/**
 * Edit-guard test (Stage 4, docs/parked-plan.md): updateTransaction must
 * reject an update that would DROP an existing external_ref — the case a
 * manual form edit of an imported transaction triggers (forms never carry
 * the ref). A form-shaped update (no refs) is refused; an importer-shaped
 * update that preserves the ref is allowed.
 *
 * Run: npx tsx src/lib/import/edit-guard.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import { importRows, postings } from "@/db/schema";
import { LedgerValidationError, updateTransaction, type TransactionInput } from "@/lib/ledger";
import { bookImportRow, createImportBatch } from "./service";
import { setupImportTestEntity, teardownImportTestEntity } from "./test-support";

const fixture = readFileSync(join(import.meta.dirname, "ing", "fixtures", "skyline-2026-06.txt"), "utf8");
let checks = 0;
const ok = (name: string) => {
  checks += 1;
  console.log(`  ✓ ${name}`);
};

async function main() {
  const env = await setupImportTestEntity();
  try {
    const batch = await createImportBatch({
      entityId: env.entityId,
      bankAccountId: env.bankAccountId,
      text: fixture,
      ownerNames: ["Grigore Filimon"],
    });
    // A professional-services debit — ref-bearing, simple two-leg shape.
    const [row] = await db
      .select()
      .from(importRows)
      .where(and(eq(importRows.batchId, batch.batchId), eq(importRows.lineNo, "1462")));
    const { transactionId } = await bookImportRow({ rowId: row.id });
    const txId = transactionId!;
    const booked = await db.select().from(postings).where(eq(postings.transactionId, txId));
    const bankLeg = booked.find((p) => p.accountId === env.bankAccountId)!;
    const equityLeg = booked.find((p) => p.accountId === env.equityAccountId)!;
    assert.ok(bankLeg.externalRef, "booked bank leg carries the ref");

    // Form-shaped update: same amounts, but no external_ref on any leg
    // (exactly what the manual edit form sends). Must be refused.
    const formShaped: TransactionInput = {
      entityId: env.entityId,
      date: "2026-06-15",
      description: "Edited via form",
      kind: "standard",
      postings: [
        { accountId: env.bankAccountId, amount: bankLeg.amount },
        { accountId: env.equityAccountId, amount: equityLeg.amount, categoryId: equityLeg.categoryId },
      ],
    };
    await assert.rejects(
      () => updateTransaction(txId, formShaped),
      (e) => e instanceof LedgerValidationError && /imported from a bank statement/.test(e.message),
    );
    ok("form-shaped edit (drops external_ref) is rejected at the service");

    // Importer-shaped update: preserves the ref on the bank leg. Allowed.
    const preserving: TransactionInput = {
      ...formShaped,
      description: "Corrected via importer",
      postings: [
        { accountId: env.bankAccountId, amount: bankLeg.amount, externalRef: bankLeg.externalRef },
        { accountId: env.equityAccountId, amount: equityLeg.amount, categoryId: equityLeg.categoryId },
      ],
    };
    await updateTransaction(txId, preserving);
    const after = await db
      .select()
      .from(postings)
      .where(and(eq(postings.transactionId, txId), isNull(postings.deletedAt)));
    assert.ok(after.some((p) => p.externalRef === bankLeg.externalRef), "ref survives the allowed edit");
    ok("ref-preserving edit (importer correction) is allowed");

    console.log(`\nAll ${checks} edit-guard checks passed.`);
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
