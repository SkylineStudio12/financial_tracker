/**
 * Imported-edit ownership test: a manual edit may replace posting refs, but
 * the durable import link and source claim remain active and the staging row
 * is marked as owner-modified.
 *
 * Run: npx tsx src/lib/import/edit-guard.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import { importRows, postings, transactionImportLinks } from "@/db/schema";
import { updateTransaction, type TransactionInput } from "@/lib/ledger";
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

    // Form-shaped update: posting refs are revision-local, while import
    // identity remains in transaction_import_links.
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
    await updateTransaction(txId, formShaped, 1);
    const [link] = await db
      .select()
      .from(transactionImportLinks)
      .where(eq(transactionImportLinks.transactionId, txId));
    const [staging] = await db.select().from(importRows).where(eq(importRows.id, row.id));
    assert.equal(link.lifecycle, "active");
    assert.ok(link.modifiedAfterImport);
    assert.equal(staging.status, "booked");
    assert.equal(staging.modifiedAfterImport, true);
    ok("form-shaped edit preserves durable import ownership and marks provenance modified");

    // Importer-shaped update: preserves the ref on the bank leg. Allowed.
    const preserving: TransactionInput = {
      ...formShaped,
      description: "Corrected via importer",
      postings: [
        { accountId: env.bankAccountId, amount: bankLeg.amount, externalRef: bankLeg.externalRef },
        { accountId: env.equityAccountId, amount: equityLeg.amount, categoryId: equityLeg.categoryId },
      ],
    };
    await updateTransaction(txId, preserving, 2);
    const after = await db
      .select()
      .from(postings)
      .where(and(eq(postings.transactionId, txId), isNull(postings.deletedAt)));
    assert.ok(after.some((p) => p.externalRef === bankLeg.externalRef), "ref survives the allowed edit");
    ok("a later correction may still carry the original posting ref");

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
