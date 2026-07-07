/**
 * Transaction-KIND classification over the Stage-2 parser output — Stage 3
 * of the import path.
 *
 * PURE: parsed rows in, rows-plus-kind out. No DB, no ledger writes, no
 * double-entry, no final expense/revenue categories.
 *
 * Two design rules from the brief:
 * 1. CLASSIFICATION IS SIGNAL, NOT TRUTH. Every row carries a confidence and
 *    a human-readable reason; low confidence is fine (a human confirms in the
 *    Stage-4 review inbox), a certain-looking silent guess is not.
 * 2. The per-row IDENTITY INVENTORY is the L-0010 raw material: which stable
 *    identifiers each row actually has, so Stage 4 designs the refless-row
 *    import identity from real data. This module inventories; it does NOT
 *    pick a dedup key.
 */
import type { IngStatementRow } from "./types";

/**
 * Kind taxonomy — derived from the fixture (Skyline Nr.6/30.06.2026), one
 * kind per movement, purpose-flavoured where the statement itself carries the
 * purpose marker, structural where it doesn't:
 * - revenue: credit marked "Incoming funds" (HolyCode).
 * - state_payment: transfer to a treasury IBAN (RO..TREZ..) — Trezorerie, CAM.
 * - owner_transfer: bank transfer whose counterparty is an owner name.
 * - professional_services: outgoing business transfer to a services provider
 *   (accountants in the fixture).
 * - subscription: POS purchase at a known recurring merchant (OpenAI,
 *   Anthropic, Figma, Orange). FX-ness is NOT a kind — it lives on row.fx;
 *   the "FX card purchase" of the plan is subscription/card_purchase + fx.
 * - card_purchase: any other POS purchase (fuel, one-off fees paid by card).
 * - bank_fee: ING service-fee rows (no counterparty).
 * - unknown: no rule matched — loud, never silent.
 */
export type ImportKind =
  | "revenue"
  | "state_payment"
  | "owner_transfer"
  | "professional_services"
  | "subscription"
  | "card_purchase"
  | "bank_fee"
  | "unknown";

export type Confidence = "high" | "low";

/**
 * Which identity fields a row ACTUALLY has (L-0010 material). Stage 4 designs
 * the dedup key from this inventory; nothing here decides anything.
 */
export interface IdentityInventory {
  /** The long bank reference — the Stage-1 dedup key when present. */
  bankReference: string | null;
  internalReference: string | null;
  instantReference: string | null;
  /** POS rows: the card authorization code ("Auth. Code: 631085"). */
  authCode: string | null;
  /** POS rows: the card transaction date (ISO) — differs from book date. */
  cardDate: string | null;
  /** POS rows: masked card number ("**** 3421"). */
  cardNumber: string | null;
  counterpartyIban: string | null;
  /** True when any bank-issued reference exists (long/internal/instant). */
  hasAnyBankIssuedRef: boolean;
}

export interface ClassifiedRow {
  row: IngStatementRow;
  kind: ImportKind;
  confidence: Confidence;
  /** Always present: WHY this kind — the rule that fired, or what was weak. */
  reason: string;
  identity: IdentityInventory;
}

/** Pure classification context — caller supplies entity-specific knowledge. */
export interface ClassifyContext {
  /** Owner names as printed by the bank (e.g. ["Grigore Filimon"]). */
  ownerNames: string[];
  /** Extends the built-in recurring-merchant matchers. */
  extraSubscriptionMerchants?: RegExp[];
}

/** Seeded from the fixture's recurring merchants; context can extend. */
const SUBSCRIPTION_MERCHANTS: RegExp[] = [/OPENAI/i, /ANTHROPIC/i, /FIGMA/i, /ORANGE/i];

/** Professional-services markers on outgoing transfer counterparties. */
const PROFESSIONAL_MARKERS = /contabil|audit|expert/i;

