import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  auditLog,
  importSourceClaims,
  postings,
  revolutBookedRows,
  revolutImportBatches,
  revolutImportRows,
  transactionImportLinks,
  transactions,
} from "@/db/schema";
import { IMPORT_OWNERSHIP_LOCK } from "@/lib/ledger";
import { restoreTransaction, softDeleteNonInvestmentTransaction } from "@/lib/ledger";
import { ENTITY_IDS } from "@/lib/profiles";
import {
  approveRevolutBatch,
  createRevolutImportBatch,
  deleteBookedRevolutBatch,
} from "./brokerage-service";

const csv = [
  "Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate",
  "2026-06-01T10:00:00.000Z,,CASH TOP-UP,,,USD 100.00,USD,0.2",
  "2026-06-02T10:00:00.000Z,,CUSTODY FEE,,,USD -1.00,USD,0.2",
].join("\r\n");

async function bookBatch(fileName: string): Promise<{ batchId: string; transactionIds: string[] }> {
  const created = await createRevolutImportBatch({
    entityId: ENTITY_IDS.household,
    owner: "greg",
    sourceFileName: fileName,
    text: csv,
  });
  const approved = await approveRevolutBatch(created.batchId);
  assert.equal(approved.booked, 2);
  const markers = await db
    .select({ transactionId: revolutBookedRows.transactionId, lineNo: revolutImportRows.lineNo })
    .from(revolutBookedRows)
    .innerJoin(revolutImportRows, eq(revolutImportRows.id, revolutBookedRows.sourceRowId))
    .where(eq(revolutImportRows.batchId, created.batchId))
    .orderBy(revolutImportRows.lineNo);
  const transactionIds = markers.flatMap((m) => (m.transactionId ? [m.transactionId] : []));
  assert.equal(transactionIds.length, 2);
  return { batchId: created.batchId, transactionIds };
}

async function cleanup(batchIds: string[], transactionIds: string[]): Promise<void> {
  await db
    .delete(auditLog)
    .where(and(eq(auditLog.tableName, "transactions"), inArray(auditLog.rowId, transactionIds)));
  await db.delete(transactions).where(inArray(transactions.id, transactionIds));
  await db.delete(importSourceClaims).where(inArray(importSourceClaims.sourceBatchId, batchIds));
}

/**
 * Fix 3 regression: batch reversal must serialize against restore/purge on the
 * shared import-ownership advisory lock, and must lock every batch-owned
 * transaction FOR UPDATE so it never skips a row on a stale "already-deleted"
 * read while a concurrent restore makes that row live again.
 */
