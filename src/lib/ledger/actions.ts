"use server";

/**
 * Server actions for the entry forms. These translate form payloads into
 * balanced posting sets and delegate every write to the ledger service.
 * On success they redirect to the entity's transaction list; on business
 * rule violations they return { error } for the form to display.
 */
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  postings,
  tags,
  taxAccruals,
  transactions,
  transactionTags,
} from "@/db/schema";
import { convertMinorToRon, resolveRonRate } from "@/lib/fx";
import {
  createTransaction,
  purgeTransaction,
  restoreTransaction,
  softDeleteNonInvestmentTransaction,
  updateTransaction,
  updateTransactionMetadata,
  LedgerValidationError,
  type AccrualInput,
  type PostingInput,
  type TransactionInput,
} from "@/lib/ledger";
import { toAppError, type AppError } from "@/lib/app-error";
import { getProfile, profileForEntity } from "@/lib/profiles";
import { planMicroTaxAccrual } from "@/lib/tax/micro-tax";
import { getTransactionEditDraft } from "./edit-drafts";
import { getFlowPageData } from "./flow-page-data";
import { hasLikelyRestoreCollision } from "./queries";
import type { AccountOption } from "@/components/forms/option-types";
import type { TransactionEditDraft } from "./edit-drafts";
import type { EmployeeOption } from "@/lib/management/service";

/**
 * Post-save destination: the caller's profile view. The slug comes from the
 * client, so validate it against the PROFILES config (and the entity it
 * claims to scope) before interpolating; fall back to the entity's default
 * profile.
 */
function transactionsPath(entityId: string, profileSlug?: string): string {
  const profile = profileSlug ? getProfile(profileSlug) : undefined;
  const safe =
    profile && profile.entityId === entityId ? profile : profileForEntity(entityId);
  if (!safe) throw new LedgerValidationError("profile.unknownEntity");
  return `/p/${safe.slug}/transactions`;
}

export interface StandardPayload {
  transactionId?: string;
  expectedRevision?: number;
  expectedUpdatedAt?: string;
  storedKind?: "standard" | "trade";
  /** When true, skip the redirect on success and return { ok } instead —
   * used by the modal so the list stays put and the form can repeat-enter. */
  stay?: boolean;
  /** Profile view to return to after a redirecting save (validated). */
  profileSlug?: string;
  entityId: string;
  accountId: string;
  date: string;
  description: string;
  direction: "expense" | "income";
  /** Positive integer minor units in the account's currency. */
  totalMinor: number;
  /** Positive amounts summing to totalMinor; one split = no split UI. */
  splits: { categoryId: string; amountMinor: number }[];
  tagNames: string[];
  counterparty?: string;
}

export interface TransferPayload {
  transactionId?: string;
  expectedRevision?: number;
  expectedUpdatedAt?: string;
  editMode?: "transfer" | "tax_settlement";
  /** See StandardPayload.stay. */
  stay?: boolean;
  /** See StandardPayload.profileSlug. */
  profileSlug?: string;
  entityId: string;
  fromAccountId: string;
  toAccountId: string;
  date: string;
  /** Positive integer minor units in the FROM account's currency. */
  amountMinor: number;
  /** Positive integer minor units in the TO account's currency; required
   * when the two accounts have different currencies. */
  receivedMinor?: number;
  note?: string;
}

export interface TransactionMetadataPayload {
  transactionId: string;
  expectedRevision: number;
  expectedUpdatedAt: string;
  description: string;
  notes: string;
}

export interface OpeningBalancePayload {
  transactionId: string;
  expectedRevision: number;
  expectedUpdatedAt: string;
  entityId: string;
  accountId: string;
  date: string;
  description: string;
  amountMinor: number;
}

type ActionResult = { error: AppError } | { ok: true };

export async function loadTransactionEditDraftAction(
  transactionId: string,
  entityId: string,
  profileSlug: string,
): Promise<
  | {
      draft: TransactionEditDraft;
      personalAccounts: AccountOption[];
      employees: EmployeeOption[];
      error?: never;
    }
  | { error: AppError; draft?: never; personalAccounts?: never; employees?: never }
