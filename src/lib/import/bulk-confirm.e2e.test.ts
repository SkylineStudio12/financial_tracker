/**
 * §11.5 regression: the June 2026 ING salary transfer is left pending by
 * bulk confirm, while eligible non-transfer rows are staged without booking.
 *
 * Run with DATABASE_URL pointed at TEST_DATABASE_URL:
 *   npx tsx src/lib/import/bulk-confirm.e2e.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  auditLog,
  importRows,
  postings,
  salaryTransactionDetails,
  transactions,
} from "@/db/schema";
import { requireTestDatabase } from "@/lib/test-database-sentinel";
import {
  confirmHighConfidenceRows,
  createImportBatch,
} from "./service";
import { setupImportTestEntity, teardownImportTestEntity } from "./test-support";

const fixture = readFileSync(
  join(import.meta.dirname, "ing", "fixtures", "skyline-2026-06.txt"),
  "utf8",
);

let checks = 0;
async function ok(name: string, assertion: () => void | Promise<void>) {
  await assertion();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  if (!(await requireTestDatabase(pool, "import-inbox bulk confirm"))) return;
  const priorAuditIds = new Set(
    (await db.select({ id: auditLog.id }).from(auditLog)).map((row) => row.id),
  );
  const env = await setupImportTestEntity();
  try {
    // Historical baseline only: this synthetic test company has no mapped
    // owner, so seed its pre-existing salary movement directly. The bulk rows
    // under test still book through the ordinary ledger service.
    const [salaryTransaction] = await db
      .insert(transactions)
      .values({
        entityId: env.entityId,
        date: "2026-07-10",
        description: "Salary Grigore Filimon 2026-06",
        kind: "salary",
      })
      .returning({ id: transactions.id });
    const salaryTransactionId = salaryTransaction.id;
    await db.insert(postings).values([
      {
        transactionId: salaryTransactionId,
        accountId: env.bankAccountId,
        amount: -269_500,
        amountRon: -269_500,
        currency: "RON",
        counterparty: "Grigore Filimon",
      },
      {
        transactionId: salaryTransactionId,
        accountId: env.equityAccountId,
        amount: 269_500,
        amountRon: 269_500,
        currency: "RON",
      },
    ]);
    await db.insert(salaryTransactionDetails).values({
      transactionId: salaryTransactionId,
      revision: 1,
      payMonth: "2026-06-01",
      personalDeductionMinor: 0,
    });
    const batch = await createImportBatch({
      entityId: env.entityId,
      bankAccountId: env.bankAccountId,
      text: `${fixture}\n\n`,
      ownerNames: ["Grigore Filimon"],
    });

    const result = await confirmHighConfidenceRows(batch.batchId);
    const rows = await db.select().from(importRows).where(eq(importRows.batchId, batch.batchId));
    const byLine = new Map(rows.map((row) => [row.lineNo, row]));
    const ownerTransfer = byLine.get("1465");
    const eligibleNonTransfer = byLine.get("1462");

    await ok("§11.5: line 1465 owner_transfer stays low-confidence and pending", () => {
      assert.ok(ownerTransfer);
      const classified = ownerTransfer.payload as { row: { amountMinor: number } };
      assert.equal(classified.row.amountMinor, 269_500);
      assert.equal(ownerTransfer.kind, "owner_transfer");
      assert.equal(ownerTransfer.confidence, "low");
      assert.match(ownerTransfer.reason, /ownerNameMatch/);
      assert.equal(ownerTransfer.status, "pending");
      assert.equal(ownerTransfer.skipReasonCode, null);
      assert.equal(ownerTransfer.skipReasonNote, null);
      assert.equal(ownerTransfer.transactionId, null);
      assert.equal(result.ownerTransfersExcluded, 1);
    });

    await ok("§11.5: salary-owned 2,695.00 bank movement exists once, not twice", async () => {
      const movements = await db
        .select({ transactionId: postings.transactionId, kind: transactions.kind })
        .from(postings)
        .innerJoin(transactions, eq(transactions.id, postings.transactionId))
        .where(
          and(
            eq(postings.accountId, env.bankAccountId),
            eq(postings.amount, -269_500),
            isNull(postings.deletedAt),
            isNull(transactions.deletedAt),
          ),
        );
      assert.deepEqual(movements, [{ transactionId: salaryTransactionId, kind: "salary" }]);
      const details = await db
        .select({ payMonth: salaryTransactionDetails.payMonth })
        .from(salaryTransactionDetails)
        .where(eq(salaryTransactionDetails.transactionId, salaryTransactionId));
      assert.deepEqual(details.map((row) => row.payMonth), ["2026-06-01"]);
    });

    await ok("§11.5: eligible high-confidence non-transfer line 1462 stages only", () => {
      assert.ok(eligibleNonTransfer);
      assert.equal(eligibleNonTransfer.kind, "professional_services");
      assert.equal(eligibleNonTransfer.confidence, "high");
      assert.equal(eligibleNonTransfer.status, "confirmed");
      assert.equal(eligibleNonTransfer.confirmedCategoryId, eligibleNonTransfer.suggestedCategoryId);
      assert.equal(eligibleNonTransfer.transactionId, null);
      assert.equal(result.confirmed, 13);
      assert.equal(result.left, 4);
    });

    await ok("bulk staging writes no import transaction or posting", async () => {
      const importedTransactions = rows.flatMap((row) =>
        row.transactionId ? [row.transactionId] : [],
      );
      assert.deepEqual(importedTransactions, []);
      const entityTransactions = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.entityId, env.entityId), isNull(transactions.deletedAt)));
      assert.deepEqual(entityTransactions, [{ id: salaryTransactionId }]);
    });

    await ok("bulk revenue line 1482 remains confirmed and unbooked", () => {
      const revenue = byLine.get("1482");
      assert.equal(revenue?.status, "confirmed");
      assert.equal(revenue.transactionId, null);
    });

    console.log(`\nAll ${checks} import-inbox bulk-confirm checks passed.`);
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
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
