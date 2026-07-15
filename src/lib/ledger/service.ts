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
  transactionImportLinks,
  transactionTags,
} from "@/db/schema";
import { convertMinorToRon, resolveRonRate } from "@/lib/fx";
import {
  markTransactionImportEdited,
  markTransactionImportRestored,
  markTransactionImportTrashed,
  releaseTransactionImportOwnership,
} from "@/lib/import/ownership";
import { acquireImportOwnershipLock } from "./locks";
import { LedgerValidationError, type PostingInput, type TransactionInput } from "./types";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** An open Drizzle transaction handle (never the bare pool). */
export type LedgerTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface PreparedPosting extends PostingInput {
  currency: "RON" | "EUR" | "USD";
  amountRon: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function validateAndPrepare(
  input: TransactionInput,
  reader: DbOrTx = db,
): Promise<PreparedPosting[]> {
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
  const accountRows = await reader
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
    ? await reader
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
  revision = 1,
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
          currentRevision: revision,
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
          currentRevision: revision,
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
        revision,
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
        revision,
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

/** Full current revision, stored in audit_log on mutation. */
async function snapshotTransaction(
  id: string,
  reader: DbOrTx = db,
  state: "live" | "deleted" = "live",
) {
  const [transaction] = await reader.select().from(transactions).where(eq(transactions.id, id));
  if (
    !transaction ||
    (state === "live" && transaction.deletedAt !== null) ||
    (state === "deleted" && transaction.deletedAt === null)
  ) {
    throw new LedgerValidationError("ledger.transactionNotFound", { transactionId: id });
  }
  const postingRows = await reader
    .select()
    .from(postings)
    .where(
      and(
        eq(postings.transactionId, id),
        eq(postings.revision, transaction.currentRevision),
        state === "live"
          ? isNull(postings.deletedAt)
          : eq(postings.deletedAt, transaction.deletedAt!),
      ),
    );
  const accrualRows = await reader
    .select()
    .from(taxAccruals)
    .where(
      and(
        eq(taxAccruals.transactionId, id),
        eq(taxAccruals.revision, transaction.currentRevision),
        state === "live"
          ? isNull(taxAccruals.deletedAt)
          : eq(taxAccruals.deletedAt, transaction.deletedAt!),
      ),
    );
  const tagRows = await reader
    .select()
    .from(transactionTags)
    .where(eq(transactionTags.transactionId, id));
  const importLinks = await reader
    .select()
    .from(transactionImportLinks)
    .where(eq(transactionImportLinks.transactionId, id));
  return {
    transaction,
    postings: postingRows,
    accruals: accrualRows,
    tagIds: tagRows.map((t) => t.tagId),
    importLinks,
  };
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
 * Account/category validation uses the caller transaction when supplied, so
 * validation and every sibling write observe one atomic database state.
 */
type ExistingTransactionMode = {
  existingTransactionId: string;
  revision: number;
};

export async function createTransaction(
  input: TransactionInput,
  tx?: LedgerTx,
  existing?: ExistingTransactionMode,
): Promise<string> {
  const prepared = await validateAndPrepare(input, tx ?? db);
  const write = async (t: DbOrTx) => {
    const id = await insertTransactionRows(
      t,
      input,
      prepared,
      existing?.existingTransactionId,
      existing?.revision ?? 1,
    );
    if (!existing) {
      await t.insert(auditLog).values({
        tableName: "transactions",
        rowId: id,
        action: "insert",
        previousValues: null,
      });
    }
    return id;
  };
  return tx ? write(tx) : db.transaction(write);
}

/**
 * CRUD-1 structural boundary. Historical trade rows count too: a previously
 * deleted investment transaction still owns lot/audit topology and remains a
 * CRUD-2 concern.
 */
async function assertNotTradeTransaction(id: string, reader: DbOrTx = db): Promise<void> {
  const [trade] = await reader
    .select({ id: trades.id })
    .from(trades)
    .where(eq(trades.transactionId, id))
    .limit(1);
  if (trade) {
    throw new LedgerValidationError("ledger.investmentCrudUnavailable");
  }
}

export async function updateTransaction(
  id: string,
  input: TransactionInput,
  expectedRevision?: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .for("update");
    if (!locked || locked.deletedAt !== null) {
      throw new LedgerValidationError("ledger.transactionNotFound", { transactionId: id });
    }
    await assertNotTradeTransaction(id, tx);
    if (expectedRevision !== undefined && locked.currentRevision !== expectedRevision) {
      throw new LedgerValidationError("ledger.transactionRevisionConflict");
    }
    const prior = await snapshotTransaction(id, tx);
    const deletedAt = new Date();
    await tx
      .update(postings)
      .set({ deletedAt })
      .where(
        and(
          eq(postings.transactionId, id),
          eq(postings.revision, locked.currentRevision),
          isNull(postings.deletedAt),
        ),
      );
    await tx
      .update(taxAccruals)
      .set({ deletedAt })
      .where(
        and(
          eq(taxAccruals.transactionId, id),
          eq(taxAccruals.revision, locked.currentRevision),
          isNull(taxAccruals.deletedAt),
        ),
      );
    await tx.delete(transactionTags).where(eq(transactionTags.transactionId, id));
    await createTransaction(input, tx, {
      existingTransactionId: id,
      revision: locked.currentRevision + 1,
    });
    await markTransactionImportEdited(tx, id);
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
  allowManualInvestment = true,
): Promise<void> {
  const [locked] = await tx
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .for("update");
  if (!locked || locked.deletedAt !== null) {
    throw new LedgerValidationError("ledger.transactionNotFound", { transactionId: id });
  }
  const prior = await snapshotTransaction(id, tx);
  if (prior.postings.length < 2) {
    throw new LedgerValidationError("ledger.transactionRestoreTopologyChanged");
  }
  const ronSum = prior.postings.reduce((sum, posting) => sum + posting.amountRon, 0);
  if (ronSum !== 0) throw new LedgerValidationError("ledger.ronZeroSum", { sum: ronSum });
  const deletedAt = new Date();
  const markerRows = await tx
    .select({ batchId: revolutImportRows.batchId })
    .from(revolutBookedRows)
    .innerJoin(revolutImportRows, eq(revolutImportRows.id, revolutBookedRows.sourceRowId))
    .where(eq(revolutBookedRows.transactionId, id));
  if (
    allowedRevolutBatchId !== undefined &&
    (markerRows.length === 0 ||
      markerRows.some((marker) => marker.batchId !== allowedRevolutBatchId))
  ) {
    throw new LedgerValidationError("revolut.batchReversalTopologyChanged");
  }
  const tradeRows = await tx
    .select()
    .from(trades)
    .where(and(eq(trades.transactionId, id), isNull(trades.deletedAt)));
  if (allowedRevolutBatchId === undefined && tradeRows.length > 0 && markerRows.length > 0) {
    throw new LedgerValidationError("ledger.importedInvestmentTransactionRequiresBatchDelete");
  }
  if (allowedRevolutBatchId === undefined && tradeRows.length > 0 && !allowManualInvestment) {
    throw new LedgerValidationError("ledger.investmentCrudUnavailable");
  }

  // TRADE INTEGRITY (Phase 4 Stage 2). Lot accounting is append-only:
  // remaining quantity = buy.quantity − Σ LIVE consumptions, so deleting a
  // SELL must soft-delete its consumptions (restoring the lots — the same
  // live-row unwind as L-0011), and deleting a BUY whose lot a live sell
  // has consumed must be refused (the sell's booked basis would dangle and
  // the position account would go negative). Lives here, in the single
  // write path, so no caller can bypass it.
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
  await tx
    .update(postings)
    .set({ deletedAt })
    .where(
      and(
        eq(postings.transactionId, id),
        eq(postings.revision, locked.currentRevision),
        isNull(postings.deletedAt),
      ),
    );
  await tx
    .update(taxAccruals)
    .set({ deletedAt })
    .where(
      and(
        eq(taxAccruals.transactionId, id),
        eq(taxAccruals.revision, locked.currentRevision),
        isNull(taxAccruals.deletedAt),
      ),
    );
  await markTransactionImportTrashed(tx as LedgerTx, id);
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

/** CRUD-1 entry point: the shared delete core with investment topology excluded. */
export async function softDeleteNonInvestmentTransaction(id: string): Promise<void> {
  await db.transaction((tx) => writeSoftDeleteTransaction(tx, id, undefined, false));
}

export async function restoreTransaction(id: string, expectedRevision?: number): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialize against full batch reversal and purge (shared lock order).
    await acquireImportOwnershipLock(tx);
    const [locked] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .for("update");
    if (!locked) {
      throw new LedgerValidationError("ledger.transactionNotFound", { transactionId: id });
    }
    if (locked.deletedAt === null) throw new LedgerValidationError("ledger.transactionNotDeleted");
    if (expectedRevision !== undefined && locked.currentRevision !== expectedRevision) {
      throw new LedgerValidationError("ledger.transactionRevisionConflict");
    }
    await assertNotTradeTransaction(id, tx);
    const prior = await snapshotTransaction(id, tx, "deleted");
    if (prior.postings.length < 2) {
      throw new LedgerValidationError("ledger.transactionRestoreTopologyChanged");
    }
    const [allRevisionPostings, allRevisionAccruals] = await Promise.all([
      tx
        .select({ id: postings.id, deletedAt: postings.deletedAt })
        .from(postings)
        .where(
          and(eq(postings.transactionId, id), eq(postings.revision, locked.currentRevision)),
        ),
      tx
        .select({ id: taxAccruals.id, deletedAt: taxAccruals.deletedAt })
        .from(taxAccruals)
        .where(
          and(eq(taxAccruals.transactionId, id), eq(taxAccruals.revision, locked.currentRevision)),
        ),
    ]);
    const tombstone = locked.deletedAt.getTime();
    if (
      allRevisionPostings.length !== prior.postings.length ||
      allRevisionAccruals.length !== prior.accruals.length ||
      allRevisionPostings.some((posting) => posting.deletedAt?.getTime() !== tombstone) ||
      allRevisionAccruals.some((accrual) => accrual.deletedAt?.getTime() !== tombstone)
    ) {
      throw new LedgerValidationError("ledger.transactionRestoreTopologyChanged");
    }
    const ronSum = prior.postings.reduce((sum, posting) => sum + posting.amountRon, 0);
    if (ronSum !== 0) throw new LedgerValidationError("ledger.ronZeroSum", { sum: ronSum });
    const postingIds = new Set(prior.postings.map((posting) => posting.id));
    if (prior.accruals.some((accrual) => !postingIds.has(accrual.postingId))) {
      throw new LedgerValidationError("ledger.transactionRestoreTopologyChanged");
    }
    // Reactivate ONLY the exact posting/accrual ids in the validated snapshot,
    // never "every row at this revision" — a drifted or orphaned same-revision
    // row must not be silently reactivated into a non-zero-sum state. The
    // returned-row counts must match the snapshot size exactly; a mismatch
    // means a concurrent mutation moved a row out from under us — fail loud.
    await tx.update(transactions).set({ deletedAt: null }).where(eq(transactions.id, id));
    const reactivatedPostings = await tx
      .update(postings)
      .set({ deletedAt: null })
      .where(inArray(postings.id, prior.postings.map((posting) => posting.id)))
      .returning({ id: postings.id });
    if (reactivatedPostings.length !== prior.postings.length) {
      throw new LedgerValidationError("ledger.transactionRestoreTopologyChanged");
    }
    if (prior.accruals.length > 0) {
      const reactivatedAccruals = await tx
        .update(taxAccruals)
        .set({ deletedAt: null })
        .where(inArray(taxAccruals.id, prior.accruals.map((accrual) => accrual.id)))
        .returning({ id: taxAccruals.id });
      if (reactivatedAccruals.length !== prior.accruals.length) {
        throw new LedgerValidationError("ledger.transactionRestoreTopologyChanged");
      }
    }
    // Assert the now-live revision is a complete zero-sum posting set before
    // the transaction commits.
    const liveAfter = await tx
      .select({ amountRon: postings.amountRon })
      .from(postings)
      .where(
        and(
          eq(postings.transactionId, id),
          eq(postings.revision, locked.currentRevision),
          isNull(postings.deletedAt),
        ),
      );
    if (liveAfter.length !== prior.postings.length) {
      throw new LedgerValidationError("ledger.transactionRestoreTopologyChanged");
    }
    const liveSum = liveAfter.reduce((sum, posting) => sum + posting.amountRon, 0);
    if (liveSum !== 0) throw new LedgerValidationError("ledger.ronZeroSum", { sum: liveSum });
    await markTransactionImportRestored(tx, id);
    await tx.insert(auditLog).values({
      tableName: "transactions",
      rowId: id,
      action: "restore",
      previousValues: prior,
    });
  });
}

export async function purgeTransaction(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialize against full batch reversal and restore (shared lock order).
    await acquireImportOwnershipLock(tx);
    const [locked] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .for("update");
    if (!locked) {
      throw new LedgerValidationError("ledger.transactionNotFound", { transactionId: id });
    }
    if (locked.deletedAt === null) {
      throw new LedgerValidationError("ledger.transactionPurgeRequiresTrash");
    }
    await assertNotTradeTransaction(id, tx);
    const prior = await snapshotTransaction(id, tx, "deleted");
    await releaseTransactionImportOwnership(tx, id, "transaction_purge");
    await tx.insert(auditLog).values({
      tableName: "transactions",
      rowId: id,
      action: "purge",
      previousValues: prior,
    });
    await tx.delete(transactions).where(eq(transactions.id, id));
  });
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
