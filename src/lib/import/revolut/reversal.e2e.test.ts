import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  accounts,
  auditLog,
  categories,
  entities,
  lotConsumptions,
  postings,
  revolutBookedRows,
  revolutImportBatches,
  revolutImportRows,
  securities,
  stockSplitConsumptionAdjustments,
  stockSplitLotAdjustments,
  stockSplits,
  taxAccruals,
  trades,
  transactions,
  transactionTags,
} from "@/db/schema";
import { LedgerValidationError, softDeleteTransaction } from "@/lib/ledger";
import { ENTITY_IDS } from "@/lib/profiles";
import {
  executeStockSplit,
  executeTrade,
  loadLots,
} from "@/lib/investments/service";
import {
  setupTradeTestEntity,
  teardownTradeTestEntity,
  type TradeTestEnv,
} from "@/lib/investments/test-support";
import {
  approveRevolutBatch,
  createRevolutImportBatch,
  deleteBookedRevolutBatch,
  REVOLUT_ACCOUNT_NAMES,
  type StoredRevolutRow,
} from "./brokerage-service";

const fixture = [
  "Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate",
  "2024-01-10T10:00:00.000Z,,CASH TOP-UP,,,USD 1000.00,USD,0.2",
  "2024-01-11T10:00:00.000Z,RVRA,BUY - MARKET,10,USD 10.00,USD 100.00,USD,0.2",
  "2024-01-12T10:00:00.000Z,RVRA,SELL - MARKET,4,USD 12.00,USD 48.00,USD,0.2",
  "2024-01-13T10:00:00.000Z,RVRA,STOCK SPLIT,6,,USD 0,USD,0.2",
  "2024-01-14T10:00:00.000Z,RVRB,BUY - MARKET,5,USD 20.00,USD 100.00,USD,0.2",
  "2024-01-15T10:00:00.000Z,RVRB,STOCK SPLIT,5,,USD 0,USD,0.2",
  "2024-01-16T10:00:00.000Z,RVRA,DIVIDEND,,,USD 1.00,USD,0.2",
  "2024-01-17T10:00:00.000Z,,CUSTODY FEE,,,USD -1.00,USD,0.2",
].join("\r\n");

const batchIds = new Set<string>();
const transactionIds = new Set<string>();
const splitIds = new Set<string>();
const securityIds = new Set<string>();

function assertTestDatabase(): void {
  const raw = process.env.DATABASE_URL;
  assert.ok(raw, "DATABASE_URL is required");
  const databaseName = decodeURIComponent(new URL(raw).pathname.slice(1));
  assert.match(databaseName, /_test$/, "reversal suite refuses a database without an _test suffix");
}

