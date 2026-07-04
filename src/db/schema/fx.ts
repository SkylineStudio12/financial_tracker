import { date, numeric, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { currency } from "./enums";
import { id, timestamps } from "./helpers";

/**
 * Daily FX rates to RON (BNR reference rates, synced in a later phase).
 * The rate is a ratio, not a money amount, so numeric is correct here —
 * the integer-minor-units rule applies only to amounts.
 * No soft delete: synced data is replaced, not user-edited.
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    id,
    date: date("date").notNull(),
    currency: currency("currency").notNull(),
    rateToRon: numeric("rate_to_ron", { precision: 18, scale: 6 }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("fx_rates_date_currency_unique").on(table.date, table.currency)],
);
