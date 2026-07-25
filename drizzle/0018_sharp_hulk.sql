-- ENUM STRATEGY (do not "simplify" tax_config_parameter to ADD VALUE).
-- Same rationale as migration 0009 (import_row_status) and
-- drizzle/migration-enum-safety.test.ts: Drizzle's migrator runs ALL pending
-- migration statements inside ONE wrapping transaction, and Postgres forbids
-- USING a value added by `ALTER TYPE ... ADD VALUE` in the same transaction
-- that added it when the enum type pre-existed the transaction (error 55P04).
-- The re-ADDed tax_config_parameter_kind_check below references
-- 'micro_revenue_tax' in this same transaction, so the new value MUST arrive
-- via a type RECREATE (rename -> create -> cast column -> drop old), which
-- makes it usable immediately. drizzle-kit generate emitted ADD VALUE here;
-- it was rewritten to the RECREATE form by hand — regenerating this file
-- reintroduces the 55P04.
--   * The kind check is DROPped before the column re-cast because its stored
--     expression carries casts to the renamed old type.
--   * tax_config_assert_contiguous_series takes tax_config_parameter as its
--     argument type, so it blocks DROP TYPE of the old enum; it is dropped
--     and recreated (identical body, from 0008) against the new type. Its
--     caller (tax_config_contiguity_trigger) resolves it by name at runtime
--     and needs no change; no DML touches tax_config in this migration, so
--     no trigger can fire inside the swap window.
--   * tax_config_bracket_parent_trigger is declared AFTER INSERT OR UPDATE
--     OF parameter, value_kind; that column list is a dependency on
--     "parameter" that makes the re-cast fail with "cannot alter type of a
--     column used in a trigger definition", so the trigger is dropped before
--     the swap and recreated byte-identical to 0008 afterwards.
ALTER TABLE "tax_config" DROP CONSTRAINT "tax_config_parameter_kind_check";--> statement-breakpoint
DROP TRIGGER "tax_config_bracket_parent_trigger" ON "tax_config";--> statement-breakpoint
ALTER TYPE "public"."tax_config_parameter" RENAME TO "tax_config_parameter_old";--> statement-breakpoint
CREATE TYPE "public"."tax_config_parameter" AS ENUM('cas_employee_rate', 'cass_employee_rate', 'cam_employer_rate', 'income_tax_rate', 'dividend_tax_rate', 'minimum_wage', 'personal_deduction', 'cass_investment_brackets', 'micro_revenue_tax');--> statement-breakpoint
ALTER TABLE "tax_config" ALTER COLUMN "parameter" TYPE "public"."tax_config_parameter" USING "parameter"::text::"public"."tax_config_parameter";--> statement-breakpoint
DROP FUNCTION "tax_config_assert_contiguous_series"("public"."tax_config_parameter_old");--> statement-breakpoint
DROP TYPE "public"."tax_config_parameter_old";--> statement-breakpoint
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
CREATE CONSTRAINT TRIGGER "tax_config_bracket_parent_trigger"
AFTER INSERT OR UPDATE OF parameter, value_kind ON "tax_config"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "tax_config_bracket_trigger"();--> statement-breakpoint
ALTER TABLE "tax_config" ADD CONSTRAINT "tax_config_parameter_kind_check" CHECK ((
        "tax_config"."parameter" in (
          'cas_employee_rate',
          'cass_employee_rate',
          'cam_employer_rate',
          'income_tax_rate',
          'dividend_tax_rate',
          'micro_revenue_tax'
        ) and "tax_config"."value_kind" = 'rate_bps'
      ) or (
        "tax_config"."parameter" in ('minimum_wage', 'personal_deduction')
        and "tax_config"."value_kind" = 'amount_minor'
      ) or (
        "tax_config"."parameter" = 'cass_investment_brackets'
        and "tax_config"."value_kind" = 'bracket_set'
      ));
