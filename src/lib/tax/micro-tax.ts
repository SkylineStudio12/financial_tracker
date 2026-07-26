/**
 * Micro-enterprise revenue tax accrual — the ONE place that constructs the
 * accrual legs for company income, shared by the manual entry form and the
 * statement importer so both produce identical accruals.
 *
 * Extracted verbatim from saveStandardTransaction (behavior-unchanged
 * refactor, Stage 4 amendment 4): same lookups, same rounding, same error
 * messages, same posting/accrual shapes.
 *
 * The rate is NEVER a literal here or in any caller: since the U3 cutover it
 * comes from the `micro_revenue_tax` window in `tax_config`, resolved at the
 * transaction date via resolveTaxConfig (fail-loud on uncovered dates).
 * `tax_rules` is queried ONLY for the accrual's tax_rule_id provenance link —
 * tax_accruals.tax_rule_id is a NOT NULL FK to tax_rules until the provenance
 * cutover unit (U5+) re-homes it.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, entities } from "@/db/schema";
import {
  LedgerValidationError,
  type AccrualInput,
  type PostingInput,
} from "@/lib/ledger/types";
import { requireRate, resolveTaxConfig } from "./config-service";
import { getActiveRule, quarterOf, yearOf } from "./rules";

export interface MicroTaxAccrualPlan {
  /** Liability leg (negative = owed) + equity "Taxes" expense leg, in that
   * order; empty when no accrual applies (non-company, zero tax). */
  postings: PostingInput[];
  /** Accrual link for the liability leg; empty when postings is empty. */
  accruals: AccrualInput[];
}

/**
 * Company revenue: income on a company auto-accrues micro revenue tax at
 * the active rate — liability leg (negative = owed) balanced by an equity
 * expense leg on the company's "Taxes" category.
 *
 * Callers gate on "this is income landing on a real account" (direction and
 * account-type checks stay with the caller); the entity-type check lives
 * here so no caller can accrue micro tax for the household.
 */
export async function planMicroTaxAccrual(params: {
  entityId: string;
  /** Transaction date, YYYY-MM-DD — selects the active rule. */
  date: string;
  /** Total revenue in RON minor units (sum of the categorized equity legs). */
  revenueRonMinor: number;
  /** The entity's equity account — carries the Taxes expense leg. */
  equityAccountId: string;
  /** Index the first returned posting will occupy in the caller's posting
   * array, so the accrual link points at the liability leg. */
  basePostingIndex: number;
}): Promise<MicroTaxAccrualPlan> {
  const [entity] = await db
    .select({ type: entities.type })
    .from(entities)
    .where(eq(entities.id, params.entityId));
  if (entity?.type !== "company") {
    return { postings: [], accruals: [] };
  }
  // tax_config is the rate authority and is resolved FIRST, so an uncovered
  // date surfaces tax.configCoverageMissing (the cutover's error) rather than
  // tax_rules' tax.taxRuleMissing. getActiveRule follows for the accrual FK's
  // provenance id only.
  const microConfig = await resolveTaxConfig("micro_revenue_tax", params.date);
  const microRule = await getActiveRule("micro_revenue_tax", params.date);
  const microTax = Math.round((params.revenueRonMinor * requireRate(microConfig)) / 10_000);
  if (microTax <= 0) {
    return { postings: [], accruals: [] };
  }
  const [taxAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, params.entityId),
        eq(accounts.type, "tax_liability"),
        eq(accounts.isActive, true),
        isNull(accounts.deletedAt),
      ),
    );
  if (!taxAccount) {
    throw new LedgerValidationError("tax.companyTaxLiabilityMissing");
  }
  const [taxesCategory] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.entityId, params.entityId),
        eq(categories.name, "Taxes"),
        isNull(categories.deletedAt),
      ),
    );
  if (!taxesCategory) {
    throw new LedgerValidationError("tax.taxesCategoryMissing");
  }
  return {
    postings: [
      { accountId: taxAccount.id, amount: -microTax },
      { accountId: params.equityAccountId, amount: microTax, categoryId: taxesCategory.id },
    ],
    accruals: [
      {
        postingIndex: params.basePostingIndex,
        taxRuleId: microRule.id,
        year: yearOf(params.date),
        quarter: quarterOf(params.date),
      },
    ],
  };
}
