import type { transactionKind } from "@/db/schema";

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
}

export interface TransactionInput {
  entityId: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  kind: TransactionKind;
  notes?: string | null;
  externalRef?: string | null;
  tagIds?: string[];
  postings: PostingInput[];
}

/** Thrown for any business-rule violation; message is user-presentable. */
export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerValidationError";
  }
}
