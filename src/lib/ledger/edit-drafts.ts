import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, postings, taxAccruals, taxRules, trades, transactions, transactionTags, tags } from "@/db/schema";
import { minorToInput } from "@/lib/format";
import { LedgerValidationError } from "./types";

type StandardDraft = {
  type: "standard";
  transactionId: string;
  expectedRevision: number;
  storedKind: "standard" | "trade";
  accountId: string;
  date: string;
  description: string;
  direction: "expense" | "income";
  total: string;
  splits: { categoryId: string; amount: string }[];
  tagNames: string[];
  counterparty: string;
};

type TransferDraft = {
  type: "transfer";
  transactionId: string;
  expectedRevision: number;
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amount: string;
  received: string;
  note: string;
};

type SalaryDraft = {
  type: "salary";
  transactionId: string;
  expectedRevision: number;
  employeeName: string;
  month: string;
  gross: string;
  personalAccountId: string;
};

type DividendDraft = {
  type: "dividend";
  transactionId: string;
  expectedRevision: number;
  date: string;
  gross: string;
  personalAccountId: string;
};

type OpeningBalanceDraft = {
  type: "opening_balance";
  transactionId: string;
  expectedRevision: number;
  accountId: string;
  date: string;
  description: string;
  amount: string;
};

export type TransactionEditDraft =
  | StandardDraft
  | TransferDraft
  | SalaryDraft
  | DividendDraft
  | OpeningBalanceDraft;

export async function getTransactionEditDraft(
  transactionId: string,
  entityId: string,
): Promise<TransactionEditDraft> {
  const [transaction] = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.entityId, entityId),
        isNull(transactions.deletedAt),
      ),
    );
  if (!transaction) {
    throw new LedgerValidationError("ledger.transactionNotFound", { transactionId });
  }
  const [trade] = await db
    .select({ id: trades.id })
    .from(trades)
    .where(eq(trades.transactionId, transactionId))
    .limit(1);
  if (trade) throw new LedgerValidationError("ledger.investmentCrudUnavailable");

  const legs = await db
    .select({
      id: postings.id,
      accountId: postings.accountId,
      accountEntityId: accounts.entityId,
      accountType: accounts.type,
      amount: postings.amount,
      amountRon: postings.amountRon,
      categoryId: postings.categoryId,
      counterparty: postings.counterparty,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(
      and(
        eq(postings.transactionId, transactionId),
        eq(postings.revision, transaction.currentRevision),
        isNull(postings.deletedAt),
      ),
    );
  const tagRows = await db
    .select({ name: tags.name })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .where(eq(transactionTags.transactionId, transactionId));

  if (transaction.kind === "transfer" && legs.length === 2) {
    const from = legs.find((leg) => leg.amount < 0);
    const to = legs.find((leg) => leg.amount > 0);
    if (!from || !to) throw new LedgerValidationError("ledger.transactionShapeUnsupported");
    return {
      type: "transfer",
      transactionId,
      expectedRevision: transaction.currentRevision,
      fromAccountId: from.accountId,
      toAccountId: to.accountId,
      date: transaction.date,
      amount: minorToInput(Math.abs(from.amount)),
      received: minorToInput(Math.abs(to.amount)),
      note: transaction.notes ?? "",
    };
  }

  if (transaction.kind === "opening_balance") {
    const accountLeg = legs.find((leg) => leg.accountType !== "equity");
    if (!accountLeg || legs.length !== 2) {
      throw new LedgerValidationError("ledger.transactionShapeUnsupported");
    }
    return {
      type: "opening_balance",
      transactionId,
      expectedRevision: transaction.currentRevision,
      accountId: accountLeg.accountId,
      date: transaction.date,
      description: transaction.description,
      amount: minorToInput(Math.abs(accountLeg.amount)),
    };
  }

  if (transaction.kind === "salary" || transaction.kind === "dividend") {
    const accrualRows = await db
      .select({ ruleType: taxRules.ruleType, amount: postings.amount })
      .from(taxAccruals)
      .innerJoin(taxRules, eq(taxRules.id, taxAccruals.taxRuleId))
      .innerJoin(postings, eq(postings.id, taxAccruals.postingId))
      .where(
        and(
          eq(taxAccruals.transactionId, transactionId),
          eq(taxAccruals.revision, transaction.currentRevision),
          isNull(taxAccruals.deletedAt),
        ),
      );
    const personal = legs.find(
      (leg) => leg.accountEntityId !== entityId && leg.amount > 0,
    );
    if (!personal) throw new LedgerValidationError("ledger.transactionShapeUnsupported");
    if (transaction.kind === "salary") {
      const employeeTaxes = accrualRows
        .filter((row) =>
          ["salary_cas", "salary_cass", "salary_income_tax"].includes(row.ruleType),
        )
        .reduce((sum, row) => sum + Math.abs(row.amount), 0);
      const companyBank = legs.find(
        (leg) => leg.accountEntityId === entityId && leg.accountType === "bank" && leg.amount < 0,
      );
      if (!companyBank) throw new LedgerValidationError("ledger.transactionShapeUnsupported");
      return {
        type: "salary",
        transactionId,
        expectedRevision: transaction.currentRevision,
        employeeName: companyBank.counterparty ?? "",
        month: transaction.date.slice(0, 7),
        gross: minorToInput(personal.amount + employeeTaxes),
        personalAccountId: personal.accountId,
      };
    }
    const withholding = accrualRows
      .filter((row) => row.ruleType === "dividend_tax")
      .reduce((sum, row) => sum + Math.abs(row.amount), 0);
    return {
      type: "dividend",
      transactionId,
      expectedRevision: transaction.currentRevision,
      date: transaction.date,
      gross: minorToInput(personal.amount + withholding),
      personalAccountId: personal.accountId,
    };
  }

  const realLegs = legs.filter((leg) => leg.accountType !== "equity");
  const equityLegs = legs.filter((leg) => leg.accountType === "equity");
  if (
    (transaction.kind !== "standard" && transaction.kind !== "trade") ||
    realLegs.length !== 1 ||
    equityLegs.length === 0
  ) {
    throw new LedgerValidationError("ledger.transactionShapeUnsupported");
  }
  const bankLeg = realLegs[0];
  const total = Math.abs(bankLeg.amount);
  const equityRonTotal = equityLegs.reduce((sum, leg) => sum + Math.abs(leg.amountRon), 0);
  const splitAmounts = equityLegs.map((leg) =>
    equityRonTotal === 0 ? 0 : Math.round((total * Math.abs(leg.amountRon)) / equityRonTotal),
  );
  const allocated = splitAmounts.slice(0, -1).reduce((sum, value) => sum + value, 0);
  splitAmounts[splitAmounts.length - 1] = total - allocated;
  return {
    type: "standard",
    transactionId,
    expectedRevision: transaction.currentRevision,
    storedKind: transaction.kind,
    accountId: bankLeg.accountId,
    date: transaction.date,
    description: transaction.description,
    direction: bankLeg.amount < 0 ? "expense" : "income",
    total: minorToInput(total),
    splits: equityLegs.map((leg, index) => ({
      categoryId: leg.categoryId ?? "",
      amount: minorToInput(splitAmounts[index]),
    })),
    tagNames: tagRows.map((row) => row.name),
    counterparty: bankLeg.counterparty ?? "",
  };
}
