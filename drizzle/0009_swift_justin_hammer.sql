-- ENUM STRATEGY (do not "simplify" import_row_status to ADD VALUE).
-- Drizzle's migrator (both drizzle-kit migrate and the programmatic
-- node-postgres migrator) runs ALL pending migration statements inside ONE
-- wrapping transaction. Postgres forbids USING a value added by
-- `ALTER TYPE ... ADD VALUE` in the same transaction that added it, when the
-- enum type pre-existed the transaction (error 55P04, unless the type was
-- also CREATEd in that transaction).
--   * import_row_status: the backfill UPDATEs below set status = 'trashed'
--     in this same transaction, so its new values MUST arrive via a type
--     RECREATE (rename -> create -> cast columns -> drop old), which makes
--     them usable immediately. ADD VALUE here would 55P04 on a DB that has
--     any row the UPDATE touches (proven by the production-clone run and by
--     drizzle/migration-enum-safety.test.ts).
--   * audit_action: ADD VALUE is safe ONLY because 'restore'/'purge' are
--     never used inside this migration (audit rows are written at runtime).
CREATE TYPE "public"."import_link_lifecycle" AS ENUM('active', 'trashed', 'released');--> statement-breakpoint
CREATE TYPE "public"."import_provider" AS ENUM('ing', 'revolut');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'restore';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'purge';--> statement-breakpoint
ALTER TYPE "public"."import_row_status" RENAME TO "import_row_status_old";--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('pending', 'booked', 'skipped', 'duplicate', 'trashed', 'purged');--> statement-breakpoint
ALTER TABLE "import_rows" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "revolut_import_rows" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "import_rows" ALTER COLUMN "status" TYPE "public"."import_row_status" USING "status"::text::"public"."import_row_status";--> statement-breakpoint
ALTER TABLE "revolut_import_rows" ALTER COLUMN "status" TYPE "public"."import_row_status" USING "status"::text::"public"."import_row_status";--> statement-breakpoint
ALTER TABLE "import_rows" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "revolut_import_rows" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
DROP TYPE "public"."import_row_status_old";--> statement-breakpoint
CREATE TABLE "import_source_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "import_provider" NOT NULL,
	"raw_text_hash" text NOT NULL,
	"source_batch_id" uuid NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_import_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"provider" "import_provider" NOT NULL,
	"source_batch_id" uuid NOT NULL,
	"source_row_id" uuid NOT NULL,
	"source_label" text NOT NULL,
	"row_identity" text NOT NULL,
	"raw_text_hash" text NOT NULL,
	"lifecycle" "import_link_lifecycle" DEFAULT 'active' NOT NULL,
	"modified_after_import" timestamp with time zone,
	"original_booked_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "import_source_claims" ("provider", "raw_text_hash", "source_batch_id")
SELECT 'ing', "raw_text_hash", "id" FROM "import_batches";
--> statement-breakpoint
INSERT INTO "import_source_claims" ("provider", "raw_text_hash", "source_batch_id")
SELECT 'revolut', "raw_text_hash", "id" FROM "revolut_import_batches";
--> statement-breakpoint
INSERT INTO "transaction_import_links" (
	"transaction_id", "provider", "source_batch_id", "source_row_id",
	"source_label", "row_identity", "raw_text_hash", "lifecycle", "original_booked_at"
)
SELECT
	ir."transaction_id", 'ing', ib."id", ir."id", ib."statement_number",
	ib."bank_account_id"::text || ':' || ir."resolved_external_ref", ib."raw_text_hash",
	CASE WHEN t."deleted_at" IS NULL THEN 'active'::import_link_lifecycle
		ELSE 'trashed'::import_link_lifecycle END,
	COALESCE(ir."booked_at", ir."created_at")
FROM "import_rows" ir
JOIN "import_batches" ib ON ib."id" = ir."batch_id"
JOIN "transactions" t ON t."id" = ir."transaction_id"
WHERE ir."status" = 'booked' AND ir."transaction_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "transaction_import_links" (
	"transaction_id", "provider", "source_batch_id", "source_row_id",
	"source_label", "row_identity", "raw_text_hash", "lifecycle", "original_booked_at"
)
SELECT
	rbr."transaction_id", 'revolut', rib."id", rir."id", rib."source_file_name",
	rir."content_hash", rib."raw_text_hash",
	CASE WHEN t."deleted_at" IS NULL THEN 'active'::import_link_lifecycle
		ELSE 'trashed'::import_link_lifecycle END,
	COALESCE(rir."booked_at", rir."created_at")
FROM "revolut_booked_rows" rbr
JOIN "revolut_import_rows" rir ON rir."id" = rbr."source_row_id"
JOIN "revolut_import_batches" rib ON rib."id" = rir."batch_id"
JOIN "transactions" t ON t."id" = rbr."transaction_id"
WHERE rbr."transaction_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "import_rows" ir
SET "status" = 'trashed'
FROM "transactions" t
WHERE ir."transaction_id" = t."id" AND ir."status" = 'booked' AND t."deleted_at" IS NOT NULL;
--> statement-breakpoint
UPDATE "revolut_import_rows" rir
SET "status" = 'trashed'
FROM "transactions" t
WHERE rir."transaction_id" = t."id" AND rir."status" = 'booked' AND t."deleted_at" IS NOT NULL;
--> statement-breakpoint
DROP INDEX "revolut_import_batches_raw_text_hash_uidx";--> statement-breakpoint
DROP INDEX "import_batches_raw_text_hash_uidx";--> statement-breakpoint
ALTER TABLE "revolut_import_rows" ADD COLUMN "modified_after_import" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "revolut_import_rows" ADD COLUMN "modified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "modified_after_import" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "modified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "current_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_accruals" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_accruals" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction_import_links" ADD CONSTRAINT "transaction_import_links_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_source_claims_active_hash_uidx" ON "import_source_claims" USING btree ("provider","raw_text_hash") WHERE "import_source_claims"."released_at" is null;--> statement-breakpoint
CREATE INDEX "import_source_claims_batch_idx" ON "import_source_claims" USING btree ("provider","source_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_import_links_source_row_uidx" ON "transaction_import_links" USING btree ("provider","source_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_import_links_active_identity_uidx" ON "transaction_import_links" USING btree ("provider","row_identity") WHERE "transaction_import_links"."released_at" is null;--> statement-breakpoint
CREATE INDEX "transaction_import_links_transaction_idx" ON "transaction_import_links" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_import_links_batch_idx" ON "transaction_import_links" USING btree ("provider","source_batch_id");--> statement-breakpoint
CREATE INDEX "revolut_import_batches_raw_text_hash_idx" ON "revolut_import_batches" USING btree ("raw_text_hash");--> statement-breakpoint
CREATE INDEX "import_batches_raw_text_hash_idx" ON "import_batches" USING btree ("raw_text_hash");--> statement-breakpoint
CREATE INDEX "postings_transaction_revision_idx" ON "postings" USING btree ("transaction_id","revision");
