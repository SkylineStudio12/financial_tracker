import type { db } from "./index";
import { taxConfig, taxConfigCassInvestmentBrackets } from "./schema";
import {
  assertCassInvestmentBrackets,
  assertTaxConfigWindows,
  type CassInvestmentBracketInput,
  type TaxConfigWindowInput,
} from "@/lib/tax/config-validation";

type SeedTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ACCOUNTANT_SOURCE = "accountant letter 2026-07";

export const CONFIRMED_TAX_CONFIG_SEED = [
  { parameter: "cas_employee_rate", valueKind: "rate_bps", rateBps: 2500, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: ACCOUNTANT_SOURCE },
  { parameter: "cass_employee_rate", valueKind: "rate_bps", rateBps: 1000, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: ACCOUNTANT_SOURCE },
  { parameter: "cam_employer_rate", valueKind: "rate_bps", rateBps: 225, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: ACCOUNTANT_SOURCE },
  { parameter: "income_tax_rate", valueKind: "rate_bps", rateBps: 1000, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: ACCOUNTANT_SOURCE },
  { parameter: "dividend_tax_rate", valueKind: "rate_bps", rateBps: 1600, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: ACCOUNTANT_SOURCE },
  { parameter: "minimum_wage", valueKind: "amount_minor", rateBps: null, amountMinor: 405_000, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: ACCOUNTANT_SOURCE },
  { parameter: "cass_investment_brackets", valueKind: "bracket_set", rateBps: null, amountMinor: null, validFrom: "2026-01-01", validTo: null, status: "confirmed", source: ACCOUNTANT_SOURCE },
  { parameter: "personal_deduction", valueKind: "amount_minor", rateBps: null, amountMinor: 62_800, validFrom: "2026-05-01", validTo: null, status: "confirmed", source: `${ACCOUNTANT_SOURCE}; confirmed only for gross 4500 RON, base function, zero dependents` },
] as const satisfies readonly (TaxConfigWindowInput & { status: "confirmed" })[];

/** Bounds and bases are deliberately independent facts, even where equal in 2026. */
export const CONFIRMED_CASS_INVESTMENT_BRACKETS = [
  { ordinal: 0, lowerMinor: 0, upperMinor: 2_430_000, baseMinor: 0, cassMinor: 0 },
  { ordinal: 1, lowerMinor: 2_430_000, upperMinor: 4_860_000, baseMinor: 2_430_000, cassMinor: 243_000 },
  { ordinal: 2, lowerMinor: 4_860_000, upperMinor: 9_720_000, baseMinor: 4_860_000, cassMinor: 486_000 },
  { ordinal: 3, lowerMinor: 9_720_000, upperMinor: null, baseMinor: 9_720_000, cassMinor: 972_000 },
] as const satisfies readonly CassInvestmentBracketInput[];

export async function seedConfirmedTaxConfig(tx: SeedTx): Promise<void> {
  assertTaxConfigWindows(CONFIRMED_TAX_CONFIG_SEED);
  assertCassInvestmentBrackets(CONFIRMED_CASS_INVESTMENT_BRACKETS);

  const inserted = await tx.insert(taxConfig).values([...CONFIRMED_TAX_CONFIG_SEED]).returning({
    id: taxConfig.id,
    parameter: taxConfig.parameter,
  });
  const bracketParent = inserted.find((row) => row.parameter === "cass_investment_brackets");
  if (!bracketParent) throw new Error("Confirmed investment CASS bracket parent was not seeded");
  await tx.insert(taxConfigCassInvestmentBrackets).values(
    CONFIRMED_CASS_INVESTMENT_BRACKETS.map((row) => ({
      taxConfigId: bracketParent.id,
      ...row,
    })),
  );
}
