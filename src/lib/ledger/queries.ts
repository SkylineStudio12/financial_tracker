/**
 * Read side of the ledger: list and detail queries for the UI.
 * All queries exclude soft-deleted rows.
 */
import { and, count, desc, eq, exists, gte, ilike, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  categories,
  postings,
  tags,
  taxAccruals,
  taxRules,
  transactions,
  transactionTags,
} from "@/db/schema";
import type { TransactionKind } from "./types";

export interface TransactionFilters {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  kind?: TransactionKind;
  tagId?: string;
  search?: string;
}

export interface TransactionListRow {
  id: string;
  date: string;
  description: string;
  kind: TransactionKind;
  /** Single category name, or "Split (n)" when legs differ, or null. */
  category: string | null;
  tagNames: string[];
  /** Display leg: the real-account posting with the largest |RON| value. */
  amount: number;
  currency: string;
  amountRon: number;
  accountName: string;
}

const PAGE_SIZE = 25;

function filterConditions(entityId: string, filters: TransactionFilters) {
  const conditions = [eq(transactions.entityId, entityId), isNull(transactions.deletedAt)];
  if (filters.from) conditions.push(gte(transactions.date, filters.from));
  if (filters.to) conditions.push(lte(transactions.date, filters.to));
  if (filters.kind) conditions.push(eq(transactions.kind, filters.kind));
  if (filters.search) conditions.push(ilike(transactions.description, `%${filters.search}%`));
  if (filters.accountId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(postings)
          .where(
            and(
              eq(postings.transactionId, transactions.id),
              eq(postings.accountId, filters.accountId),
              isNull(postings.deletedAt),
            ),
          ),
      ),
    );
  }
  if (filters.categoryId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(postings)
          .where(
            and(
              eq(postings.transactionId, transactions.id),
              eq(postings.categoryId, filters.categoryId),
              isNull(postings.deletedAt),
            ),
          ),
      ),
    );
  }
  if (filters.tagId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(transactionTags)
          .where(
            and(
              eq(transactionTags.transactionId, transactions.id),
              eq(transactionTags.tagId, filters.tagId),
            ),
          ),
      ),
    );
  }
  return and(...conditions);
}

export async function listTransactions(
  entityId: string,
  filters: TransactionFilters,
  page: number,
): Promise<{ rows: TransactionListRow[]; total: number; pageSize: number }> {
  const where = filterConditions(entityId, filters);

  const [{ total }] = await db.select({ total: count() }).from(transactions).where(where);

  const transactionRows = await db
    .select()
    .from(transactions)
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const ids = transactionRows.map((t) => t.id);
  const postingRows = ids.length
    ? await db
        .select({
          transactionId: postings.transactionId,
          amount: postings.amount,
          currency: postings.currency,
          amountRon: postings.amountRon,
          accountName: accounts.name,
          accountType: accounts.type,
          categoryName: categories.name,
        })
        .from(postings)
        .innerJoin(accounts, eq(accounts.id, postings.accountId))
        .leftJoin(categories, eq(categories.id, postings.categoryId))
        .where(and(inArray(postings.transactionId, ids), isNull(postings.deletedAt)))
    : [];
  const tagRows = ids.length
    ? await db
        .select({ transactionId: transactionTags.transactionId, name: tags.name })
        .from(transactionTags)
        .innerJoin(tags, eq(tags.id, transactionTags.tagId))
        .where(inArray(transactionTags.transactionId, ids))
    : [];

  const rows = transactionRows.map((transaction): TransactionListRow => {
    const legs = postingRows.filter((p) => p.transactionId === transaction.id);
    const realLegs = legs.filter((p) => p.accountType !== "equity");
    const display = [...(realLegs.length ? realLegs : legs)].sort(
      (a, b) => Math.abs(b.amountRon) - Math.abs(a.amountRon),
    )[0];
    const categoryNames = [...new Set(legs.flatMap((p) => (p.categoryName ? [p.categoryName] : [])))];
    return {
      id: transaction.id,
      date: transaction.date,
      description: transaction.description,
      kind: transaction.kind,
      category:
        categoryNames.length === 0
          ? null
          : categoryNames.length === 1
            ? categoryNames[0]
            : `Split (${categoryNames.length})`,
      tagNames: tagRows.filter((t) => t.transactionId === transaction.id).map((t) => t.name),
      amount: display?.amount ?? 0,
      currency: display?.currency ?? "RON",
      amountRon: display?.amountRon ?? 0,
      accountName: display?.accountName ?? "—",
    };
  });

  return { rows, total, pageSize: PAGE_SIZE };
}

export async function getTransactionDetail(transactionId: string) {
  const [transaction] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), isNull(transactions.deletedAt)));
  if (!transaction) return null;

  const postingRows = await db
    .select({
      id: postings.id,
      amount: postings.amount,
      currency: postings.currency,
      amountRon: postings.amountRon,
      counterparty: postings.counterparty,
      accountName: accounts.name,
      accountType: accounts.type,
      categoryName: categories.name,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .leftJoin(categories, eq(categories.id, postings.categoryId))
    .where(and(eq(postings.transactionId, transactionId), isNull(postings.deletedAt)));

  const tagRows = await db
    .select({ name: tags.name })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .where(eq(transactionTags.transactionId, transactionId));

  const accrualRows = await db
    .select({
      id: taxAccruals.id,
      year: taxAccruals.year,
      quarter: taxAccruals.quarter,
      ruleType: taxRules.ruleType,
      rateBps: taxRules.rateBps,
      ruleNotes: taxRules.notes,
      postingId: taxAccruals.postingId,
    })
    .from(taxAccruals)
    .innerJoin(taxRules, eq(taxRules.id, taxAccruals.taxRuleId))
    .where(eq(taxAccruals.transactionId, transactionId));

  return { transaction, postings: postingRows, tagNames: tagRows.map((t) => t.name), accruals: accrualRows };
}

/** Data for filter dropdowns on the list page. */
export async function getFilterOptions(entityId: string) {
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.entityId, entityId), isNull(accounts.deletedAt)))
    .orderBy(accounts.name);
  const categoryRows = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(
      and(
        sql`${categories.entityId} is null or ${categories.entityId} = ${entityId}`,
        isNull(categories.deletedAt),
      ),
    )
    .orderBy(categories.name);
  const tagRows = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(isNull(tags.deletedAt))
    .orderBy(tags.name);
  return { accounts: accountRows, categories: categoryRows, tags: tagRows };
}
