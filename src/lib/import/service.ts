/**
 * Import staging + booking logic (Stage 4). Staging writes ONLY to the
 * import_batches/import_rows inbox tables; booking a row delegates to
 * createTransaction — the ledger's single write path — with the resolved
 * external_ref on the bank posting so the partial unique index backstops
 * dedup. Nothing here auto-books.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  categories,
  importBatches,
  importRows,
  postings,
  transactionImportLinks,
  transactions,
} from "@/db/schema";
import {
  acquireImportOwnershipLock,
  assertBatchExternalRefsUnique,
  createTransaction,
  LedgerValidationError,
} from "@/lib/ledger";
import { toAppError, type AppError } from "@/lib/app-error";
import { buildImportTransactionInput, bookingNeedsCategory } from "./booking";
import {
  BANK_COUNTERPARTY_BY_SOURCE,
  OWNER_BANK_NAMES,
  SUGGESTED_CATEGORY_BY_KIND,
} from "./config";
import {
  classifyStatementRows,
  serializeClassifyReason,
  type ClassifiedRow,
} from "./ing/classify";
import { normalizeStatementNumber, parseStatementPeriod, resolveExternalRef } from "./ing/identity";
import { parseIngStatement } from "./ing/parse";
import { isIngCsv, parseIngCsvStatement } from "./ing/parse-csv";
import {
  findActiveImportLink,
  findActiveSourceClaim,
  ingRowIdentity,
  insertSourceClaim,
  insertTransactionImportLink,
} from "./ownership";

export interface CreateBatchResult {
  batchId: string;
  staged: number;
  /** Rows pre-marked duplicate: their external_ref already lives on a live posting. */
  duplicates: number;
  /** Refless rows inside a period overlap with an earlier batch (amendment 1b). */
  overlapSuspects: number;
}

/**
 * Parse + classify a pasted ING statement and stage it in the review inbox.
 * NOTHING touches the ledger here. Throws LedgerValidationError (or
 * IngParseError from the parser) with a user-presentable error.
 */
