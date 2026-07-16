"use server";

/**
 * Guided-flow server actions: salary, dividend, and their previews.
 *
 * Posting shape (extends the agreed equity-balancing model):
 * - company bank −net, personal (household) bank +net — the cash movement
 * - one tax_liability leg per rule, NEGATIVE = amount owed to the state
 * - one company equity leg balancing the accrued taxes
 * Zero-sum holds; paying taxes later (bank −T, tax_liability +T) brings the
 * liability account back toward zero.
 */
import { redirect } from "next/navigation";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, entities, taxRules } from "@/db/schema";
import {
  createTransaction,
  updateTransaction,
  LedgerValidationError,
  type AccrualInput,
  type PostingInput,
} from "@/lib/ledger";
import { toAppError, type AppError } from "@/lib/app-error";
import { computeDividend } from "@/lib/tax/compute";
import { getActiveRule, quarterOf, yearOf } from "@/lib/tax/rules";
import { profileForEntity } from "@/lib/profiles";
import { getLastCompleteSalaryDraft, type SalaryDraft } from "./edit-drafts";

/** Companies map 1:1 to profiles, so the post-save view derives from the id. */
function companyTransactionsPath(companyId: string): string {
  const profile = profileForEntity(companyId);
  if (!profile) throw new LedgerValidationError("profile.unknownCompany");
  return `/p/${profile.slug}/transactions`;
}

export interface SalaryFlowPayload {
  transactionId?: string;
  expectedRevision?: number;
  stay?: boolean;
  companyId: string;
  employeeName: string;
  /** YYYY-MM */
  month: string;
  grossMinor: number;
  casMinor: number;
  cassMinor: number;
  incomeTaxMinor: number;
  camMinor: number;
  netMinor: number;
  personalDeductionMinor: number;
  /** Household account that receives the net salary. */
  personalAccountId: string;
}

export interface DividendFlowPayload {
  transactionId?: string;
  expectedRevision?: number;
  stay?: boolean;
  companyId: string;
  date: string;
  grossMinor: number;
  personalAccountId: string;
}

type ActionResult = { error: AppError } | { ok: true };

/** Salaries are dated on the last day of the selected month. */
function monthEndDate(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new LedgerValidationError("flows.invalidMonth", { month });
  }
  const [year, monthNumber] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

async function loadCompanyAccounts(companyId: string) {
  const [company] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.id, companyId), eq(entities.type, "company"), isNull(entities.deletedAt)));
  if (!company) throw new LedgerValidationError("flows.notCompanyEntity");

  const companyAccounts = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.entityId, companyId), isNull(accounts.deletedAt)));
  const bank = companyAccounts.find((a) => a.type === "bank" && a.isActive);
  const taxLiability = companyAccounts.find((a) => a.type === "tax_liability" && a.isActive);
  const equity = companyAccounts.find((a) => a.type === "equity" && a.isActive);
  if (!bank || !taxLiability || !equity) {
    throw new LedgerValidationError("flows.companyAccountsMissing");
  }
  return { company, bank, taxLiability, equity };
}

type SalaryRuleType = "salary_income_tax" | "salary_cas" | "salary_cass" | "cam";
type SalaryRuleId = { id: string; ruleType: SalaryRuleType };

async function loadSalaryRuleIds(date: string): Promise<Record<SalaryRuleType, SalaryRuleId>> {
  const rows = await db
    .select({ id: taxRules.id, ruleType: taxRules.ruleType })
    .from(taxRules)
    .where(
      and(
        isNull(taxRules.deletedAt),
        lte(taxRules.validFrom, date),
        or(isNull(taxRules.validTo), gte(taxRules.validTo, date)),
      ),
    )
    .orderBy(desc(taxRules.validFrom));
  const result = {} as Record<SalaryRuleType, SalaryRuleId>;
  for (const type of ["salary_income_tax", "salary_cas", "salary_cass", "cam"] as const) {
    const row = rows.find((candidate) => candidate.ruleType === type);
    if (!row) throw new LedgerValidationError("tax.taxRuleMissing", { type, date });
    result[type] = { id: row.id, ruleType: type };
  }
  return result;
}

export interface SalaryPreview {
  date: string;
  gross: number;
  cas: number;
  cass: number;
  incomeTax: number;
  net: number;
  cam: number;
  personalDeduction: number;
  employerCost: number;
  totalAccrued: number;
}