const TREASURY_IBAN = /^RO\d{2}TREZ/;
const CARD_LINE = /^Card No:\s*(\*+\s*\d+)$/;
const CARD_DATE_AUTH = /^Date:\s*(\d{2})-(\d{2})-(\d{4})\s+Auth\. Code:\s*(\d+)$/;

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function extractIdentity(row: IngStatementRow): IdentityInventory {
  let authCode: string | null = null;
  let cardDate: string | null = null;
  let cardNumber: string | null = null;
  for (const line of row.rawLines) {
    const card = line.match(CARD_LINE);
    if (card) cardNumber = card[1];
    const dateAuth = line.match(CARD_DATE_AUTH);
    if (dateAuth) {
      cardDate = `${dateAuth[3]}-${dateAuth[2]}-${dateAuth[1]}`;
      authCode = dateAuth[4];
    }
  }
  return {
    bankReference: row.bankReference,
    internalReference: row.internalReference,
    instantReference: row.instantReference,
    authCode,
    cardDate,
    cardNumber,
    counterpartyIban: row.counterpartyIban,
    hasAnyBankIssuedRef:
      row.bankReference !== null ||
      row.internalReference !== null ||
      row.instantReference !== null,
  };
}

function classifyRow(row: IngStatementRow, ctx: ClassifyContext): ClassifiedRow {
  const identity = extractIdentity(row);
  const raw = row.rawLines.join(" ");
  const isPos = row.rawLines.includes("POS purchase");
  const isTransfer = row.rawLines.some((l) => l.startsWith("Transfer ING Business"));
  const subscriptionMatchers = [
    ...SUBSCRIPTION_MERCHANTS,
    ...(ctx.extraSubscriptionMerchants ?? []),
  ];
  const done = (kind: ImportKind, confidence: Confidence, reason: string): ClassifiedRow => ({
    row,
    kind,
    confidence,
    reason,
    identity,
  });

  // Bank fee: no counterparty, the statement's own "Service Fee" rows.
  if (row.counterpartyName === null && /Service Fee/.test(raw)) {
    return done("bank_fee", "high", "Service Fee row with no counterparty");
  }

  // Revenue: credit direction + the "Incoming funds" marker.
  if (row.direction === "credit") {
    if (row.rawLines.includes("Incoming funds")) {
      return done("revenue", "high", 'credit with "Incoming funds" marker');
    }
    return done("unknown", "low", "credit without a recognized incoming-funds marker");
  }

  // State payment: any transfer to a treasury IBAN.
  if (row.counterpartyIban && TREASURY_IBAN.test(row.counterpartyIban)) {
    return done("state_payment", "high", "counterparty IBAN is a treasury account (RO..TREZ)");
  }

  if (isPos) {
    const merchant = row.counterpartyName ?? "";
    if (subscriptionMatchers.some((m) => m.test(merchant))) {
      return done("subscription", "high", `known recurring merchant: ${row.counterpartyName}`);
    }
    // Kind is structurally certain (card purchase); purpose may not be —
    // e.g. a state fee paid by card looks identical to a shop purchase.
    return done(
      "card_purchase",
      "low",
      "POS purchase at an unrecognized merchant — purpose unverified, confirm in review",
    );
  }

  if (isTransfer && row.counterpartyName) {
    const counterparty = normalizeName(row.counterpartyName);
    if (ctx.ownerNames.some((n) => normalizeName(n) === counterparty)) {
      return done("owner_transfer", "high", `counterparty matches owner name: ${row.counterpartyName}`);
    }
    if (PROFESSIONAL_MARKERS.test(row.counterpartyName)) {
      return done(
        "professional_services",
        "high",
        `counterparty carries a professional-services marker: ${row.counterpartyName}`,
      );
    }
    return done(
      "professional_services",
      "low",
      "outgoing business transfer to a company counterparty without a professional-services marker",
    );
  }

  return done("unknown", "low", "no classification rule matched this row shape");
}

/** Classify every row — total function, nothing falls through silently. */
export function classifyStatementRows(
  rows: IngStatementRow[],
  ctx: ClassifyContext,
): ClassifiedRow[] {
  return rows.map((row) => classifyRow(row, ctx));
}
