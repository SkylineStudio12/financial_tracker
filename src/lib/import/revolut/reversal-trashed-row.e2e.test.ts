import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  auditLog,
  importSourceClaims,
  revolutBookedRows,
  revolutImportBatches,
  revolutImportRows,
  transactionImportLinks,
  transactions,
} from "@/db/schema";
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

async function main(): Promise<void> {
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1));
  assert.match(databaseName, /_test$/);
  const created = await createRevolutImportBatch({
    entityId: ENTITY_IDS.household,
    owner: "greg",
    sourceFileName: "__test__crud-trashed-row.csv",
    text: csv,
  });
  const approved = await approveRevolutBatch(created.batchId);
  assert.equal(approved.booked, 2);
  const markers = await db
    .select({ transactionId: revolutBookedRows.transactionId })
    .from(revolutBookedRows)
    .innerJoin(revolutImportRows, eq(revolutImportRows.id, revolutBookedRows.sourceRowId))
    .where(eq(revolutImportRows.batchId, created.batchId));
  const transactionIds = markers.flatMap((marker) =>
    marker.transactionId ? [marker.transactionId] : [],
  );
  assert.equal(transactionIds.length, 2);

  const alreadyTrashedId = transactionIds[0];
  await softDeleteNonInvestmentTransaction(alreadyTrashedId);
  const [trashedRow] = await db
    .select({ status: revolutImportRows.status })
    .from(revolutImportRows)
    .where(eq(revolutImportRows.transactionId, alreadyTrashedId));
  assert.equal(trashedRow.status, "trashed");

  await deleteBookedRevolutBatch({
    batchId: created.batchId,
    entityId: ENTITY_IDS.household,
    owner: "greg",
  });

  assert.equal(
    (await db.select().from(revolutImportBatches).where(eq(revolutImportBatches.id, created.batchId))).length,
    0,
  );
  assert.equal(
    (await db.select().from(revolutImportRows).where(eq(revolutImportRows.batchId, created.batchId))).length,
    0,
  );
  const releasedLinks = await db
    .select()
    .from(transactionImportLinks)
    .where(eq(transactionImportLinks.sourceBatchId, created.batchId));
  assert.equal(releasedLinks.length, 2);
  assert.ok(releasedLinks.every((link) => link.lifecycle === "released" && link.releasedAt));
  const [claim] = await db
    .select()
    .from(importSourceClaims)
    .where(eq(importSourceClaims.sourceBatchId, created.batchId));
  assert.ok(claim.releasedAt);
  assert.ok(
    (
      await db
        .select()
        .from(transactions)
        .where(and(inArray(transactions.id, transactionIds), sql`${transactions.deletedAt} is not null`))
    ).length === 2,
  );

  const second = await createRevolutImportBatch({
    entityId: ENTITY_IDS.household,
    owner: "greg",
    sourceFileName: "__test__crud-trashed-row-reimport.csv",
    text: csv,
  });
  assert.notEqual(second.batchId, created.batchId);
  await approveRevolutBatch(second.batchId);
  const newLinks = await db
    .select()
    .from(transactionImportLinks)
    .where(eq(transactionImportLinks.sourceBatchId, second.batchId));
  assert.equal(newLinks.length, 2);
  assert.ok(newLinks.every((link) => link.lifecycle === "active" && link.releasedAt === null));
  await restoreTransaction(alreadyTrashedId, 1);
  const [oldLinkAfterRestore] = await db
    .select()
    .from(transactionImportLinks)
    .where(eq(transactionImportLinks.transactionId, alreadyTrashedId));
  assert.equal(oldLinkAfterRestore.lifecycle, "released");
  assert.ok(oldLinkAfterRestore.releasedAt);
  const activeNewLinks = await db
    .select()
    .from(transactionImportLinks)
    .where(
      and(
        eq(transactionImportLinks.sourceBatchId, second.batchId),
        sql`${transactionImportLinks.releasedAt} is null`,
      ),
    );
  assert.equal(activeNewLinks.length, 2);

  const newTransactionIds = newLinks.map((link) => link.transactionId);
  await deleteBookedRevolutBatch({
    batchId: second.batchId,
    entityId: ENTITY_IDS.household,
    owner: "greg",
  });

  await db
    .delete(auditLog)
    .where(
      and(
        eq(auditLog.tableName, "transactions"),
        inArray(auditLog.rowId, [...transactionIds, ...newTransactionIds]),
      ),
    );
  await db.delete(transactions).where(inArray(transactions.id, [...transactionIds, ...newTransactionIds]));
  await db
    .delete(importSourceClaims)
    .where(inArray(importSourceClaims.sourceBatchId, [created.batchId, second.batchId]));
  console.log("PASS fixture 11: already-trashed Revolut non-trade row reverses atomically");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
