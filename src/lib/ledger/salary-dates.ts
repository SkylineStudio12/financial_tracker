import { LedgerValidationError } from "@/lib/app-error";

const PAY_MONTH_RE = /^(\d{4})-(\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parsePayMonth(payMonth: string): { year: number; month: number } | null {
  const match = PAY_MONTH_RE.exec(payMonth);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

export function defaultSalaryPaymentDate(payMonth: string): string {
  const parsed = parsePayMonth(payMonth);
  if (!parsed) return "";
  const date = new Date(Date.UTC(parsed.year, parsed.month, 10));
  return date.toISOString().slice(0, 10);
}

export function salaryPaymentDateAfterPayMonthChange(
  payMonth: string,
  currentPaymentDate: string,
  paymentDateTouched: boolean,
): string {
  return paymentDateTouched ? currentPaymentDate : defaultSalaryPaymentDate(payMonth);
}

export function salaryPeriod(payMonth: string): {
  payMonthDate: string;
  anchorDate: string;
  year: number;
  quarter: number;
} {
  const parsed = parsePayMonth(payMonth);
  if (!parsed) {
    throw new LedgerValidationError("flows.invalidMonth", { month: payMonth });
  }
  const lastDay = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
  return {
    payMonthDate: `${payMonth}-01`,
    anchorDate: `${payMonth}-${String(lastDay).padStart(2, "0")}`,
    year: parsed.year,
    quarter: Math.floor((parsed.month - 1) / 3) + 1,
  };
}

export function validateSalaryPaymentDate(paymentDate: string): string {
  if (!DATE_RE.test(paymentDate)) {
    throw new LedgerValidationError("flows.invalidPaymentDate", { date: paymentDate });
  }
  const parsed = new Date(`${paymentDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== paymentDate) {
    throw new LedgerValidationError("flows.invalidPaymentDate", { date: paymentDate });
  }
  return paymentDate;
}
