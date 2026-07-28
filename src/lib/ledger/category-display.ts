import type { TransactionKind } from "./types";

const DISPLAYABLE_KINDS = [
  "transfer",
  "salary",
  "dividend",
  "opening_balance",
  "trade",
] as const satisfies readonly TransactionKind[];
type DisplayableKind = (typeof DISPLAYABLE_KINDS)[number];

function isDisplayableKind(kind: TransactionKind): kind is DisplayableKind {
  return (DISPLAYABLE_KINDS as readonly TransactionKind[]).includes(kind);
}

export type TransactionCategoryDisplay =
  | { type: "split"; count: number }
  | { type: "category" }
  | { type: "tax_settlement" }
  | { type: "kind"; kind: DisplayableKind }
  | { type: "empty" };

export function transactionCategoryDisplay(input: {
  splitCount: number | null;
  category: string | null;
  hasTaxLiabilityLeg: boolean;
  kind: TransactionKind;
}): TransactionCategoryDisplay {
  if (input.splitCount) return { type: "split", count: input.splitCount };
  if (input.category) return { type: "category" };
  if (input.hasTaxLiabilityLeg) return { type: "tax_settlement" };
  if (isDisplayableKind(input.kind)) {
    return { type: "kind", kind: input.kind };
  }
  return { type: "empty" };
}
