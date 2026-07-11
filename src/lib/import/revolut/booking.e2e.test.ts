import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  accounts,
  postings,
  revolutBookedRows,
  revolutImportBatches,
  revolutImportRows,
  securities,
  stockSplits,
  transactions,
} from "@/db/schema";
import { ENTITY_IDS } from "@/lib/profiles";
import { LedgerValidationError } from "@/lib/ledger";
import {
  approveRevolutBatch,
  createRevolutImportBatch,
  REVOLUT_ACCOUNT_NAMES,
} from "./brokerage-service";

const ROLLBACK = new Error("intentional Revolut import test rollback");
const fixture = readFileSync(
  join(process.cwd(), "fixtures", "revolut", "All_stock_transactions.csv"),
  "utf8",
).replace(/\n/g, "\r\n");

async function accountBalances() {
  const targetNames = [
    REVOLUT_ACCOUNT_NAMES.cash.USD,
    REVOLUT_ACCOUNT_NAMES.cash.EUR,
    REVOLUT_ACCOUNT_NAMES.position.USD,
    REVOLUT_ACCOUNT_NAMES.position.EUR,
    REVOLUT_ACCOUNT_NAMES.clearing,
  ];
  const rows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, ENTITY_IDS.household),
        inArray(accounts.name, targetNames),
        isNull(accounts.deletedAt),
      ),
    );
  assert.equal(rows.length, 5, "all five Revolut accounts provisioned");
  const result = new Map<string, number>();
  for (const row of rows) {
    const live = await db
      .select({ amount: postings.amount })
      .from(postings)
      .where(and(eq(postings.accountId, row.id), isNull(postings.deletedAt)));
    result.set(row.name, live.reduce((sum, posting) => sum + posting.amount, 0));
  }
  return result;
}

async function run() {
  const beforeBalances = await accountBalances();
  const beforeTransactionCount = await db.$count(transactions);
  const beforeSecurities = await db.select({ id: securities.id, ticker: securities.ticker }).from(securities);
  const beforeTickerSet = new Set(beforeSecurities.map((security) => security.ticker));
  let batchId: string | null = null;

  try {
    const created = await createRevolutImportBatch({
      entityId: ENTITY_IDS.household,
      owner: "greg",
      sourceFileName: "__test__All stock transactions.csv",
      text: fixture,
    });
    batchId = created.batchId;
    assert.equal(created.parsed, 291);
    assert.equal(created.staged, 285);
    assert.equal(created.correctionPairsDropped, 3);
    assert.equal(created.exactDuplicates, 0);
    assert.equal(created.suspectedDuplicates, 0);

    const stagedRows = await db
      .select({ id: revolutImportRows.id, lineNo: revolutImportRows.lineNo, payload: revolutImportRows.payload })
      .from(revolutImportRows)
      .where(eq(revolutImportRows.batchId, created.batchId));
    const finalRow = stagedRows.sort((a, b) => b.lineNo - a.lineNo)[0];
    await db
      .update(revolutImportRows)
      .set({ payload: { ...(finalRow.payload as object), kind: "unsupported" } })
      .where(eq(revolutImportRows.id, finalRow.id));
    await assert.rejects(
      approveRevolutBatch(created.batchId),
      (error: unknown) =>
        error instanceof LedgerValidationError &&
        error.code === "revolut.bookingRowFailed" &&
        error.params?.lineNo === finalRow.lineNo,
    );
    assert.equal(await db.$count(transactions), beforeTransactionCount);
    assert.equal(await db.$count(revolutBookedRows), 0);
    assert.equal(
      await db.$count(
        revolutImportRows,
        and(eq(revolutImportRows.batchId, created.batchId), eq(revolutImportRows.status, "booked")),
      ),
      0,
      "late-row failure rolls back every earlier row",
    );
    await db
      .update(revolutImportRows)
      .set({ payload: finalRow.payload })
      .where(eq(revolutImportRows.id, finalRow.id));

    await assert.rejects(
      db.transaction(async (tx) => {
        const result = await approveRevolutBatch(created.batchId, tx);
        assert.deepEqual(result, {
          booked: 285,
          duplicates: 0,
          excluded: 0,
          transactions: 282,
          splits: 3,
        });
        assert.equal(
          await tx.$count(revolutBookedRows),
          285,
          "one global content-hash marker per booked row",
        );
        assert.equal(
          await tx.$count(stockSplits),
          3,
          "three stock splits recorded inside the same transaction",
        );
        assert.equal(
          await tx.$count(
            revolutImportRows,
            and(eq(revolutImportRows.batchId, created.batchId), eq(revolutImportRows.status, "booked")),
          ),
          285,
        );
        const replay = await approveRevolutBatch(created.batchId, tx);
        assert.deepEqual(replay, {
          booked: 0,
          duplicates: 0,
          excluded: 0,
          transactions: 0,
          splits: 0,
        });
        throw ROLLBACK;
      }),
      (error: unknown) => error === ROLLBACK,
    );

    assert.equal(await db.$count(transactions), beforeTransactionCount, "outer rollback removes every ledger write");
    assert.deepEqual(await accountBalances(), beforeBalances, "outer rollback restores all five account balances");
    assert.equal(
      await db.$count(revolutBookedRows),
      0,
      "outer rollback removes all idempotence markers",
    );
    const [batch] = await db
      .select({ bookedAt: revolutImportBatches.bookedAt })
      .from(revolutImportBatches)
      .where(eq(revolutImportBatches.id, created.batchId));
    assert.equal(batch.bookedAt, null, "outer rollback leaves the staged batch unbooked");
    console.log("All Revolut rows booked and asserted atomically; forced outer rollback removed every write.");
  } finally {
    if (batchId) await db.delete(revolutImportBatches).where(eq(revolutImportBatches.id, batchId));
    const afterSecurities = await db.select({ id: securities.id, ticker: securities.ticker }).from(securities);
    const createdSecurityIds = afterSecurities
      .filter((security) => !beforeTickerSet.has(security.ticker))
      .map((security) => security.id);
    if (createdSecurityIds.length > 0) {
      await db.delete(securities).where(inArray(securities.id, createdSecurityIds));
    }
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
