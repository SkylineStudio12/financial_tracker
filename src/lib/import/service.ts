/**
 * Import staging + booking logic (Stage 4). Staging writes ONLY to the
 * import_batches/import_rows inbox tables; booking a row delegates to
 * createTransaction — the ledger's single write path — with the resolved
 * external_ref on the bank posting so the partial unique index backstops
 * dedup. Nothing here auto-books.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, importBatches, importRows, postings } from "@/db/schema";
import {
  assertBatchExternalRefsUnique,
  createTransaction,
  LedgerValidationError,
} from "@/lib/ledger";
import { buildImportTransactionInput, bookingNeedsCategory } from "./booking";
import { OWNER_BANK_NAMES, SUGGESTED_CATEGORY_BY_KIND } from "./config";
import { classifyStatementRows, type ClassifiedRow } from "./ing/classify";
import { normalizeStatementNumber, parseStatementPeriod, resolveExternalRef } from "./ing/identity";
import { parseIngStatement } from "./ing/parse";
import { isIngCsv, parseIngCsvStatement } from "./ing/parse-csv";

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
 * IngParseError from the parser) with a user-presentable message.
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
    throw new LedgerValidationError("Statement account not found on this entity");
  }
  if (account.type !== "bank" || !account.isActive) {
    throw new LedgerValidationError("Statements import into an active bank account");
  }
  if (account.currency !== "RON") {
    throw new LedgerValidationError(
      "The ING statement importer supports RON current accounts only",
    );
  }

  // Format routing (CSV amendment): CSV is the DEFAULT source, detected by
  // its header row; anything else goes to the PDF-text parser. Both produce
  // the same typed statement — everything downstream is format-agnostic.
  const source = isIngCsv(params.text) ? "ing_csv" : "ing_pdf_text";
  const stmt =
    source === "ing_csv" ? parseIngCsvStatement(params.text) : parseIngStatement(params.text);
  const classified = classifyStatementRows(stmt.rows, {
    ownerNames: params.ownerNames ?? OWNER_BANK_NAMES[params.entityId] ?? [],
  });
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
  const [existingBatch] = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(eq(importBatches.rawTextHash, rawTextHash));
  if (existingBatch) {
    throw new LedgerValidationError(
      "This exact statement text is already imported — open its batch in the inbox instead",
    );
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

    await tx.insert(importRows).values(
      classified.map((c) => {
        const ref = refByLineNo.get(c.row.lineNo)!;
        const existingTransactionId = existingByRef.get(ref) ?? null;
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
          reason: c.reason,
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
    if (pg.code === "23505" && pg.constraint === "postings_account_external_ref_uidx") {
      return true;
    }
  }
  return false;
}

export type BookRowResult =
  | { status: "booked"; transactionId: string }
  | { status: "duplicate"; transactionId: string | null };

/**
 * Book ONE confirmed inbox row into the ledger — through createTransaction,
 * the single write path. A unique-index hit is not an error: the movement is
 * already in the ledger, so the row flips to `duplicate` with a link.
 */
export async function bookImportRow(params: {
  rowId: string;
  /** Overrides the suggestion; required where the kind needs a category
   * and no suggestion exists (card_purchase, unknown). */
  categoryId?: string | null;
}): Promise<BookRowResult> {
  const [row] = await db.select().from(importRows).where(eq(importRows.id, params.rowId));
  if (!row) throw new LedgerValidationError("Import row not found");
  if (row.status !== "pending") {
    throw new LedgerValidationError(`This row is already ${row.status}`);
  }
  const [batch] = await db
    .select()
    .from(importBatches)
    .where(eq(importBatches.id, row.batchId));
  if (!batch) throw new LedgerValidationError("Import batch not found");

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
    throw new LedgerValidationError("This entity has no equity account to balance against");
  }
  const taxLiability = entityAccounts.find((a) => a.type === "tax_liability") ?? null;

  const classified = row.payload as ClassifiedRow;
  const categoryId = params.categoryId ?? row.suggestedCategoryId;
  const input = await buildImportTransactionInput({
    classified,
    externalRef: row.resolvedExternalRef,
    categoryId: bookingNeedsCategory(row.kind) ? categoryId : null,
    ctx: {
      entityId: batch.entityId,
      bankAccountId: batch.bankAccountId,
      equityAccountId: equity.id,
      taxLiabilityAccountId: taxLiability?.id ?? null,
      statementNumber: batch.statementNumber,
    },
  });

  try {
    const transactionId = await createTransaction(input);
    await db
      .update(importRows)
      .set({ status: "booked", transactionId, bookedAt: new Date() })
      .where(eq(importRows.id, row.id));
    return { status: "booked", transactionId };
  } catch (error) {
    if (!isExternalRefUniqueViolation(error)) throw error;
    // Already in the ledger (booked between staging and now, or via an
    // overlapping batch): link the existing transaction, never book twice.
    const [existing] = await db
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

export interface BookHighConfidenceResult {
  booked: number;
  duplicates: number;
  /** Rows left pending: low confidence, overlap-suspect, or no category. */
  left: number;
  errors: string[];
}

/**
 * Book every pending HIGH-confidence row that needs no human input: not
 * overlap-suspect (those demand per-row confirmation by design) and either
 * category-free by shape or carrying a suggestion. Everything else stays in
 * the inbox.
 */
export async function bookHighConfidenceRows(batchId: string): Promise<BookHighConfidenceResult> {
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

  const result: BookHighConfidenceResult = { booked: 0, duplicates: 0, left: 0, errors: [] };
  for (const row of rows) {
    const bookable =
      row.confidence === "high" &&
      !row.overlapSuspect &&
      (!bookingNeedsCategory(row.kind) || row.suggestedCategoryId !== null);
    if (!bookable) {
      result.left += 1;
      continue;
    }
    try {
      const booked = await bookImportRow({ rowId: row.id });
      if (booked.status === "booked") result.booked += 1;
      else result.duplicates += 1;
    } catch (error) {
      result.left += 1;
      if (error instanceof LedgerValidationError) {
        result.errors.push(`Line ${row.lineNo}: ${error.message}`);
      } else {
        throw error;
      }
    }
  }
  return result;
}

export async function skipImportRow(rowId: string): Promise<void> {
  const [row] = await db
    .select({ status: importRows.status })
    .from(importRows)
    .where(eq(importRows.id, rowId));
  if (!row) throw new LedgerValidationError("Import row not found");
  if (row.status !== "pending") {
    throw new LedgerValidationError(`This row is already ${row.status}`);
  }
  await db.update(importRows).set({ status: "skipped" }).where(eq(importRows.id, rowId));
}
