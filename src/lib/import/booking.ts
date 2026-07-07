/**
 * Statement row → full double-entry TransactionInput, per the approved
 * Stage-4 KIND mapping. This module CONSTRUCTS input for the ledger service;
 * it never writes — booking calls createTransaction like every other entry
 * path (single write path).
 *
 * The statement account is RON (validated at batch creation), so the settled
 * RON amount on the row IS the charge: no conversion happens and the BNR
 * rate is never consulted. Foreign-currency POS rows keep the bank's own
 * printed FX facts verbatim in the notes.
 */
import { LedgerValidationError, type PostingInput, type TransactionInput } from "@/lib/ledger";
import { planMicroTaxAccrual } from "@/lib/tax/micro-tax";
import type { ClassifiedRow } from "./ing/classify";

export interface BookingContext {
  entityId: string;
  /** The statement's ledger account — the bank leg of every row. */
  bankAccountId: string;
  /** The entity's equity account — the P&L / transfer counter-leg. */
  equityAccountId: string;
  /** The entity's tax_liability account; required to book state_payment. */
  taxLiabilityAccountId: string | null;
  /** Normalized statement number, for provenance in notes. */
  statementNumber: string;
}

/** Kinds whose booking REQUIRES a category on the equity leg. */
const CATEGORY_REQUIRED = new Set([
  "revenue",
  "professional_services",
  "subscription",
  "card_purchase",
  "bank_fee",
  "unknown",
]);

export function bookingNeedsCategory(kind: string): boolean {
  return CATEGORY_REQUIRED.has(kind);
}

function fxNote(classified: ClassifiedRow): string | null {
  const fx = classified.row.fx;
  if (!fx) return null;
  const fmt = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
  return (
    `FX: ${fmt(fx.originalAmountMinor)} ${fx.originalCurrency} settled as ` +
    `${fmt(fx.settlementAmountMinor)} ${fx.settlementCurrency} @ bank's printed rate ${fx.printedRate}`
  );
}

/**
 * Build the complete transaction for one classified statement row.
 *
 * KIND → double-entry (bank leg always carries external_ref, counterparty,
 * IBAN; X = row amount, all RON):
 * - revenue          standard  bank +X · equity −X (income category)
 *                              + micro-tax accrual pair via the shared helper
 * - state_payment    standard  bank −X · tax_liability +X (settles accrued
 *                              tax; no category by the placement rules)
 * - owner_transfer   transfer  bank −X · equity +X (transfers uncategorized)
 * - professional_services / subscription / card_purchase / bank_fee / unknown
 *                    standard  bank ∓X · equity ±X (category required —
 *                              suggested or user-picked, never guessed here)
 *
 * The micro-tax accrual fires for ANY credit booked as standard income on a
 * company (same trigger as the manual form: income direction), not only for
 * high-confidence "revenue" — a company credit booked under an income
 * category accrues tax no matter what the classifier called it.
 */
export async function buildImportTransactionInput(params: {
  classified: ClassifiedRow;
  /** Resolved import identity (long ref or synthetic statement-scoped key). */
  externalRef: string;
  /** Category for the equity leg where the kind requires one. */
  categoryId: string | null;
  ctx: BookingContext;
}): Promise<TransactionInput> {
  const { classified, externalRef, categoryId, ctx } = params;
  const { row, kind } = classified;
  const signed = row.direction === "credit" ? row.amountMinor : -row.amountMinor;

  const bankLeg: PostingInput = {
    accountId: ctx.bankAccountId,
    amount: signed,
    counterparty: row.counterpartyName,
    counterpartyIban: row.counterpartyIban,
    externalRef,
  };

  const notes = [
    `Imported from ING statement ${ctx.statementNumber}, line ${row.lineNo}.`,
    ...(fxNote(classified) ? [fxNote(classified)!] : []),
  ].join("\n");

  const description = row.counterpartyName ?? row.description;
  if (!description) {
    throw new LedgerValidationError(`Row ${row.lineNo} has no usable description`);
  }

  const base = { entityId: ctx.entityId, date: row.bookDate, description, notes };

  if (kind === "owner_transfer") {
    return {
      ...base,
      kind: "transfer",
      postings: [bankLeg, { accountId: ctx.equityAccountId, amount: -signed }],
    };
  }

  if (kind === "state_payment") {
    if (!ctx.taxLiabilityAccountId) {
      throw new LedgerValidationError(
        "This entity has no tax_liability account to settle a state payment against",
      );
    }
    return {
      ...base,
      kind: "standard",
      postings: [bankLeg, { accountId: ctx.taxLiabilityAccountId, amount: -signed }],
    };
  }

  if (!categoryId) {
    throw new LedgerValidationError(
      `Pick a category for line ${row.lineNo} (${kind}) before booking it`,
    );
  }
  const postings: PostingInput[] = [
    bankLeg,
    { accountId: ctx.equityAccountId, amount: -signed, categoryId },
  ];
  const accruals =
    row.direction === "credit"
      ? await planMicroTaxAccrual({
          entityId: ctx.entityId,
          date: row.bookDate,
          revenueRonMinor: row.amountMinor,
          equityAccountId: ctx.equityAccountId,
          basePostingIndex: postings.length,
        })
      : { postings: [], accruals: [] };
  postings.push(...accruals.postings);

  return { ...base, kind: "standard", postings, accruals: accruals.accruals };
}
