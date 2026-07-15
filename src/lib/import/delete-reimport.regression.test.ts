/**
 * Import ownership lifecycle regression: soft-delete removes the row from the
 * ledger but retains duplicate ownership; permanent purge deliberately
 * releases that ownership and makes the source row bookable again.
 *
 * Runs on the dev DB against a throwaway company entity.
 * Run: npx tsx src/lib/import/delete-reimport.regression.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import { importRows, postings } from "@/db/schema";
import { purgeTransaction, softDeleteNonInvestmentTransaction } from "@/lib/ledger";
import { bookImportRow, createImportBatch } from "./service";
import { setupImportTestEntity, teardownImportTestEntity } from "./test-support";

const fixture = readFileSync(join(import.meta.dirname, "ing", "fixtures", "skyline-2026-06.txt"), "utf8");

let checks = 0;
function ok(name: string) {
  checks += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  const env = await setupImportTestEntity();
  try {
    // A refless fee row — the hardest identity case (synthetic key).
    const FEE_LINE = "1463";

    // 1. Book it once.
    const first = await createImportBatch({
      entityId: env.entityId,
      bankAccountId: env.bankAccountId,
      text: fixture,
      ownerNames: ["Grigore Filimon"],
    });
    const [firstRow] = await db
      .select()
      .from(importRows)
      .where(and(eq(importRows.batchId, first.batchId), eq(importRows.lineNo, FEE_LINE)));
    const booked = await bookImportRow({ rowId: firstRow.id });
    assert.equal(booked.status, "booked");
    const firstTxId = booked.transactionId;
    ok(`fee row ${FEE_LINE} books first time (ref ${firstRow.resolvedExternalRef})`);

    // 2. A re-import now sees it as a live duplicate (index active).
    const dupBatch = await createImportBatch({
      entityId: env.entityId,
      bankAccountId: env.bankAccountId,
      text: fixture + " ",
      ownerNames: ["Grigore Filimon"],
    });
    const [dupRow] = await db
      .select()
      .from(importRows)
      .where(and(eq(importRows.batchId, dupBatch.batchId), eq(importRows.lineNo, FEE_LINE)));
    assert.equal(dupRow.status, "duplicate");
    ok("while live, re-import marks the same fee row duplicate");

    // 3. Soft-delete the booked transaction.
    await softDeleteNonInvestmentTransaction(firstTxId);
    const live = await db
      .select({ id: postings.id })
      .from(postings)
      .where(
        and(
          eq(postings.accountId, env.bankAccountId),
          eq(postings.externalRef, firstRow.resolvedExternalRef),
          isNull(postings.deletedAt),
        ),
      );
    assert.equal(live.length, 0, "soft-delete leaves no LIVE posting on that ref");
    ok("soft-deleting the transaction frees the ref among live postings");

    // 4. Trash retains durable identity even though the posting ref is free.
    const reimport = await createImportBatch({
      entityId: env.entityId,
      bankAccountId: env.bankAccountId,
      text: fixture + "  ",
      ownerNames: ["Grigore Filimon"],
    });
    const [reRow] = await db
      .select()
      .from(importRows)
      .where(and(eq(importRows.batchId, reimport.batchId), eq(importRows.lineNo, FEE_LINE)));
    assert.equal(reRow.status, "duplicate", "trash retains duplicate ownership");
    assert.equal(reRow.resolvedExternalRef, firstRow.resolvedExternalRef, "same identity");
    ok("soft-delete keeps the imported row duplicate-protected");

    // 5. Purge is the explicit identity-release action.
    await purgeTransaction(firstTxId);
    const afterPurge = await createImportBatch({
      entityId: env.entityId,
      bankAccountId: env.bankAccountId,
      text: fixture + "   ",
      ownerNames: ["Grigore Filimon"],
    });
    const [releasedRow] = await db
      .select()
      .from(importRows)
      .where(and(eq(importRows.batchId, afterPurge.batchId), eq(importRows.lineNo, FEE_LINE)));
    assert.equal(releasedRow.status, "pending", "purge releases duplicate ownership");
    const rebooked = await bookImportRow({ rowId: releasedRow.id });
    assert.equal(rebooked.status, "booked", "delete-then-reimport books cleanly");
    assert.notEqual(rebooked.transactionId, firstTxId, "a genuinely new transaction");
    ok("purge → re-import → books cleanly with a new transaction");

    console.log(`\nAll ${checks} regression checks passed.`);
  } finally {
    await teardownImportTestEntity(env.entityId);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
