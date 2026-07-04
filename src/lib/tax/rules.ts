import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { taxRules } from "@/db/schema";
import type { taxRuleType } from "@/db/schema";
import { LedgerValidationError } from "@/lib/ledger";

export type TaxRuleType = (typeof taxRuleType.enumValues)[number];

export interface ActiveRule {
  id: string;
  ruleType: TaxRuleType;
  rateBps: number;
  notes: string | null;
}

/** The rule of a given type active on a date (validity window match). */
export async function getActiveRule(type: TaxRuleType, date: string): Promise<ActiveRule> {
  const [rule] = await db
    .select({
      id: taxRules.id,
      ruleType: taxRules.ruleType,
      rateBps: taxRules.rateBps,
      notes: taxRules.notes,
    })
    .from(taxRules)
    .where(
      and(
        eq(taxRules.ruleType, type),
        lte(taxRules.validFrom, date),
        or(isNull(taxRules.validTo), gte(taxRules.validTo, date)),
        isNull(taxRules.deletedAt),
      ),
    )
    .orderBy(desc(taxRules.validFrom))
    .limit(1);
  if (!rule) {
    throw new LedgerValidationError(`No active ${type} tax rule for ${date}`);
  }
  return rule;
}

export const quarterOf = (date: string): number =>
  Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;

export const yearOf = (date: string): number => Number(date.slice(0, 4));
