CREATE TYPE "public"."price_provider" AS ENUM('stooq', 'eodhd');--> statement-breakpoint
CREATE TYPE "public"."price_snapshot_source" AS ENUM('manual', 'stooq', 'eodhd');--> statement-breakpoint
CREATE TABLE "security_price_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"provider" "price_provider" NOT NULL,
	"symbol" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD COLUMN "source" "price_snapshot_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "security_price_mappings" ADD CONSTRAINT "security_price_mappings_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "security_price_mappings_security_provider_unique" ON "security_price_mappings" USING btree ("security_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "security_price_mappings_provider_symbol_unique" ON "security_price_mappings" USING btree ("provider","symbol");