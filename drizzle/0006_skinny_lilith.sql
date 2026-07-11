-- Additive and one-way: PostgreSQL cannot remove enum values safely. Account
-- rows using `clearing` are provisioned only in 0007, after this migration's
-- transaction commits (PostgreSQL forbids using a new enum value earlier).
ALTER TYPE "public"."account_type" ADD VALUE 'clearing' BEFORE 'tax_liability';--> statement-breakpoint
CREATE TABLE "revolut_booked_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_hash" text NOT NULL,
	"semantic_key" text NOT NULL,
	"source_row_id" uuid NOT NULL,
	"transaction_id" uuid,
	"stock_split_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revolut_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"owner" "account_owner" NOT NULL,
	"source_file_name" text NOT NULL,
	"raw_text_hash" text NOT NULL,
	"parsed_row_count" integer NOT NULL,
	"staged_row_count" integer NOT NULL,
	"correction_pair_count" integer NOT NULL,
	"verification" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"booked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revolut_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"occurred_at" text NOT NULL,
	"type" text NOT NULL,
	"kind" text NOT NULL,
	"ticker" text,
	"currency" "currency" NOT NULL,
	"content_hash" text NOT NULL,
	"semantic_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"suspected_duplicate" boolean DEFAULT false NOT NULL,
	"status" "import_row_status" DEFAULT 'pending' NOT NULL,
	"transaction_id" uuid,
	"stock_split_id" uuid,
	"booked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_split_consumption_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"split_id" uuid NOT NULL,
	"consumption_id" uuid NOT NULL,
	"quantity_before" numeric(20, 8) NOT NULL,
	"quantity_after" numeric(20, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_split_lot_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"split_id" uuid NOT NULL,
	"buy_trade_id" uuid NOT NULL,
	"quantity_before" numeric(20, 8) NOT NULL,
	"quantity_after" numeric(20, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"occurred_at" text NOT NULL,
	"ratio" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "revolut_booked_rows" ADD CONSTRAINT "revolut_booked_rows_source_row_id_revolut_import_rows_id_fk" FOREIGN KEY ("source_row_id") REFERENCES "public"."revolut_import_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revolut_booked_rows" ADD CONSTRAINT "revolut_booked_rows_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revolut_booked_rows" ADD CONSTRAINT "revolut_booked_rows_stock_split_id_stock_splits_id_fk" FOREIGN KEY ("stock_split_id") REFERENCES "public"."stock_splits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revolut_import_batches" ADD CONSTRAINT "revolut_import_batches_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revolut_import_rows" ADD CONSTRAINT "revolut_import_rows_batch_id_revolut_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."revolut_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revolut_import_rows" ADD CONSTRAINT "revolut_import_rows_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revolut_import_rows" ADD CONSTRAINT "revolut_import_rows_stock_split_id_stock_splits_id_fk" FOREIGN KEY ("stock_split_id") REFERENCES "public"."stock_splits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_split_consumption_adjustments" ADD CONSTRAINT "stock_split_consumption_adjustments_split_id_stock_splits_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."stock_splits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_split_consumption_adjustments" ADD CONSTRAINT "stock_split_consumption_adjustments_consumption_id_lot_consumptions_id_fk" FOREIGN KEY ("consumption_id") REFERENCES "public"."lot_consumptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_split_lot_adjustments" ADD CONSTRAINT "stock_split_lot_adjustments_split_id_stock_splits_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."stock_splits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_split_lot_adjustments" ADD CONSTRAINT "stock_split_lot_adjustments_buy_trade_id_trades_id_fk" FOREIGN KEY ("buy_trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_splits" ADD CONSTRAINT "stock_splits_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_splits" ADD CONSTRAINT "stock_splits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "revolut_booked_rows_content_hash_uidx" ON "revolut_booked_rows" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "revolut_booked_rows_semantic_key_idx" ON "revolut_booked_rows" USING btree ("semantic_key");--> statement-breakpoint
CREATE UNIQUE INDEX "revolut_import_batches_raw_text_hash_uidx" ON "revolut_import_batches" USING btree ("raw_text_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "revolut_import_rows_batch_line_uidx" ON "revolut_import_rows" USING btree ("batch_id","line_no");--> statement-breakpoint
CREATE INDEX "revolut_import_rows_batch_id_idx" ON "revolut_import_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "revolut_import_rows_content_hash_idx" ON "revolut_import_rows" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "revolut_import_rows_semantic_key_idx" ON "revolut_import_rows" USING btree ("semantic_key");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_split_consumption_adjustments_split_consumption_uidx" ON "stock_split_consumption_adjustments" USING btree ("split_id","consumption_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_split_lot_adjustments_split_buy_uidx" ON "stock_split_lot_adjustments" USING btree ("split_id","buy_trade_id");--> statement-breakpoint
CREATE INDEX "stock_splits_security_id_idx" ON "stock_splits" USING btree ("security_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_splits_account_security_occurred_uidx" ON "stock_splits" USING btree ("account_id","security_id","occurred_at");
