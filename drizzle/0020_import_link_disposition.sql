CREATE TYPE "public"."import_review_disposition" AS ENUM('standard', 'drawing', 'linked_existing');--> statement-breakpoint
DROP INDEX "transaction_import_links_source_row_uidx";--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "review_disposition" "import_review_disposition";--> statement-breakpoint
UPDATE "import_rows" SET "review_disposition" = 'standard' WHERE "status" = 'confirmed' AND "kind" <> 'owner_transfer';--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_import_links_active_transaction_uidx" ON "transaction_import_links" USING btree ("transaction_id") WHERE "transaction_import_links"."released_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_import_links_source_row_uidx" ON "transaction_import_links" USING btree ("provider","source_row_id") WHERE "transaction_import_links"."released_at" is null;
