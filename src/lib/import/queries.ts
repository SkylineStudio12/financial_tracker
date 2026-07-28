/**
 * Read queries for the import inbox pages. Display only — no writes.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  categories,
  importBatches,
  importRows,
  postings,
  transactionImportLinks,
  transactions,
} from "@/db/schema";
import { IMPORT_LINK_DATE_WINDOW_DAYS, shiftImportLinkDate } from "./linking";

export interface ImportLinkCandidate {
  transactionId: string;
  date: string;
  description: string | null;
  kind: string;
  amountMinor: number;
  alreadyLinked: boolean;
}

export async function getImportFormOptions(entityId: string) {
  const bankAccounts = await db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, entityId),
        eq(accounts.type, "bank"),
        eq(accounts.isActive, true),
        isNull(accounts.deletedAt),
      ),
    )
    .orderBy(asc(accounts.name));
  return { bankAccounts };
}

export async function listImportBatches(entityId: string) {
  return db
    .select({
      id: importBatches.id,
      statementNumber: importBatches.statementNumber,
      periodStart: importBatches.periodStart,
      periodEnd: importBatches.periodEnd,
      accountName: accounts.name,
      createdAt: importBatches.createdAt,
      openCount: sql<number>`(
        SELECT count(*)::int FROM import_rows r
        WHERE r.batch_id = ${importBatches.id}
          AND r.status IN ('pending', 'confirmed')
      )`,
      rowCount: sql<number>`(
        SELECT count(*)::int FROM import_rows r WHERE r.batch_id = ${importBatches.id}
      )`,
    })
    .from(importBatches)
    .innerJoin(accounts, eq(accounts.id, importBatches.bankAccountId))
    .where(eq(importBatches.entityId, entityId))
    .orderBy(desc(importBatches.createdAt));
}

export async function getImportBatch(batchId: string, entityId: string) {
  const [batch] = await db
    .select({
      id: importBatches.id,
      entityId: importBatches.entityId,
      statementNumber: importBatches.statementNumber,
      statementIban: importBatches.statementIban,
      periodStart: importBatches.periodStart,
      periodEnd: importBatches.periodEnd,
      openingBalanceMinor: importBatches.openingBalanceMinor,
      closingBalanceMinor: importBatches.closingBalanceMinor,
      accountName: accounts.name,
    })
    .from(importBatches)
    .innerJoin(accounts, eq(accounts.id, importBatches.bankAccountId))
    .where(and(eq(importBatches.id, batchId), eq(importBatches.entityId, entityId)));
  if (!batch) return null;

  const rows = await db
    .select()
    .from(importRows)
    .where(eq(importRows.batchId, batchId))
    .orderBy(sql`${importRows.lineNo}::int`); // lineNo is digits-only (parser-enforced)

  const entityCategories = await db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.entityId, entityId), isNull(categories.deletedAt)))
    .orderBy(asc(categories.kind), asc(categories.name));

  const transactionIds = rows.flatMap((row) => row.transactionId ? [row.transactionId] : []);
  const bookedCategories = transactionIds.length
    ? await db
        .select({ transactionId: postings.transactionId, categoryName: categories.name })
        .from(postings)
        .innerJoin(categories, eq(categories.id, postings.categoryId))
        .where(inArray(postings.transactionId, transactionIds))
    : [];
  const bookedCategoryByTransactionId = new Map(
    bookedCategories.map((row) => [row.transactionId, row.categoryName]),
  );

  const evidence = rows.map((row) => {
    const payload = row.payload as { row: { bookDate: string; amountMinor: number } };
    return {
      rowId: row.id,
      date: payload.row.bookDate,
      amountMinor: payload.row.amountMinor,
    };
  });
  const uniqueAmounts = [...new Set(evidence.map((row) => row.amountMinor))];
  const earliestDate = evidence.map((row) => row.date).toSorted()[0];
  const latestDate = evidence.map((row) => row.date).toSorted().at(-1);
  const candidateRows =
    earliestDate && latestDate && uniqueAmounts.length
      ? await db
          .selectDistinct({
            transactionId: transactions.id,
            date: transactions.date,
            description: transactions.description,
            kind: transactions.kind,
            amountMinor: sql<number>`abs(${postings.amount})`,
          })
          .from(transactions)
          .innerJoin(
            postings,
            and(
              eq(postings.transactionId, transactions.id),
              eq(postings.revision, transactions.currentRevision),
              isNull(postings.deletedAt),
            ),
          )
          .where(
            and(
              eq(transactions.entityId, entityId),
              isNull(transactions.deletedAt),
              gte(
                transactions.date,
                shiftImportLinkDate(earliestDate, -IMPORT_LINK_DATE_WINDOW_DAYS),
              ),
              lte(
                transactions.date,
                shiftImportLinkDate(latestDate, IMPORT_LINK_DATE_WINDOW_DAYS),
              ),
              inArray(sql<number>`abs(${postings.amount})`, uniqueAmounts),
            ),
          )
          .orderBy(desc(transactions.date), desc(transactions.id))
      : [];
  const candidateTransactionIds = candidateRows.map((candidate) => candidate.transactionId);
  const existingTransactionLinks = candidateTransactionIds.length
    ? await db
        .select({ transactionId: transactionImportLinks.transactionId })
        .from(transactionImportLinks)
        .where(inArray(transactionImportLinks.transactionId, candidateTransactionIds))
    : [];
  const linkedTransactionIds = new Set(
    existingTransactionLinks.map((link) => link.transactionId),
  );
  const linkCandidatesByRowId = new Map<string, ImportLinkCandidate[]>();
  for (const row of evidence) {
    const from = shiftImportLinkDate(row.date, -IMPORT_LINK_DATE_WINDOW_DAYS);
    const to = shiftImportLinkDate(row.date, IMPORT_LINK_DATE_WINDOW_DAYS);
    linkCandidatesByRowId.set(
      row.rowId,
      candidateRows
        .filter(
          (candidate) =>
            Number(candidate.amountMinor) === row.amountMinor &&
            candidate.date >= from &&
            candidate.date <= to,
        )
        .map((candidate) => ({
          ...candidate,
          amountMinor: Number(candidate.amountMinor),
          alreadyLinked: linkedTransactionIds.has(candidate.transactionId),
        })),
    );
  }
  const rowIds = rows.map((row) => row.id);
  const manualLinks = rowIds.length
    ? await db
        .select({ sourceRowId: transactionImportLinks.sourceRowId })
        .from(transactionImportLinks)
        .where(
          and(
            eq(transactionImportLinks.provider, "ing"),
            inArray(transactionImportLinks.sourceRowId, rowIds),
            isNull(transactionImportLinks.releasedAt),
          ),
        )
    : [];
  const manuallyLinkedRowIds = new Set(manualLinks.map((link) => link.sourceRowId));

  return {
    batch,
    rows,
    categories: entityCategories,
    bookedCategoryByTransactionId,
    linkCandidatesByRowId,
    manuallyLinkedRowIds,
  };
}
