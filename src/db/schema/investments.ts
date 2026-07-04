import {
  boolean,
  date,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currency, tradeKind } from "./enums";
import { id, moneyMinor, softDelete, timestamps } from "./helpers";
import { accounts } from "./entities";
import { transactions } from "./transactions";

export const securities = pgTable(
  "securities",
  {
    id,
    ticker: text("ticker").notNull(),
    name: text("name").notNull(),
    currency: currency("currency").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (table) => [uniqueIndex("securities_ticker_unique").on(table.ticker)],
);

/**
 * A brokerage event, always linked to the transaction that carries its
 * postings. quantity is NOT money (fractional shares), so high-precision
 * numeric is correct; price and total ARE money — integer minor units in
 * the security's currency.
 */
export const trades = pgTable(
  "trades",
  {
    id,
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    kind: tradeKind("kind").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull(),
    price: moneyMinor("price").notNull(),
    total: moneyMinor("total").notNull(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("trades_account_id_idx").on(table.accountId),
    index("trades_security_id_idx").on(table.securityId),
    index("trades_transaction_id_idx").on(table.transactionId),
  ],
);

/** Daily security prices in minor units (synced in a later phase).
 * No soft delete: synced data is replaced, not user-edited. */
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id,
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id),
    date: date("date").notNull(),
    price: moneyMinor("price").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("price_snapshots_security_id_date_unique").on(table.securityId, table.date),
  ],
);
