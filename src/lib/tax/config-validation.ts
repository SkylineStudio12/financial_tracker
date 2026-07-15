import { taxConfigParameter, taxConfigValueKind } from "@/db/schema";
import { LedgerValidationError } from "@/lib/ledger";

export type TaxConfigParameter = (typeof taxConfigParameter.enumValues)[number];
export type TaxConfigValueKind = (typeof taxConfigValueKind.enumValues)[number];

export const TAX_CONFIG_VALUE_KIND = {
  cas_employee_rate: "rate_bps",
  cass_employee_rate: "rate_bps",
  cam_employer_rate: "rate_bps",
  income_tax_rate: "rate_bps",
  dividend_tax_rate: "rate_bps",
  minimum_wage: "amount_minor",
  personal_deduction: "amount_minor",
  cass_investment_brackets: "bracket_set",
} as const satisfies Record<TaxConfigParameter, TaxConfigValueKind>;

export interface TaxConfigWindowInput {
  parameter: TaxConfigParameter;
  valueKind: TaxConfigValueKind;
  rateBps: number | null;
  amountMinor: number | null;
  validFrom: string;
  validTo: string | null;
  source: string;
}

export interface CassInvestmentBracketInput {
  ordinal: number;
  lowerMinor: number;
  upperMinor: number | null;
  baseMinor: number;
  cassMinor: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertTaxDate(date: string): void {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !DATE_RE.test(date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new LedgerValidationError("tax.configValueInvalid", { field: "date", value: date });
  }
}

function invalidWindow(parameter: TaxConfigParameter, reason: string): never {
  throw new LedgerValidationError("tax.configWindowInvalid", { parameter, reason });
}

/** Validate complete in-memory series before a seed or future settings write. */
export function assertTaxConfigWindows(rows: readonly TaxConfigWindowInput[]): void {
  const byParameter = new Map<TaxConfigParameter, TaxConfigWindowInput[]>();

  for (const row of rows) {
    assertTaxDate(row.validFrom);
    if (row.validTo !== null) assertTaxDate(row.validTo);
    if (!row.source.trim()) invalidWindow(row.parameter, "source is blank");
    if (row.valueKind !== TAX_CONFIG_VALUE_KIND[row.parameter]) {
      invalidWindow(row.parameter, "value kind does not match parameter");
    }
    if (row.valueKind === "rate_bps") {
      if (!Number.isInteger(row.rateBps) || row.rateBps! < 0 || row.rateBps! > 10_000) {
        invalidWindow(row.parameter, "rate is outside 0..10000 basis points");
      }
      if (row.amountMinor !== null) invalidWindow(row.parameter, "rate row has an amount");
    } else if (row.valueKind === "amount_minor") {
      if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor! < 0) {
        invalidWindow(row.parameter, "amount is not a non-negative safe integer");
      }
      if (row.rateBps !== null) invalidWindow(row.parameter, "amount row has a rate");
    } else if (row.rateBps !== null || row.amountMinor !== null) {
      invalidWindow(row.parameter, "bracket set has a scalar value");
    }
    if (row.validTo !== null && row.validTo <= row.validFrom) {
      invalidWindow(row.parameter, "window end is not after its start");
    }
    const series = byParameter.get(row.parameter) ?? [];
    series.push(row);
    byParameter.set(row.parameter, series);
  }

  for (const [parameter, series] of byParameter) {
    series.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    for (let index = 0; index < series.length; index += 1) {
      const current = series[index];
      const next = series[index + 1];
      if (next) {
        if (current.validTo !== next.validFrom) {
          invalidWindow(parameter, "adjacent windows are gapped or overlapping");
        }
      } else if (current.validTo !== null) {
        invalidWindow(parameter, "final window is not open-ended");
      }
    }
  }
}

export function assertCassInvestmentBrackets(
  rows: readonly CassInvestmentBracketInput[],
): void {
  const ordered = [...rows].sort((a, b) => a.ordinal - b.ordinal);
  if (ordered.length === 0) {
    throw new LedgerValidationError("tax.configValueInvalid", {
      field: "cassInvestmentBrackets",
      value: "empty",
    });
  }
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    const values = [current.lowerMinor, current.baseMinor, current.cassMinor];
    if (
      current.ordinal !== index ||
      values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      (current.upperMinor !== null &&
        (!Number.isSafeInteger(current.upperMinor) || current.upperMinor <= current.lowerMinor)) ||
      (index === 0 && current.lowerMinor !== 0) ||
      (next ? current.upperMinor !== next.lowerMinor : current.upperMinor !== null)
    ) {
      throw new LedgerValidationError("tax.configValueInvalid", {
        field: "cassInvestmentBrackets",
        value: `ordinal ${current.ordinal}`,
      });
    }
  }
}
