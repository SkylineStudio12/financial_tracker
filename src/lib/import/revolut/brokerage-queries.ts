import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { revolutBookedRows, revolutImportBatches, revolutImportRows } from "@/db/schema";

export interface RevolutBatchReversalPreview {
  transactions: number;
  splits: number;
  markers: number;
  splitTickers: string[];
}

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
  let reversal: RevolutBatchReversalPreview | null = null;
  if (batch.bookedAt) {
    const markers = await db
      .select({
        transactionId: revolutBookedRows.transactionId,
        stockSplitId: revolutBookedRows.stockSplitId,
        ticker: revolutImportRows.ticker,
      })
      .from(revolutBookedRows)
      .innerJoin(revolutImportRows, eq(revolutImportRows.id, revolutBookedRows.sourceRowId))
      .where(eq(revolutImportRows.batchId, batchId));
    reversal = {
      transactions: new Set(
        markers.flatMap((marker) => (marker.transactionId ? [marker.transactionId] : [])),
      ).size,
      splits: new Set(
        markers.flatMap((marker) => (marker.stockSplitId ? [marker.stockSplitId] : [])),
      ).size,
      markers: markers.length,
      splitTickers: markers.flatMap((marker) =>
        marker.stockSplitId && marker.ticker ? [marker.ticker] : [],
      ),
    };
  }
  return { batch, rows, reversal };
}
