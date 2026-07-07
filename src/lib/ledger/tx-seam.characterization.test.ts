/**
 * CHARACTERIZATION of the createTransaction transaction-handle seam (Phase 4
 * Stage 2 amendment 2): the optional `tx` parameter must leave every existing
 * caller — all of which omit it — byte-identical in behavior, and the
 * composed path must inherit the full validation + audit discipline.
 *
 * Also characterizes the lazy-rate change: BNR resolution now runs ONLY for
 * postings that lack an explicit amountRon. Before, an explicit-amountRon
 * leg on a non-RON account still resolved (and discarded) a BNR rate — which
 * fetches from the network on a cache miss.
 *
 * Runs on the dev DB against a throwaway entity (created + torn down here).
 * Run: npx tsx src/lib/ledger/tx-seam.characterization.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq, gte } from "drizzle-orm";
import { db, pool } from "@/db";
import { accounts, auditLog, categories, entities, fxRates, postings, transactions } from "@/db/schema";
import { createTransaction, LedgerValidationError, type TransactionInput } from "@/lib/ledger";

// Far-future dates: no fx_rates rows exist there, so any BNR resolution
// would go to the network (backfillYear) and fail loudly — a regression of
// the lazy-rate rule cannot pass silently.
const FUTURE_DATE = "2031-01-15";
const SEEDED_RATE_DATE = "2031-01-14";

let checks = 0;
function ok(name: string) {
  checks += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  const [entity] = await db
    .insert(entities)
    .values({ name: "TX-SEAM CHARACTERIZATION (throwaway)", type: "household" })
    .returning();
  const [bank, usd, equity] = await db
    .insert(accounts)
    .values([
      { entityId: entity.id, name: "Seam bank", type: "bank", currency: "RON" },
      { entityId: entity.id, name: "Seam brokerage", type: "brokerage", currency: "USD" },
      { entityId: entity.id, name: "Seam equity", type: "equity", currency: "RON" },
    ])
    .returning();
  const [category] = await db
    .insert(categories)
    .values({ entityId: entity.id, name: "Seam expense", kind: "expense" })
    .returning();

  const standardInput = (description: string): TransactionInput => ({
    entityId: entity.id,
    date: "2026-07-07",
    description,
    kind: "standard",
    postings: [
      { accountId: bank.id, amount: -12345 },
      { accountId: equity.id, amount: 12345, categoryId: category.id },
    ],
  });

  const rowsOf = async (txId: string) => ({
    tx: await db.select().from(transactions).where(eq(transactions.id, txId)),
    postings: (
      await db.select().from(postings).where(eq(postings.transactionId, txId))
    ).sort((a, b) => a.amount - b.amount),
    audit: await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.rowId, txId), eq(auditLog.tableName, "transactions"))),
  });

  try {
    // 1. Baseline: parameter ABSENT — the path every existing caller uses.
    const baseId = await createTransaction(standardInput("baseline write"));
    const base = await rowsOf(baseId);
    assert.equal(base.tx.length, 1);
    assert.equal(base.tx[0].kind, "standard");
    assert.equal(base.postings.length, 2);
    assert.equal(base.postings[0].amount, -12345);
    assert.equal(base.postings[0].amountRon, -12345);
    assert.equal(base.postings[1].categoryId, category.id);
    assert.equal(base.audit.length, 1);
    assert.equal(base.audit[0].action, "insert");
    ok("param-absent write: transaction + zero-sum postings + audit row, as always");

    // 2. Composed: identical input inside a caller-owned transaction produces
    // field-identical rows.
    const composedId = await db.transaction((tx) =>
      createTransaction(standardInput("composed write"), tx),
    );
    const composed = await rowsOf(composedId);
    const UNSTABLE = new Set(["id", "transactionId", "createdAt", "updatedAt", "description", "rowId"]);
    const strip = (rows: Record<string, unknown>[]) =>
      rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !UNSTABLE.has(k))));
    assert.deepEqual(strip(composed.tx as never), strip(base.tx as never));
    assert.deepEqual(strip(composed.postings as never), strip(base.postings as never));
    assert.deepEqual(strip(composed.audit as never), strip(base.audit as never));
    ok("composed write: rows field-identical to the param-absent baseline");

    // 3. Rollback in the CALLER's scope unwinds everything createTransaction
    // wrote — transaction, postings, audit.
    let rolledBackId = "";
    await assert.rejects(
      db.transaction(async (tx) => {
        rolledBackId = await createTransaction(standardInput("to be rolled back"), tx);
        throw new Error("outer failure after inner ledger write");
      }),
      /outer failure/,
    );
    const gone = await rowsOf(rolledBackId);
    assert.equal(gone.tx.length, 0);
    assert.equal(gone.postings.length, 0);
    assert.equal(gone.audit.length, 0);
    ok("outer rollback fully unwinds the inner ledger write (tx + postings + audit)");

    // 4. Validation fires identically in the composed path, before any write.
    const before = await db.$count(transactions, eq(transactions.entityId, entity.id));
    await assert.rejects(
      db.transaction((tx) =>
        createTransaction(
          {
            ...standardInput("zero-sum violation"),
            postings: [
              { accountId: bank.id, amount: -100 },
              { accountId: equity.id, amount: 99, categoryId: category.id },
            ],
          },
          tx,
        ),
      ),
      LedgerValidationError,
    );
    assert.equal(await db.$count(transactions, eq(transactions.entityId, entity.id)), before);
    ok("zero-sum validation still throws in the composed path, nothing written");

    // 5. Lazy rates: explicit-amountRon legs on a non-RON account write with
    // NO rate available anywhere near the date — BNR is never consulted.
    const fxId = await createTransaction({
      entityId: entity.id,
      date: FUTURE_DATE,
      description: "explicit RON mirror, no BNR data exists",
      kind: "transfer",
      postings: [
        { accountId: bank.id, amount: -50000 },
        { accountId: usd.id, amount: 10000, amountRon: 50000 },
      ],
    });
    const fx = await rowsOf(fxId);
    assert.equal(fx.postings.find((p) => p.currency === "USD")!.amountRon, 50000);
    ok("explicit-amountRon USD leg books with zero fx_rates data (BNR not consulted)");

    // 6. The conversion path is unchanged: a leg WITHOUT amountRon still
    // resolves the stored rate. Seed one rate the day before; assert the
    // stored conversion used it exactly.
    await db.insert(fxRates).values({ date: SEEDED_RATE_DATE, currency: "USD", rateToRon: "5.000000" });
    const convId = await createTransaction({
      entityId: entity.id,
      date: FUTURE_DATE,
      description: "implicit conversion via stored rate",
      kind: "transfer",
      postings: [
        { accountId: usd.id, amount: -10000 },
        { accountId: bank.id, amount: 50000 },
      ],
    });
    const conv = await rowsOf(convId);
    assert.equal(conv.postings.find((p) => p.currency === "USD")!.amountRon, -50000);
    ok("missing-amountRon leg still converts via the resolved stored rate");
  } finally {
    // Teardown: everything hangs off the throwaway entity; fx row is global.
    const txIds = (
      await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.entityId, entity.id))
    ).map((t) => t.id);
    for (const id of txIds) {
      await db.delete(auditLog).where(eq(auditLog.rowId, id));
      await db.delete(postings).where(eq(postings.transactionId, id));
    }
    await db.delete(transactions).where(eq(transactions.entityId, entity.id));
    await db.delete(categories).where(eq(categories.entityId, entity.id));
    await db.delete(accounts).where(eq(accounts.entityId, entity.id));
    await db.delete(entities).where(eq(entities.id, entity.id));
    await db.delete(fxRates).where(gte(fxRates.date, SEEDED_RATE_DATE));
  }

  console.log(`\nAll ${checks} seam characterization checks passed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
