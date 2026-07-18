/**
 * Dashboard read queries. Balances are ledger sums: the RON value of a
 * posting is fixed at write time (transaction-date BNR rate), so RON
 * balances are historical-cost sums, not current-rate revaluations.
 * Soft-deleted postings are excluded everywhere (they are marked together
 * with their transaction).
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountType,
  entities,
  postings,
  taxAccruals,
  taxRules,
  transactions,
} from "@/db/schema";
import type { AccountOwner } from "@/lib/profiles";
import type { TaxRuleType } from "@/lib/tax/rules";

export type AccountType = (typeof accountType.enumValues)[number];

export interface AccountBalance {
  accountId: string;
  name: string;
  /** Typed to the enum so display layers can prove label completeness. */
  type: AccountType;
  currency: string;
  balance: number;
  balanceRon: number;
}

export async function getAccountBalances(
  entityId: string,
  owner?: AccountOwner,
  options?: { includeInactive?: boolean },
): Promise<AccountBalance[]> {
  return db
    .select({
      accountId: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency: accounts.currency,
      balance: sql`coalesce(sum(${postings.amount}), 0)`.mapWith(Number),
      balanceRon: sql`coalesce(sum(${postings.amountRon}), 0)`.mapWith(Number),
    })
    .from(accounts)
    .leftJoin(
      postings,
      and(eq(postings.accountId, accounts.id), isNull(postings.deletedAt)),
    )
    .where(
      and(
        eq(accounts.entityId, entityId),
        ...(options?.includeInactive ? [] : [eq(accounts.isActive, true)]),
        isNull(accounts.deletedAt),
        // Personal profile: only that person's accounts (no joint accounts
        // exist; the structural equity account has owner NULL and drops out).
        ...(owner ? [eq(accounts.owner, owner)] : []),
      ),
    )
    .groupBy(accounts.id)
    .orderBy(accounts.type, accounts.name);
}

export interface NetCashPosition {
  /** RON sums of bank + cash accounts, per entity. */
  cashByEntity: { entityName: string; cashRon: number }[];
  totalCashRon: number;
  /** Sum of tax_liability balances (negative = owed). */
  accruedTaxRon: number;
  netRon: number;
}

/** Household view: cash across ALL entities minus accrued tax liabilities. */
export async function getNetCashPosition(): Promise<NetCashPosition> {
  const cashRows = await db
    .select({
      entityName: entities.name,
      cashRon: sql`coalesce(sum(${postings.amountRon}), 0)`.mapWith(Number),
    })
    .from(accounts)
    .innerJoin(entities, eq(entities.id, accounts.entityId))
    .leftJoin(postings, and(eq(postings.accountId, accounts.id), isNull(postings.deletedAt)))
    .where(
      and(
        inArray(accounts.type, ["bank", "cash"]),
        eq(accounts.isActive, true),
        isNull(accounts.deletedAt),
        isNull(entities.deletedAt),
      ),
    )
    .groupBy(entities.id, entities.name)
    .orderBy(entities.name);

  const [taxRow] = await db
    .select({
      accruedRon: sql`coalesce(sum(${postings.amountRon}), 0)`.mapWith(Number),
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(
      and(
        eq(accounts.type, "tax_liability"),
        isNull(accounts.deletedAt),
        isNull(postings.deletedAt),
      ),
    );

  const totalCashRon = cashRows.reduce((sum, row) => sum + row.cashRon, 0);
  const accruedTaxRon = taxRow?.accruedRon ?? 0;
  return {
    cashByEntity: cashRows,
    totalCashRon,
    accruedTaxRon,
    netRon: totalCashRon + accruedTaxRon,
  };
}

export interface AccrualGroup {
  year: number;
  /** null = assessed annually (e.g. CASS on dividends). */
  quarter: number | null;
  ruleType: TaxRuleType;
  /** Positive number: amount owed. */
  accruedRon: number;
}

/** All accrued amounts for a company grouped by period and rule. */
export async function getTaxAccrualGroups(entityId: string): Promise<AccrualGroup[]> {
  const rows = await db
    .select({
      year: taxAccruals.year,
      quarter: taxAccruals.quarter,
      ruleType: taxRules.ruleType,
      accruedRon: sql`coalesce(sum(-${postings.amountRon}), 0)`.mapWith(Number),
    })
    .from(taxAccruals)
    .innerJoin(taxRules, eq(taxRules.id, taxAccruals.taxRuleId))
    .innerJoin(postings, and(eq(postings.id, taxAccruals.postingId), isNull(postings.deletedAt)))
    .innerJoin(
      transactions,
      and(eq(transactions.id, taxAccruals.transactionId), isNull(transactions.deletedAt)),
    )
    .where(eq(transactions.entityId, entityId))
    .groupBy(taxAccruals.year, taxAccruals.quarter, taxRules.ruleType)
    .orderBy(desc(taxAccruals.year), desc(taxAccruals.quarter));
  return rows;
}
