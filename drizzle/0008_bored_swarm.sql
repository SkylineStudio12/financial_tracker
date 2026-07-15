CREATE TYPE "public"."tax_config_parameter" AS ENUM('cas_employee_rate', 'cass_employee_rate', 'cam_employer_rate', 'income_tax_rate', 'dividend_tax_rate', 'minimum_wage', 'personal_deduction', 'cass_investment_brackets');--> statement-breakpoint
CREATE TYPE "public"."tax_config_status" AS ENUM('confirmed', 'estimate');--> statement-breakpoint
CREATE TYPE "public"."tax_config_value_kind" AS ENUM('rate_bps', 'amount_minor', 'bracket_set');--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
CREATE TABLE "tax_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parameter" "tax_config_parameter" NOT NULL,
	"value_kind" "tax_config_value_kind" NOT NULL,
	"rate_bps" integer,
	"amount_minor" bigint,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"status" "tax_config_status" NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_config_valid_window_check" CHECK ("tax_config"."valid_to" is null or "tax_config"."valid_to" > "tax_config"."valid_from"),
	CONSTRAINT "tax_config_source_nonblank_check" CHECK (btrim("tax_config"."source") <> ''),
	CONSTRAINT "tax_config_value_shape_check" CHECK ((
        "tax_config"."value_kind" = 'rate_bps'
        and "tax_config"."rate_bps" between 0 and 10000
        and "tax_config"."amount_minor" is null
      ) or (
        "tax_config"."value_kind" = 'amount_minor'
        and "tax_config"."rate_bps" is null
        and "tax_config"."amount_minor" >= 0
      ) or (
        "tax_config"."value_kind" = 'bracket_set'
        and "tax_config"."rate_bps" is null
        and "tax_config"."amount_minor" is null
      )),
	CONSTRAINT "tax_config_parameter_kind_check" CHECK ((
        "tax_config"."parameter" in (
          'cas_employee_rate',
          'cass_employee_rate',
          'cam_employer_rate',
          'income_tax_rate',
          'dividend_tax_rate'
        ) and "tax_config"."value_kind" = 'rate_bps'
      ) or (
        "tax_config"."parameter" in ('minimum_wage', 'personal_deduction')
        and "tax_config"."value_kind" = 'amount_minor'
      ) or (
        "tax_config"."parameter" = 'cass_investment_brackets'
        and "tax_config"."value_kind" = 'bracket_set'
      ))
);
--> statement-breakpoint
CREATE TABLE "tax_config_cass_investment_brackets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tax_config_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"lower_minor" bigint NOT NULL,
	"upper_minor" bigint,
	"base_minor" bigint NOT NULL,
	"cass_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_config_cass_brackets_ordinal_check" CHECK ("tax_config_cass_investment_brackets"."ordinal" >= 0),
	CONSTRAINT "tax_config_cass_brackets_values_check" CHECK ("tax_config_cass_investment_brackets"."lower_minor" >= 0
        and ("tax_config_cass_investment_brackets"."upper_minor" is null or "tax_config_cass_investment_brackets"."upper_minor" > "tax_config_cass_investment_brackets"."lower_minor")
        and "tax_config_cass_investment_brackets"."base_minor" >= 0
        and "tax_config_cass_investment_brackets"."cass_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "tax_config_cass_investment_brackets" ADD CONSTRAINT "tax_config_cass_investment_brackets_tax_config_id_tax_config_id_fk" FOREIGN KEY ("tax_config_id") REFERENCES "public"."tax_config"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_config_parameter_valid_from_uidx" ON "tax_config" USING btree ("parameter","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_config_cass_brackets_config_ordinal_uidx" ON "tax_config_cass_investment_brackets" USING btree ("tax_config_id","ordinal");--> statement-breakpoint
ALTER TABLE "tax_config" ADD CONSTRAINT "tax_config_no_overlapping_windows"
EXCLUDE USING gist (
	"parameter" WITH =,
	daterange("valid_from", coalesce("valid_to", 'infinity'::date), '[)') WITH &&
) DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE FUNCTION "tax_config_assert_contiguous_series"(checked_parameter tax_config_parameter)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (
		WITH ordered AS (
			SELECT
				valid_to,
				lead(valid_from) OVER (ORDER BY valid_from) AS next_valid_from
			FROM tax_config
			WHERE parameter = checked_parameter
		)
		SELECT 1
		FROM ordered
		WHERE
			(next_valid_from IS NULL AND valid_to IS NOT NULL)
			OR (next_valid_from IS NOT NULL AND valid_to IS DISTINCT FROM next_valid_from)
	) THEN
		RAISE EXCEPTION 'tax_config windows are not contiguous for %', checked_parameter
			USING ERRCODE = '23514', CONSTRAINT = 'tax_config_contiguous_windows_check';
	END IF;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "tax_config_contiguity_trigger"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP <> 'DELETE' THEN
		PERFORM tax_config_assert_contiguous_series(NEW.parameter);
	END IF;
	IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD.parameter IS DISTINCT FROM NEW.parameter) THEN
		PERFORM tax_config_assert_contiguous_series(OLD.parameter);
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "tax_config_contiguous_windows_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "tax_config"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "tax_config_contiguity_trigger"();--> statement-breakpoint
CREATE FUNCTION "tax_config_assert_bracket_set"(checked_config_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	parent_kind tax_config_value_kind;
	parent_parameter tax_config_parameter;
BEGIN
	SELECT value_kind, parameter
	INTO parent_kind, parent_parameter
	FROM tax_config
	WHERE id = checked_config_id;

	IF NOT FOUND THEN
		RETURN;
	END IF;

	IF parent_kind <> 'bracket_set' OR parent_parameter <> 'cass_investment_brackets' THEN
		IF EXISTS (
			SELECT 1 FROM tax_config_cass_investment_brackets
			WHERE tax_config_id = checked_config_id
		) THEN
			RAISE EXCEPTION 'tax config % is not an investment CASS bracket set', checked_config_id
				USING ERRCODE = '23514', CONSTRAINT = 'tax_config_cass_bracket_parent_check';
		END IF;
		RETURN;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM tax_config_cass_investment_brackets
		WHERE tax_config_id = checked_config_id
	) OR EXISTS (
		WITH ordered AS (
			SELECT
				ordinal,
				lower_minor,
				upper_minor,
				row_number() OVER (ORDER BY ordinal) - 1 AS expected_ordinal,
				lead(lower_minor) OVER (ORDER BY ordinal) AS next_lower
			FROM tax_config_cass_investment_brackets
			WHERE tax_config_id = checked_config_id
		)
		SELECT 1
		FROM ordered
		WHERE
			ordinal <> expected_ordinal
			OR (ordinal = 0 AND lower_minor <> 0)
			OR (next_lower IS NULL AND upper_minor IS NOT NULL)
			OR (next_lower IS NOT NULL AND upper_minor IS DISTINCT FROM next_lower)
	) THEN
		RAISE EXCEPTION 'investment CASS brackets are not contiguous for %', checked_config_id
			USING ERRCODE = '23514', CONSTRAINT = 'tax_config_cass_bracket_ranges_check';
	END IF;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "tax_config_bracket_trigger"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_TABLE_NAME = 'tax_config' THEN
		PERFORM tax_config_assert_bracket_set(COALESCE(NEW.id, OLD.id));
	ELSIF TG_OP <> 'DELETE' THEN
		PERFORM tax_config_assert_bracket_set(NEW.tax_config_id);
		IF TG_OP = 'UPDATE' AND OLD.tax_config_id IS DISTINCT FROM NEW.tax_config_id THEN
			PERFORM tax_config_assert_bracket_set(OLD.tax_config_id);
		END IF;
	ELSE
		PERFORM tax_config_assert_bracket_set(OLD.tax_config_id);
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "tax_config_bracket_parent_trigger"
AFTER INSERT OR UPDATE OF parameter, value_kind ON "tax_config"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "tax_config_bracket_trigger"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "tax_config_bracket_rows_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "tax_config_cass_investment_brackets"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "tax_config_bracket_trigger"();
