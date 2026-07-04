import { date, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { taxRuleType } from "./enums";
import { id, moneyMinor, softDelete, timestamps } from "./helpers";
import { postings, transactions } from "./transactions";

/**
 * Romanian tax parameters, versioned by validity window. Rates are in basis
 * points (1% = 100 bps) so they stay integers. Thresholds are integer minor
 * units where a rule has them (e.g. the micro-enterprise revenue ceiling, the
 * CASS minimum-wage multiples); null where not applicable.
 */
export const taxRules = pgTable("tax_rules", {
  id,
  ruleType: taxRuleType("rule_type").notNull(),
  rateBps: integer("rate_bps").notNull(),
  thresholdMin: moneyMinor("threshold_min"),
  thresholdMax: moneyMinor("threshold_max"),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  notes: text("notes"),
  ...timestamps,
  ...softDelete,
});

/**
 * Links a transaction to the posting it generated on a tax_liability account
 * and the tax rule that was applied. Derived data — lives and dies with its
 * transaction (no soft delete). quarter is null for taxes assessed annually.
 */
export const taxAccruals = pgTable(
  "tax_accruals",
  {
    id,
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    postingId: uuid("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),
    taxRuleId: uuid("tax_rule_id")
      .notNull()
      .references(() => taxRules.id),
    year: integer("year").notNull(),
    quarter: integer("quarter"),
    ...timestamps,
  },
  (table) => [
    index("tax_accruals_transaction_id_idx").on(table.transactionId),
    index("tax_accruals_year_quarter_idx").on(table.year, table.quarter),
  ],
);