> {
  try {
    const profile = getProfile(profileSlug);
    if (!profile || profile.entityId !== entityId) {
      throw new LedgerValidationError("ledger.transactionNotFound", { transactionId });
    }
    const draft = await getTransactionEditDraft(transactionId, entityId, profile.owner);
    const flowData =
      draft.type === "salary" || draft.type === "dividend"
        ? await getFlowPageData(draft.bookingEntityId)
        : { personalAccounts: [], employees: [] };
    return {
      draft,
      personalAccounts: flowData.personalAccounts,
      employees: flowData.employees,
    };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export async function saveTransactionMetadataAction(
  payload: TransactionMetadataPayload,
): Promise<ActionResult> {
  try {
    await updateTransactionMetadata(
      payload.transactionId,
      { description: payload.description, notes: payload.notes },
      payload.expectedRevision,
      payload.expectedUpdatedAt,
    );
    return { ok: true };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

async function loadAccount(accountId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)));
  if (!account) throw new LedgerValidationError("forms.accountNotFound");
  return account;
}

async function findEquityAccount(entityId: string) {
  const [equity] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, entityId),
        eq(accounts.type, "equity"),
        eq(accounts.isActive, true),
        isNull(accounts.deletedAt),
      ),
    );
  if (!equity) {
    throw new LedgerValidationError("forms.equityAccountMissing");
  }
  return equity;
}

/** Find-or-create tags by name; returns their ids. */
async function resolveTagIds(names: string[]): Promise<string[]> {
  const cleaned = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (cleaned.length === 0) return [];
  await db.insert(tags).values(cleaned.map((name) => ({ name }))).onConflictDoNothing();
  const rows = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(inArray(tags.name, cleaned), isNull(tags.deletedAt)));
  if (rows.length !== cleaned.length) {
    throw new LedgerValidationError("forms.tagCreateFailed");
  }
  return rows.map((r) => r.id);
}

async function persist(
  input: TransactionInput,
  transactionId?: string,
  expectedRevision?: number,
  expectedUpdatedAt?: string,
) {
  if (transactionId) {
    await updateTransaction(transactionId, input, expectedRevision, expectedUpdatedAt);
  } else {
    await createTransaction(input);
  }
}