export async function createImportBatch(params: {
  entityId: string;
  bankAccountId: string;
  text: string;
  /** Owner bank-names override; production omits it and the per-entity
   * config (OWNER_BANK_NAMES) is used. Present so tests can drive a
   * throwaway entity without editing global config. */
  ownerNames?: string[];
}): Promise<CreateBatchResult> {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, params.bankAccountId), isNull(accounts.deletedAt)));
  if (!account || account.entityId !== params.entityId) {
    throw new LedgerValidationError("imports.statementAccountNotFound");
  }
  if (account.type !== "bank" || !account.isActive) {
    throw new LedgerValidationError("imports.statementAccountMustBeActiveBank");
  }
  if (account.currency !== "RON") {
    throw new LedgerValidationError("imports.statementAccountMustBeRon");
  }

  // Format routing (CSV amendment): CSV is the DEFAULT source, detected by
  // its header row; anything else goes to the PDF-text parser. Both produce
  // the same typed statement — everything downstream is format-agnostic.
  const source = isIngCsv(params.text) ? "ing_csv" : "ing_pdf_text";
  const stmt =
    source === "ing_csv" ? parseIngCsvStatement(params.text) : parseIngStatement(params.text);
  const classified = classifyStatementRows(stmt.rows, {
    ownerNames: params.ownerNames ?? OWNER_BANK_NAMES[params.entityId] ?? [],
  }).map((classifiedRow) =>
    classifiedRow.kind === "bank_fee"
      ? {
          ...classifiedRow,
          row: {
            ...classifiedRow.row,
            counterpartyName: BANK_COUNTERPARTY_BY_SOURCE[source],
          },
        }
      : classifiedRow,
  );
  const refByLineNo = new Map(
    classified.map((c) => [c.row.lineNo, resolveExternalRef(c.row, stmt)]),
  );

  // L-0010 tripwire at the earliest possible moment: two identical resolved
  // refs in one statement mean the identity design broke — fail loudly
  // before anything is staged.
  assertBatchExternalRefsUnique(
    classified.map((c) => ({
      accountId: params.bankAccountId,
      externalRef: refByLineNo.get(c.row.lineNo),
    })),
  );

  // Exact-re-paste convenience guard (NOT the dedup guarantee — that is the
  // row-level partial unique index; see the schema comment on rawTextHash).
  const rawTextHash = createHash("sha256").update(params.text).digest("hex");
  const existingClaim = await findActiveSourceClaim("ing", rawTextHash);
  if (existingClaim) {
    throw new LedgerValidationError("imports.statementTextAlreadyImported");
  }

  const period = parseStatementPeriod(stmt.period);

  // Period overlap with earlier batches on the same account: the synthetic
  // refless key is statement-scoped, so a refless row reappearing in a
  // DIFFERENT overlapping export cannot hard-dedup. Those exact rows get
  // flagged for individual human confirmation (amendment 1b).
  const priorBatches = await db
    .select({
      periodStart: importBatches.periodStart,
      periodEnd: importBatches.periodEnd,
    })
    .from(importBatches)
    .where(eq(importBatches.bankAccountId, params.bankAccountId));
  const overlaps = priorBatches.filter(
    (b) => b.periodStart <= period.end && b.periodEnd >= period.start,
  );
  const inOverlap = (bookDate: string) =>
    overlaps.some((b) => bookDate >= b.periodStart && bookDate <= b.periodEnd);

  // Category suggestions by kind, resolved against the entity's categories.
  const wanted = Object.values(SUGGESTED_CATEGORY_BY_KIND).flatMap((s) => (s ? [s.name] : []));
  const categoryRows = wanted.length
    ? await db
        .select({ id: categories.id, name: categories.name, kind: categories.kind })
        .from(categories)
        .where(
          and(
            eq(categories.entityId, params.entityId),
            inArray(categories.name, [...new Set(wanted)]),
            isNull(categories.deletedAt),
          ),
        )
    : [];
  const categoryByNameKind = new Map(categoryRows.map((c) => [`${c.name}|${c.kind}`, c.id]));
  const suggestFor = (kind: string): string | null => {
    const s = SUGGESTED_CATEGORY_BY_KIND[kind];
    return s ? (categoryByNameKind.get(`${s.name}|${s.kind}`) ?? null) : null;
  };

  // Pre-mark rows whose ref already exists on a LIVE posting (re-import of
  // ref-bearing rows, or same-numbered statement re-extracted): friendlier
  // than 17 booking failures, and the index still backstops booking.
  const allRefs = [...refByLineNo.values()];
  const existingPostings = await db
    .select({ externalRef: postings.externalRef, transactionId: postings.transactionId })
    .from(postings)
    .where(
      and(
        eq(postings.accountId, params.bankAccountId),
        inArray(postings.externalRef, allRefs),
        isNull(postings.deletedAt),
      ),
    );
  const existingByRef = new Map(existingPostings.map((p) => [p.externalRef!, p.transactionId]));
  const rowIdentities = allRefs.map((ref) => ingRowIdentity(params.bankAccountId, ref));
  const existingLinks = rowIdentities.length
    ? await db
        .select({ rowIdentity: transactionImportLinks.rowIdentity, transactionId: transactionImportLinks.transactionId })
        .from(transactionImportLinks)
        .where(
          and(
            eq(transactionImportLinks.provider, "ing"),
            inArray(transactionImportLinks.rowIdentity, rowIdentities),
            isNull(transactionImportLinks.releasedAt),
          ),
        )
    : [];
  const linkedByIdentity = new Map(existingLinks.map((link) => [link.rowIdentity, link.transactionId]));

  let duplicates = 0;
  let overlapSuspects = 0;
  const batchId = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({
        entityId: params.entityId,
        bankAccountId: params.bankAccountId,
        source,
        statementNumber: normalizeStatementNumber(stmt.statementNumber),
        statementIban: stmt.accountIban,
        periodStart: period.start,
        periodEnd: period.end,
        openingBalanceMinor: stmt.openingBalanceMinor,
        closingBalanceMinor: stmt.closingBalanceMinor,
        rawTextHash,
      })
      .returning({ id: importBatches.id });
    await insertSourceClaim(tx, { provider: "ing", rawTextHash, sourceBatchId: batch.id });

    await tx.insert(importRows).values(
      classified.map((c) => {
        const ref = refByLineNo.get(c.row.lineNo)!;
        const existingTransactionId =
          linkedByIdentity.get(ingRowIdentity(params.bankAccountId, ref)) ??
          existingByRef.get(ref) ??
          null;
        const overlapSuspect =
          !existingTransactionId && c.row.bankReference === null && inOverlap(c.row.bookDate);
        if (existingTransactionId) duplicates += 1;
        if (overlapSuspect) overlapSuspects += 1;
        return {
          batchId: batch.id,
          lineNo: c.row.lineNo,
          resolvedExternalRef: ref,
          kind: c.kind,
          confidence: c.confidence,
          reason: serializeClassifyReason(c.reason),
          payload: c,
          suggestedCategoryId: suggestFor(c.kind),
          overlapSuspect,
          status: existingTransactionId ? ("duplicate" as const) : ("pending" as const),
          transactionId: existingTransactionId,
        };
      }),
    );
    return batch.id;
  });

  return { batchId, staged: classified.length, duplicates, overlapSuspects };
}

