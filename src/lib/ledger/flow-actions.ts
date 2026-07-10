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
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, entities } from "@/db/schema";
import {
  createTransaction,
  LedgerValidationError,
  type AccrualInput,
  type PostingInput,
} from "@/lib/ledger";
import { toAppError, type AppError } from "@/lib/app-error";
import { computeDividend, computeSalary } from "@/lib/tax/compute";
import { getActiveRule, quarterOf, yearOf, type ActiveRule } from "@/lib/tax/rules";
import { profileForEntity } from "@/lib/profiles";

/** Companies map 1:1 to profiles, so the post-save view derives from the id. */
function companyTransactionsPath(companyId: string): string {
  const profile = profileForEntity(companyId);
  if (!profile) throw new LedgerValidationError("profile.unknownCompany");
  return `/p/${profile.slug}/transactions`;
}

export interface SalaryFlowPayload {
  companyId: string;
  employeeName: string;
  /** YYYY-MM */
  month: string;
  grossMinor: number;
  /** Household account that receives the net salary. */
  personalAccountId: string;
}

export interface DividendFlowPayload {
  companyId: string;
  date: string;
  grossMinor: number;
  personalAccountId: string;
}

type ActionResult = { error: AppError };

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

async function loadSalaryRules(date: string) {
  const [incomeTax, cas, cass, cam] = await Promise.all([
    getActiveRule("salary_income_tax", date),
    getActiveRule("salary_cas", date),
    getActiveRule("salary_cass", date),
    getActiveRule("cam", date),
  ]);
  return { incomeTax, cas, cass, cam };
}

export interface SalaryPreview {
  date: string;
  gross: number;
  cas: number;
  cass: number;
  incomeTax: number;
  net: number;
  cam: number;
  employerCost: number;
  totalAccrued: number;
  rateNote: string;
}

export async function previewSalary(
  payload: Pick<SalaryFlowPayload, "month" | "grossMinor">,
): Promise<SalaryPreview | ActionResult> {
  try {
    const date = monthEndDate(payload.month);
    const rules = await loadSalaryRules(date);
    const b = computeSalary(payload.grossMinor, {
      incomeTaxBps: rules.incomeTax.rateBps,
      casBps: rules.cas.rateBps,
      cassBps: rules.cass.rateBps,
      camBps: rules.cam.rateBps,
    });
    return {
      date,
      gross: b.grossMinor,
      cas: b.casMinor,
      cass: b.cassMinor,
      incomeTax: b.incomeTaxMinor,
      net: b.netMinor,
      cam: b.camMinor,
      employerCost: b.employerCostMinor,
      totalAccrued: b.totalAccruedMinor,
      rateNote: `Rates: income tax ${rules.incomeTax.rateBps / 100}%, CAS ${rules.cas.rateBps / 100}%, CASS ${rules.cass.rateBps / 100}%, CAM ${rules.cam.rateBps / 100}% (placeholder values — confirm before relying on them)`,
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
    if (!Number.isSafeInteger(payload.grossMinor) || payload.grossMinor <= 0) {
      throw new LedgerValidationError("flows.grossAmountPositive");
    }
    const date = monthEndDate(payload.month);
    const { company, bank, taxLiability, equity } = await loadCompanyAccounts(payload.companyId);
    const rules = await loadSalaryRules(date);
    const b = computeSalary(payload.grossMinor, {
      incomeTaxBps: rules.incomeTax.rateBps,
      casBps: rules.cas.rateBps,
      cassBps: rules.cass.rateBps,
      camBps: rules.cam.rateBps,
    });

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

    const taxLegs: { rule: ActiveRule; amount: number }[] = [
      { rule: rules.cas, amount: b.casMinor },
      { rule: rules.cass, amount: b.cassMinor },
      { rule: rules.incomeTax, amount: b.incomeTaxMinor },
      { rule: rules.cam, amount: b.camMinor },
    ].filter((leg) => leg.amount !== 0);

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

    await createTransaction({
      entityId: payload.companyId,
      date,
      description: `Salary ${payload.employeeName.trim()} ${payload.month}`,
      kind: "salary",
      postings: postingInputs,
      accruals,
    });
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
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
): Promise<DividendPreview | ActionResult> {
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

    await createTransaction({
      entityId: payload.companyId,
      date: payload.date,
      description: `Dividend distribution ${payload.date}`,
      kind: "dividend",
      postings: postingInputs,
      accruals,
    });
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
  redirect(companyTransactionsPath(payload.companyId));
}
