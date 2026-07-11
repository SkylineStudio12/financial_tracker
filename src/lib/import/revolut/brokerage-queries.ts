import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { revolutImportBatches, revolutImportRows } from "@/db/schema";

export async function listRevolutImportBatches(entityId: string, owner: "greg") {
  return db
    .select({
      id: revolutImportBatches.id,
      sourceFileName: revolutImportBatches.sourceFileName,
      createdAt: revolutImportBatches.createdAt,
      bookedAt: revolutImportBatches.bookedAt,
      pendingCount: sql<number>`(
        SELECT count(*)::int FROM revolut_import_rows r
        WHERE r.batch_id = ${revolutImportBatches.id} AND r.status = 'pending'
      )`,
      excludedCount: sql<number>`(
        SELECT count(*)::int FROM revolut_import_rows r
        WHERE r.batch_id = ${revolutImportBatches.id} AND r.status = 'skipped'
      )`,
      rowCount: sql<number>`(
        SELECT count(*)::int FROM revolut_import_rows r
        WHERE r.batch_id = ${revolutImportBatches.id}
      )`,
    })
    .from(revolutImportBatches)
    .where(
      sql`${revolutImportBatches.entityId} = ${entityId} AND ${revolutImportBatches.owner} = ${owner}`,
    )
    .orderBy(desc(revolutImportBatches.createdAt));
}

export async function getRevolutImportBatch(batchId: string, entityId: string, owner: "greg") {
  const [batch] = await db
    .select()
    .from(revolutImportBatches)
    .where(
      sql`${revolutImportBatches.id} = ${batchId} AND ${revolutImportBatches.entityId} = ${entityId} AND ${revolutImportBatches.owner} = ${owner}`,
    );
  if (!batch) return null;
  const rows = await db
    .select()
    .from(revolutImportRows)
    .where(eq(revolutImportRows.batchId, batchId))
    .orderBy(asc(revolutImportRows.lineNo));
  return { batch, rows };
}