type EnteredSalaryAmounts = Pick<
  SalaryFlowPayload,
  | "grossMinor"
  | "casMinor"
  | "cassMinor"
  | "incomeTaxMinor"
  | "camMinor"
  | "netMinor"
  | "personalDeductionMinor"
>;

function validateEnteredSalary(payload: EnteredSalaryAmounts) {
  const positive = [
    ["gross", payload.grossMinor],
    ["cas", payload.casMinor],
    ["cass", payload.cassMinor],
    ["incomeTax", payload.incomeTaxMinor],
    ["cam", payload.camMinor],
    ["net", payload.netMinor],
  ] as const;
  for (const [field, value] of positive) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new LedgerValidationError("flows.salaryAmountInvalid", { field });
    }
  }
  if (
    !Number.isSafeInteger(payload.personalDeductionMinor) ||
    payload.personalDeductionMinor < 0
  ) {
    throw new LedgerValidationError("flows.salaryAmountInvalid", {
      field: "personalDeduction",
    });
  }
  const expectedNet =
    payload.grossMinor - payload.casMinor - payload.cassMinor - payload.incomeTaxMinor;
  if (payload.netMinor !== expectedNet) {
    throw new LedgerValidationError("flows.salaryNetMismatch", {
      expected: expectedNet,
      actual: payload.netMinor,
    });
  }
  return {
    grossMinor: payload.grossMinor,
    casMinor: payload.casMinor,
    cassMinor: payload.cassMinor,
    incomeTaxMinor: payload.incomeTaxMinor,
    netMinor: payload.netMinor,
    camMinor: payload.camMinor,
    employerCostMinor: payload.grossMinor + payload.camMinor,
    totalAccruedMinor:
      payload.casMinor + payload.cassMinor + payload.incomeTaxMinor + payload.camMinor,
  };
}

