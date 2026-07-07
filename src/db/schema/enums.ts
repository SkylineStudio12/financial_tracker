import { pgEnum } from "drizzle-orm/pg-core";

export const entityType = pgEnum("entity_type", ["household", "company"]);

/**
 * Owner of a Household account — a presentation-layer view filter, not a new
 * bookkeeping unit. Every real Household account belongs to exactly one
 * person (there are no joint accounts); Household itself is the shared
 * consolidated view over both people's accounts. NULL where ownership does
 * not apply: company accounts and the structural Household equity account.
 * Tax logic never reads this column.
 */
export const accountOwner = pgEnum("account_owner", ["greg", "andra"]);

export const accountType = pgEnum("account_type", [
  "bank",
  "cash",
  "brokerage",
  "tax_liability",
  "equity",
]);

export const currency = pgEnum("currency", ["RON", "EUR", "USD"]);

export const transactionKind = pgEnum("transaction_kind", [
  "standard",
  "transfer",
  "salary",
  "dividend",
  "trade",
  "opening_balance",
]);

export const categoryKind = pgEnum("category_kind", ["income", "expense"]);

export const tradeKind = pgEnum("trade_kind", ["buy", "sell", "dividend", "fee"]);

export const taxRuleType = pgEnum("tax_rule_type", [
  "micro_revenue_tax",
  "dividend_tax",
  "cass_dividend",
  "salary_income_tax",
  "salary_cas",
  "salary_cass",
  "cam",
]);

export const auditAction = pgEnum("audit_action", ["insert", "update", "delete"]);

/**
 * Review-inbox lifecycle of one staged statement row. `duplicate` means the
 * row's external_ref already exists on a live posting (seen at batch
 * creation or when a booking attempt hit the unique index).
 */
export const importRowStatus = pgEnum("import_row_status", [
  "pending",
  "booked",
  "skipped",
  "duplicate",
]);
