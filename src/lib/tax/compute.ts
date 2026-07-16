/**
 * Pure Romanian payroll/dividend arithmetic on integer minor units (bani).
 * Rates come from tax_rules rows (basis points) — nothing is hardcoded here.
 * NOTE: personal deductions and CASS income caps are NOT modeled; the seeded
 * rules carry placeholder rates. Results are estimates until rates and rules
 * are confirmed.
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
  /** CASS on dividends is an ESTIMATE: the real base is capped in
   * minimum-wage multiples and settled via the annual tax return. */
  cassEstimateMinor: number;
}

export function computeDividend(
  grossMinor: number,
  dividendTaxBps: number,
  cassBps: number,
): DividendBreakdown {
  const withholdingTaxMinor = bps(grossMinor, dividendTaxBps);
  return {
    grossMinor,
    withholdingTaxMinor,
    netMinor: grossMinor - withholdingTaxMinor,
    cassEstimateMinor: bps(grossMinor, cassBps),
  };
}
