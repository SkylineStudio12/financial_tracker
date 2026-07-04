import { pgEnum } from "drizzle-orm/pg-core";

export const entityType = pgEnum("entity_type", ["household", "company"]);

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