/** Postgres unique-violation for our dedup index, wherever pg nested it. */
function isExternalRefUniqueViolation(error: unknown): boolean {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint?: string };
    if (
      pg.code === "23505" &&
      (pg.constraint === "postings_account_external_ref_uidx" ||
        pg.constraint === "transaction_import_links_active_identity_uidx")
    ) {
      return true;
    }
  }
  return false;
}

export type BookRowResult =
  | { status: "booked"; transactionId: string }
  | { status: "duplicate"; transactionId: string | null };

export interface ConfirmHighConfidenceResult {
  confirmed: number;
  ownerTransfersExcluded: number;
  /** Rows still pending after staging: low confidence, overlap-suspect, or no category. */
  left: number;
}

export type BookConfirmedRowOutcome =
  | {
      rowId: string;
      lineNo: string;
      status: "booked" | "duplicate";
      transactionId: string | null;
    }
  | {
      rowId: string;
      lineNo: string;
      status: "error";
      error: AppError;
    };

/** Server-action ownership check: client-supplied row and batch ids must
 * resolve inside the profile's entity before any single-row mutation runs. */
export async function assertImportRowScope(params: {
  rowId: string;
  batchId: string;
  entityId: string;
}): Promise<void> {
  const [scoped] = await db
    .select({ id: importRows.id })
    .from(importRows)
    .innerJoin(importBatches, eq(importBatches.id, importRows.batchId))
    .where(
      and(
        eq(importRows.id, params.rowId),
        eq(importRows.batchId, params.batchId),
        eq(importBatches.entityId, params.entityId),
      ),
    );
  if (!scoped) throw new LedgerValidationError("imports.rowNotFound");
}

/** Bulk-action ownership check: the client-supplied batch must belong to the
 * profile entity before any row in it can be changed. */
export async function assertImportBatchScope(params: {
  batchId: string;
  entityId: string;
}): Promise<void> {
  const [scoped] = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(
      and(
        eq(importBatches.id, params.batchId),
        eq(importBatches.entityId, params.entityId),
      ),
    );
  if (!scoped) throw new LedgerValidationError("imports.batchNotFound");
}

