/**
 * Pure Romanian payroll/dividend arithmetic on integer minor units (bani).
 * Rates come from resolved tax_config windows (basis points) — nothing is
 * hardcoded here. NOTE: personal deductions and CASS income caps are NOT
 * modeled here; callers resolve those from tax_config where applicable.
 */

const bps = (amountMinor: number, rateBps: number): number =>
  Math.round((amountMinor * rateBps) / 10_000);

export interface SalaryRates {
  incomeTaxBps: number;
  casBps: number;
  cassBps: number;
  camBps: number;
}

export interface SalaryBreakdown {
  grossMinor: number;
  casMinor: number;
  cassMinor: number;
  /** Income tax applies to gross minus CAS and CASS (no personal deduction). */
  incomeTaxMinor: number;
  netMinor: number;
  camMinor: number;
  employerCostMinor: number;
  /** CAS + CASS + income tax + CAM — everything accrued as liability. */
  totalAccruedMinor: number;
}

/** @deprecated The live salary flow transcribes payslip values. Retained only
 * for legacy/tests until the separately scoped salary-calculator cleanup. */
export function computeSalary(grossMinor: number, rates: SalaryRates): SalaryBreakdown {
  const casMinor = bps(grossMinor, rates.casBps);
  const cassMinor = bps(grossMinor, rates.cassBps);
  const incomeTaxMinor = bps(grossMinor - casMinor - cassMinor, rates.incomeTaxBps);
  const netMinor = grossMinor - casMinor - cassMinor - incomeTaxMinor;
  const camMinor = bps(grossMinor, rates.camBps);
  return {
    grossMinor,
    casMinor,
    cassMinor,
    incomeTaxMinor,
    netMinor,
    camMinor,
    employerCostMinor: grossMinor + camMinor,
    totalAccruedMinor: casMinor + cassMinor + incomeTaxMinor + camMinor,
  };
}

export interface DividendBreakdown {
  grossMinor: number;
  withholdingTaxMinor: number;
  netMinor: number;
  /** CASS on dividends is an ESTIMATE: the annual-bracket amount for the
   * basis at booking time, trued up via the annual tax return. */
  cassEstimateMinor: number;
}

/** Withholding is computed here (same integer rounding as always); the CASS
 * estimate arrives pre-resolved from the tax_config bracket set (U3 cutover)
 * and passes through unchanged. */
export function computeDividend(
  grossMinor: number,
  dividendTaxBps: number,
  cassEstimateMinor: number,
): DividendBreakdown {
  const withholdingTaxMinor = bps(grossMinor, dividendTaxBps);
  return {
    grossMinor,
    withholdingTaxMinor,
    netMinor: grossMinor - withholdingTaxMinor,
    cassEstimateMinor,
  };
}