async function expectCode(
  work: Promise<unknown>,
  code: ConstructorParameters<typeof LedgerValidationError>[0],
): Promise<LedgerValidationError> {
  try {
    await work;
  } catch (error) {
    assert.ok(error instanceof LedgerValidationError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`Expected ${code}`);
}

async function batchLinks(batchId: string) {
  const rows = await db
    .select({
      transactionId: revolutBookedRows.transactionId,
      splitId: revolutBookedRows.stockSplitId,
    })
    .from(revolutBookedRows)
    .innerJoin(revolutImportRows, eq(revolutImportRows.id, revolutBookedRows.sourceRowId))
    .where(eq(revolutImportRows.batchId, batchId));
  const txIds = rows.flatMap((row) => (row.transactionId ? [row.transactionId] : []));
  const batchSplitIds = rows.flatMap((row) => (row.splitId ? [row.splitId] : []));
  txIds.forEach((id) => transactionIds.add(id));
  batchSplitIds.forEach((id) => splitIds.add(id));
  return { transactionIds: txIds, splitIds: batchSplitIds };
}

async function bookFixture() {
  const created = await createRevolutImportBatch({
    entityId: ENTITY_IDS.household,
    owner: "greg",
    sourceFileName: "__test__reversal.csv",
    text: fixture,
  });
  batchIds.add(created.batchId);
  assert.deepEqual(
    {
      parsed: created.parsed,
      staged: created.staged,
      corrections: created.correctionPairsDropped,
      exactDuplicates: created.exactDuplicates,
      suspectedDuplicates: created.suspectedDuplicates,
      existingBatch: created.existingBatch,
    },
    {
      parsed: 8,
      staged: 8,
      corrections: 0,
      exactDuplicates: 0,
      suspectedDuplicates: 0,
      existingBatch: false,
    },
  );
  assert.deepEqual(await approveRevolutBatch(created.batchId), {
    booked: 8,
    duplicates: 0,
    excluded: 0,
    transactions: 6,
    splits: 2,
  });
  await batchLinks(created.batchId);
  const createdSecurities = await db
    .select({ id: securities.id })
    .from(securities)
    .where(inArray(securities.ticker, ["RVRA", "RVRB"]));
  createdSecurities.forEach((row) => securityIds.add(row.id));
  return created.batchId;
}

async function snapshotBatch(batchId: string) {
  const [batch] = await db
    .select({ verification: revolutImportBatches.verification })
    .from(revolutImportBatches)
    .where(eq(revolutImportBatches.id, batchId));
  assert.ok(batch);
  const rows = await db
    .select({ lineNo: revolutImportRows.lineNo, status: revolutImportRows.status })
    .from(revolutImportRows)
    .where(eq(revolutImportRows.batchId, batchId));
  const markers = await db
    .select({ hash: revolutBookedRows.contentHash })
    .from(revolutBookedRows)
    .innerJoin(revolutImportRows, eq(revolutImportRows.id, revolutBookedRows.sourceRowId))
    .where(eq(revolutImportRows.batchId, batchId));
  const [cash] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, ENTITY_IDS.household),
        eq(accounts.name, REVOLUT_ACCOUNT_NAMES.cash.USD),
        isNull(accounts.deletedAt),
      ),
    );
  assert.ok(cash);
  const held = await db
    .select({ id: securities.id, ticker: securities.ticker })
    .from(securities)
    .where(inArray(securities.ticker, ["RVRA", "RVRB"]));
  const holdings = await db.transaction(async (tx) =>
    Promise.all(
      held
        .sort((a, b) => a.ticker.localeCompare(b.ticker))
        .map(async (security) => ({
          ticker: security.ticker,
          lots: (await loadLots(tx, cash.id, security.id)).map((lot) => ({
            buyDate: lot.buyDate,
            quantity: lot.quantity.toString(),
            consumedQuantity: lot.consumedQuantity.toString(),
            totalMinor: lot.totalMinor.toString(),
            totalRonMinor: lot.totalRonMinor.toString(),
            allocatedMinor: lot.allocatedMinor.toString(),
            allocatedRonMinor: lot.allocatedRonMinor.toString(),
          })),
        })),
    ),
  );
  return {
    verification: batch.verification,
    rows: rows.sort((a, b) => a.lineNo - b.lineNo),
    markerHashes: markers.map((row) => row.hash).sort(),
    holdings,
  };
}

async function counts() {
  return {
    entities: await db.$count(entities),
    accounts: await db.$count(accounts),
    categories: await db.$count(categories),
    securities: await db.$count(securities),
    transactions: await db.$count(transactions),
    postings: await db.$count(postings),
    transactionTags: await db.$count(transactionTags),
    trades: await db.$count(trades),
    consumptions: await db.$count(lotConsumptions),
    splits: await db.$count(stockSplits),
    splitLots: await db.$count(stockSplitLotAdjustments),
    splitConsumptions: await db.$count(stockSplitConsumptionAdjustments),
    batches: await db.$count(revolutImportBatches),
    rows: await db.$count(revolutImportRows),
    markers: await db.$count(revolutBookedRows),
    taxAccruals: await db.$count(taxAccruals),
    audit: await db.$count(auditLog),
  };
}

async function hardCleanup(): Promise<void> {
  const activeRows = batchIds.size
    ? await db
        .select({ id: revolutImportRows.id, splitId: revolutImportRows.stockSplitId })
        .from(revolutImportRows)
        .where(inArray(revolutImportRows.batchId, [...batchIds]))
    : [];
  activeRows.flatMap((row) => (row.splitId ? [row.splitId] : [])).forEach((id) => splitIds.add(id));
  if (activeRows.length > 0) {
    await db
      .delete(revolutBookedRows)
      .where(inArray(revolutBookedRows.sourceRowId, activeRows.map((row) => row.id)));
  }
  if (splitIds.size > 0) {
    await db
      .delete(stockSplitConsumptionAdjustments)
      .where(inArray(stockSplitConsumptionAdjustments.splitId, [...splitIds]));
    await db
      .delete(stockSplitLotAdjustments)
      .where(inArray(stockSplitLotAdjustments.splitId, [...splitIds]));
  }
  if (batchIds.size > 0) {
    await db.delete(revolutImportBatches).where(inArray(revolutImportBatches.id, [...batchIds]));
  }
  if (splitIds.size > 0) {
    await db.delete(stockSplits).where(inArray(stockSplits.id, [...splitIds]));
  }
  if (transactionIds.size > 0) {
    const tradeRows = await db
      .select({ id: trades.id })
      .from(trades)
      .where(inArray(trades.transactionId, [...transactionIds]));
    if (tradeRows.length > 0) {
      const ids = tradeRows.map((row) => row.id);
      await db
        .delete(lotConsumptions)
        .where(or(inArray(lotConsumptions.buyTradeId, ids), inArray(lotConsumptions.sellTradeId, ids)));
      await db.delete(trades).where(inArray(trades.id, ids));
    }
    await db.delete(taxAccruals).where(inArray(taxAccruals.transactionId, [...transactionIds]));
    await db.delete(transactionTags).where(inArray(transactionTags.transactionId, [...transactionIds]));
    await db.delete(postings).where(inArray(postings.transactionId, [...transactionIds]));
    await db
      .delete(auditLog)
      .where(
        or(
          inArray(auditLog.rowId, [...transactionIds]),
          inArray(auditLog.rowId, [...batchIds]),
        ),
      );
    await db.delete(transactions).where(inArray(transactions.id, [...transactionIds]));
  }
  if (securityIds.size > 0) {
    await db.delete(securities).where(inArray(securities.id, [...securityIds]));
  }
}

