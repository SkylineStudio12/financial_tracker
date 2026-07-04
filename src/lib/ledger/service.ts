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
  postings,
  transactions,
  transactionTags,
} from "@/db/schema";
import { convertMinorToRon, resolveRonRate } from "@/lib/fx";
import { LedgerValidationError, type PostingInput, type TransactionInput } from "./types";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

interface PreparedPosting extends PostingInput {
  currency: "RON" | "EUR" | "USD";
  amountRon: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function validateAndPrepare(input: TransactionInput): Promise<PreparedPosting[]> {
  if (!DATE_RE.test(input.date)) {
    throw new LedgerValidationError(`Invalid transaction date: ${input.date}`);
  }
  if (!input.description.trim()) {
    throw new LedgerValidationError("Description is required");
  }
  if (input.postings.length < 2) {
    throw new LedgerValidationError("A transaction needs at least two postings");
  }
  for (const posting of input.postings) {
    if (!Number.isSafeInteger(posting.amount) || posting.amount === 0) {
      throw new LedgerValidationError("Posting amounts must be non-zero integers in minor units");
    }
    if (posting.amountRon !== undefined && !Number.isSafeInteger(posting.amountRon)) {
      throw new LedgerValidationError("RON amounts must be integers in minor units");
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
    if (!account) throw new LedgerValidationError(`Account not found: ${accountId}`);
    if (!account.isActive) {
      throw new LedgerValidationError(`Account is inactive: ${account.name}`);
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
    if (!category) throw new LedgerValidationError(`Category not found: ${categoryId}`);
    if (category.entityId !== null && category.entityId !== input.entityId) {
      throw new LedgerValidationError(`Category "${category.name}" belongs to another entity`);
    }
  }

  // Category placement rules.
  for (const posting of input.postings) {
    const account = accountById.get(posting.accountId)!;
    if (posting.categoryId) {
      if (input.kind === "transfer") {
        throw new LedgerValidationError("Transfers are never categorized");
      }
      if (account.type === "tax_liability") {
        throw new LedgerValidationError("Tax accrual postings are never categorized");
      }
      if (account.type !== "equity") {
        throw new LedgerValidationError(
          "Categories belong on the equity (P&L) leg, not on real-account postings",
        );
      }
    } else if (input.kind === "standard" && account.type === "equity") {
      throw new LedgerValidationError(
        "The income/expense side of a standard transaction requires a category",
      );
    }
  }

  // RON conversion — resolve each non-RON currency once for the date.
  const currencies = [
    ...new Set(
      input.postings
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
    throw new LedgerValidationError(
      `Postings must sum to zero in RON; got ${sum} minor units. ` +
        "For cross-currency transfers, mirror the sending leg's RON amount on the receiving leg.",
    );
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
          externalRef: input.externalRef ?? null,
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
          externalRef: input.externalRef ?? null,
        })
        .returning();

  await tx.insert(postings).values(
    prepared.map((p) => ({
      transactionId: transaction.id,
      accountId: p.accountId,
      amount: p.amount,
      currency: p.currency,
      amountRon: p.amountRon,
      categoryId: p.categoryId ?? null,
      counterparty: p.counterparty ?? null,
    })),
  );

  if (input.tagIds?.length) {
    await tx
      .insert(transactionTags)
      .values(input.tagIds.map((tagId) => ({ transactionId: transaction.id, tagId })));
  }
  return transaction.id;
}

/** Full prior state of a transaction, stored in audit_log on update/delete. */
async function snapshotTransaction(id: string) {
  const [transaction] = await db.select().from(transactions).where(eq(transactions.id, id));
  if (!transaction || transaction.deletedAt) {
    throw new LedgerValidationError(`Transaction not found: ${id}`);
  }
  const postingRows = await db.select().from(postings).where(eq(postings.transactionId, id));
  const tagRows = await db
    .select()
    .from(transactionTags)
    .where(eq(transactionTags.transactionId, id));
  return { transaction, postings: postingRows, tagIds: tagRows.map((t) => t.tagId) };
}

export async function createTransaction(input: TransactionInput): Promise<string> {
  const prepared = await validateAndPrepare(input);
  return db.transaction(async (tx) => {
    const id = await insertTransactionRows(tx, input, prepared);
    await tx.insert(auditLog).values({
      tableName: "transactions",
      rowId: id,
      action: "insert",
      previousValues: null,
    });
    return id;
  });
}

export async function updateTransaction(id: string, input: TransactionInput): Promise<void> {
  const prior = await snapshotTransaction(id);
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

export async function softDeleteTransaction(id: string): Promise<void> {
  const prior = await snapshotTransaction(id);
  const deletedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.update(transactions).set({ deletedAt }).where(eq(transactions.id, id));
    await tx.update(postings).set({ deletedAt }).where(eq(postings.transactionId, id));
    await tx.insert(auditLog).values({
      tableName: "transactions",
      rowId: id,
      action: "delete",
      previousValues: prior,
    });
  });
}
