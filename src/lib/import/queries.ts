/**
 * Read queries for the import inbox pages. Display only — no writes.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, importBatches, importRows } from "@/db/schema";

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
      pendingCount: sql<number>`(
        SELECT count(*)::int FROM import_rows r
        WHERE r.batch_id = ${importBatches.id} AND r.status = 'pending'
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

  return { batch, rows, categories: entityCategories };
}
