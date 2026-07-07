/**
 * Typed output of the ING statement parser (Stage 2 of the import path).
 * Pure data — no DB shapes, no ledger concepts. Classification and
 * double-entry construction happen in later stages.
 */

/** FX details printed on foreign-currency POS rows, captured verbatim. */
export interface IngFxDetails {
  /** e.g. "USD" for the OpenAI row, "EUR" for Anthropic/Figma. */
  originalCurrency: string;
  /** Original amount in integer minor units of originalCurrency. */
  originalAmountMinor: number;
  settlementCurrency: string;
  settlementAmountMinor: number;
  /**
   * The bank's printed FX rate, kept as the PRINTED STRING ("5.42",
   * "5.4216") — precision varies row to row and the plan prefers this rate
   * over BNR lookups, so nothing may reformat it.
   */
  printedRate: string;
}

export interface IngStatementRow {
  /** Short per-statement line number (e.g. "1461") — DISPLAY ONLY, assumed
   * to reset each statement; never a dedup key. */
  lineNo: string;
  /** Book date as ISO YYYY-MM-DD. */
  bookDate: string;
  direction: "debit" | "credit";
  /** Positive integer minor units (bani) in the account currency. */
  amountMinor: number;
  /** Printed running balance after this row, integer minor units. */
  balanceAfterMinor: number;
  /** First body line unless the row is a bank fee (then null). For POS rows
   * this is the merchant; the cardholder line stays in rawLines. */
  counterpartyName: string | null;
  /** Structured RO IBAN when printed (transfer rows); null on POS/fee rows. */
  counterpartyIban: string | null;
  /** Unconsumed body text after structured extraction, joined with " ". */
  description: string;
  /** Every body line of the row, verbatim, for full fidelity / later rules. */
  rawLines: string[];
  /**
   * The ING LONG bank reference — the dedup key per L-0010 (UUID-style or
   * long-numeric). NULL when the statement prints none (POS, fees, and the
   * incoming-funds row in the fixture print no "Bank reference").
   */
  bankReference: string | null;
  /** "Internal reference" when printed (treasury rows, incoming funds). */
  internalReference: string | null;
  /** "Instant reference" when printed (instant transfers). */
  instantReference: string | null;
  /** FX block for foreign-currency POS rows; null otherwise. */
  fx: IngFxDetails | null;
}

export interface IngStatement {
  /** e.g. "Nr.6 / 30.06.2026" */
  statementNumber: string;
  /** The statement's own account IBAN (spaces removed). */
  accountIban: string;
  /** Printed period, verbatim (e.g. "01 - 30.06.2026"). */
  period: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  /** Declared counts from the header ("Total credits (1)", "Total debits (16)"). */
  declaredCreditCount: number;
  declaredDebitCount: number;
  /** Declared totals from the header, positive integer minor units. */
  declaredTotalCreditsMinor: number;
  declaredTotalDebitsMinor: number;
  rows: IngStatementRow[];
}

/** Any structural or arithmetic failure — the parse is wrong, fail loudly. */
export class IngParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngParseError";
  }
}
