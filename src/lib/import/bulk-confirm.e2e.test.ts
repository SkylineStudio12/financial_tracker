/**
 * §11.5 regression: the June 2026 ING salary transfer is system-skipped by
 * bulk confirm, while eligible non-transfer rows still book through the
 * ordinary single-row service path.
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
  taxAccruals,
  transactions,
} from "@/db/schema";
import { createTransaction } from "@/lib/ledger";
import { requireTestDatabase } from "@/lib/test-database-sentinel";
import {
  bookHighConfidenceRows,
  createImportBatch,
  OWNER_TRANSFER_BULK_SKIP_REASON,
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
    const salaryTransactionId = await createTransaction({
      entityId: env.entityId,
      date: "2026-07-10",
      description: "Salary Grigore Filimon 2026-06",
      kind: "salary",
      postings: [
        { accountId: env.bankAccountId, amount: -269_500, counterparty: "Grigore Filimon" },
        { accountId: env.equityAccountId, amount: 269_500 },
      ],
      salaryDetail: { payMonth: "2026-06-01", personalDeductionMinor: 0 },
    });
    const batch = await createImportBatch({
      entityId: env.entityId,
      bankAccountId: env.bankAccountId,
      text: `${fixture}\n\n`,
      ownerNames: ["Grigore Filimon"],
    });

    const result = await bookHighConfidenceRows(batch.batchId);
    const rows = await db.select().from(importRows).where(eq(importRows.batchId, batch.batchId));
    const byLine = new Map(rows.map((row) => [row.lineNo, row]));
    const ownerTransfer = byLine.get("1465");
    const eligibleNonTransfer = byLine.get("1462");

    await ok("§11.5: line 1465 (2,695.00 owner_transfer) is system-skipped, never booked", () => {
      assert.ok(ownerTransfer);
      const classified = ownerTransfer.payload as { row: { amountMinor: number } };
      assert.equal(classified.row.amountMinor, 269_500);
      assert.equal(ownerTransfer.kind, "owner_transfer");
      assert.equal(ownerTransfer.confidence, "high");
      assert.match(ownerTransfer.reason, /ownerNameMatch/);
      assert.equal(ownerTransfer.status, "skipped");
      assert.equal(ownerTransfer.skipReasonCode, OWNER_TRANSFER_BULK_SKIP_REASON);
      assert.equal(ownerTransfer.skipReasonNote, null);
      assert.equal(ownerTransfer.transactionId, null);
      assert.equal(result.ownerTransfersSkipped, 1);
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

    await ok("§11.5: eligible high-confidence non-transfer line 1462 still books", () => {
      assert.ok(eligibleNonTransfer);
      assert.equal(eligibleNonTransfer.kind, "professional_services");
      assert.equal(eligibleNonTransfer.confidence, "high");
      assert.equal(eligibleNonTransfer.status, "booked");
      assert.ok(eligibleNonTransfer.transactionId);
      assert.equal(result.booked, 13);
      assert.equal(result.duplicates, 0);
      assert.equal(result.left, 3);
    });

    await ok("bulk-booked transactions are balanced through the ledger service", async () => {
      const bookedTransactionIds = rows.flatMap((row) =>
        row.status === "booked" && row.transactionId ? [row.transactionId] : [],
      );
      const bookedPostings = await db
        .select({ transactionId: postings.transactionId, amountRon: postings.amountRon })
        .from(postings)
        .where(inArray(postings.transactionId, bookedTransactionIds));
      const sums = new Map<string, number>();
      for (const posting of bookedPostings) {
        sums.set(posting.transactionId, (sums.get(posting.transactionId) ?? 0) + posting.amountRon);
      }
      assert.equal(sums.size, 13);
      assert.ok([...sums.values()].every((sum) => sum === 0));
    });

    await ok("bulk revenue line 1482 retains the ordinary micro-tax accrual", async () => {
      const revenue = byLine.get("1482");
      assert.equal(revenue?.status, "booked");
      assert.ok(revenue.transactionId);
      const accruals = await db
        .select({ id: taxAccruals.id })
        .from(taxAccruals)
        .where(eq(taxAccruals.transactionId, revenue.transactionId));
      assert.equal(accruals.length, 1);
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
