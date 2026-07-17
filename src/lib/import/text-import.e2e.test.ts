/**
 * MONEY-GRADE end-to-end test: committed statement TEXT → review inbox →
 * booked ledger, against the real Skyline fixture.
 *
 * NAMING (Stage 4 amendment 6): this exercises the TEXT → ledger path. It
 * feeds pre-extracted statement text (the committed fixture) — it does NOT
 * test PDF extraction. A green run means "text import works", never
 * "PDF import works".
 *
 * Runs on the dev DB against a throwaway company entity (created + torn down
 * here); seeded data is untouched.
 * Run: npx tsx src/lib/import/text-import.e2e.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import { auditLog, importRows, postings, taxAccruals, transactions } from "@/db/schema";
import { LedgerValidationError } from "@/lib/ledger";
import { requireTestDatabase } from "@/lib/test-database-sentinel";
import { bookHighConfidenceRows, bookImportRow, createImportBatch } from "./service";
import {
  EXPECTED_KIND,
  setupImportTestEntity,
  teardownImportTestEntity,
  type ImportTestEntity,
} from "./test-support";

const fixture = readFileSync(join(import.meta.dirname, "ing", "fixtures", "skyline-2026-06.txt"), "utf8");
const csvFixture = readFileSync(join(import.meta.dirname, "ing", "fixtures", "skyline-2026-06.csv"), "utf8");

let checks = 0;
function ok(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => {
    checks += 1;
    console.log(`  ✓ ${name}`);
  });
}

async function run(env: ImportTestEntity) {
  // ---------------------------------------------------- 1. Parse into inbox
  const created = await createImportBatch({
    entityId: env.entityId,
    bankAccountId: env.bankAccountId,
    text: fixture,
    ownerNames: ["Grigore Filimon"],
  });
  await ok("import stages 17 rows, nothing booked, no duplicates/overlaps", () => {
    assert.equal(created.staged, 17);
    assert.equal(created.duplicates, 0);
    assert.equal(created.overlapSuspects, 0);
  });

  const staged = await db
    .select()
    .from(importRows)
    .where(eq(importRows.batchId, created.batchId));
  const byLine = new Map(staged.map((r) => [r.lineNo, r]));

  await ok("every staged row is pending (nothing auto-booked)", () => {
    assert.equal(staged.length, 17);
    assert.ok(staged.every((r) => r.status === "pending"));
    assert.ok(staged.every((r) => r.transactionId === null));
  });

  await ok("each row's kind matches the approved KIND mapping", () => {
    for (const [lineNo, kind] of Object.entries(EXPECTED_KIND)) {
      assert.equal(byLine.get(lineNo)?.kind, kind, `line ${lineNo}`);
    }
  });

  await ok("twin fees 1476/1479 get DISTINCT synthetic keys, both present", () => {
    const a = byLine.get("1476")!.resolvedExternalRef;
    const b = byLine.get("1479")!.resolvedExternalRef;
    assert.notEqual(a, b);
    assert.match(a, /^ING:RO\d{2}[A-Z0-9]+:Nr\.6\/30\.06\.2026:1476$/);
    assert.match(b, /^ING:RO\d{2}[A-Z0-9]+:Nr\.6\/30\.06\.2026:1479$/);
  });

  await ok("ref-bearing rows keep the long bank ref; refless rows use synthetic keys", () => {
    // Transfers/professional services carry the long ref; POS/fees/revenue don't.
    assert.ok(!byLine.get("1462")!.resolvedExternalRef.startsWith("ING:")); // has bank ref
    assert.ok(byLine.get("1482")!.resolvedExternalRef.startsWith("ING:")); // revenue, refless
    assert.ok(byLine.get("1461")!.resolvedExternalRef.startsWith("ING:")); // POS, refless
  });

  // ---------------------------------------------------- 2. Book every row
  // card_purchase/unknown have no suggestion → caller supplies a category;
  // everything else books on its suggestion (or needs none).
  let booked = 0;
  for (const row of staged) {
    const categoryId =
      row.kind === "card_purchase" ? env.categoryId("Services|expense") : undefined;
    const result = await bookImportRow({ rowId: row.id, categoryId });
    assert.equal(result.status, "booked", `line ${row.lineNo} did not book: ${result.status}`);
    booked += 1;
  }
  await ok("all 17 rows book through createTransaction", () => assert.equal(booked, 17));

  const txRows = await db
    .select({ id: transactions.id, kind: transactions.kind })
    .from(transactions)
    .where(and(eq(transactions.entityId, env.entityId), isNull(transactions.deletedAt)));
  const txById = new Map(txRows.map((t) => [t.id, t]));
  assert.equal(txRows.length, 17);

  const bookedRows = await db
    .select()
    .from(importRows)
    .where(eq(importRows.batchId, created.batchId));
  const bookedByLine = new Map(bookedRows.map((r) => [r.lineNo, r]));

  // Postings grouped by transaction.
  const allPostings = await db
    .select()
    .from(postings)
    .where(isNull(postings.deletedAt));
  const postingsByTx = new Map<string, typeof allPostings>();
  for (const p of allPostings) {
    if (!txById.has(p.transactionId)) continue;
    (postingsByTx.get(p.transactionId) ?? postingsByTx.set(p.transactionId, []).get(p.transactionId)!).push(p);
  }

  await ok("zero-sum holds on every booked transaction", () => {
    for (const [txId, ps] of postingsByTx) {
      const sum = ps.reduce((s, p) => s + p.amountRon, 0);
      assert.equal(sum, 0, `tx ${txId} not zero-sum: ${sum}`);
    }
  });

  await ok("bank legs reproduce the statement's closing-balance movement", () => {
    // opening 40,988.95 → closing 59,012.95 = +18,024.00 RON = 1,802,400 bani.
    const bankLegs = allPostings.filter((p) => p.accountId === env.bankAccountId);
    const movement = bankLegs.reduce((s, p) => s + p.amount, 0);
    assert.equal(movement, 1_802_400);
    assert.equal(bankLegs.length, 17, "exactly one bank leg per statement row");
  });

  await ok("revenue (1482) fires the micro-tax accrual pair", async () => {
    const txId = bookedByLine.get("1482")!.transactionId!;
    const ps = postingsByTx.get(txId)!;
    // bank + equity(Revenue) + tax_liability + equity(Taxes) = 4 legs.
    assert.equal(ps.length, 4);
    assert.ok(ps.some((p) => p.accountId === env.taxLiabilityAccountId && p.amount < 0));
    const accr = await db.select().from(taxAccruals).where(eq(taxAccruals.transactionId, txId));
    assert.equal(accr.length, 1, "revenue booked exactly one tax accrual link");
  });

  await ok("state_payment (1475/1478) settles tax_liability, no category", () => {
    for (const lineNo of ["1475", "1478"]) {
      const txId = bookedByLine.get(lineNo)!.transactionId!;
      const ps = postingsByTx.get(txId)!;
      assert.equal(ps.length, 2);
      const settle = ps.find((p) => p.accountId === env.taxLiabilityAccountId);
      assert.ok(settle, `line ${lineNo} has no tax_liability leg`);
      assert.equal(settle!.amount > 0, true, "debit statement row pays DOWN the liability");
      assert.ok(ps.every((p) => p.categoryId === null), "state payment legs are uncategorized");
    }
  });

  await ok("owner_transfer (1465) books as a transfer, not an expense", () => {
    const txId = bookedByLine.get("1465")!.transactionId!;
    assert.equal(txById.get(txId)!.kind, "transfer");
    assert.ok(postingsByTx.get(txId)!.every((p) => p.categoryId === null));
  });

  await ok("no BNR fx_rates were consulted (all-RON statement)", () => {
    // Every booked posting is RON; conversion path (resolveRonRate) is never
    // reached, so booking cannot have called BNR. Asserting currency proves it.
    assert.ok(allPostings.filter((p) => txById.has(p.transactionId)).every((p) => p.currency === "RON"));
  });

  // ---------------------------------------------------- 3. Re-import is a no-op
  // Same statement, whitespace-different extraction (parser trims, so the
  // parse is identical but the hash differs → exercises real dedup, not the
  // convenience hash guard).
  const reimport = await createImportBatch({
    entityId: env.entityId,
    bankAccountId: env.bankAccountId,
    text: fixture + "\n\n",
    ownerNames: ["Grigore Filimon"],
  });
  await ok("re-import pre-marks all 17 rows duplicate (ref-bearing + synthetic)", () => {
    assert.equal(reimport.staged, 17);
    assert.equal(reimport.duplicates, 17);
  });

  const reRows = await db
    .select()
    .from(importRows)
    .where(eq(importRows.batchId, reimport.batchId));
  await ok("re-import twins 1476/1479 still distinct and both duplicate-linked", () => {
    const a = reRows.find((r) => r.lineNo === "1476")!;
    const b = reRows.find((r) => r.lineNo === "1479")!;
    assert.notEqual(a.resolvedExternalRef, b.resolvedExternalRef);
    assert.equal(a.status, "duplicate");
    assert.equal(b.status, "duplicate");
    assert.ok(a.transactionId && b.transactionId && a.transactionId !== b.transactionId);
  });

  await ok("booking a duplicate row is refused (no second write)", async () => {
    const dup = reRows.find((r) => r.status === "duplicate")!;
    await assert.rejects(
      () => bookImportRow({ rowId: dup.id }),
      (e) =>
        e instanceof LedgerValidationError &&
        e.code === "imports.rowAlreadyStatus" &&
        e.params?.status === "duplicate",
    );
  });

  const finalTxCount = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.entityId, env.entityId), isNull(transactions.deletedAt)));
  await ok("ledger still holds exactly 17 transactions after re-import", () =>
    assert.equal(finalTxCount.length, 17),
  );

  // ------------------------------------------ 4. Cross-format import safety
  // The SAME statement as its CSV export — the synthetic-key blind spot the
  // CSV amendment names: refless synthetic keys are format-dependent and
  // CANNOT row-dedup across formats, so the format-agnostic (account,
  // period) overlap guard must flag every refless row for individual
  // confirmation, while ref-bearing rows hard-dedup via the bank's own
  // reference regardless of format.
  // Whitespace-perturbed like the text re-import above: the rawTextHash
  // guard is GLOBAL (not entity-scoped), so the owner's real import of this
  // same CSV into Skyline on the shared dev DB would otherwise short-circuit
  // this batch before the controls under test (row dedup + overlap guard)
  // ever run. The parser drops blank lines, so the parse is identical.
  const csvImport = await createImportBatch({
    entityId: env.entityId,
    bankAccountId: env.bankAccountId,
    text: csvFixture + "\n\n",
    ownerNames: ["Grigore Filimon"],
  });
  await ok("CSV of the already-booked statement: 6 ref-bearing rows dedup ACROSS formats", () => {
    assert.equal(csvImport.staged, 17);
    assert.equal(csvImport.duplicates, 6);
  });
  await ok("…and all 11 refless rows are overlap-flagged for per-row confirmation", () =>
    assert.equal(csvImport.overlapSuspects, 11),
  );
  const bulk = await bookHighConfidenceRows(csvImport.batchId);
  await ok("confirm-all books NONE of them — overlap suspects demand a human", () => {
    assert.equal(bulk.booked, 0);
    assert.equal(bulk.left, 11);
  });
  const afterCsv = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.entityId, env.entityId), isNull(transactions.deletedAt)));
  await ok("ledger STILL holds exactly 17 — the two-format case books nothing silently", () =>
    assert.equal(afterCsv.length, 17),
  );
}

async function main() {
  if (!(await requireTestDatabase(pool, "text import"))) return;
  const priorAuditIds = new Set(
    (await db.select({ id: auditLog.id }).from(auditLog)).map((row) => row.id),
  );
  const env = await setupImportTestEntity();
  try {
    await run(env);
    console.log(`\nAll ${checks} money-grade checks passed.`);
  } finally {
    await teardownImportTestEntity(env.entityId);
    const createdAuditIds = (await db.select({ id: auditLog.id }).from(auditLog))
      .map((row) => row.id)
      .filter((id) => !priorAuditIds.has(id));
    if (createdAuditIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.id, createdAuditIds));
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