export async function previewSalary(
  payload: Pick<
    SalaryFlowPayload,
    | "month"
    | "grossMinor"
    | "casMinor"
    | "cassMinor"
    | "incomeTaxMinor"
    | "camMinor"
    | "netMinor"
    | "personalDeductionMinor"
  >,
): Promise<SalaryPreview | { error: AppError }> {
  try {
    const date = monthEndDate(payload.month);
    const b = validateEnteredSalary(payload);
    return {
      date,
      gross: b.grossMinor,
      cas: b.casMinor,
      cass: b.cassMinor,
      incomeTax: b.incomeTaxMinor,
      net: b.netMinor,
      cam: b.camMinor,
      personalDeduction: payload.personalDeductionMinor,
      employerCost: b.employerCostMinor,
      totalAccrued: b.totalAccruedMinor,
    };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export type SalaryRepeatPrefill = Pick<
  SalaryDraft,
  | "employeeName"
  | "month"
  | "gross"
  | "cas"
  | "cass"
  | "incomeTax"
  | "cam"
  | "net"
  | "personalDeduction"
  | "personalAccountId"
>;

export async function repeatLastSalary(
  companyId: string,
  employeeName: string,
): Promise<SalaryRepeatPrefill | { error: AppError } | null> {
  try {
    const draft = await getLastCompleteSalaryDraft(companyId, employeeName);
    if (!draft) return null;
    return {
      employeeName: draft.employeeName,
      month: draft.month,
      gross: draft.gross,
      cas: draft.cas,
      cass: draft.cass,
      incomeTax: draft.incomeTax,
      cam: draft.cam,
      net: draft.net,
      personalDeduction: draft.personalDeduction,
      personalAccountId: draft.personalAccountId,
    };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export async function saveSalary(payload: SalaryFlowPayload): Promise<ActionResult | undefined> {
  try {
    if (!payload.employeeName.trim()) throw new LedgerValidationError("flows.employeeNameRequired");
    const date = monthEndDate(payload.month);
    const { company, bank, taxLiability, equity } = await loadCompanyAccounts(payload.companyId);
    const rules = await loadSalaryRuleIds(date);
    const b = validateEnteredSalary(payload);

    // Salaries category for the equity (expense) leg, if the company has one.
    const [salariesCategory] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.entityId, payload.companyId),
          eq(categories.name, "Salaries"),
          isNull(categories.deletedAt),
        ),
      );

    const taxLegs: { rule: SalaryRuleId; amount: number }[] = [
      { rule: rules.salary_cas, amount: b.casMinor },
      { rule: rules.salary_cass, amount: b.cassMinor },
      { rule: rules.salary_income_tax, amount: b.incomeTaxMinor },
      { rule: rules.cam, amount: b.camMinor },
    ];

    const postingInputs: PostingInput[] = [
      { accountId: bank.id, amount: -b.netMinor, counterparty: payload.employeeName.trim() },
      {
        accountId: payload.personalAccountId,
        amount: b.netMinor,
        counterparty: company.name,
      },
      ...taxLegs.map((leg) => ({ accountId: taxLiability.id, amount: -leg.amount })),
      {
        accountId: equity.id,
        amount: b.totalAccruedMinor,
        categoryId: salariesCategory?.id ?? null,
      },
    ];
    const accruals: AccrualInput[] = taxLegs.map((leg, index) => ({
      postingIndex: 2 + index,
      taxRuleId: leg.rule.id,
      year: yearOf(date),
      quarter: quarterOf(date),
    }));

    const input = {
      entityId: payload.companyId,
      date,
      description: `Salary ${payload.employeeName.trim()} ${payload.month}`,
      kind: "salary",
      postings: postingInputs,
      accruals,
      salaryDetail: {
        personalDeductionMinor: payload.personalDeductionMinor,
      },
    } as const;
    if (payload.transactionId) {
      await updateTransaction(payload.transactionId, input, payload.expectedRevision);
    } else {
      await createTransaction(input);
    }
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
  if (payload.stay) return { ok: true };
  redirect(companyTransactionsPath(payload.companyId));
}

export interface DividendPreview {
  gross: number;
  withholdingTax: number;
  net: number;
  cassEstimate: number;
  rateNote: string;
}

export async function previewDividend(
  payload: Pick<DividendFlowPayload, "date" | "grossMinor">,
): Promise<DividendPreview | { error: AppError }> {
  try {
    const dividendRule = await getActiveRule("dividend_tax", payload.date);
    const cassRule = await getActiveRule("cass_dividend", payload.date);
    const b = computeDividend(payload.grossMinor, dividendRule.rateBps, cassRule.rateBps);
    return {
      gross: b.grossMinor,
      withholdingTax: b.withholdingTaxMinor,
      net: b.netMinor,
      cassEstimate: b.cassEstimateMinor,
      rateNote: `Rates: dividend tax ${dividendRule.rateBps / 100}%, CASS ${cassRule.rateBps / 100}% of gross as a rough ESTIMATE (real CASS is capped in minimum-wage multiples; placeholder values — confirm)`,
    };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export async function saveDividend(payload: DividendFlowPayload): Promise<ActionResult | undefined> {
  try {
    if (!Number.isSafeInteger(payload.grossMinor) || payload.grossMinor <= 0) {
      throw new LedgerValidationError("flows.grossAmountPositive");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
      throw new LedgerValidationError("flows.invalidDate", { date: payload.date });
    }
    const { company, bank, taxLiability, equity } = await loadCompanyAccounts(payload.companyId);
    const dividendRule = await getActiveRule("dividend_tax", payload.date);
    const cassRule = await getActiveRule("cass_dividend", payload.date);
    const b = computeDividend(payload.grossMinor, dividendRule.rateBps, cassRule.rateBps);

    const postingInputs: PostingInput[] = [
      { accountId: bank.id, amount: -b.netMinor, counterparty: "Shareholder" },
      { accountId: payload.personalAccountId, amount: b.netMinor, counterparty: company.name },
      { accountId: taxLiability.id, amount: -b.withholdingTaxMinor },
      // Clearly-labeled ESTIMATE: real CASS is settled via the annual return.
      { accountId: taxLiability.id, amount: -b.cassEstimateMinor, counterparty: "ESTIMATE" },
      { accountId: equity.id, amount: b.withholdingTaxMinor + b.cassEstimateMinor },
    ];
    const accruals: AccrualInput[] = [
      {
        postingIndex: 2,
        taxRuleId: dividendRule.id,
        year: yearOf(payload.date),
        quarter: quarterOf(payload.date),
      },
      {
        postingIndex: 3,
        taxRuleId: cassRule.id,
        year: yearOf(payload.date),
        quarter: null, // CASS on dividends settles annually
      },
    ];

    const input = {
      entityId: payload.companyId,
      date: payload.date,
      description: `Dividend distribution ${payload.date}`,
      kind: "dividend",
      postings: postingInputs,
      accruals,
    } as const;
    if (payload.transactionId) {
      await updateTransaction(payload.transactionId, input, payload.expectedRevision);
    } else {
      await createTransaction(input);
    }
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
  if (payload.stay) return { ok: true };
  redirect(companyTransactionsPath(payload.companyId));
}