async function main(): Promise<void> {
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1));
  assert.match(databaseName, /_test$/);

  // --- Test 1: restore blocks on the shared lock while reversal-class work holds it. ---
  {
    const { batchId, transactionIds } = await bookBatch("__test__concurrency-lock.csv");
    await softDeleteNonInvestmentTransaction(transactionIds[0]);

    const holder = await pool.connect();
    await holder.query("begin");
    await holder.query(`select pg_advisory_xact_lock(${IMPORT_OWNERSHIP_LOCK})`);

    let restoreSettled = false;
    const restorePromise = restoreTransaction(transactionIds[0], 1).then(() => {
      restoreSettled = true;
    });
    // While the lock is held, restore cannot proceed.
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(restoreSettled, false, "restore proceeded without the shared ownership lock");

    await holder.query("rollback");
    holder.release();
    await restorePromise;
    assert.equal(restoreSettled, true);
    const [restored] = await db
      .select({ deletedAt: transactions.deletedAt })
      .from(transactions)
      .where(eq(transactions.id, transactionIds[0]));
    assert.equal(restored.deletedAt, null, "restore did not complete after the lock was released");

    await deleteBookedRevolutBatch({ batchId, entityId: ENTITY_IDS.household, owner: "greg" });
    await cleanup([batchId], transactionIds);
    console.log("PASS concurrency 1: restore serializes on the shared import-ownership lock");
  }

  // --- Test 2: reversal reverses a row that was restored live (no stranding). ---
  // A row trashed, then restored, is LIVE at reversal time. With the FOR UPDATE
  // fresh read, reversal must reverse it rather than skip it on a stale read.
  {
    const { batchId, transactionIds } = await bookBatch("__test__concurrency-live.csv");
    await softDeleteNonInvestmentTransaction(transactionIds[0]);
    await restoreTransaction(transactionIds[0], 1);
    const [beforeReversal] = await db
      .select({ deletedAt: transactions.deletedAt })
      .from(transactions)
      .where(eq(transactions.id, transactionIds[0]));
    assert.equal(beforeReversal.deletedAt, null, "row should be live after restore");

    await deleteBookedRevolutBatch({ batchId, entityId: ENTITY_IDS.household, owner: "greg" });

    // Full teardown: both transactions soft-deleted, batch + markers gone, all
    // links released. The previously-live row was NOT stranded.
    const txRows = await db
      .select({ id: transactions.id, deletedAt: transactions.deletedAt })
      .from(transactions)
      .where(inArray(transactions.id, transactionIds));
    assert.equal(txRows.length, 2);
    assert.ok(
      txRows.every((t) => t.deletedAt !== null),
      "reversal stranded a live transaction instead of reversing it",
    );
    const livePostings = await db
      .select({ id: postings.id })
      .from(postings)
      .where(and(inArray(postings.transactionId, transactionIds), isNull(postings.deletedAt)));
    assert.equal(livePostings.length, 0, "reversal left live postings on a torn-down batch");
    assert.equal(
      (await db.select().from(revolutImportBatches).where(eq(revolutImportBatches.id, batchId)))
        .length,
      0,
    );
    const links = await db
      .select({ lifecycle: transactionImportLinks.lifecycle })
      .from(transactionImportLinks)
      .where(eq(transactionImportLinks.sourceBatchId, batchId));
    assert.ok(
      links.length > 0 && links.every((l) => l.lifecycle === "released"),
      "reversal did not release every ownership link",
    );
    const [claim] = await db
      .select({ releasedAt: importSourceClaims.releasedAt })
      .from(importSourceClaims)
      .where(eq(importSourceClaims.sourceBatchId, batchId));
    assert.ok(claim.releasedAt, "reversal did not release the source claim");

    await cleanup([batchId], transactionIds);
    console.log("PASS concurrency 2: reversal reverses a restored-live row without stranding it");
  }

  // --- Test 3: genuinely concurrent restore + reversal end in a consistent state. ---
  {
    const { batchId, transactionIds } = await bookBatch("__test__concurrency-race.csv");
    await softDeleteNonInvestmentTransaction(transactionIds[0]);

    const results = await Promise.allSettled([
      restoreTransaction(transactionIds[0], 1),
      deleteBookedRevolutBatch({ batchId, entityId: ENTITY_IDS.household, owner: "greg" }),
    ]);
    // At least the reversal must succeed; restore may succeed or fail depending
    // on ordering, but the end state must never be mixed.
    assert.ok(
      results.some((r) => r.status === "fulfilled"),
      "both concurrent operations failed",
    );

    const batchGone =
      (await db.select().from(revolutImportBatches).where(eq(revolutImportBatches.id, batchId)))
        .length === 0;
    const markersGone =
      (
        await db
          .select()
          .from(revolutBookedRows)
          .innerJoin(revolutImportRows, eq(revolutImportRows.id, revolutBookedRows.sourceRowId))
          .where(eq(revolutImportRows.batchId, batchId))
      ).length === 0;
    // Consistency invariant: the batch and its markers are torn down together,
    // never one without the other.
    assert.equal(batchGone, markersGone, "batch and its markers are in a mixed teardown state");
    // No batch-owned transaction is left live with its ownership still active
    // while the batch is gone (the stranded state the fix prevents).
    if (batchGone) {
      const liveActive = await db
        .select({ id: transactions.id })
        .from(transactions)
        .innerJoin(
          transactionImportLinks,
          eq(transactionImportLinks.transactionId, transactions.id),
        )
        .where(
          and(
            inArray(transactions.id, transactionIds),
            isNull(transactions.deletedAt),
            sql`${transactionImportLinks.releasedAt} is null`,
          ),
        );
      assert.equal(liveActive.length, 0, "stranded: live transaction with active ownership, batch gone");
    }

    await cleanup([batchId], transactionIds);
    console.log("PASS concurrency 3: concurrent restore vs reversal end in a consistent state");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
