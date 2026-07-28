/**
 * Existing-transaction disposition regression: linking satisfies an import
 * row without rewriting the target ledger, and unlink releases only import
 * ownership.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  auditLog,
  importRows,
  postings,
  transactionImportLinks,
  transactions,
} from "@/db/schema";
import {
  createTransaction,
  LedgerValidationError,
  restoreTransaction,
  softDeleteNonInvestmentTransaction,
} from "@/lib/ledger";
import { requireTestDatabase } from "@/lib/test-database-sentinel";
import {
  bookImportRow,
  confirmDrawingImportRow,
  confirmImportRow,
  createImportBatch,
  linkImportRowToExistingTransaction,
  unlinkImportRow,
} from "./service";
import { findActiveImportLink, ingRowIdentity } from "./ownership";
import { getImportBatch } from "./queries";
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
  if (!(await requireTestDatabase(pool, "existing import link"))) return;
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
    const evidence = (lineNo: string) =>
      byLine(lineNo).payload as {
        row: { bookDate: string; amountMinor: number };
      };

    async function createMatchingTarget(
      lineNo: string,
      description: string,
      targetEnv = env,
    ) {
      const row = evidence(lineNo).row;
      return createTransaction({
        entityId: targetEnv.entityId,
        date: row.bookDate,
        description,
        kind: "standard",
        postings: [
          {
            accountId: targetEnv.bankAccountId,
            amount: -row.amountMinor,
            amountRon: -row.amountMinor,
            categoryId: null,
          },
          {
            accountId: targetEnv.equityAccountId,
            amount: row.amountMinor,
            amountRon: row.amountMinor,
            categoryId: targetEnv.categoryId("Services|expense"),
          },
        ],
      });
    }

    async function targetSnapshot(transactionId: string) {
      const [transaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId));
      const targetPostings = await db
        .select()
        .from(postings)
        .where(eq(postings.transactionId, transactionId))
        .orderBy(postings.id);
      return { transaction, postings: targetPostings };
    }

    const targetId = await createMatchingTarget("1462", "Existing manual counterpart");
    await ok("candidate search is entity-, amount-, and seven-day-window scoped", async () => {
      const review = await getImportBatch(batch.batchId, env.entityId);
      const candidate = review?.linkCandidatesByRowId
        .get(byLine("1462").id)
        ?.find((item) => item.transactionId === targetId);
      assert.ok(candidate);
      assert.equal(candidate.amountMinor, evidence("1462").row.amountMinor);
      assert.equal(candidate.alreadyLinked, false);
    });
    const beforeLink = await targetSnapshot(targetId);
    await linkImportRowToExistingTransaction({
      rowId: byLine("1462").id,
      transactionId: targetId,
    });

    await ok("link writes durable provenance and satisfies the row without changing the target", async () => {
      const [linkedRow] = await db
        .select()
        .from(importRows)
        .where(eq(importRows.id, byLine("1462").id));
      const [link] = await db
        .select()
        .from(transactionImportLinks)
        .where(eq(transactionImportLinks.sourceRowId, linkedRow.id));
      assert.equal(linkedRow.status, "duplicate");
      assert.equal(linkedRow.transactionId, targetId);
      assert.equal(linkedRow.reviewDisposition, "linked_existing");
      assert.equal(link.transactionId, targetId);
      assert.equal(link.provider, "ing");
      assert.equal(link.sourceBatchId, batch.batchId);
      assert.equal(link.sourceRowId, linkedRow.id);
      assert.equal(link.rawTextHash.length, 64);
      assert.equal(link.lifecycle, "active");
      assert.equal(link.releasedAt, null);
      assert.equal(
        link.originalBookedAt.getTime(),
        beforeLink.transaction.createdAt.getTime(),
      );
      assert.deepEqual(await targetSnapshot(targetId), beforeLink);
    });

    const twinTargetId = await createMatchingTarget("1476", "Existing fee counterpart");
    assert.equal(evidence("1476").row.amountMinor, evidence("1479").row.amountMinor);
    await linkImportRowToExistingTransaction({
      rowId: byLine("1476").id,
      transactionId: twinTargetId,
    });
    await ok("a transaction that already carries import provenance refuses a second link", async () => {
      await assert.rejects(
        linkImportRowToExistingTransaction({
          rowId: byLine("1479").id,
          transactionId: twinTargetId,
        }),
        (error) =>
          error instanceof LedgerValidationError &&
          error.code === "imports.linkTransactionAlreadyLinked",
      );
      const [secondRow] = await db
        .select()
        .from(importRows)
        .where(eq(importRows.id, byLine("1479").id));
      assert.equal(secondRow.status, "pending");
      assert.equal(secondRow.transactionId, null);
    });
    await softDeleteNonInvestmentTransaction(twinTargetId);
    await ok("a later target delete/restore preserves the linked-existing disposition", async () => {
      const [trashedRow] = await db
        .select()
        .from(importRows)
        .where(eq(importRows.id, byLine("1476").id));
      assert.equal(trashedRow.status, "trashed");
      assert.equal(trashedRow.reviewDisposition, "linked_existing");
      await restoreTransaction(twinTargetId, 1);
      const [restoredRow] = await db
        .select()
        .from(importRows)
        .where(eq(importRows.id, byLine("1476").id));
      assert.equal(restoredRow.status, "duplicate");
      assert.equal(restoredRow.reviewDisposition, "linked_existing");
    });

    const deletedTargetId = await createMatchingTarget("1464", "Counterpart moved to trash");
    const wrongEntityTargetId = await createMatchingTarget(
      "1464",
      "Other entity counterpart",
      otherEnv,
    );
    await ok("a matching transaction from another entity is refused", async () => {
      await assert.rejects(
        linkImportRowToExistingTransaction({
          rowId: byLine("1464").id,
          transactionId: wrongEntityTargetId,
        }),
        (error) =>
          error instanceof LedgerValidationError &&
          error.code === "imports.linkTransactionWrongEntity",
      );
    });
    await softDeleteNonInvestmentTransaction(deletedTargetId);
    await ok("a soft-deleted transaction cannot satisfy an import row", async () => {
      await assert.rejects(
        linkImportRowToExistingTransaction({
          rowId: byLine("1464").id,
          transactionId: deletedTargetId,
        }),
        (error) =>
          error instanceof LedgerValidationError &&
          error.code === "imports.linkTransactionDeleted",
      );
      const [unlinkedRow] = await db
        .select()
        .from(importRows)
        .where(eq(importRows.id, byLine("1464").id));
      assert.equal(unlinkedRow.status, "pending");
    });

    const secondBatch = await createImportBatch({
      entityId: env.entityId,
      bankAccountId: env.bankAccountId,
      text: `${fixture}\n\n`,
      ownerNames: ["Grigore Filimon"],
    });
    await ok("the active durable link keeps the statement identity claimed", async () => {
      const [duplicate] = await db
        .select()
        .from(importRows)
        .where(
          and(
            eq(importRows.batchId, secondBatch.batchId),
            eq(importRows.lineNo, "1462"),
          ),
        );
      assert.equal(duplicate.status, "duplicate");
      assert.equal(duplicate.transactionId, targetId);
      const claim = await findActiveImportLink(
        "ing",
        ingRowIdentity(env.bankAccountId, byLine("1462").resolvedExternalRef),
      );
      assert.equal(claim?.transactionId, targetId);
    });

    await unlinkImportRow(byLine("1462").id);
    await ok("unlink returns the row to pending, releases ownership, and leaves the target untouched", async () => {
      const [unlinkedRow] = await db
        .select()
        .from(importRows)
        .where(eq(importRows.id, byLine("1462").id));
      const [releasedLink] = await db
        .select()
        .from(transactionImportLinks)
        .where(eq(transactionImportLinks.sourceRowId, unlinkedRow.id));
      assert.equal(unlinkedRow.status, "pending");
      assert.equal(unlinkedRow.transactionId, null);
      assert.equal(unlinkedRow.reviewDisposition, null);
      assert.equal(releasedLink.lifecycle, "released");
      assert.ok(releasedLink.releasedAt);
      assert.equal(releasedLink.releaseReason, "manual_unlink");
      assert.equal(
        await findActiveImportLink(
          "ing",
          ingRowIdentity(env.bankAccountId, byLine("1462").resolvedExternalRef),
        ),
        null,
      );
      assert.deepEqual(await targetSnapshot(targetId), beforeLink);
    });

    await ok("owner transfer requires an explicit disposition", async () => {
      await assert.rejects(
        confirmImportRow({ rowId: byLine("1465").id }),
        (error) =>
          error instanceof LedgerValidationError &&
          error.code === "imports.ownerTransferDispositionRequired",
      );
    });
    await confirmDrawingImportRow(byLine("1465").id);
    const drawing = await bookImportRow({ rowId: byLine("1465").id });
    await ok("Drawing records the choice and books the existing plain-transfer shape", async () => {
      assert.equal(drawing.status, "booked");
      const [drawingRow] = await db
        .select()
        .from(importRows)
        .where(eq(importRows.id, byLine("1465").id));
      const [drawingTransaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, drawing.transactionId!));
      const drawingPostings = await db
        .select()
        .from(postings)
        .where(eq(postings.transactionId, drawing.transactionId!));
      assert.equal(drawingRow.reviewDisposition, "drawing");
      assert.equal(drawingTransaction.kind, "transfer");
      assert.equal(drawingPostings.length, 2);
      assert.ok(drawingPostings.every((posting) => posting.categoryId === null));
      assert.equal(drawingPostings.reduce((sum, posting) => sum + posting.amountRon, 0), 0);
    });

    console.log(`\nAll ${checks} existing-link checks passed.`);
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
