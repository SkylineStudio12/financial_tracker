import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import {
  taxConfigParameter,
  taxConfigStatus,
  taxConfigValueKind,
  taxRuleType,
} from "./enums";
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
 * Day-level Romanian tax configuration. Windows are half-open
 * [validFrom, validTo); migration-level deferred constraints enforce no gaps
 * or overlaps within each parameter series.
 */
export const taxConfig = pgTable(
  "tax_config",
  {
    id,
    parameter: taxConfigParameter("parameter").notNull(),
    valueKind: taxConfigValueKind("value_kind").notNull(),
    rateBps: integer("rate_bps"),
    amountMinor: moneyMinor("amount_minor"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    status: taxConfigStatus("status").notNull(),
    source: text("source").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tax_config_parameter_valid_from_uidx").on(table.parameter, table.validFrom),
    check(
      "tax_config_valid_window_check",
      sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
    ),
    check("tax_config_source_nonblank_check", sql`btrim(${table.source}) <> ''`),
    check(
      "tax_config_value_shape_check",
      sql`(
        ${table.valueKind} = 'rate_bps'
        and ${table.rateBps} between 0 and 10000
        and ${table.amountMinor} is null
      ) or (
        ${table.valueKind} = 'amount_minor'
        and ${table.rateBps} is null
        and ${table.amountMinor} >= 0
      ) or (
        ${table.valueKind} = 'bracket_set'
        and ${table.rateBps} is null
        and ${table.amountMinor} is null
      )`,
    ),
    check(
      "tax_config_parameter_kind_check",
      sql`(
        ${table.parameter} in (
          'cas_employee_rate',
          'cass_employee_rate',
          'cam_employer_rate',
          'income_tax_rate',
          'dividend_tax_rate'
        ) and ${table.valueKind} = 'rate_bps'
      ) or (
        ${table.parameter} in ('minimum_wage', 'personal_deduction')
        and ${table.valueKind} = 'amount_minor'
      ) or (
        ${table.parameter} = 'cass_investment_brackets'
        and ${table.valueKind} = 'bracket_set'
      )`,
    ),
  ],
);

/** Independent CASS bracket facts; coincident 2026 bounds and bases remain
 * separate columns because future legislation may change either independently. */
export const taxConfigCassInvestmentBrackets = pgTable(
  "tax_config_cass_investment_brackets",
  {
    id,
    taxConfigId: uuid("tax_config_id")
      .notNull()
      .references(() => taxConfig.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    lowerMinor: moneyMinor("lower_minor").notNull(),
    upperMinor: moneyMinor("upper_minor"),
    baseMinor: moneyMinor("base_minor").notNull(),
    cassMinor: moneyMinor("cass_minor").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tax_config_cass_brackets_config_ordinal_uidx").on(
      table.taxConfigId,
      table.ordinal,
    ),
    check("tax_config_cass_brackets_ordinal_check", sql`${table.ordinal} >= 0`),
    check(
      "tax_config_cass_brackets_values_check",
      sql`${table.lowerMinor} >= 0
        and (${table.upperMinor} is null or ${table.upperMinor} > ${table.lowerMinor})
        and ${table.baseMinor} >= 0
        and ${table.cassMinor} >= 0`,
    ),
  ],
);

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
    revision: integer("revision").notNull().default(1),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("tax_accruals_transaction_id_idx").on(table.transactionId),
    index("tax_accruals_year_quarter_idx").on(table.year, table.quarter),
  ],
);
