import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  entities,
  postings,
  salaryTransactionDetails,
  taxAccruals,
  taxRules,
  trades,
  transactions,
  transactionTags,
  tags,
} from "@/db/schema";
import { minorToInput } from "@/lib/format";
import type { AccountOwner } from "@/lib/profiles";
import { profileVisibilityCondition } from "./queries";
import { LedgerValidationError } from "./types";

type BookingContext = {
  bookingEntityId: string;
  bookingEntityName: string;
};

type StandardDraft = BookingContext & {
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

type TransferDraft = BookingContext & {
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

export type SalaryDraft = BookingContext & {
  type: "salary";
  transactionId: string;
  expectedRevision: number;
  employeeName: string;
  payMonth: string;
  paymentDate: string;
  gross: string;
  cas: string;
  cass: string;
  incomeTax: string;
  cam: string;
  net: string;
  personalDeduction: string;
  personalAccountId: string;
};

type DividendDraft = BookingContext & {
  type: "dividend";
  transactionId: string;
  expectedRevision: number;
  date: string;
  gross: string;
  personalAccountId: string;
};

type OpeningBalanceDraft = BookingContext & {
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

const SALARY_RULE_TYPES = [
  "salary_cas",
  "salary_cass",
  "salary_income_tax",
  "cam",
] as const;

function salaryRuleAmount(
  rows: { ruleType: string; amount: number }[],
  ruleType: (typeof SALARY_RULE_TYPES)[number],
): number {
  const matching = rows.filter((row) => row.ruleType === ruleType);
  if (matching.length !== 1 || matching[0].amount >= 0) {
    throw new LedgerValidationError("flows.salaryShapeUnavailable");
  }
  return Math.abs(matching[0].amount);
}

export async function getLastCompleteSalaryDraft(
  entityId: string,
  employeeName: string,
): Promise<SalaryDraft | null> {
  const normalized = employeeName.trim().toLowerCase();
  if (!normalized) throw new LedgerValidationError("flows.employeeNameRequired");
  const [candidate] = await db
    .select({ transactionId: transactions.id })
    .from(transactions)
    .innerJoin(
      postings,
      and(
        eq(postings.transactionId, transactions.id),
        eq(postings.revision, transactions.currentRevision),
        isNull(postings.deletedAt),
      ),
    )
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .innerJoin(
      salaryTransactionDetails,
      and(
        eq(salaryTransactionDetails.transactionId, transactions.id),
        eq(salaryTransactionDetails.revision, transactions.currentRevision),
      ),
    )
    .where(
      and(
        eq(transactions.entityId, entityId),
        eq(transactions.kind, "salary"),
        isNull(transactions.deletedAt),
        eq(accounts.entityId, entityId),
        eq(accounts.type, "bank"),
        sql`${postings.amount} < 0`,
        sql`lower(btrim(${postings.counterparty})) = ${normalized}`,
      ),
    )
    .orderBy(
      desc(salaryTransactionDetails.payMonth),
      desc(transactions.date),
      desc(transactions.createdAt),
    )
    .limit(1);
  if (!candidate) return null;
  const draft = await getTransactionEditDraft(candidate.transactionId, entityId);
  if (draft.type !== "salary" || !draft.personalDeduction) {
    throw new LedgerValidationError("flows.salaryShapeUnavailable");
  }
  return draft;
}

export async function getTransactionEditDraft(
  transactionId: string,
  entityId: string,
  owner?: AccountOwner,
): Promise<TransactionEditDraft> {
  const [transaction] = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.id, transactionId),
        isNull(transactions.deletedAt),
      ),
    );
  if (!transaction) {
    throw new LedgerValidationError("ledger.transactionNotFound", { transactionId });
  }
  const [visible] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.id, transactionId),
        profileVisibilityCondition({ entityId, owner }, "live"),
      ),
    )
    .limit(1);
  if (!visible) {
    throw new LedgerValidationError("ledger.transactionNotFound", { transactionId });
  }
  const [bookingEntity] = await db
    .select({ name: entities.name })
    .from(entities)
    .where(eq(entities.id, transaction.entityId))
    .limit(1);
  if (!bookingEntity) {
    throw new LedgerValidationError("ledger.transactionNotFound", { transactionId });
  }
  const bookingContext = {
    bookingEntityId: transaction.entityId,
    bookingEntityName: bookingEntity.name,
  };
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
      ...bookingContext,
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
      ...bookingContext,
      type: "opening_balance",
      transactionId,
      expectedRevision: transaction.currentRevision,
      accountId: accountLeg.accountId,
      date: transaction.date,
      description: transaction.description ?? "",
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
      (leg) => leg.accountEntityId !== transaction.entityId && leg.amount > 0,
    );
    if (!personal) throw new LedgerValidationError("ledger.transactionShapeUnsupported");
    if (transaction.kind === "salary") {
      if (
        legs.length !== 7 ||
        accrualRows.length !== 4 ||
        accrualRows.some(
          (row) =>
            !SALARY_RULE_TYPES.includes(
              row.ruleType as (typeof SALARY_RULE_TYPES)[number],
            ),
        )
      ) {
        throw new LedgerValidationError("flows.salaryShapeUnavailable");
      }
      const cas = salaryRuleAmount(accrualRows, "salary_cas");
      const cass = salaryRuleAmount(accrualRows, "salary_cass");
      const incomeTax = salaryRuleAmount(accrualRows, "salary_income_tax");
      const cam = salaryRuleAmount(accrualRows, "cam");
      const companyBank = legs.find(
        (leg) =>
          leg.accountEntityId === transaction.entityId &&
          leg.accountType === "bank" &&
          leg.amount < 0,
      );
      const equity = legs.find(
        (leg) =>
          leg.accountEntityId === transaction.entityId &&
          leg.accountType === "equity" &&
          leg.amount > 0,
      );
      const taxLegs = legs.filter(
        (leg) =>
          leg.accountEntityId === transaction.entityId &&
          leg.accountType === "tax_liability" &&
          leg.amount < 0,
      );
      const net = personal.amount;
      if (
        !companyBank ||
        !equity ||
        taxLegs.length !== 4 ||
        companyBank.amount !== -net ||
        equity.amount !== cas + cass + incomeTax + cam
      ) {
        throw new LedgerValidationError("flows.salaryShapeUnavailable");
      }
      const [detail] = await db
        .select({
          payMonth: salaryTransactionDetails.payMonth,
          personalDeductionMinor: salaryTransactionDetails.personalDeductionMinor,
        })
        .from(salaryTransactionDetails)
        .where(
          and(
            eq(salaryTransactionDetails.transactionId, transactionId),
            eq(salaryTransactionDetails.revision, transaction.currentRevision),
          ),
        );
      return {
        ...bookingContext,
        type: "salary",
        transactionId,
        expectedRevision: transaction.currentRevision,
        employeeName: companyBank.counterparty ?? "",
        payMonth: detail?.payMonth.slice(0, 7) ?? transaction.date.slice(0, 7),
        paymentDate: transaction.date,
        gross: minorToInput(net + cas + cass + incomeTax),
        cas: minorToInput(cas),
        cass: minorToInput(cass),
        incomeTax: minorToInput(incomeTax),
        cam: minorToInput(cam),
        net: minorToInput(net),
        personalDeduction: detail ? minorToInput(detail.personalDeductionMinor) : "",
        personalAccountId: personal.accountId,
      };
    }
    const withholding = accrualRows
      .filter((row) => row.ruleType === "dividend_tax")
      .reduce((sum, row) => sum + Math.abs(row.amount), 0);
    return {
      ...bookingContext,
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
    ...bookingContext,
    type: "standard",
    transactionId,
    expectedRevision: transaction.currentRevision,
    storedKind: transaction.kind,
    accountId: bankLeg.accountId,
    date: transaction.date,
    description: transaction.description ?? "",
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
