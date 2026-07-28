/**
 * Imported-transaction CRUD test: an imported non-investment transaction
 * follows the same edit/delete/restore path as a manual transaction while its
 * durable import ownership and modified-after-import marker remain intact.
 *
 * Run: npx tsx src/lib/import/edit-guard.test.ts
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
  transactionImportLinks,
  transactions,
} from "@/db/schema";
import {
  IMPORT_OWNERSHIP_LOCK,
  restoreTransaction,
  softDeleteNonInvestmentTransaction,
  updateTransaction,
  type TransactionInput,
} from "@/lib/ledger";
import { requireTestDatabase } from "@/lib/test-database-sentinel";
import {
  bookImportRow,
  confirmImportRow,
  createImportBatch,
  reopenTrashedImportRow,
} from "./service";
import { setupImportTestEntity, teardownImportTestEntity } from "./test-support";

const fixture = readFileSync(join(import.meta.dirname, "ing", "fixtures", "skyline-2026-06.txt"), "utf8");
let checks = 0;
const ok = (name: string) => {
  checks += 1;
  console.log(`  ✓ ${name}`);
};

async function main() {
  if (!(await requireTestDatabase(pool, "import edit guard"))) return;
  const priorAuditIds = new Set(
    (await db.select({ id: auditLog.id }).from(auditLog)).map((row) => row.id),
  );
  const env = await setupImportTestEntity();
  try {
    const batch = await createImportBatch({
      entityId: env.entityId,
      bankAccountId: env.bankAccountId,
      text: fixture,
      ownerNames: ["Grigore Filimon"],
    });
    const bookFixtureRow = async (lineNo: string) => {
      const [row] = await db
        .select()
        .from(importRows)
        .where(and(eq(importRows.batchId, batch.batchId), eq(importRows.lineNo, lineNo)));
      await confirmImportRow({ rowId: row.id, categoryId: row.suggestedCategoryId });
      const { transactionId } = await bookImportRow({ rowId: row.id });
      const txId = transactionId!;
      const [transaction] = await db.select().from(transactions).where(eq(transactions.id, txId));
      const currentPostings = await db
        .select()
        .from(postings)
        .where(and(eq(postings.transactionId, txId), isNull(postings.deletedAt)));
      const [link] = await db
        .select()
        .from(transactionImportLinks)
        .where(eq(transactionImportLinks.transactionId, txId));
      return { row, txId, transaction, currentPostings, link };
    };

    // Two professional-services debits — ref-bearing, simple two-leg shapes.
    // Separate transactions prove each edit independently sets provenance.
    const categoryCase = await bookFixtureRow("1462");
    const categoryBankLeg = categoryCase.currentPostings.find(
      (posting) => posting.accountId === env.bankAccountId,
    )!;
    const categoryEquityLeg = categoryCase.currentPostings.find(
      (posting) => posting.accountId === env.equityAccountId,
    )!;
    const changedCategoryId = env.categoryId("Software subscriptions|expense");
    assert.ok(categoryBankLeg.externalRef, "booked bank leg carries the ref");
    assert.notEqual(categoryEquityLeg.categoryId, changedCategoryId);

    const categoryChanged: TransactionInput = {
      entityId: env.entityId,
      date: categoryCase.transaction.date,
      description: categoryCase.transaction.description,
      kind: categoryCase.transaction.kind,
      postings: [
        { accountId: env.bankAccountId, amount: categoryBankLeg.amount },
        {
          accountId: env.equityAccountId,
          amount: categoryEquityLeg.amount,
          categoryId: changedCategoryId,
        },
      ],
    };
    await updateTransaction(categoryCase.txId, categoryChanged, 1);
    const categoryPostings = await db
      .select()
      .from(postings)
      .where(
        and(
          eq(postings.transactionId, categoryCase.txId),
          eq(postings.revision, 2),
          isNull(postings.deletedAt),
        ),
      );
    assert.equal(
      categoryPostings.find((posting) => posting.accountId === env.equityAccountId)?.categoryId,
      changedCategoryId,
    );
    const [linkAfterCategory] = await db
      .select()
      .from(transactionImportLinks)
      .where(eq(transactionImportLinks.transactionId, categoryCase.txId));
    const [stagingAfterCategory] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, categoryCase.row.id));
    assert.equal(linkAfterCategory.id, categoryCase.link.id);
    assert.equal(linkAfterCategory.lifecycle, "active");
    assert.equal(linkAfterCategory.releasedAt, null);
    assert.ok(linkAfterCategory.modifiedAfterImport);
    assert.equal(stagingAfterCategory.status, "booked");
    assert.equal(stagingAfterCategory.modifiedAfterImport, true);
    ok("category change succeeds and sets modified-after-import provenance");

    const descriptionCase = await bookFixtureRow("1464");
    const changedDescription = "Edited imported description";
    assert.notEqual(descriptionCase.transaction.description, changedDescription);
    const descriptionChanged: TransactionInput = {
      entityId: env.entityId,
      date: descriptionCase.transaction.date,
      description: changedDescription,
      kind: descriptionCase.transaction.kind,
      postings: descriptionCase.currentPostings.map((posting) => ({
        accountId: posting.accountId,
        amount: posting.amount,
        amountRon: posting.amountRon,
        categoryId: posting.categoryId,
      })),
    };
    await updateTransaction(descriptionCase.txId, descriptionChanged, 1);
    const [afterDescription] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, descriptionCase.txId));
    assert.equal(afterDescription.description, changedDescription);
    const linksAfterDescription = await db
      .select()
      .from(transactionImportLinks)
      .where(eq(transactionImportLinks.transactionId, descriptionCase.txId));
    const [stagingAfterDescription] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, descriptionCase.row.id));
    assert.equal(linksAfterDescription.length, 1);
    assert.equal(linksAfterDescription[0].id, descriptionCase.link.id);
    assert.equal(linksAfterDescription[0].releasedAt, null);
    assert.ok(linksAfterDescription[0].modifiedAfterImport);
    assert.equal(stagingAfterDescription.status, "booked");
    assert.equal(stagingAfterDescription.modifiedAfterImport, true);
    ok("description edit succeeds and the durable import link survives");

    const beforeDelete = await db
      .select({
        id: postings.id,
        accountId: postings.accountId,
        amount: postings.amount,
        amountRon: postings.amountRon,
        categoryId: postings.categoryId,
        externalRef: postings.externalRef,
      })
      .from(postings)
      .where(
        and(
          eq(postings.transactionId, categoryCase.txId),
          eq(postings.revision, 2),
          isNull(postings.deletedAt),
        ),
      )
      .orderBy(postings.id);
    await softDeleteNonInvestmentTransaction(categoryCase.txId);
    const [trashedTransaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, categoryCase.txId));
    const [trashedLink] = await db
      .select()
      .from(transactionImportLinks)
      .where(eq(transactionImportLinks.transactionId, categoryCase.txId));
    const [trashedStaging] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, categoryCase.row.id));
    assert.ok(trashedTransaction.deletedAt);
    assert.equal(trashedLink.lifecycle, "trashed");
    assert.equal(trashedStaging.status, "trashed");

    await restoreTransaction(categoryCase.txId, 2);
    const afterRestore = await db
      .select({
        id: postings.id,
        accountId: postings.accountId,
        amount: postings.amount,
        amountRon: postings.amountRon,
        categoryId: postings.categoryId,
        externalRef: postings.externalRef,
      })
      .from(postings)
      .where(
        and(
          eq(postings.transactionId, categoryCase.txId),
          eq(postings.revision, 2),
          isNull(postings.deletedAt),
        ),
      )
      .orderBy(postings.id);
    const [restoredTransaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, categoryCase.txId));
    const [restoredLink] = await db
      .select()
      .from(transactionImportLinks)
      .where(eq(transactionImportLinks.transactionId, categoryCase.txId));
    const [restoredStaging] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, categoryCase.row.id));
    assert.deepEqual(afterRestore, beforeDelete);
    assert.equal(restoredTransaction.deletedAt, null);
    assert.equal(restoredTransaction.currentRevision, 2);
    assert.equal(restoredTransaction.description, categoryCase.transaction.description);
    assert.equal(restoredLink.id, categoryCase.link.id);
    assert.equal(restoredLink.lifecycle, "active");
    assert.equal(restoredLink.releasedAt, null);
    assert.ok(restoredLink.modifiedAfterImport);
    assert.equal(restoredStaging.status, "booked");
    assert.equal(restoredStaging.modifiedAfterImport, true);
    ok("delete then restore reactivates the stored posting set and import ownership");

    const rebookCase = await bookFixtureRow("1466");
    await softDeleteNonInvestmentTransaction(rebookCase.txId);
    const lockHolder = await pool.connect();
    await lockHolder.query("begin");
    await lockHolder.query(`select pg_advisory_xact_lock(${IMPORT_OWNERSHIP_LOCK})`);
    let reopenSettled = false;
    const reopenPromise = reopenTrashedImportRow(rebookCase.row.id).then(() => {
      reopenSettled = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(reopenSettled, false);
    } finally {
      await lockHolder.query("rollback");
      lockHolder.release();
    }
    await reopenPromise;
    assert.equal(reopenSettled, true);
    const [pendingRebook] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, rebookCase.row.id));
    const [oldTransaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, rebookCase.txId));
    const [heldLink] = await db
      .select()
      .from(transactionImportLinks)
      .where(eq(transactionImportLinks.id, rebookCase.link.id));
    assert.equal(pendingRebook.status, "pending");
    assert.equal(pendingRebook.transactionId, rebookCase.txId);
    assert.ok(oldTransaction.deletedAt);
    assert.equal(heldLink.transactionId, rebookCase.txId);
    assert.equal(heldLink.lifecycle, "trashed");
    assert.equal(heldLink.releasedAt, null);
    ok("trashed booked row reopens pending while its trashed link retains dedup ownership");

    await restoreTransaction(rebookCase.txId, 1);
    const [restoredPendingRow] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, rebookCase.row.id));
    const [restoredPendingLink] = await db
      .select()
      .from(transactionImportLinks)
      .where(eq(transactionImportLinks.id, rebookCase.link.id));
    assert.equal(restoredPendingRow.status, "booked");
    assert.equal(restoredPendingLink.lifecycle, "active");
    await softDeleteNonInvestmentTransaction(rebookCase.txId);
    await reopenTrashedImportRow(rebookCase.row.id);
    await confirmImportRow({
      rowId: rebookCase.row.id,
      categoryId: rebookCase.row.suggestedCategoryId,
    });
    ok("restoring a reopened old transaction reconciles its inbox row back to booked");

    const rebookAttempts = await Promise.allSettled([
      bookImportRow({ rowId: rebookCase.row.id }),
      bookImportRow({ rowId: rebookCase.row.id }),
    ]);
    const rebookedIds = rebookAttempts.flatMap((attempt) =>
      attempt.status === "fulfilled" ? [attempt.value.transactionId] : [],
    );
    assert.ok(rebookedIds.length >= 1);
    assert.equal(new Set(rebookedIds).size, 1);
    const rebookedId = rebookedIds[0]!;
    assert.notEqual(rebookedId, rebookCase.txId);
    const [afterRebookRow] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, rebookCase.row.id));
    const [afterRebookLink] = await db
      .select()
      .from(transactionImportLinks)
      .where(eq(transactionImportLinks.id, rebookCase.link.id));
    const [stillTrashed] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, rebookCase.txId));
    assert.equal(afterRebookRow.status, "booked");
    assert.equal(afterRebookRow.transactionId, rebookedId);
    assert.equal(afterRebookLink.transactionId, rebookedId);
    assert.equal(afterRebookLink.lifecycle, "active");
    assert.equal(afterRebookLink.releasedAt, null);
    assert.ok(stillTrashed.deletedAt);
    ok("concurrent rebooking assigns one replacement and leaves the old transaction in trash");

    console.log(`\nAll ${checks} edit-guard checks passed.`);
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
