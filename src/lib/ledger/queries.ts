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
  trades,
  transactions,
  transactionImportLinks,
  transactionTags,
} from "@/db/schema";
import type { AccountOwner } from "@/lib/profiles";
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
  /** Single category name when all legs share one; null otherwise. */
  category: string | null;
  /** Distinct leg-category count when legs differ (≥2); null otherwise —
   * the page renders the localized "Split (n)" label, not the query. */
  splitCount: number | null;
  tagNames: string[];
  /** Display leg: the real-account posting with the largest |RON| value. */
  amount: number;
  currency: string;
  amountRon: number;
  accountName: string;
  currentRevision: number;
  crudAvailable: boolean;
  importBatchId: string | null;
  importSourceLabel: string | null;
}

const PAGE_SIZE = 25;

function filterConditions(entityId: string, filters: TransactionFilters, owner?: AccountOwner) {
  const conditions = [eq(transactions.entityId, entityId), isNull(transactions.deletedAt)];
  // Personal-profile view filter: only transactions touching that person's
  // accounts. The equity counter-leg (owner NULL) never hides a transaction —
  // any owned leg qualifies it. There are no joint accounts.
  if (owner) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(postings)
          .innerJoin(accounts, eq(accounts.id, postings.accountId))
          .where(
            and(
              eq(postings.transactionId, transactions.id),
              eq(accounts.owner, owner),
              isNull(postings.deletedAt),
            ),
          ),
      ),
    );
  }
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
  owner?: AccountOwner,
): Promise<{ rows: TransactionListRow[]; total: number; pageSize: number }> {
  const where = filterConditions(entityId, filters, owner);

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
  const tradeRows = ids.length
    ? await db.select({ transactionId: trades.transactionId }).from(trades).where(inArray(trades.transactionId, ids))
    : [];
  const importLinks = ids.length
    ? await db
        .select({
          transactionId: transactionImportLinks.transactionId,
          sourceBatchId: transactionImportLinks.sourceBatchId,
          sourceLabel: transactionImportLinks.sourceLabel,
        })
        .from(transactionImportLinks)
        .where(inArray(transactionImportLinks.transactionId, ids))
    : [];
  const tradeTransactionIds = new Set(tradeRows.map((row) => row.transactionId));
  const importByTransaction = new Map(importLinks.map((link) => [link.transactionId, link]));

  const rows = transactionRows.map((transaction): TransactionListRow => {
    const legs = postingRows.filter((p) => p.transactionId === transaction.id);
    const realLegs = legs.filter((p) => p.accountType !== "equity");
    const display = [...(realLegs.length ? realLegs : legs)].sort(
      (a, b) => Math.abs(b.amountRon) - Math.abs(a.amountRon),
    )[0];
    const categoryNames = [...new Set(legs.flatMap((p) => (p.categoryName ? [p.categoryName] : [])))];
    const importLink = importByTransaction.get(transaction.id);
    return {
      id: transaction.id,
      date: transaction.date,
      description: transaction.description,
      kind: transaction.kind,
      category: categoryNames.length === 1 ? categoryNames[0] : null,
      splitCount: categoryNames.length > 1 ? categoryNames.length : null,
      tagNames: tagRows.filter((t) => t.transactionId === transaction.id).map((t) => t.name),
      amount: display?.amount ?? 0,
      currency: display?.currency ?? "RON",
      amountRon: display?.amountRon ?? 0,
      accountName: display?.accountName ?? "—",
      currentRevision: transaction.currentRevision,
      crudAvailable: !tradeTransactionIds.has(transaction.id),
      importBatchId: importLink?.sourceBatchId ?? null,
      importSourceLabel: importLink?.sourceLabel ?? null,
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
    .where(
      and(eq(taxAccruals.transactionId, transactionId), isNull(taxAccruals.deletedAt)),
    );

  const [trade] = await db
    .select({ id: trades.id })
    .from(trades)
    .where(eq(trades.transactionId, transactionId))
    .limit(1);
  const [importLink] = await db
    .select()
    .from(transactionImportLinks)
    .where(eq(transactionImportLinks.transactionId, transactionId))
    .limit(1);

  return {
    transaction,
    postings: postingRows,
    tagNames: tagRows.map((t) => t.name),
    accruals: accrualRows,
    crudAvailable: !trade,
    importLink: importLink ?? null,
  };
}

export async function listDeletedTransactions(entityId: string, owner?: AccountOwner) {
  const conditions = [eq(transactions.entityId, entityId), sql`${transactions.deletedAt} is not null`];
  if (owner) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(postings)
          .innerJoin(accounts, eq(accounts.id, postings.accountId))
          .where(
            and(
              eq(postings.transactionId, transactions.id),
              eq(postings.revision, transactions.currentRevision),
              eq(accounts.owner, owner),
            ),
          ),
      ),
    );
  }
  const transactionRows = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.deletedAt));
  const ids = transactionRows.map((row) => row.id);
  if (ids.length === 0) return [];
  const [postingRows, tradeRows, importLinks] = await Promise.all([
    db
      .select({
        transactionId: postings.transactionId,
        revision: postings.revision,
        amount: postings.amount,
        amountRon: postings.amountRon,
        currency: postings.currency,
        accountName: accounts.name,
        accountType: accounts.type,
      })
      .from(postings)
      .innerJoin(accounts, eq(accounts.id, postings.accountId))
      .where(inArray(postings.transactionId, ids)),
    db.select({ transactionId: trades.transactionId }).from(trades).where(inArray(trades.transactionId, ids)),
    db
      .select({
        transactionId: transactionImportLinks.transactionId,
        sourceBatchId: transactionImportLinks.sourceBatchId,
        sourceLabel: transactionImportLinks.sourceLabel,
        lifecycle: transactionImportLinks.lifecycle,
      })
      .from(transactionImportLinks)
      .where(inArray(transactionImportLinks.transactionId, ids)),
  ]);
  const tradeIds = new Set(tradeRows.map((row) => row.transactionId));
  const importByTransaction = new Map(importLinks.map((link) => [link.transactionId, link]));
  return transactionRows.map((transaction) => {
    const legs = postingRows.filter(
      (posting) =>
        posting.transactionId === transaction.id &&
        posting.revision === transaction.currentRevision,
    );
    const realLegs = legs.filter((posting) => posting.accountType !== "equity");
    const display = [...(realLegs.length ? realLegs : legs)].sort(
      (a, b) => Math.abs(b.amountRon) - Math.abs(a.amountRon),
    )[0];
    const importLink = importByTransaction.get(transaction.id);
    return {
      id: transaction.id,
      date: transaction.date,
      description: transaction.description,
      deletedAt: transaction.deletedAt!,
      amount: display?.amount ?? 0,
      amountRon: display?.amountRon ?? 0,
      currency: display?.currency ?? "RON",
      accountName: display?.accountName ?? "—",
      currentRevision: transaction.currentRevision,
      crudAvailable: !tradeIds.has(transaction.id),
      importBatchId: importLink?.sourceBatchId ?? null,
      importSourceLabel: importLink?.sourceLabel ?? null,
      importLifecycle: importLink?.lifecycle ?? null,
    };
  });
}

