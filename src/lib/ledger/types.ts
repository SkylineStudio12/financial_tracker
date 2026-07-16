import type { transactionKind } from "@/db/schema";
export { LedgerValidationError } from "@/lib/app-error";

export type TransactionKind = (typeof transactionKind.enumValues)[number];

export interface PostingInput {
  accountId: string;
  /** Signed integer minor units in the ACCOUNT's currency. The service
   * derives the posting currency from the account; they always match. */
  amount: number;
  /**
   * Optional RON override in integer minor units. Normally the service
   * converts via the BNR rate for the transaction date. Cross-currency
   * transfers set this on the receiving leg (mirroring the sending leg) so
   * the pair sums to zero while both legs keep their true original amounts.
   */
  amountRon?: number;
  categoryId?: string | null;
  counterparty?: string | null;
  /** Structured counterparty IBAN from bank imports (transfer rows print
   * it); NULL on manual writes and card/POS rows. */
  counterpartyIban?: string | null;
  /**
   * Stable bank reference for this account movement (statement-line dedup
   * key). Import-only: manual forms and guided flows never set it, so their
   * postings write NULL and stay exempt from the per-account unique index.
   */
  externalRef?: string | null;
}

/** Links a posting (by its index in `postings`) to the tax rule applied. */
export interface AccrualInput {
  postingIndex: number;
  taxRuleId: string;
  year: number;
  quarter: number | null;
}

export interface SalaryDetailInput {
  /** First day of the fiscal pay month, YYYY-MM-01. */
  payMonth: string;
  personalDeductionMinor: number;
}

export interface TransactionInput {
  entityId: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  kind: TransactionKind;
  notes?: string | null;
  tagIds?: string[];
  postings: PostingInput[];
  /** Tax accrual links for postings on tax_liability accounts. */
  accruals?: AccrualInput[];
  /** Revision-keyed payslip metadata that intentionally has no posting leg. */
  salaryDetail?: SalaryDetailInput;
}