export async function saveStandardTransaction(
  payload: StandardPayload,
): Promise<ActionResult | undefined> {
  try {
    const account = await loadAccount(payload.accountId);
    const equity = await findEquityAccount(payload.entityId);

    if (payload.splits.length === 0) {
      throw new LedgerValidationError("forms.pickAtLeastOneCategory");
    }
    for (const split of payload.splits) {
      if (!Number.isSafeInteger(split.amountMinor) || split.amountMinor <= 0) {
        throw new LedgerValidationError("forms.splitAmountPositive");
      }
      if (!split.categoryId) throw new LedgerValidationError("forms.splitCategoryRequired");
    }
    const splitSum = payload.splits.reduce((sum, s) => sum + s.amountMinor, 0);
    if (splitSum !== payload.totalMinor) {
      throw new LedgerValidationError("forms.splitSumMismatch");
    }

    // The bank/cash leg is in the account currency; the categorized equity
    // legs are in RON. For non-RON accounts convert each split at the BNR
    // rate and put the rounding remainder on the last split so the RON sum
    // matches the converted total exactly.
    const sign = payload.direction === "expense" ? -1 : 1;
    let splitRon = payload.splits.map((s) => s.amountMinor);
    if (account.currency !== "RON") {
      const rate = await resolveRonRate(payload.date, account.currency);
      const totalRon = Math.abs(convertMinorToRon(sign * payload.totalMinor, rate.rate));
      splitRon = payload.splits.map((s) => convertMinorToRon(s.amountMinor, rate.rate));
      const allocated = splitRon.slice(0, -1).reduce((sum, v) => sum + v, 0);
      splitRon[splitRon.length - 1] = totalRon - allocated;
    }

    const postingInputs: PostingInput[] = [
      {
        accountId: account.id,
        amount: sign * payload.totalMinor,
        counterparty: payload.counterparty?.trim() || null,
      },
      ...payload.splits.map((split, index) => ({
        accountId: equity.id,
        amount: -sign * splitRon[index],
        categoryId: split.categoryId,
      })),
    ];

    // Company revenue: income on a company auto-accrues micro revenue tax —
    // construction lives in the shared helper so the statement importer
    // produces identical accruals (entity-type check included there).
    const accruals: AccrualInput[] = [];
    if (payload.direction === "income" && account.type !== "equity") {
      const plan = await planMicroTaxAccrual({
        entityId: payload.entityId,
        date: payload.date,
        revenueRonMinor: splitRon.reduce((sum, v) => sum + v, 0),
        equityAccountId: equity.id,
        basePostingIndex: postingInputs.length,
      });
      postingInputs.push(...plan.postings);
      accruals.push(...plan.accruals);
    }

    await persist(
      {
        entityId: payload.entityId,
        date: payload.date,
        description: payload.description,
        kind: payload.storedKind ?? "standard",
        postings: postingInputs,
        tagIds: await resolveTagIds(payload.tagNames),
        accruals,
      },
      payload.transactionId,
      payload.expectedRevision,
      payload.expectedUpdatedAt,
    );
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
  if (payload.stay) return { ok: true };
  redirect(transactionsPath(payload.entityId, payload.profileSlug));
}

export async function saveTransferTransaction(
  payload: TransferPayload,
): Promise<ActionResult | undefined> {
  try {
    if (payload.fromAccountId === payload.toAccountId) {
      throw new LedgerValidationError("forms.sameAccountTransfer");
    }
    if (!Number.isSafeInteger(payload.amountMinor) || payload.amountMinor <= 0) {
      throw new LedgerValidationError("forms.amountPositive");
    }
    const from = await loadAccount(payload.fromAccountId);
    const to = await loadAccount(payload.toAccountId);

    const fromLeg: PostingInput = { accountId: from.id, amount: -payload.amountMinor };
    const toLeg: PostingInput = { accountId: to.id, amount: payload.amountMinor };
    let storedKind: TransactionInput["kind"] = "transfer";
    let description = `Transfer: ${from.name} → ${to.name}`;
    let tagIds: string[] = [];

    if (payload.editMode === "tax_settlement") {
      if (from.type !== "bank" || to.type !== "tax_liability") {
        throw new LedgerValidationError("ledger.transactionShapeUnsupported", {
          shape: `tax settlement requires bank(negative) + tax_liability(positive), received ${from.type} + ${to.type}`,
        });
      }
      if (!payload.transactionId || payload.expectedRevision === undefined) {
        throw new LedgerValidationError("ledger.transactionShapeUnsupported", {
          shape: "tax settlement without an existing transaction revision",
        });
      }
      const [current] = await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.id, payload.transactionId),
            eq(transactions.currentRevision, payload.expectedRevision),
            isNull(transactions.deletedAt),
          ),
        );
      if (!current) {
        throw new LedgerValidationError("ledger.transactionRevisionConflict");
      }
      const currentLegs = await db
        .select({
          accountId: postings.accountId,
          accountType: accounts.type,
          amount: postings.amount,
          categoryId: postings.categoryId,
          counterparty: postings.counterparty,
          counterpartyIban: postings.counterpartyIban,
          externalRef: postings.externalRef,
        })
        .from(postings)
        .innerJoin(accounts, eq(accounts.id, postings.accountId))
        .where(
          and(
            eq(postings.transactionId, current.id),
            eq(postings.revision, current.currentRevision),
            isNull(postings.deletedAt),
          ),
        );
      const currentFrom = currentLegs.find(
        (leg) =>
          leg.accountType === "bank" &&
          leg.amount < 0 &&
          leg.categoryId === null,
      );
      const currentTo = currentLegs.find(
        (leg) =>
          leg.accountType === "tax_liability" &&
          leg.amount > 0 &&
          leg.categoryId === null,
      );
      const [referencedAccrual] = await db
        .select({ id: taxAccruals.id })
        .from(taxAccruals)
        .where(
          and(
            eq(taxAccruals.transactionId, current.id),
            eq(taxAccruals.revision, current.currentRevision),
            isNull(taxAccruals.deletedAt),
          ),
        )
        .limit(1);
      if (
        current.kind !== "standard" ||
        currentLegs.length !== 2 ||
        !currentFrom ||
        !currentTo ||
        referencedAccrual
      ) {
        throw new LedgerValidationError("ledger.transactionShapeUnsupported", {
          shape: "tax settlement with linked accruals or changed postings",
        });
      }
      fromLeg.counterparty = currentFrom.counterparty;
      fromLeg.counterpartyIban = currentFrom.counterpartyIban;
      fromLeg.externalRef = currentFrom.externalRef;
      toLeg.counterparty = currentTo.counterparty;
      toLeg.counterpartyIban = currentTo.counterpartyIban;
      toLeg.externalRef = currentTo.externalRef;
      storedKind = "standard";
      description = current.description ?? "";
      tagIds = (
        await db
          .select({ tagId: transactionTags.tagId })
          .from(transactionTags)
          .where(eq(transactionTags.transactionId, current.id))
      ).map((row) => row.tagId);
    }

    if (from.currency !== to.currency) {
      const received = payload.receivedMinor;
      if (!received || !Number.isSafeInteger(received) || received <= 0) {
        throw new LedgerValidationError("forms.receivedAmountRequired", { currency: to.currency });
      }
      toLeg.amount = received;
      // Zero-sum across currencies: exactly one leg carries a mirrored RON
      // value. A RON leg's RON value must equal its amount, so the mirror
      // goes on the non-RON side; with two foreign currencies the sending
      // leg converts at BNR and the receiving leg mirrors it.
      if (to.currency === "RON") {
        fromLeg.amountRon = -received;
      } else if (from.currency === "RON") {
        toLeg.amountRon = payload.amountMinor;
      } else {
        const rate = await resolveRonRate(payload.date, from.currency);
        toLeg.amountRon = -convertMinorToRon(-payload.amountMinor, rate.rate);
      }
    }

    await persist(
      {
        entityId: payload.entityId,
        date: payload.date,
        description,
        kind: storedKind,
        notes: payload.note?.trim() || null,
        tagIds,
        postings: [fromLeg, toLeg],
      },
      payload.transactionId,
      payload.expectedRevision,
      payload.expectedUpdatedAt,
    );
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
  if (payload.stay) return { ok: true };
  redirect(transactionsPath(payload.entityId, payload.profileSlug));
}