export async function hasLikelyRestoreCollision(transactionId: string): Promise<boolean> {
  const [deleted] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
  if (!deleted || deleted.deletedAt === null) return false;
  const originalLegs = await db
    .select({ accountId: postings.accountId, amount: postings.amount, amountRon: postings.amountRon })
    .from(postings)
    .where(
      and(
        eq(postings.transactionId, transactionId),
        eq(postings.revision, deleted.currentRevision),
      ),
    );
  const candidates = await db
    .select({ id: transactions.id, revision: transactions.currentRevision })
    .from(transactions)
    .where(
      and(
        eq(transactions.entityId, deleted.entityId),
        eq(transactions.date, deleted.date),
        eq(transactions.description, deleted.description),
        isNull(transactions.deletedAt),
      ),
    );
  if (candidates.length === 0) return false;
  const signature = (rows: { accountId: string; amount: number; amountRon: number }[]) =>
    rows
      .map((row) => `${row.accountId}:${row.amount}:${row.amountRon}`)
      .sort()
      .join("|");
  const originalSignature = signature(originalLegs);
  const candidateLegs = await db
    .select({
      transactionId: postings.transactionId,
      revision: postings.revision,
      accountId: postings.accountId,
      amount: postings.amount,
      amountRon: postings.amountRon,
    })
    .from(postings)
    .where(and(inArray(postings.transactionId, candidates.map((candidate) => candidate.id)), isNull(postings.deletedAt)));
  return candidates.some(
    (candidate) =>
      signature(
        candidateLegs.filter(
          (leg) => leg.transactionId === candidate.id && leg.revision === candidate.revision,
        ),
      ) === originalSignature,
  );
}

/** Data for filter dropdowns on the list page. */
export async function getFilterOptions(entityId: string, owner?: AccountOwner) {
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, entityId),
        isNull(accounts.deletedAt),
        ...(owner ? [eq(accounts.owner, owner)] : []),
      ),
    )
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
