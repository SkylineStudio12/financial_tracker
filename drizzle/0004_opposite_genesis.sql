CREATE TABLE "lot_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sell_trade_id" uuid NOT NULL,
	"buy_trade_id" uuid NOT NULL,
	"quantity" numeric(20, 8) NOT NULL,
	"cost_basis_minor" bigint NOT NULL,
	"cost_basis_ron_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "fx_rate_to_ron" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_sell_trade_id_trades_id_fk" FOREIGN KEY ("sell_trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_buy_trade_id_trades_id_fk" FOREIGN KEY ("buy_trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lot_consumptions_sell_trade_id_idx" ON "lot_consumptions" USING btree ("sell_trade_id");--> statement-breakpoint
CREATE INDEX "lot_consumptions_buy_trade_id_idx" ON "lot_consumptions" USING btree ("buy_trade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lot_consumptions_sell_buy_uidx" ON "lot_consumptions" USING btree ("sell_trade_id","buy_trade_id") WHERE "lot_consumptions"."deleted_at" IS NULL;