export async function saveOpeningBalanceTransaction(
  payload: OpeningBalancePayload,
): Promise<ActionResult> {
  try {
    if (!Number.isSafeInteger(payload.amountMinor) || payload.amountMinor <= 0) {
      throw new LedgerValidationError("forms.amountPositive");
    }
    const account = await loadAccount(payload.accountId);
    const equity = await findEquityAccount(payload.entityId);
    const amountRon =
      account.currency === "RON"
        ? payload.amountMinor
        : convertMinorToRon(
            payload.amountMinor,
            (await resolveRonRate(payload.date, account.currency)).rate,
          );
    await updateTransaction(
      payload.transactionId,
      {
        entityId: payload.entityId,
        date: payload.date,
        description: payload.description,
        kind: "opening_balance",
        postings: [
          { accountId: account.id, amount: payload.amountMinor, amountRon },
          { accountId: equity.id, amount: -amountRon, amountRon: -amountRon },
        ],
      },
      payload.expectedRevision,
      payload.expectedUpdatedAt,
    );
    return { ok: true };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export async function deleteTransactionAction(
  transactionId: string,
  entityId: string,
  profileSlug?: string,
  stay = false,
): Promise<ActionResult | undefined> {
  try {
    await softDeleteNonInvestmentTransaction(transactionId);
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
  if (stay) return { ok: true };
  redirect(transactionsPath(entityId, profileSlug));
}

export async function restoreTransactionAction(
  transactionId: string,
  expectedRevision: number,
): Promise<ActionResult> {
  try {
    await restoreTransaction(transactionId, expectedRevision);
    return { ok: true };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export async function checkRestoreCollisionAction(transactionId: string) {
  return { collision: await hasLikelyRestoreCollision(transactionId) };
}

export async function purgeTransactionAction(transactionId: string): Promise<ActionResult> {
  try {
    await purgeTransaction(transactionId);
    return { ok: true };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}