/** Capture the owner's review decision without writing to the ledger. */
export async function confirmImportRow(params: {
  rowId: string;
  categoryId?: string | null;
}): Promise<void> {
  const [row] = await db
    .select({
      status: importRows.status,
      kind: importRows.kind,
      lineNo: importRows.lineNo,
      entityId: importBatches.entityId,
    })
    .from(importRows)
    .innerJoin(importBatches, eq(importBatches.id, importRows.batchId))
    .where(eq(importRows.id, params.rowId));
  if (!row) throw new LedgerValidationError("imports.rowNotFound");
  if (row.status !== "pending") {
    throw new LedgerValidationError("imports.rowAlreadyStatus", { status: row.status });
  }
  const categoryId = bookingNeedsCategory(row.kind) ? params.categoryId ?? null : null;
  if (bookingNeedsCategory(row.kind) && !categoryId) {
    throw new LedgerValidationError("imports.categoryRequiredForLine", {
      lineNo: row.lineNo,
      kind: row.kind,
    });
  }
  if (categoryId) {
    const [category] = await db
      .select({
        entityId: categories.entityId,
        name: categories.name,
      })
      .from(categories)
      .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)));
    if (!category) {
      throw new LedgerValidationError("ledger.categoryNotFound", { categoryId });
    }
    if (category.entityId !== null && category.entityId !== row.entityId) {
      throw new LedgerValidationError("ledger.categoryWrongEntity", {
        categoryName: category.name,
      });
    }
  }
  const [updated] = await db
    .update(importRows)
    .set({ status: "confirmed", confirmedCategoryId: categoryId })
    .where(and(eq(importRows.id, params.rowId), eq(importRows.status, "pending")))
    .returning({ id: importRows.id });
  if (!updated) {
    throw new LedgerValidationError("imports.rowAlreadyStatus", { status: "pending" });
  }
}

/** Return a staged decision to review and discard only the owner's category decision. */
export async function unconfirmImportRow(rowId: string): Promise<void> {
  const [updated] = await db
    .update(importRows)
    .set({ status: "pending", confirmedCategoryId: null })
    .where(and(eq(importRows.id, rowId), eq(importRows.status, "confirmed")))
    .returning({ id: importRows.id });
  if (updated) return;
  const [row] = await db
    .select({ status: importRows.status })
    .from(importRows)
    .where(eq(importRows.id, rowId));
  if (!row) throw new LedgerValidationError("imports.rowNotFound");
  throw new LedgerValidationError("imports.rowAlreadyStatus", { status: row.status });
}

/**
 * Book ONE confirmed inbox row into the ledger — through createTransaction,
 * the single write path. A unique-index hit is not an error: the movement is
 * already in the ledger, so the row flips to `duplicate` with a link.
 */
