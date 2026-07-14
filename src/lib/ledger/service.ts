/**
 * The single transaction write service. Every entry path (forms, guided
 * flows, future imports) goes through here — nothing else writes to
 * transactions/postings.
 *
 * Ledger model (decided with the user in phase 2):
 * - Postings of a transaction must sum to exactly zero in RON.
 * - Standard income/expense balances against the entity's equity account;
 *   the equity leg is the P&L side and carries the category. Splits are
 *   multiple categorized equity legs against one bank/cash leg.
 * - Transfers and tax-liability postings are never categorized.
 * - Posting amounts are in the account's currency; RON conversion uses the
 *   BNR rate resolution rule at the transaction date, except when the caller
 *   supplies an explicit RON value (cross-currency transfer mirror legs).
 * - Updates replace the whole transaction (header + postings + tags) so the
 *   ledger only ever moves between consistent states; the prior state goes
 *   to audit_log. Soft delete marks the transaction and its postings.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  auditLog,
  categories,
  lotConsumptions,
  postings,
  revolutBookedRows,
  revolutImportRows,
  taxAccruals,
  trades,
  transactions,
  transactionTags,
} from "@/db/schema";
import { convertMinorToRon, resolveRonRate } from "@/lib/fx";
import { LedgerValidationError, type PostingInput, type TransactionInput } from "./types";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** An open Drizzle transaction handle (never the bare pool). */
export type LedgerTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface PreparedPosting extends PostingInput {
  currency: "RON" | "EUR" | "USD";
  amountRon: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function validateAndPrepare(input: TransactionInput): Promise<PreparedPosting[]> {
  if (!DATE_RE.test(input.date)) {
    throw new LedgerValidationError("ledger.invalidTransactionDate", { date: input.date });
  }
  if (!input.description.trim()) {
    throw new LedgerValidationError("ledger.descriptionRequired");
  }
  if (input.postings.length < 2) {
    throw new LedgerValidationError("ledger.postingsNeedAtLeastTwo");
  }
  for (const posting of input.postings) {
    if (!Number.isSafeInteger(posting.amount) || posting.amount === 0) {
      throw new LedgerValidationError("ledger.postingAmountInvalid");
    }
    if (posting.amountRon !== undefined && !Number.isSafeInteger(posting.amountRon)) {
      throw new LedgerValidationError("ledger.ronAmountInvalid");
    }
  }

  const accountIds = [...new Set(input.postings.map((p) => p.accountId))];
  const accountRows = await db
    .select()
    .from(accounts)
    .where(and(inArray(accounts.id, accountIds), isNull(accounts.deletedAt)));
  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  for (const accountId of accountIds) {
    const account = accountById.get(accountId);
    if (!account) throw new LedgerValidationError("ledger.accountNotFound", { accountId });
    if (!account.isActive) {
      throw new LedgerValidationError("ledger.accountInactive", { accountName: account.name });
    }
  }

  const categoryIds = [
    ...new Set(input.postings.flatMap((p) => (p.categoryId ? [p.categoryId] : []))),
  ];
  const categoryRows = categoryIds.length
    ? await db
        .select()
        .from(categories)
        .where(and(inArray(categories.id, categoryIds), isNull(categories.deletedAt)))
    : [];
  const categoryById = new Map(categoryRows.map((c) => [c.id, c]));
  for (const categoryId of categoryIds) {
    const category = categoryById.get(categoryId);
    if (!category) throw new LedgerValidationError("ledger.categoryNotFound", { categoryId });
    if (category.entityId !== null && category.entityId !== input.entityId) {
      throw new LedgerValidationError("ledger.categoryWrongEntity", { categoryName: category.name });
    }
  }

  // Category placement rules.
  for (const posting of input.postings) {
    const account = accountById.get(posting.accountId)!;
    if (posting.categoryId) {
      if (input.kind === "transfer") {
        throw new LedgerValidationError("ledger.transferCategorized");
      }
      if (account.type === "tax_liability") {
        throw new LedgerValidationError("ledger.taxAccrualCategorized");
      }
      if (account.type !== "equity") {
        throw new LedgerValidationError("ledger.categoryOnRealAccount");
      }
    } else if (input.kind === "standard" && account.type === "equity") {
      throw new LedgerValidationError("ledger.standardEquityCategoryRequired");
    }
  }

  // RON conversion — resolve each non-RON currency once for the date, but
  // ONLY for postings that actually need conversion. A leg with an explicit
  // amountRon (transfer mirrors, trade legs converted at the broker's own
  // rate) never uses the BNR rate — and resolveRonRate fetches from BNR on a
  // cache miss, so resolving eagerly would make such writes depend on the
  // network for a value that is then discarded.
  const currencies = [
    ...new Set(
      input.postings
        .filter((p) => p.amountRon === undefined)
        .map((p) => accountById.get(p.accountId)!.currency)
        .filter((c) => c !== "RON"),
    ),
  ];
  const rateByCurrency = new Map<string, string>();
  for (const currency of currencies) {
    const resolved = await resolveRonRate(input.date, currency);
    rateByCurrency.set(currency, resolved.rate);
  }

  const prepared = input.postings.map((posting): PreparedPosting => {
    const account = accountById.get(posting.accountId)!;
    const amountRon =
      posting.amountRon ??
      (account.currency === "RON"
        ? posting.amount
        : convertMinorToRon(posting.amount, rateByCurrency.get(account.currency)!));
    return { ...posting, currency: account.currency, amountRon };
  });

  const sum = prepared.reduce((total, p) => total + p.amountRon, 0);
  if (sum !== 0) {
    throw new LedgerValidationError("ledger.ronZeroSum", { sum });
  }

  // Statement-line refs must be unique per account within one transaction;
  // the partial unique index enforces it across transactions.
  const seenRefs = new Set<string>();
  for (const posting of input.postings) {
    if (!posting.externalRef) continue;
    const key = `${posting.accountId}\u0000${posting.externalRef}`;
    if (seenRefs.has(key)) {
      throw new LedgerValidationError("ledger.duplicateExternalRefInTransaction", {
        externalRef: posting.externalRef,
      });
    }
    seenRefs.add(key);
  }

  for (const accrual of input.accruals ?? []) {
    const posting = input.postings[accrual.postingIndex];
    if (!posting) {
      throw new LedgerValidationError("ledger.accrualPostingMissing", {
        postingIndex: accrual.postingIndex,
      });
    }
    if (accountById.get(posting.accountId)!.type !== "tax_liability") {
      throw new LedgerValidationError("ledger.accrualPostingNotTaxLiability");
    }
  }
  return prepared;
}

async function insertTransactionRows(
  tx: DbOrTx,
  input: TransactionInput,
  prepared: PreparedPosting[],
  existingId?: string,
) {
  const [transaction] = existingId
    ? await tx
        .update(transactions)
        .set({
          entityId: input.entityId,
          date: input.date,
          description: input.description,
          kind: input.kind,
          notes: input.notes ?? null,
        })
        .where(eq(transactions.id, existingId))
        .returning()
    : await tx
        .insert(transactions)
        .values({
          entityId: input.entityId,
          date: input.date,
          description: input.description,
          kind: input.kind,
          notes: input.notes ?? null,
        })
        .returning();

  const insertedPostings = await tx
    .insert(postings)
    .values(
      prepared.map((p) => ({
        transactionId: transaction.id,
        accountId: p.accountId,
        amount: p.amount,
        currency: p.currency,
        amountRon: p.amountRon,
        categoryId: p.categoryId ?? null,
        counterparty: p.counterparty ?? null,
        counterpartyIban: p.counterpartyIban ?? null,
        externalRef: p.externalRef ?? null,
      })),
    )
    .returning({ id: postings.id });

  if (input.accruals?.length) {
    await tx.insert(taxAccruals).values(
      input.accruals.map((accrual) => ({
        transactionId: transaction.id,
        postingId: insertedPostings[accrual.postingIndex].id,
        taxRuleId: accrual.taxRuleId,
        year: accrual.year,
        quarter: accrual.quarter,
      })),
    );
  }

  if (input.tagIds?.length) {
    await tx
      .insert(transactionTags)
      .values(input.tagIds.map((tagId) => ({ transactionId: transaction.id, tagId })));
  }
  return transaction.id;
}

/** Full prior state of a transaction, stored in audit_log on update/delete. */
async function snapshotTransaction(id: string, reader: DbOrTx = db) {
  const [transaction] = await reader.select().from(transactions).where(eq(transactions.id, id));
  if (!transaction || transaction.deletedAt) {
    throw new LedgerValidationError("ledger.transactionNotFound", { transactionId: id });
  }
  const postingRows = await reader.select().from(postings).where(eq(postings.transactionId, id));
  const tagRows = await reader
    .select()
    .from(transactionTags)
    .where(eq(transactionTags.transactionId, id));
  return { transaction, postings: postingRows, tagIds: tagRows.map((t) => t.tagId) };
}

/**
 * Create a transaction. Optionally composes inside a caller-owned DB
 * transaction (`tx`): validation, inserts, and the audit row then run in the
 * caller's scope, so a caller that must write sibling rows atomically with
 * the ledger write (the trade path: trade row + lot consumptions) gets
 * all-or-nothing semantics WITHOUT a second write path — this is still the
 * single entry point. With `tx` absent, behavior is byte-identical to before
 * the parameter existed (own transaction), proven by the characterization
 * test. A rollback of the caller's transaction fully unwinds everything
 * written here.
 *
 * NOTE: account/category validation reads via the POOL, not the passed `tx`,
 * so referenced accounts must already exist and be COMMITTED before the call —
 * a composed transaction cannot create-and-immediately-reference an account
 * (the constraint the opening-balance seed hit; it books after commit).
 */
export async function createTransaction(input: TransactionInput, tx?: LedgerTx): Promise<string> {
  const prepared = await validateAndPrepare(input);
  const write = async (t: DbOrTx) => {
    const id = await insertTransactionRows(t, input, prepared);
    await t.insert(auditLog).values({
      tableName: "transactions",
      rowId: id,
      action: "insert",
      previousValues: null,
    });
    return id;
  };
  return tx ? write(tx) : db.transaction(write);
}

/**
 * IMPORTED-TRANSACTION EDIT GUARD (Stage 4 decision, docs/parked-plan.md):
 * updateTransaction hard-replaces postings, and the manual forms never carry
 * external_ref — so a form edit of an imported transaction would silently
 * strip its statement reference and make the row re-importable as a
 * duplicate. The guard is the rule "an update may not DROP an existing
 * external_ref": every (account, external_ref) pair on the prior postings
 * must survive into the replacement set. This blocks the forms naturally
 * while leaving importer-driven corrections (which resend the ref) and
 * soft-delete free. It lives here, in the single write path, so no caller
 * can bypass it.
 */
function assertExternalRefsPreserved(
  prior: { accountId: string; externalRef: string | null }[],
  next: PostingInput[],
): void {
  const nextRefs = new Set(
    next.flatMap((p) => (p.externalRef ? [`${p.accountId} ${p.externalRef}`] : [])),
  );
  for (const posting of prior) {
    if (posting.externalRef && !nextRefs.has(`${posting.accountId} ${posting.externalRef}`)) {
      throw new LedgerValidationError("ledger.importedRefsMustBePreserved");
    }
  }
}

/**
 * TRADE EDIT GUARD (Phase 4 Stage 3, L-0012 CORRUPTION check): a trade's
 * postings, trades row, and lot consumptions are ONE structure — the generic
 * edit path would hard-replace the postings while the trade rows stand,
 * orphaning booked basis. Editing a trade is therefore refused outright;
 * the correction path is delete (which cascades + guards, Stage 2) and
 * re-enter.
 */
async function assertNotTradeTransaction(id: string): Promise<void> {
  const [trade] = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.transactionId, id), isNull(trades.deletedAt)))
    .limit(1);
  if (trade) {
    throw new LedgerValidationError("ledger.tradeTransactionCannotBeEdited");
  }
}

