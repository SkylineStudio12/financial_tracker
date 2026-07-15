import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { taxConfig } from "@/db/schema";
import { LedgerValidationError } from "@/lib/ledger";
import {
  assertTaxDate,
  type TaxConfigParameter,
  type TaxConfigValueKind,
} from "./config-validation";

type TaxClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type TaxConfigStatus = "confirmed" | "estimate";

export interface ResolvedTaxConfig {
  id: string;
  parameter: TaxConfigParameter;
  valueKind: TaxConfigValueKind;
  rateBps: number | null;
  amountMinor: number | null;
  validFrom: string;
  validTo: string | null;
  status: TaxConfigStatus;
  source: string;
}

export interface AppliedTaxConfig {
  id: string;
  parameter: TaxConfigParameter;
  status: TaxConfigStatus;
  source: string;
}

/** Resolve only an exact half-open window; never fall back to a nearby row. */
export async function resolveTaxConfig(
  parameter: TaxConfigParameter,
  date: string,
  client: TaxClient = db,
): Promise<ResolvedTaxConfig> {
  assertTaxDate(date);
  const rows = await client
    .select({
      id: taxConfig.id,
      parameter: taxConfig.parameter,
      valueKind: taxConfig.valueKind,
      rateBps: taxConfig.rateBps,
      amountMinor: taxConfig.amountMinor,
      validFrom: taxConfig.validFrom,
      validTo: taxConfig.validTo,
      status: taxConfig.status,
      source: taxConfig.source,
    })
    .from(taxConfig)
    .where(
      and(
        eq(taxConfig.parameter, parameter),
        lte(taxConfig.validFrom, date),
        or(isNull(taxConfig.validTo), gt(taxConfig.validTo, date)),
      ),
    )
    .orderBy(asc(taxConfig.validFrom))
    .limit(2);

  if (rows.length === 0) {
    throw new LedgerValidationError("tax.configCoverageMissing", { parameter, date });
  }
  if (rows.length !== 1) {
    throw new LedgerValidationError("tax.configWindowInvalid", {
      parameter,
      reason: "multiple rows cover the date",
    });
  }
  return rows[0];
}

function requireRate(row: ResolvedTaxConfig): number {
  if (row.valueKind !== "rate_bps" || row.rateBps === null) {
    throw new LedgerValidationError("tax.configValueInvalid", {
      field: row.parameter,
      value: row.valueKind,
    });
  }
  return row.rateBps;
}

function requireAmount(row: ResolvedTaxConfig): number {
  if (row.valueKind !== "amount_minor" || row.amountMinor === null) {
    throw new LedgerValidationError("tax.configValueInvalid", {
      field: row.parameter,
      value: row.valueKind,
    });
  }
  return row.amountMinor;
}

function metadata(row: ResolvedTaxConfig): AppliedTaxConfig {
  return { id: row.id, parameter: row.parameter, status: row.status, source: row.source };
}

function aggregateStatus(rows: readonly ResolvedTaxConfig[]): TaxConfigStatus {
  return rows.some((row) => row.status === "estimate") ? "estimate" : "confirmed";
}

function assertPositiveMinor(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new LedgerValidationError("tax.calculationInputInvalid", { field, value });
  }
}

/** Exact arithmetic half-up to whole RON; contribution minimum is opt-in. */
export function roundTaxRateToWholeRonMinor(
  amountMinor: number,
  rateBps: number,
  minimumOneRon: boolean,
): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !Number.isInteger(rateBps)) {
    throw new LedgerValidationError("tax.calculationInputInvalid", {
      field: "rateCalculation",
      value: `${amountMinor}:${rateBps}`,
    });
  }
  const denominator = 1_000_000n;
  const numerator = BigInt(amountMinor) * BigInt(rateBps);
  let wholeRon = (numerator + denominator / 2n) / denominator;
  if (minimumOneRon && numerator > 0n && wholeRon === 0n) wholeRon = 1n;
  const result = wholeRon * 100n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new LedgerValidationError("tax.calculationInputInvalid", {
      field: "rateCalculation",
      value: "result exceeds safe integer range",
    });
  }
  return Number(result);
}

