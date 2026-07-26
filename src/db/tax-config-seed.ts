import type { db } from "./index";
import { taxConfig, taxConfigCassInvestmentBrackets } from "./schema";
import {
  assertCassInvestmentBrackets,
  assertTaxConfigWindows,
  type CassInvestmentBracketInput,
  type TaxConfigWindowInput,
} from "@/lib/tax/config-validation";

type SeedTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PAYSLIP_SOURCE = "payslip Skyline 2026-05";
const ACCOUNTANT_SOURCE = "artifact 2 accountant 2026-07";

/** The ruled 2026 set (20-05/20-08), value-for-value identical to
 * drizzle/seed/tax-config-2026.sql — the test suite exercises the SAME
 * config live holds. Statuses per Ruling 4: income tax and the personal
 * deduction stay `estimate` while the base calc is open with the
 * accountant; CASS investment brackets are `estimate` per R3. */
export const TAX_CONFIG_2026_SEED = [
  { parameter: "cas_employee_rate", valueKind: "rate_bps", rateBps: 2500, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: PAYSLIP_SOURCE },
  { parameter: "cass_employee_rate", valueKind: "rate_bps", rateBps: 1000, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: PAYSLIP_SOURCE },
  { parameter: "cam_employer_rate", valueKind: "rate_bps", rateBps: 225, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: PAYSLIP_SOURCE },
  { parameter: "income_tax_rate", valueKind: "rate_bps", rateBps: 1000, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "estimate", source: PAYSLIP_SOURCE },
  { parameter: "dividend_tax_rate", valueKind: "rate_bps", rateBps: 1600, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: ACCOUNTANT_SOURCE },
  { parameter: "micro_revenue_tax", valueKind: "rate_bps", rateBps: 100, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: ACCOUNTANT_SOURCE },
  { parameter: "minimum_wage", valueKind: "amount_minor", rateBps: null, amountMinor: 405_000, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: ACCOUNTANT_SOURCE },
  { parameter: "personal_deduction", valueKind: "amount_minor", rateBps: null, amountMinor: 62_800, validFrom: "2026-01-01", validTo: null, status: "estimate", source: ACCOUNTANT_SOURCE },
  { parameter: "cass_investment_brackets", valueKind: "bracket_set", rateBps: null, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "estimate", source: ACCOUNTANT_SOURCE },
] as const satisfies readonly (TaxConfigWindowInput & { status: "confirmed" | "estimate" })[];

/** Bounds and bases are deliberately independent facts, even where equal in 2026. */
export const CASS_INVESTMENT_BRACKETS_2026 = [
  { ordinal: 0, lowerMinor: 0, upperMinor: 2_430_000, baseMinor: 0, cassMinor: 0 },
  { ordinal: 1, lowerMinor: 2_430_000, upperMinor: 4_860_000, baseMinor: 2_430_000, cassMinor: 243_000 },
  { ordinal: 2, lowerMinor: 4_860_000, upperMinor: 9_720_000, baseMinor: 4_860_000, cassMinor: 486_000 },
  { ordinal: 3, lowerMinor: 9_720_000, upperMinor: null, baseMinor: 9_720_000, cassMinor: 972_000 },
] as const satisfies readonly CassInvestmentBracketInput[];

export async function seedTaxConfig2026(tx: SeedTx): Promise<void> {
  assertTaxConfigWindows(TAX_CONFIG_2026_SEED);
  assertCassInvestmentBrackets(CASS_INVESTMENT_BRACKETS_2026);

  const inserted = await tx.insert(taxConfig).values([...TAX_CONFIG_2026_SEED]).returning({
    id: taxConfig.id,
    parameter: taxConfig.parameter,
  });
  const bracketParent = inserted.find((row) => row.parameter === "cass_investment_brackets");
  if (!bracketParent) throw new Error("Investment CASS bracket parent was not seeded");
  await tx.insert(taxConfigCassInvestmentBrackets).values(
    CASS_INVESTMENT_BRACKETS_2026.map((row) => ({
      taxConfigId: bracketParent.id,
      ...row,
    })),
  );
}
