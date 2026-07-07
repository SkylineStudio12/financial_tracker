CREATE TYPE "public"."import_row_status" AS ENUM('pending', 'booked', 'skipped', 'duplicate');--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"source" text NOT NULL,
	"statement_number" text NOT NULL,
	"statement_iban" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"opening_balance_minor" bigint NOT NULL,
	"closing_balance_minor" bigint NOT NULL,
	"raw_text_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"line_no" text NOT NULL,
	"resolved_external_ref" text NOT NULL,
	"kind" text NOT NULL,
	"confidence" text NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb NOT NULL,
	"suggested_category_id" uuid,
	"overlap_suspect" boolean DEFAULT false NOT NULL,
	"status" "import_row_status" DEFAULT 'pending' NOT NULL,
	"transaction_id" uuid,
	"booked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "postings_account_external_ref_uidx";--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_bank_account_id_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_suggested_category_id_categories_id_fk" FOREIGN KEY ("suggested_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_raw_text_hash_uidx" ON "import_batches" USING btree ("raw_text_hash");--> statement-breakpoint
CREATE INDEX "import_batches_account_period_idx" ON "import_batches" USING btree ("bank_account_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_batch_line_no_uidx" ON "import_rows" USING btree ("batch_id","line_no");--> statement-breakpoint
CREATE INDEX "import_rows_batch_id_idx" ON "import_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "postings_account_external_ref_uidx" ON "postings" USING btree ("account_id","external_ref") WHERE "postings"."external_ref" IS NOT NULL AND "postings"."deleted_at" IS NULL;