export interface SalaryTaxResult {
  grossMinor: number;
  casMinor: number;
  cassMinor: number;
  camMinor: number;
  personalDeductionMinor: number;
  taxableBaseMinor: number;
  incomeTaxMinor: number;
  status: TaxConfigStatus;
  appliedConfig: AppliedTaxConfig[];
}

export async function calculateSalary(input: {
  grossMinor: number;
  payPeriodDate: string;
  isBaseFunction: boolean;
  dependents: number;
}): Promise<SalaryTaxResult> {
  assertPositiveMinor(input.grossMinor, "grossMinor");
  if (!Number.isInteger(input.dependents) || input.dependents < 0) {
    throw new LedgerValidationError("tax.calculationInputInvalid", {
      field: "dependents",
      value: input.dependents,
    });
  }

  return db.transaction(
    async (tx) => {
      // The pay-period date, not the booking timestamp, drives every salary parameter.
      // Resolve deduction first: before 2026-05-01 the intended failure is coverage-missing.
      const deduction = await resolveTaxConfig("personal_deduction", input.payPeriodDate, tx);
      if (input.grossMinor !== 450_000 || !input.isBaseFunction || input.dependents !== 0) {
        throw new LedgerValidationError("tax.personalDeductionContextUnsupported", {
          grossMinor: input.grossMinor,
          isBaseFunction: String(input.isBaseFunction),
          dependents: input.dependents,
        });
      }

      const cas = await resolveTaxConfig("cas_employee_rate", input.payPeriodDate, tx);
      const cass = await resolveTaxConfig("cass_employee_rate", input.payPeriodDate, tx);
      const cam = await resolveTaxConfig("cam_employer_rate", input.payPeriodDate, tx);
      const incomeTax = await resolveTaxConfig("income_tax_rate", input.payPeriodDate, tx);
      const personalDeductionMinor = requireAmount(deduction);
      const casMinor = roundTaxRateToWholeRonMinor(input.grossMinor, requireRate(cas), true);
      const cassMinor = roundTaxRateToWholeRonMinor(input.grossMinor, requireRate(cass), true);
      const camMinor = roundTaxRateToWholeRonMinor(input.grossMinor, requireRate(cam), true);
      const taxableBaseMinor = Math.max(
        0,
        input.grossMinor - casMinor - cassMinor - personalDeductionMinor,
      );
      const incomeTaxMinor = roundTaxRateToWholeRonMinor(
        taxableBaseMinor,
        requireRate(incomeTax),
        false,
      );
      const rows = [cas, cass, cam, incomeTax, deduction];

      return {
        grossMinor: input.grossMinor,
        casMinor,
        cassMinor,
        camMinor,
        personalDeductionMinor,
        taxableBaseMinor,
        incomeTaxMinor,
        status: aggregateStatus(rows),
        appliedConfig: rows.map(metadata),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export interface DividendTaxResult {
  grossDividendMinor: number;
  taxMinor: number;
  netMinor: number;
  status: TaxConfigStatus;
  appliedConfig: AppliedTaxConfig;
}

export async function calculateDividendTax(input: {
  grossDividendMinor: number;
  distributionDate: string;
}): Promise<DividendTaxResult> {
  assertPositiveMinor(input.grossDividendMinor, "grossDividendMinor");
  // The distribution date, not declaration or payment-booking time, drives the rate.
  const row = await resolveTaxConfig("dividend_tax_rate", input.distributionDate);
  // Whole-leu rounding follows ANAF D100 material; accountant confirmation remains open.
  const taxMinor = roundTaxRateToWholeRonMinor(
    input.grossDividendMinor,
    requireRate(row),
    false,
  );
  return {
    grossDividendMinor: input.grossDividendMinor,
    taxMinor,
    netMinor: input.grossDividendMinor - taxMinor,
    status: row.status,
    appliedConfig: metadata(row),
  };
}
