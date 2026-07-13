import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currency, priceProvider, priceSnapshotSource, tradeKind } from "./enums";
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

export const securityPriceMappings = pgTable(
  "security_price_mappings",
  {
    id,
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id),
    provider: priceProvider("provider").notNull(),
    symbol: text("symbol").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("security_price_mappings_security_provider_unique").on(
      table.securityId,
      table.provider,
    ),
    uniqueIndex("security_price_mappings_provider_symbol_unique").on(
      table.provider,
      table.symbol,
    ),
  ],
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
    /**
     * The broker's ACTUALLY-APPLIED conversion rate to RON for non-RON
     * trades (Phase 4 decision: structured, not notes-only like the bank
     * importer's printed FX facts). Same shape as fx_rates.rate_to_ron.
     *
     * SINGLE SOURCE OF TRUTH RULE: this rate is the INPUT and the postings'
     * amount_ron is the stored OUTPUT — the write service must derive the
     * trade's RON legs from this rate (via the explicit-amountRon override,
     * the transfer-mirror pattern), never store two independently-sourced
     * values. NULL only where no conversion happened (RON-denominated
     * security); enforcement is service logic, not a DB constraint.
     */
    fxRateToRon: numeric("fx_rate_to_ron", { precision: 18, scale: 6 }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("trades_account_id_idx").on(table.accountId),
    index("trades_security_id_idx").on(table.securityId),
    index("trades_transaction_id_idx").on(table.transactionId),
  ],
);

/**
 * FIFO lot tracking (Phase 4 decision: FIFO cost basis, but lots STORED so
 * specific-lot identification stays possible later without a migration).
 *
 * A LOT IS A BUY TRADE — no separate lots table. Manual entry only in Phase
 * 4 (no transfers-in, no splits, opening positions enter as ordinary buy
 * trades), so every share a sell can consume originated in exactly one buy
 * row, and a lots table would duplicate trades 1:1 for no gain.
 *
 * Each row records one sell consuming part of one buy lot. Everything is
 * IMMUTABLE-BY-APPEND: a lot's remaining quantity is DERIVED
 * (buy.quantity − Σ live consumptions of that buy), never a mutated column —
 * so soft-deleting a mistaken sell restores its lots automatically (the
 * same live-row scoping logic as L-0011), and history stays auditable.
 *
 * FIFO is WRITE-SERVICE POLICY (consume live lots in buy-date order), not a
 * schema property: specific-lot later = same table, different lot selection,
 * zero migration. Over-consumption (Σ consumed > lot quantity among live
 * rows) is application-enforced by the service, like zero-sum.
 *
 * cost_basis_minor is the consumed slice of the buy lot's cost in the
 * security's currency; cost_basis_ron_minor is that slice's RON value AT
 * BUY TIME (from the buy trade's postings/rate) — stored at write time so
 * realized RON gain (sell proceeds in RON − this) never re-derives
 * historical rates, exactly the amount_ron philosophy. Whether fees
 * capitalize into basis is a write-path decision (Stage 2), not encoded here.
 */
export const lotConsumptions = pgTable(
  "lot_consumptions",
  {
    id,
    sellTradeId: uuid("sell_trade_id")
      .notNull()
      .references(() => trades.id),
    buyTradeId: uuid("buy_trade_id")
      .notNull()
      .references(() => trades.id),
    quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull(),
    costBasisMinor: moneyMinor("cost_basis_minor").notNull(),
    costBasisRonMinor: moneyMinor("cost_basis_ron_minor").notNull(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("lot_consumptions_sell_trade_id_idx").on(table.sellTradeId),
    index("lot_consumptions_buy_trade_id_idx").on(table.buyTradeId),
    // One sell consumes a given buy lot at most once AMONG LIVE ROWS —
    // scoped to deleted_at IS NULL per L-0011 (soft-deleted table: the
    // constraint must bind only live rows or an unwound sell blocks re-entry).
    uniqueIndex("lot_consumptions_sell_buy_uidx")
      .on(table.sellTradeId, table.buyTradeId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

/** A split changes share units, never money or basis. The service records the
 * event and its exact per-lot transformations before updating quantities. */
export const stockSplits = pgTable(
  "stock_splits",
  {
    id,
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    occurredAt: text("occurred_at").notNull(),
    ratio: integer("ratio").notNull(),
    ...timestamps,
  },
  (table) => [
    index("stock_splits_security_id_idx").on(table.securityId),
    uniqueIndex("stock_splits_account_security_occurred_uidx").on(
      table.accountId,
      table.securityId,
      table.occurredAt,
    ),
  ],
);

export const stockSplitLotAdjustments = pgTable(
  "stock_split_lot_adjustments",
  {
    id,
    splitId: uuid("split_id")
      .notNull()
      .references(() => stockSplits.id, { onDelete: "cascade" }),
    buyTradeId: uuid("buy_trade_id")
      .notNull()
      .references(() => trades.id),
    quantityBefore: numeric("quantity_before", { precision: 20, scale: 8 }).notNull(),
    quantityAfter: numeric("quantity_after", { precision: 20, scale: 8 }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("stock_split_lot_adjustments_split_buy_uidx").on(table.splitId, table.buyTradeId)],
);

export const stockSplitConsumptionAdjustments = pgTable(
  "stock_split_consumption_adjustments",
  {
    id,
    splitId: uuid("split_id")
      .notNull()
      .references(() => stockSplits.id, { onDelete: "cascade" }),
    consumptionId: uuid("consumption_id")
      .notNull()
      .references(() => lotConsumptions.id),
    quantityBefore: numeric("quantity_before", { precision: 20, scale: 8 }).notNull(),
    quantityAfter: numeric("quantity_after", { precision: 20, scale: 8 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("stock_split_consumption_adjustments_split_consumption_uidx").on(
      table.splitId,
      table.consumptionId,
    ),
  ],
);

/** Daily security prices in minor units with explicit writer provenance.
 * No soft delete: the shared upsert applies source-precedence policy. */
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id,
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id),
    date: date("date").notNull(),
    price: moneyMinor("price").notNull(),
    source: priceSnapshotSource("source").notNull().default("manual"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("price_snapshots_security_id_date_unique").on(table.securityId, table.date),
  ],
);