export async function bookImportRow(params: {
  rowId: string;
}): Promise<BookRowResult> {
  const [row] = await db.select().from(importRows).where(eq(importRows.id, params.rowId));
  if (!row) throw new LedgerValidationError("imports.rowNotFound");
  if (row.status !== "confirmed") {
    throw new LedgerValidationError("imports.rowAlreadyStatus", { status: row.status });
  }
  const [batch] = await db
    .select()
    .from(importBatches)
    .where(eq(importBatches.id, row.batchId));
  if (!batch) throw new LedgerValidationError("imports.batchNotFound");

  // The L-0010 tripwire runs over the WHOLE batch's resolved refs before
  // every booking — a duplicate here means the identity design broke.
  const batchRows = await db
    .select({
      resolvedExternalRef: importRows.resolvedExternalRef,
    })
    .from(importRows)
    .where(eq(importRows.batchId, row.batchId));
  assertBatchExternalRefsUnique(
    batchRows.map((r) => ({
      accountId: batch.bankAccountId,
      externalRef: r.resolvedExternalRef,
    })),
  );

  const entityAccounts = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, batch.entityId),
        eq(accounts.isActive, true),
        isNull(accounts.deletedAt),
      ),
    );
  const equity = entityAccounts.find((a) => a.type === "equity");
  if (!equity) {
    throw new LedgerValidationError("imports.equityAccountMissing");
  }
  const taxLiability = entityAccounts.find((a) => a.type === "tax_liability") ?? null;

  const classified = row.payload as ClassifiedRow;
  const input = await buildImportTransactionInput({
    classified,
    externalRef: row.resolvedExternalRef,
    categoryId: bookingNeedsCategory(row.kind) ? row.confirmedCategoryId : null,
    ctx: {
      entityId: batch.entityId,
      bankAccountId: batch.bankAccountId,
      equityAccountId: equity.id,
      taxLiabilityAccountId: taxLiability?.id ?? null,
      statementNumber: batch.statementNumber,
    },
  });

  const rowIdentity = ingRowIdentity(batch.bankAccountId, row.resolvedExternalRef);
  const alreadyClaimed = await findActiveImportLink("ing", rowIdentity);
  let rebookLink: typeof transactionImportLinks.$inferSelect | null = null;
  if (
    alreadyClaimed &&
    row.transactionId &&
    alreadyClaimed.sourceRowId === row.id &&
    alreadyClaimed.transactionId === row.transactionId &&
    alreadyClaimed.lifecycle === "trashed"
  ) {
    const [trashedTransaction] = await db
      .select({ deletedAt: transactions.deletedAt })
      .from(transactions)
      .where(eq(transactions.id, row.transactionId));
    if (trashedTransaction?.deletedAt) rebookLink = alreadyClaimed;
  }
  if (alreadyClaimed && !rebookLink) {
    await db
      .update(importRows)
      .set({ status: "duplicate", transactionId: alreadyClaimed.transactionId })
      .where(eq(importRows.id, row.id));
    return { status: "duplicate", transactionId: alreadyClaimed.transactionId };
  }

  try {
    const transactionId = await db.transaction(async (tx) => {
      if (rebookLink) {
        await acquireImportOwnershipLock(tx);
        const [lockedTransaction] = await tx
          .select({ deletedAt: transactions.deletedAt })
          .from(transactions)
          .where(eq(transactions.id, rebookLink.transactionId))
          .for("update");
        const [lockedRow] = await tx
          .select({
            status: importRows.status,
            transactionId: importRows.transactionId,
          })
          .from(importRows)
          .where(eq(importRows.id, row.id))
          .for("update");
        const [lockedLink] = await tx
          .select({
            transactionId: transactionImportLinks.transactionId,
            lifecycle: transactionImportLinks.lifecycle,
            releasedAt: transactionImportLinks.releasedAt,
          })
          .from(transactionImportLinks)
          .where(eq(transactionImportLinks.id, rebookLink.id))
          .for("update");
        if (
          !lockedTransaction?.deletedAt ||
          lockedRow?.status !== "confirmed" ||
          lockedRow.transactionId !== rebookLink.transactionId ||
          lockedLink?.transactionId !== rebookLink.transactionId ||
          lockedLink.lifecycle !== "trashed" ||
          lockedLink.releasedAt !== null
        ) {
          throw new LedgerValidationError("imports.rowAlreadyStatus", {
            status: lockedRow?.status ?? "trashed",
          });
        }
      }
      const transactionId = await createTransaction(input, tx);
      const bookedAt = new Date();
      if (rebookLink) {
        const [reassigned] = await tx
          .update(transactionImportLinks)
          .set({
            transactionId,
            lifecycle: "active",
            releasedAt: null,
            releaseReason: null,
          })
          .where(
            and(
              eq(transactionImportLinks.id, rebookLink.id),
              eq(transactionImportLinks.transactionId, rebookLink.transactionId),
              eq(transactionImportLinks.lifecycle, "trashed"),
              isNull(transactionImportLinks.releasedAt),
            ),
          )
          .returning({ id: transactionImportLinks.id });
        if (!reassigned) {
          throw new LedgerValidationError("imports.rowAlreadyStatus", { status: "trashed" });
        }
      } else {
        await insertTransactionImportLink(tx, {
          transactionId,
          provider: "ing",
          sourceBatchId: batch.id,
          sourceRowId: row.id,
          sourceLabel: batch.statementNumber,
          rowIdentity,
          rawTextHash: batch.rawTextHash,
          originalBookedAt: bookedAt,
        });
      }
      const [bookedRow] = await tx
        .update(importRows)
        .set({ status: "booked", transactionId, bookedAt })
        .where(
          and(
            eq(importRows.id, row.id),
            eq(importRows.status, "confirmed"),
            rebookLink
              ? eq(importRows.transactionId, rebookLink.transactionId)
              : isNull(importRows.transactionId),
          ),
        )
        .returning({ id: importRows.id });
      if (!bookedRow) {
        throw new LedgerValidationError("imports.rowAlreadyStatus", { status: "confirmed" });
      }
      return transactionId;
    });
    return { status: "booked", transactionId };
  } catch (error) {
    if (!isExternalRefUniqueViolation(error)) throw error;
    // Already in the ledger (booked between staging and now, or via an
    // overlapping batch): link the existing transaction, never book twice.
    const claimed = await findActiveImportLink("ing", rowIdentity);
    if (
      claimed?.sourceRowId === row.id &&
      claimed.lifecycle === "active"
    ) {
      await db
        .update(importRows)
        .set({ status: "booked", transactionId: claimed.transactionId })
        .where(eq(importRows.id, row.id));
      return { status: "booked", transactionId: claimed.transactionId };
    }
    const [existing] = claimed
      ? [{ transactionId: claimed.transactionId }]
      : await db
          .select({ transactionId: postings.transactionId })
          .from(postings)
          .where(
            and(
              eq(postings.accountId, batch.bankAccountId),
              eq(postings.externalRef, row.resolvedExternalRef),
              isNull(postings.deletedAt),
            ),
          );
    const transactionId = existing?.transactionId ?? null;
    await db
      .update(importRows)
      .set({ status: "duplicate", transactionId })
      .where(eq(importRows.id, row.id));
    return { status: "duplicate", transactionId };
  }
}

