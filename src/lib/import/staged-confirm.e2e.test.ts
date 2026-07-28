/**
 * Staged ING review regression: confirmation persists without ledger writes,
 * un-confirm clears the decision, and batch booking isolates row failures.
 *
 * Run with DATABASE_URL pointed at TEST_DATABASE_URL:
 *   npx tsx src/lib/import/staged-confirm.e2e.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "@/db";
import { auditLog, categories, importRows, transactions } from "@/db/schema";
import { requireTestDatabase } from "@/lib/test-database-sentinel";
import {
  bookConfirmedRows,
  confirmImportRow,
  createImportBatch,
  unconfirmImportRow,
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
  if (!(await requireTestDatabase(pool, "staged import confirmation"))) return;
  const priorAuditIds = new Set(
    (await db.select({ id: auditLog.id }).from(auditLog)).map((row) => row.id),
  );
  const env = await setupImportTestEntity();
  const otherEnv = await setupImportTestEntity();
  try {
    const batch = await createImportBatch({
      entityId: env.entityId,
      bankAccountId: env.bankAccountId,
      text: fixture,
      ownerNames: ["Grigore Filimon"],
    });
    const rows = await db
      .select()
      .from(importRows)
      .where(eq(importRows.batchId, batch.batchId));
    const byLine = (lineNo: string) => rows.find((row) => row.lineNo === lineNo)!;
    const servicesCategoryId = env.categoryId("Services|expense");

    await ok("confirm rejects a category from another entity before persisting a decision", async () => {
      await assert.rejects(
        confirmImportRow({
          rowId: byLine("1461").id,
          categoryId: otherEnv.categoryId("Services|expense"),
        }),
        (error) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "ledger.categoryWrongEntity",
      );
      const [reloaded] = await db
        .select()
        .from(importRows)
        .where(eq(importRows.id, byLine("1461").id));
      assert.equal(reloaded.status, "pending");
      assert.equal(reloaded.confirmedCategoryId, null);
    });

    const archivedCategoryId = env.categoryId("Software subscriptions|expense");
    await db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(eq(categories.id, archivedCategoryId));
    await ok("confirm rejects an archived category before persisting a decision", async () => {
      await assert.rejects(
        confirmImportRow({ rowId: byLine("1464").id, categoryId: archivedCategoryId }),
        (error) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "ledger.categoryNotFound",
      );
      const [reloaded] = await db
        .select()
        .from(importRows)
        .where(eq(importRows.id, byLine("1464").id));
      assert.equal(reloaded.status, "pending");
      assert.equal(reloaded.confirmedCategoryId, null);
    });
    await db
      .update(categories)
      .set({ deletedAt: null })
      .where(eq(categories.id, archivedCategoryId));

    await confirmImportRow({ rowId: byLine("1461").id, categoryId: servicesCategoryId });
    await ok("confirm stages without creating a transaction and persists the owner category", async () => {
      const [reloaded] = await db
        .select()
        .from(importRows)
        .where(eq(importRows.id, byLine("1461").id));
      assert.equal(reloaded.status, "confirmed");
      assert.equal(reloaded.confirmedCategoryId, servicesCategoryId);
      assert.equal(reloaded.suggestedCategoryId, null);
      assert.equal(reloaded.transactionId, null);
      assert.equal(
        await db.$count(transactions, eq(transactions.entityId, env.entityId)),
        0,
      );
    });

    await unconfirmImportRow(byLine("1461").id);
    await ok("un-confirm returns the row to pending and clears the owner category", async () => {
      const [reloaded] = await db
        .select()
        .from(importRows)
        .where(eq(importRows.id, byLine("1461").id));
      assert.equal(reloaded.status, "pending");
      assert.equal(reloaded.confirmedCategoryId, null);
      assert.equal(reloaded.transactionId, null);
    });

    await confirmImportRow({ rowId: byLine("1461").id, categoryId: servicesCategoryId });
    const firstBooking = await bookConfirmedRows(batch.batchId);
    await ok("batch booking books only confirmed rows and leaves untouched rows pending", async () => {
      assert.deepEqual(
        firstBooking.map((outcome) => [outcome.lineNo, outcome.status]),
        [["1461", "booked"]],
      );
      const current = await db
        .select()
        .from(importRows)
        .where(inArray(importRows.id, [byLine("1461").id, byLine("1462").id]));
      assert.equal(current.find((row) => row.lineNo === "1461")?.status, "booked");
      assert.equal(current.find((row) => row.lineNo === "1462")?.status, "pending");
    });

    const failingCategoryId = archivedCategoryId;
    await confirmImportRow({
      rowId: byLine("1462").id,
      categoryId: byLine("1462").suggestedCategoryId,
    });
    await confirmImportRow({ rowId: byLine("1464").id, categoryId: failingCategoryId });
    await db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(eq(categories.id, failingCategoryId));

    const mixedBooking = await bookConfirmedRows(batch.batchId);
    await ok("a mid-batch failure preserves earlier success and remains confirmed with an error", async () => {
      assert.equal(mixedBooking.length, 2);
      const succeeded = mixedBooking.find((outcome) => outcome.lineNo === "1462");
      const failed = mixedBooking.find((outcome) => outcome.lineNo === "1464");
      assert.equal(succeeded?.status, "booked");
      assert.equal(failed?.status, "error");
      if (failed?.status !== "error") assert.fail("line 1464 should return an error outcome");
      assert.equal(failed.error.code, "ledger.categoryNotFound");

      const current = await db
        .select()
        .from(importRows)
        .where(inArray(importRows.id, [byLine("1462").id, byLine("1464").id, byLine("1465").id]));
      assert.equal(current.find((row) => row.lineNo === "1462")?.status, "booked");
      assert.equal(current.find((row) => row.lineNo === "1464")?.status, "confirmed");
      assert.equal(
        current.find((row) => row.lineNo === "1464")?.confirmedCategoryId,
        failingCategoryId,
      );
      assert.equal(current.find((row) => row.lineNo === "1465")?.status, "pending");
    });

    console.log(`\nAll ${checks} staged-confirm checks passed.`);
  } finally {
    await teardownImportTestEntity(otherEnv.entityId);
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
