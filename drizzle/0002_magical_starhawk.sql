ALTER TABLE "postings" ADD COLUMN "counterparty_iban" text;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "external_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "postings_account_external_ref_uidx" ON "postings" USING btree ("account_id","external_ref") WHERE "postings"."external_ref" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "external_ref";