/**
 * Stage every pending HIGH-confidence row that needs no human input: not an
 * owner transfer, not overlap-suspect (those demand per-row confirmation by
 * design), and either category-free by shape or carrying a suggestion.
 * Owner transfers remain pending for individual review.
 */
export async function confirmHighConfidenceRows(
  batchId: string,
): Promise<ConfirmHighConfidenceResult> {
  const rows = await db
    .select({
      id: importRows.id,
      kind: importRows.kind,
      confidence: importRows.confidence,
      overlapSuspect: importRows.overlapSuspect,
      suggestedCategoryId: importRows.suggestedCategoryId,
      lineNo: importRows.lineNo,
    })
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), eq(importRows.status, "pending")));

  const result: ConfirmHighConfidenceResult = {
    confirmed: 0,
    ownerTransfersExcluded: 0,
    left: 0,
  };
  for (const row of rows) {
    if (row.kind === "owner_transfer") {
      result.ownerTransfersExcluded += 1;
      continue;
    }
    const highConfidenceEligible =
      row.confidence === "high" &&
      !row.overlapSuspect &&
      (!bookingNeedsCategory(row.kind) || row.suggestedCategoryId !== null);
    if (!highConfidenceEligible) continue;
    const [updated] = await db
      .update(importRows)
      .set({
        status: "confirmed",
        confirmedCategoryId: bookingNeedsCategory(row.kind) ? row.suggestedCategoryId : null,
      })
      .where(and(eq(importRows.id, row.id), eq(importRows.status, "pending")))
      .returning({ id: importRows.id });
    if (updated) result.confirmed += 1;
  }
  result.left = await db.$count(
    importRows,
    and(eq(importRows.batchId, batchId), eq(importRows.status, "pending")),
  );
  return result;
}

/**
 * Book only the rows already confirmed in this batch. Each row owns its own
 * transaction, so one failure remains confirmed and does not roll back earlier
 * successes.
 */
export async function bookConfirmedRows(batchId: string): Promise<BookConfirmedRowOutcome[]> {
  const rows = await db
    .select({ id: importRows.id, lineNo: importRows.lineNo })
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), eq(importRows.status, "confirmed")))
    .orderBy(sql`${importRows.lineNo}::int`);
  const outcomes: BookConfirmedRowOutcome[] = [];
  for (const row of rows) {
    try {
      const result = await bookImportRow({ rowId: row.id });
      outcomes.push({
        rowId: row.id,
        lineNo: row.lineNo,
        status: result.status,
        transactionId: result.transactionId,
      });
    } catch (error) {
      outcomes.push({
        rowId: row.id,
        lineNo: row.lineNo,
        status: "error",
        error: toAppError(error) ?? {
          code: "imports.rowBookingFailed",
          params: { lineNo: row.lineNo },
        },
      });
    }
  }
  return outcomes;
}

