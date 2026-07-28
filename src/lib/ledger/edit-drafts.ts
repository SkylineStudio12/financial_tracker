import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  categories,
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
  metadataDescription: string;
  metadataNotes: string;
  expectedUpdatedAt: string;
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
  editMode: "transfer" | "tax_settlement";
  transactionId: string;
  expectedRevision: number;
  fromAccountId: string;
  fromAccountName: string;
  fromAccountCurrency: string;
  fromAccountType: string;
  toAccountId: string;
  toAccountName: string;
  toAccountCurrency: string;
  toAccountType: string;
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

type MetadataOnlyDraft = BookingContext & {
  type: "metadata_only";
  transactionId: string;
  expectedRevision: number;
  postingShape: string;
};

export type TransactionEditDraft =
  | StandardDraft
  | TransferDraft
  | SalaryDraft
  | DividendDraft
  | OpeningBalanceDraft
  | MetadataOnlyDraft;

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
    metadataDescription: transaction.description ?? "",
    metadataNotes: transaction.notes ?? "",
    expectedUpdatedAt: transaction.updatedAt.toISOString(),
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
      accountName: accounts.name,
      accountCurrency: accounts.currency,
      accountType: accounts.type,
      amount: postings.amount,
      amountRon: postings.amountRon,
      categoryId: postings.categoryId,
      categoryName: categories.name,
      counterparty: postings.counterparty,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .leftJoin(categories, eq(categories.id, postings.categoryId))
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

  const postingShape = `${transaction.kind}: ${[...legs]
    .sort(
      (left, right) =>
        left.accountType.localeCompare(right.accountType) ||
        left.amount - right.amount ||
        left.id.localeCompare(right.id),
    )
    .map(
      (leg) =>
        `${leg.accountType}(${leg.amount < 0 ? "negative" : "positive"}, ${
          leg.categoryId ? "categorized" : "uncategorized"
        })`,
    )
    .join(" + ")}`;
  const metadataOnly = (): MetadataOnlyDraft => ({
    ...bookingContext,
    type: "metadata_only",
    transactionId,
    expectedRevision: transaction.currentRevision,
    postingShape,
  });

  const negativeTaxSettlementLeg =
    transaction.kind === "standard" && legs.length === 2
      ? legs.find(
          (leg) =>
            leg.accountType === "bank" &&
            leg.amount < 0 &&
            leg.categoryId === null,
        )
      : undefined;
  const positiveTaxSettlementLeg =
    transaction.kind === "standard" && legs.length === 2
      ? legs.find(
          (leg) =>
            leg.accountType === "tax_liability" &&
            leg.amount > 0 &&
            leg.categoryId === null,
        )
      : undefined;
  const taxSettlement =
    negativeTaxSettlementLeg !== undefined && positiveTaxSettlementLeg !== undefined;

  if ((transaction.kind === "transfer" || taxSettlement) && legs.length === 2) {
    const from = legs.find((leg) => leg.amount < 0);
    const to = legs.find((leg) => leg.amount > 0);
    if (!from || !to) return metadataOnly();
    if (taxSettlement) {
      const [referencedAccrual] = await db
        .select({ id: taxAccruals.id })
        .from(taxAccruals)
        .where(
          and(
            eq(taxAccruals.transactionId, transactionId),
            eq(taxAccruals.revision, transaction.currentRevision),
            isNull(taxAccruals.deletedAt),
          ),
        )
        .limit(1);
      if (referencedAccrual) return metadataOnly();
    }
    return {
      ...bookingContext,
      type: "transfer",
      editMode: taxSettlement ? "tax_settlement" : "transfer",
      transactionId,
      expectedRevision: transaction.currentRevision,
      fromAccountId: from.accountId,
      fromAccountName: from.accountName,
      fromAccountCurrency: from.accountCurrency,
      fromAccountType: from.accountType,
      toAccountId: to.accountId,
      toAccountName: to.accountName,
      toAccountCurrency: to.accountCurrency,
      toAccountType: to.accountType,
      date: transaction.date,
      amount: minorToInput(Math.abs(from.amount)),
      received: minorToInput(Math.abs(to.amount)),
      note: transaction.notes ?? "",
    };
  }

  if (transaction.kind === "opening_balance") {
    const accountLeg = legs.find((leg) => leg.accountType !== "equity");
    if (!accountLeg || legs.length !== 2) {
      return metadataOnly();
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
    if (!personal) return metadataOnly();
    if (transaction.kind === "salary") {
      if (
        legs.length !== 7 ||
        accrualRows.length !== 4 ||
        SALARY_RULE_TYPES.some(
          (ruleType) =>
            accrualRows.filter((row) => row.ruleType === ruleType && row.amount < 0).length !== 1,
        ) ||
        accrualRows.some(
          (row) =>
            !SALARY_RULE_TYPES.includes(
              row.ruleType as (typeof SALARY_RULE_TYPES)[number],
            ),
        )
      ) {
        return metadataOnly();
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
        return metadataOnly();
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

  const assetLegs = legs.filter(
    (leg) => leg.accountType !== "equity" && leg.accountType !== "tax_liability",
  );
  const taxLiabilityLegs = legs.filter((leg) => leg.accountType === "tax_liability");
  const equityLegs = legs.filter((leg) => leg.accountType === "equity");
  if (
    (transaction.kind !== "standard" && transaction.kind !== "trade") ||
    assetLegs.length !== 1 ||
    equityLegs.length === 0
  ) {
    return metadataOnly();
  }
  const bankLeg = assetLegs[0];
  let editableEquityLegs = equityLegs;
  if (taxLiabilityLegs.length > 0) {
    const microAccrualRows = await db
      .select({ postingId: taxAccruals.postingId, ruleType: taxRules.ruleType })
      .from(taxAccruals)
      .innerJoin(taxRules, eq(taxRules.id, taxAccruals.taxRuleId))
      .where(
        and(
          eq(taxAccruals.transactionId, transactionId),
          eq(taxAccruals.revision, transaction.currentRevision),
          isNull(taxAccruals.deletedAt),
        ),
      );
    const taxPostingIds = new Set(taxLiabilityLegs.map((leg) => leg.id));
    const accruedPostingIds = new Set(microAccrualRows.map((row) => row.postingId));
    const taxExpenseLegs = equityLegs.filter(
      (leg) => leg.categoryName === "Taxes" && leg.amountRon > 0,
    );
    editableEquityLegs = equityLegs.filter((leg) => !taxExpenseLegs.includes(leg));
    const liabilityRon = taxLiabilityLegs.reduce((sum, leg) => sum + leg.amountRon, 0);
    const expenseRon = taxExpenseLegs.reduce((sum, leg) => sum + leg.amountRon, 0);
    if (
      transaction.kind !== "standard" ||
      bankLeg.amount <= 0 ||
      taxLiabilityLegs.some((leg) => leg.amountRon >= 0) ||
      taxExpenseLegs.length !== 1 ||
      editableEquityLegs.length === 0 ||
      editableEquityLegs.some((leg) => leg.amountRon >= 0) ||
      liabilityRon + expenseRon !== 0 ||
      microAccrualRows.length !== taxLiabilityLegs.length ||
      accruedPostingIds.size !== taxLiabilityLegs.length ||
      microAccrualRows.some(
        (row) => row.ruleType !== "micro_revenue_tax" || !taxPostingIds.has(row.postingId),
      )
    ) {
      return metadataOnly();
    }
  }
  const total = Math.abs(bankLeg.amount);
  const equityRonTotal = editableEquityLegs.reduce(
    (sum, leg) => sum + Math.abs(leg.amountRon),
    0,
  );
  const splitAmounts = editableEquityLegs.map((leg) =>
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
    splits: editableEquityLegs.map((leg, index) => ({
      categoryId: leg.categoryId ?? "",
      amount: minorToInput(splitAmounts[index]),
    })),
    tagNames: tagRows.map((row) => row.name),
    counterparty: bankLeg.counterparty ?? "",
  };
}