async function run(): Promise<void> {
  assertTestDatabase();
  const baseline = await counts();
  let manualEnv: TradeTestEnv | null = null;
  try {
    const firstBatchId = await bookFixture();
    const stateA = await snapshotBatch(firstBatchId);
    const markerRows = await db
      .select({ transactionId: revolutBookedRows.transactionId, payload: revolutImportRows.payload })
      .from(revolutBookedRows)
      .innerJoin(revolutImportRows, eq(revolutImportRows.id, revolutBookedRows.sourceRowId))
      .where(eq(revolutImportRows.batchId, firstBatchId));
    const importedBuy = markerRows.find(
      (row) => (row.payload as StoredRevolutRow).kind === "buy" && row.transactionId,
    );
    assert.ok(importedBuy?.transactionId);
    await expectCode(
      softDeleteTransaction(importedBuy.transactionId),
      "ledger.importedInvestmentTransactionRequiresBatchDelete",
    );

    const [cash] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.name, REVOLUT_ACCOUNT_NAMES.cash.USD));
    const [rvra] = await db
      .select({ id: securities.id })
      .from(securities)
      .where(eq(securities.ticker, "RVRA"));
    assert.ok(cash && rvra);
    const outsideSell = await executeTrade({
      kind: "sell",
      accountId: cash.id,
      securityId: rvra.id,
      date: "2024-01-20",
      quantity: "1",
      priceMinor: 1_200,
      totalMinor: 1_200,
      totalRonMinor: 6_000,
    });
    transactionIds.add(outsideSell.transactionId);
    const refusedState = await snapshotBatch(firstBatchId);
    const outsideError = await expectCode(
      deleteBookedRevolutBatch({
        batchId: firstBatchId,
        entityId: ENTITY_IDS.household,
        owner: "greg",
      }),
      "revolut.batchOutsideConsumption",
    );
    assert.match(String(outsideError.params?.transactionIds), new RegExp(outsideSell.transactionId));
    assert.deepEqual(await snapshotBatch(firstBatchId), refusedState, "refusal leaves batch state untouched");
    await softDeleteTransaction(outsideSell.transactionId);

    manualEnv = await setupTradeTestEntity();
    await executeTrade({
      kind: "buy",
      accountId: manualEnv.cashAccountId,
      positionAccountId: manualEnv.positionAccountId,
      securityId: manualEnv.securityId,
      date: "2025-01-01",
      quantity: "4",
      priceMinor: 100,
      totalMinor: 400,
      totalRonMinor: 2_000,
    });
    await executeStockSplit({
      accountId: manualEnv.cashAccountId,
      securityId: manualEnv.securityId,
      occurredAt: "2025-01-02T10:00:00.000Z",
      ratio: 2,
      deltaQuantity: "4",
    });
    const manualBefore = await db.transaction(async (tx) =>
      (await loadLots(tx, manualEnv!.cashAccountId, manualEnv!.securityId)).map((lot) => ({
        quantity: lot.quantity.toString(),
        consumed: lot.consumedQuantity.toString(),
        basis: lot.totalMinor.toString(),
      })),
    );
    const storedLotBefores = await db
      .select({
        tradeId: stockSplitLotAdjustments.buyTradeId,
        quantityBefore: stockSplitLotAdjustments.quantityBefore,
      })
      .from(stockSplitLotAdjustments)
      .where(inArray(stockSplitLotAdjustments.splitId, [...splitIds]));
    const storedConsumptionBefores = await db
      .select({
        consumptionId: stockSplitConsumptionAdjustments.consumptionId,
        quantityBefore: stockSplitConsumptionAdjustments.quantityBefore,
      })
      .from(stockSplitConsumptionAdjustments)
      .where(inArray(stockSplitConsumptionAdjustments.splitId, [...splitIds]));
    assert.deepEqual(
      storedConsumptionBefores.map((row) => row.quantityBefore),
      ["4.00000000"],
      "sell-before-split fixture records the exact consumed quantity",
    );

    assert.deepEqual(
      await deleteBookedRevolutBatch({
        batchId: firstBatchId,
        entityId: ENTITY_IDS.household,
        owner: "greg",
      }),
      { transactions: 6, splits: 2, markers: 8 },
    );
    for (const expected of storedLotBefores) {
      const [restored] = await db
        .select({ quantity: trades.quantity })
        .from(trades)
        .where(eq(trades.id, expected.tradeId));
      assert.equal(restored?.quantity, expected.quantityBefore);
    }
    for (const expected of storedConsumptionBefores) {
      const [restored] = await db
        .select({ quantity: lotConsumptions.quantity })
        .from(lotConsumptions)
        .where(eq(lotConsumptions.id, expected.consumptionId));
      assert.equal(restored?.quantity, expected.quantityBefore);
    }
    assert.equal(
      await db.$count(
        stockSplitLotAdjustments,
        inArray(stockSplitLotAdjustments.splitId, [...splitIds]),
      ),
      0,
    );
    assert.equal(
      await db.$count(
        stockSplitConsumptionAdjustments,
        inArray(stockSplitConsumptionAdjustments.splitId, [...splitIds]),
      ),
      0,
    );
    const manualAfter = await db.transaction(async (tx) =>
      (await loadLots(tx, manualEnv!.cashAccountId, manualEnv!.securityId)).map((lot) => ({
        quantity: lot.quantity.toString(),
        consumed: lot.consumedQuantity.toString(),
        basis: lot.totalMinor.toString(),
      })),
    );
    assert.deepEqual(manualAfter, manualBefore, "unrelated manual trade/split state is unchanged");

    assert.equal(
      await db.$count(
        revolutBookedRows,
        inArray(revolutBookedRows.contentHash, stateA.markerHashes),
      ),
      0,
    );
    assert.equal(await db.$count(revolutImportBatches, eq(revolutImportBatches.id, firstBatchId)), 0);
    assert.equal(await db.$count(stockSplits, inArray(stockSplits.id, [...splitIds])), 0);
    assert.equal(
      await db.$count(
        transactions,
        and(inArray(transactions.id, [...transactionIds]), isNull(transactions.deletedAt)),
      ),
      0,
    );
    const orphanMarkers = await db
      .select({ id: revolutBookedRows.id })
      .from(revolutBookedRows)
      .leftJoin(revolutImportRows, eq(revolutImportRows.id, revolutBookedRows.sourceRowId))
      .where(isNull(revolutImportRows.id));
    assert.equal(orphanMarkers.length, 0);

    const secondBatchId = await bookFixture();
    const stateB = await snapshotBatch(secondBatchId);
    assert.deepEqual(stateB, stateA, "state A equals state B after delete and identical re-import");
    const duplicateOnly = await createRevolutImportBatch({
      entityId: ENTITY_IDS.household,
      owner: "greg",
      sourceFileName: "__test__duplicate-only.csv",
      text: fixture.replace(/\r\n/g, "\n"),
    });
    batchIds.add(duplicateOnly.batchId);
    assert.equal(duplicateOnly.exactDuplicates, 8);
    assert.deepEqual(await approveRevolutBatch(duplicateOnly.batchId), {
      booked: 0,
      duplicates: 8,
      excluded: 0,
      transactions: 0,
      splits: 0,
    });
    assert.deepEqual(
      await deleteBookedRevolutBatch({
        batchId: duplicateOnly.batchId,
        entityId: ENTITY_IDS.household,
        owner: "greg",
      }),
      { transactions: 0, splits: 0, markers: 0 },
    );
    assert.deepEqual(await snapshotBatch(secondBatchId), stateB, "duplicate-only delete preserves owner batch");
    await deleteBookedRevolutBatch({
      batchId: secondBatchId,
      entityId: ENTITY_IDS.household,
      owner: "greg",
    });

    await teardownTradeTestEntity(manualEnv);
    manualEnv = null;
    await hardCleanup();
    assert.deepEqual(await counts(), baseline, "test leaves zero residue in every touched table");
    console.log("PASS test-database sentinel (_test) and live-URL separation");
    console.log("PASS marker clearing, split stored-before reversal, and newest-first sell unwind");
    console.log("PASS single-delete and outside-consumption refusals leave state untouched");
    console.log("PASS unrelated manual trade/split characterization unchanged");
    console.log("PASS identical re-import: state A = state B");
    console.log("PASS zero test residue");
  } finally {
    if (manualEnv) await teardownTradeTestEntity(manualEnv);
    await hardCleanup();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