export async function skipImportRow(params: {
  rowId: string;
  /** Manual skips carry no system code; a human note is optional. */
  note?: string | null;
}): Promise<void> {
  const note = params.note?.trim() || null;
  const [updated] = await db
    .update(importRows)
    .set({ status: "skipped", skipReasonCode: null, skipReasonNote: note })
    .where(and(eq(importRows.id, params.rowId), eq(importRows.status, "pending")))
    .returning({ id: importRows.id });
  if (updated) return;
  const [row] = await db
    .select({ status: importRows.status })
    .from(importRows)
    .where(eq(importRows.id, params.rowId));
  if (!row) throw new LedgerValidationError("imports.rowNotFound");
  throw new LedgerValidationError("imports.rowAlreadyStatus", { status: row.status });
}

/** Reopen only a manual skip. Booked/trashed/purged rows have separate,
 * ledger-owned lifecycles and must never pass through this transition. */
export async function reopenSkippedImportRow(rowId: string): Promise<void> {
  const [updated] = await db
    .update(importRows)
    .set({ status: "pending", skipReasonCode: null, skipReasonNote: null })
    .where(and(eq(importRows.id, rowId), eq(importRows.status, "skipped")))
    .returning({ id: importRows.id });
  if (updated) return;
  const [row] = await db
    .select({ status: importRows.status })
    .from(importRows)
    .where(eq(importRows.id, rowId));
  if (!row) throw new LedgerValidationError("imports.rowNotFound");
  throw new LedgerValidationError("imports.rowAlreadyStatus", { status: row.status });
}

/**
 * Return a booked row whose transaction is still in trash to pending.
 * The row keeps its transaction id and the unreleased trashed link keeps
 * owning the dedup identity until a rebooking atomically reassigns that link.
 */
export async function reopenTrashedImportRow(rowId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await acquireImportOwnershipLock(tx);
    const [rowSnapshot] = await tx
      .select()
      .from(importRows)
      .where(eq(importRows.id, rowId));
    if (!rowSnapshot) throw new LedgerValidationError("imports.rowNotFound");
    if (rowSnapshot.status !== "trashed" || !rowSnapshot.transactionId) {
      throw new LedgerValidationError("imports.rowAlreadyStatus", {
        status: rowSnapshot.status,
      });
    }
    const [transaction] = await tx
      .select({ deletedAt: transactions.deletedAt })
      .from(transactions)
      .where(eq(transactions.id, rowSnapshot.transactionId))
      .for("update");
    const [row] = await tx
      .select()
      .from(importRows)
      .where(eq(importRows.id, rowId))
      .for("update");
    if (!row || row.status !== "trashed" || row.transactionId !== rowSnapshot.transactionId) {
      throw new LedgerValidationError("imports.rowAlreadyStatus", {
        status: row?.status ?? rowSnapshot.status,
      });
    }
    const [link] = await tx
      .select()
      .from(transactionImportLinks)
      .where(
        and(
          eq(transactionImportLinks.provider, "ing"),
          eq(transactionImportLinks.sourceRowId, row.id),
          eq(transactionImportLinks.transactionId, row.transactionId),
          eq(transactionImportLinks.lifecycle, "trashed"),
          isNull(transactionImportLinks.releasedAt),
        ),
      )
      .for("update");
    if (!transaction?.deletedAt || !link) {
      throw new LedgerValidationError("imports.rowAlreadyStatus", { status: row.status });
    }
    const [reopened] = await tx
      .update(importRows)
      .set({ status: "pending" })
      .where(
        and(
          eq(importRows.id, row.id),
          eq(importRows.status, "trashed"),
          eq(importRows.transactionId, row.transactionId),
        ),
      )
      .returning({ id: importRows.id });
    if (!reopened) {
      throw new LedgerValidationError("imports.rowAlreadyStatus", { status: row.status });
    }
  });
}