export async function updateTransaction(id: string, input: TransactionInput): Promise<void> {
  const prior = await snapshotTransaction(id);
  await assertNotTradeTransaction(id);
  assertExternalRefsPreserved(prior.postings, input.postings);
  const prepared = await validateAndPrepare(input);
  await db.transaction(async (tx) => {
    // Hard-replace postings: the prior state lives in audit_log, and
    // dependent rows (tax_accruals) cascade so no orphans remain.
    await tx.delete(postings).where(eq(postings.transactionId, id));
    await tx.delete(transactionTags).where(eq(transactionTags.transactionId, id));
    await insertTransactionRows(tx, input, prepared, id);
    await tx.insert(auditLog).values({
      tableName: "transactions",
      rowId: id,
      action: "update",
      previousValues: prior,
    });
  });
}

/**
 * Intra-import duplicate guard — run over a WHOLE statement batch before any
 * insert. The partial unique index alone cannot protect an importer that
 * treats "ref already exists" as "already imported, skip": if the bank's
 * long reference ever turns out non-unique, that skip would silently drop a
 * real second movement. Two identical refs inside one fresh batch can only
 * mean the stability assumption broke — so fail loudly instead.
 * Pure and synchronous; lives here so the future importer cannot reach the
 * write path without passing it.
 */
export function assertBatchExternalRefsUnique(
  rows: { accountId: string; externalRef: string | null | undefined }[],
): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.externalRef) continue;
    const key = `${row.accountId} ${row.externalRef}`;
    if (seen.has(key)) {
      throw new LedgerValidationError("ledger.importBatchDuplicateExternalRef", {
        externalRef: row.externalRef,
      });
    }
    seen.add(key);
  }
}

async function writeSoftDeleteTransaction(
  tx: DbOrTx,
  id: string,
  allowedRevolutBatchId?: string,
): Promise<void> {
  const prior = await snapshotTransaction(id, tx);
  const deletedAt = new Date();
  const markerRows = await tx
    .select({ batchId: revolutImportRows.batchId })
    .from(revolutBookedRows)
    .innerJoin(revolutImportRows, eq(revolutImportRows.id, revolutBookedRows.sourceRowId))
    .where(eq(revolutBookedRows.transactionId, id));
  if (allowedRevolutBatchId === undefined && markerRows.length > 0) {
    throw new LedgerValidationError("ledger.importedInvestmentTransactionRequiresBatchDelete");
  }
  if (
    allowedRevolutBatchId !== undefined &&
    (markerRows.length === 0 ||
      markerRows.some((marker) => marker.batchId !== allowedRevolutBatchId))
  ) {
    throw new LedgerValidationError("revolut.batchReversalTopologyChanged");
  }

  // TRADE INTEGRITY (Phase 4 Stage 2). Lot accounting is append-only:
  // remaining quantity = buy.quantity − Σ LIVE consumptions, so deleting a
  // SELL must soft-delete its consumptions (restoring the lots — the same
  // live-row unwind as L-0011), and deleting a BUY whose lot a live sell
  // has consumed must be refused (the sell's booked basis would dangle and
  // the position account would go negative). Lives here, in the single
  // write path, so no caller can bypass it.
  const tradeRows = await tx
    .select()
    .from(trades)
    .where(and(eq(trades.transactionId, id), isNull(trades.deletedAt)));
  if (tradeRows.length > 0) {
    const buyIds = tradeRows.filter((t) => t.kind === "buy").map((t) => t.id);
    if (buyIds.length > 0) {
      const [dependent] = await tx
        .select({ id: lotConsumptions.id })
        .from(lotConsumptions)
        .where(
          and(inArray(lotConsumptions.buyTradeId, buyIds), isNull(lotConsumptions.deletedAt)),
        )
        .limit(1);
      if (dependent) {
        throw new LedgerValidationError("ledger.consumedBuyCannotBeDeleted");
      }
    }
    const sellIds = tradeRows.filter((t) => t.kind === "sell").map((t) => t.id);
    if (sellIds.length > 0) {
      await tx
        .update(lotConsumptions)
        .set({ deletedAt })
        .where(
          and(inArray(lotConsumptions.sellTradeId, sellIds), isNull(lotConsumptions.deletedAt)),
        );
    }
    await tx
      .update(trades)
      .set({ deletedAt })
      .where(inArray(trades.id, tradeRows.map((t) => t.id)));
  }

  await tx.update(transactions).set({ deletedAt }).where(eq(transactions.id, id));
  await tx.update(postings).set({ deletedAt }).where(eq(postings.transactionId, id));
  await tx.insert(auditLog).values({
    tableName: "transactions",
    rowId: id,
    action: "delete",
    previousValues: prior,
  });
}

export async function softDeleteTransaction(id: string): Promise<void> {
  await db.transaction((tx) => writeSoftDeleteTransaction(tx, id));
}

/** Batch-owned entry to the same guarded delete core. The marker-to-batch
 * check prevents this composition seam from becoming a generic bypass. */
export async function softDeleteRevolutBatchTransaction(
  id: string,
  batchId: string,
  tx: LedgerTx,
): Promise<void> {
  await writeSoftDeleteTransaction(tx, id, batchId);
}
