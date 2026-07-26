import "dotenv/config";
import assert from "node:assert/strict";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  accounts,
  auditLog,
  postings,
  taxConfig,
  taxConfigCassInvestmentBrackets,
  transactions,
} from "@/db/schema";
import { LedgerValidationError } from "@/lib/ledger";
import { previewDividend, saveDividend } from "@/lib/ledger/flow-actions";
import { ENTITY_IDS } from "@/lib/profiles";
import {
  calculateDividendTax,
  calculateSalary,
  cassBandForBasis,
  resolveCassInvestmentBrackets,
  resolveTaxConfig,
  roundTaxRateToWholeRonMinor,
} from "./config-service";
import { planMicroTaxAccrual } from "./micro-tax";
import {
  assertCassInvestmentBrackets,
  assertTaxConfigWindows,
  type TaxConfigWindowInput,
} from "./config-validation";

function assertTestDatabase(): void {
  const raw = process.env.DATABASE_URL;
  assert.ok(raw, "DATABASE_URL is required");
  const databaseName = decodeURIComponent(new URL(raw).pathname.slice(1));
  assert.match(databaseName, /_test$/, "tax-config suite refuses a database without an _test suffix");
}

async function expectCode(
  work: Promise<unknown> | (() => unknown),
  code: ConstructorParameters<typeof LedgerValidationError>[0],
  params?: Record<string, string | number>,
): Promise<void> {
  try {
    if (typeof work === "function") work();
    else await work;
  } catch (error) {
    assert.ok(error instanceof LedgerValidationError);
    assert.equal(error.code, code);
    if (params) assert.deepEqual(error.params, params);
    return;
  }
  assert.fail(`Expected ${code}`);
}

async function expectConstraint(work: Promise<unknown>, constraint: string): Promise<void> {
  try {
    await work;
  } catch (error) {
    let current: unknown = error;
    let actual: string | undefined;
    while (current && typeof current === "object") {
      actual = (current as { constraint?: string }).constraint ?? actual;
      current = (current as { cause?: unknown }).cause;
    }
    assert.equal(actual, constraint);
    return;
  }
  assert.fail(`Expected database constraint ${constraint}`);
}

function ok(message: string): void {
  console.log(`  PASS ${message}`);
}

function syntheticWindows(secondFrom: string, firstTo: string): TaxConfigWindowInput[] {
  return [
    {
      parameter: "minimum_wage",
      valueKind: "amount_minor",
      rateBps: null,
      amountMinor: 405_000,
      validFrom: "2026-01-01",
      validTo: firstTo,
      source: "test",
    },
    {
      parameter: "minimum_wage",
      valueKind: "amount_minor",
      rateBps: null,
      amountMinor: 410_000,
      validFrom: secondFrom,
      validTo: null,
      source: "test",
    },
  ];
}

async function main(): Promise<void> {
  assertTestDatabase();

  const configRows = await db.select().from(taxConfig).orderBy(asc(taxConfig.parameter));
  const bracketRows = await db
    .select({
      ordinal: taxConfigCassInvestmentBrackets.ordinal,
      lowerMinor: taxConfigCassInvestmentBrackets.lowerMinor,
      upperMinor: taxConfigCassInvestmentBrackets.upperMinor,
      baseMinor: taxConfigCassInvestmentBrackets.baseMinor,
      cassMinor: taxConfigCassInvestmentBrackets.cassMinor,
    })
    .from(taxConfigCassInvestmentBrackets)
    .orderBy(asc(taxConfigCassInvestmentBrackets.ordinal));
  assert.equal(configRows.length, 9);
  assert.equal(bracketRows.length, 4);
  // Ruling 4 statuses: income tax, the personal deduction, and the CASS
  // bracket set stay `estimate`; everything else is payslip/accountant-confirmed.
  const expectedStatuses: Record<string, "confirmed" | "estimate"> = {
    cas_employee_rate: "confirmed",
    cass_employee_rate: "confirmed",
    cam_employer_rate: "confirmed",
    income_tax_rate: "estimate",
    dividend_tax_rate: "confirmed",
    micro_revenue_tax: "confirmed",
    minimum_wage: "confirmed",
    personal_deduction: "estimate",
    cass_investment_brackets: "estimate",
  };
  for (const row of configRows) {
    assert.equal(row.status, expectedStatuses[row.parameter], `status of ${row.parameter}`);
  }
  assert.equal(
    configRows.find((row) => row.parameter === "micro_revenue_tax")!.rateBps,
    100,
  );
  assert.ok(configRows.every((row) => row.validFrom >= "2026-01-01"));
  assertTaxConfigWindows(configRows);
  assertCassInvestmentBrackets(bracketRows);
  assert.deepEqual(bracketRows, [
    { ordinal: 0, lowerMinor: 0, upperMinor: 2_430_000, baseMinor: 0, cassMinor: 0 },
    { ordinal: 1, lowerMinor: 2_430_000, upperMinor: 4_860_000, baseMinor: 2_430_000, cassMinor: 243_000 },
    { ordinal: 2, lowerMinor: 4_860_000, upperMinor: 9_720_000, baseMinor: 4_860_000, cassMinor: 486_000 },
    { ordinal: 3, lowerMinor: 9_720_000, upperMinor: null, baseMinor: 9_720_000, cassMinor: 972_000 },
  ]);
  assert.equal(
    configRows.find((row) => row.parameter === "personal_deduction")!.source,
    "artifact 2 accountant 2026-07",
  );
  ok("seed: the ruled 9-row 2026 set, 4 independent bracket bounds/bases, no pre-2026 rows");

  const salary = await calculateSalary({
    grossMinor: 450_000,
    payPeriodDate: "2026-05-31",
    isBaseFunction: true,
    dependents: 0,
  });
  assert.deepEqual(
    {
      gross: salary.grossMinor,
      cas: salary.casMinor,
      cass: salary.cassMinor,
      cam: salary.camMinor,
      deduction: salary.personalDeductionMinor,
      base: salary.taxableBaseMinor,
      incomeTax: salary.incomeTaxMinor,
      status: salary.status,
    },
    {
      gross: 450_000,
      cas: 112_500,
      cass: 45_000,
      cam: 10_100,
      deduction: 62_800,
      base: 229_700,
      incomeTax: 23_000,
      // income_tax_rate and personal_deduction are `estimate` per Ruling 4,
      // so the aggregate salary status is estimate (amounts are unchanged).
      status: "estimate",
    },
  );
  assert.equal(roundTaxRateToWholeRonMinor(450_000, 225, true), 10_100);
  assert.equal(roundTaxRateToWholeRonMinor(229_700, 1000, false), 23_000);
  assert.equal(roundTaxRateToWholeRonMinor(50_500, 1000, false), 5_100);
  assert.equal(roundTaxRateToWholeRonMinor(1, 225, true), 100);
  ok("salary: exact May fixture; 101.25 rounds down, 229.70 rounds up, .50 rounds up");

  // The ruled seed covers personal_deduction from 2026-01-01, so the
  // coverage-missing-before-context ordering is proven at a pre-2026 date.
  await expectCode(
    calculateSalary({
      grossMinor: 450_000,
      payPeriodDate: "2025-12-31",
      isBaseFunction: false,
      dependents: 2,
    }),
    "tax.configCoverageMissing",
    { parameter: "personal_deduction", date: "2025-12-31" },
  );
  await expectCode(
    calculateSalary({
      grossMinor: 450_000,
      payPeriodDate: "2026-04-30",
      isBaseFunction: false,
      dependents: 2,
    }),
    "tax.personalDeductionContextUnsupported",
  );
  await expectCode(
    calculateSalary({
      grossMinor: 500_000,
      payPeriodDate: "2026-05-31",
      isBaseFunction: true,
      dependents: 0,
    }),
    "tax.personalDeductionContextUnsupported",
  );
  ok("salary pre-2026: deduction coverage-missing wins before context-unsupported, intentionally");

  const dividend = await calculateDividendTax({
    grossDividendMinor: 10_000,
    distributionDate: "2026-07-15",
  });
  assert.deepEqual(
    { gross: dividend.grossDividendMinor, tax: dividend.taxMinor, net: dividend.netMinor },
    { gross: 10_000, tax: 1_600, net: 8_400 },
  );
  assert.equal(
    (await calculateDividendTax({ grossDividendMinor: 10_313, distributionDate: "2026-07-15" }))
      .taxMinor,
    1_700,
  );
  ok("dividend: 16% as of distribution date; whole-leu D100 rounding fixture locked");

  await expectCode(
    resolveTaxConfig("cas_employee_rate", "2025-12-31"),
    "tax.configCoverageMissing",
    { parameter: "cas_employee_rate", date: "2025-12-31" },
  );
  await expectCode(resolveTaxConfig("cas_employee_rate", "2026-99-99"), "tax.configValueInvalid", {
    field: "date",
    value: "2026-99-99",
  });
  ok("resolver: uncovered dates fail distinctly with no nearest/current fallback");

  await expectCode(
    () => assertTaxConfigWindows(syntheticWindows("2026-07-01", "2026-06-01")),
    "tax.configWindowInvalid",
  );
  await expectCode(
    () => assertTaxConfigWindows(syntheticWindows("2026-05-01", "2026-06-01")),
    "tax.configWindowInvalid",
  );
  ok("pure window validator rejects gaps and overlaps");

  const [minimumWage] = await db
    .select({ id: taxConfig.id })
    .from(taxConfig)
    .where(eq(taxConfig.parameter, "minimum_wage"));
  assert.ok(minimumWage);
  await expectConstraint(
    db.transaction(async (tx) => {
      await tx.update(taxConfig).set({ validTo: "2027-06-01" }).where(eq(taxConfig.id, minimumWage.id));
      await tx.insert(taxConfig).values({
        parameter: "minimum_wage",
        valueKind: "amount_minor",
        amountMinor: 410_000,
        validFrom: "2027-05-01",
        validTo: null,
        status: "estimate",
        source: "synthetic overlap test",
      });
      await tx.execute(sql`set constraints tax_config_no_overlapping_windows immediate`);
    }),
    "tax_config_no_overlapping_windows",
  );
  await expectConstraint(
    db.transaction(async (tx) => {
      await tx.update(taxConfig).set({ validTo: "2027-05-01" }).where(eq(taxConfig.id, minimumWage.id));
      await tx.insert(taxConfig).values({
        parameter: "minimum_wage",
        valueKind: "amount_minor",
        amountMinor: 410_000,
        validFrom: "2027-06-01",
        validTo: null,
        status: "estimate",
        source: "synthetic gap test",
      });
    }),
    "tax_config_contiguous_windows_check",
  );
  ok("database constraints reject overlap and gap at transaction boundary");

  let successorId = "";
  await db.transaction(async (tx) => {
    await tx.update(taxConfig).set({ validTo: "2027-04-01" }).where(eq(taxConfig.id, minimumWage.id));
    const [successor] = await tx
      .insert(taxConfig)
      .values({
        parameter: "minimum_wage",
        valueKind: "amount_minor",
        amountMinor: 425_000,
        validFrom: "2027-04-01",
        validTo: null,
        status: "estimate",
        source: "synthetic random-month boundary",
      })
      .returning({ id: taxConfig.id });
    successorId = successor.id;
  });
  assert.equal((await resolveTaxConfig("minimum_wage", "2027-03-31")).amountMinor, 405_000);
  assert.equal((await resolveTaxConfig("minimum_wage", "2027-04-01")).amountMinor, 425_000);
  await db.transaction(async (tx) => {
    await tx.delete(taxConfig).where(eq(taxConfig.id, successorId));
    await tx.update(taxConfig).set({ validTo: null }).where(eq(taxConfig.id, minimumWage.id));
  });
  assert.equal(
    await db.$count(
      taxConfig,
      and(eq(taxConfig.parameter, "minimum_wage"), eq(taxConfig.validFrom, "2026-01-01")),
    ),
    1,
  );
  ok("random-month boundary: March 31 old, April 1 new; fixture cleaned up");

  // ---- U3 cutover: the repointed computing paths (20-12.1-U3, finding 2) --
  // These pin gates (d) and (e) of 20-12-U3 as repo artifacts rather than
  // transcript claims.

  const brackets = await resolveCassInvestmentBrackets("2026-07-15");
  assert.equal(brackets.config.parameter, "cass_investment_brackets");
  assert.equal(brackets.config.status, "estimate");
  assert.deepEqual(
    brackets.bands.map((band) => band.ordinal),
    [0, 1, 2, 3],
  );
  await expectCode(
    resolveCassInvestmentBrackets("2025-12-31"),
    "tax.configCoverageMissing",
    { parameter: "cass_investment_brackets", date: "2025-12-31" },
  );
  ok("cass brackets: parent + 4 ordinal-ordered children; absent window fails loud");

  // Half-open [lowerMinor, upperMinor); NULL upper = open top band. Every
  // edge is a money-correctness surface, so every edge is asserted.
  const band = (basis: number) => cassBandForBasis(brackets.bands, basis);
  assert.deepEqual(
    [0, 2_429_999, 2_430_000, 4_859_999, 4_860_000, 9_719_999, 9_720_000, 50_000_000].map(
      (basis) => [basis, band(basis).ordinal, band(basis).cassMinor],
    ),
    [
      [0, 0, 0],
      [2_429_999, 0, 0],
      [2_430_000, 1, 243_000],
      [4_859_999, 1, 243_000],
      [4_860_000, 2, 486_000],
      [9_719_999, 2, 486_000],
      [9_720_000, 3, 972_000],
      [50_000_000, 3, 972_000],
    ],
  );
  // Reachable from previewDividend, which does no gross validation of its
  // own: a bad basis must fail loud, never clamp into band 0.
  await expectCode(() => cassBandForBasis(brackets.bands, -1), "tax.calculationInputInvalid", {
    field: "cassBasisMinor",
    value: -1,
  });
  await expectCode(() => cassBandForBasis(brackets.bands, 1.5), "tax.calculationInputInvalid", {
    field: "cassBasisMinor",
    value: 1.5,
  });
  ok("cass band edges: half-open bounds, open top band, and a bad basis fails loud");

  // The empty-bands guard in resolveCassInvestmentBrackets is unreachable
  // through the database: a childless bracket_set parent is rejected at
  // commit. Pin the invariant that makes it unreachable.
  const [bracketParent] = await db
    .select({ id: taxConfig.id })
    .from(taxConfig)
    .where(eq(taxConfig.parameter, "cass_investment_brackets"));
  assert.ok(bracketParent);
  await expectConstraint(
    db.transaction(async (tx) => {
      await tx
        .update(taxConfig)
        .set({ validTo: "2027-01-01" })
        .where(eq(taxConfig.id, bracketParent.id));
      await tx.insert(taxConfig).values({
        parameter: "cass_investment_brackets",
        valueKind: "bracket_set",
        validFrom: "2027-01-01",
        validTo: null,
        status: "estimate",
        source: "synthetic childless bracket parent",
      });
    }),
    "tax_config_cass_bracket_ranges_check",
  );
  ok("childless bracket_set parent rejected at commit — empty-set branch unreachable by construction");

  const preview = await previewDividend({ date: "2026-07-15", grossMinor: 5_500_000 });
  assert.ok(!("error" in preview), "preview must resolve against the seeded config");
  assert.deepEqual(
    {
      gross: preview.gross,
      withholdingTax: preview.withholdingTax,
      net: preview.net,
      cassEstimate: preview.cassEstimate,
    },
    { gross: 5_500_000, withholdingTax: 880_000, net: 4_620_000, cassEstimate: 486_000 },
  );
  assert.equal(band(5_500_000).ordinal, 2);
  // The note describes what the code does: a band matched on THIS gross.
  // It must not claim a year-to-date computation that does not exist (U6).
  assert.match(preview.rateNote, /not a year-to-date total/);
  // Each distribution books its own full-bracket estimate with no offset, so
  // the note must disclose that repeat distributions stack until the true-up.
  assert.match(preview.rateNote, /repeat distributions accumulate until that true-up/);
  // No YTD framing at all while the basis is per-distribution; U6 owns YTD.
  assert.doesNotMatch(preview.rateNote, /\bYTD\b/i);
  ok("dividend preview 55,000 RON: 880000 withholding, 486000 CASS from band 2, honest note");

  const [skylineEquity] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, ENTITY_IDS.skyline),
        eq(accounts.type, "equity"),
        isNull(accounts.deletedAt),
      ),
    );
  assert.ok(skylineEquity);
  await expectCode(
    planMicroTaxAccrual({
      entityId: ENTITY_IDS.skyline,
      date: "2025-12-31",
      revenueRonMinor: 1_000_000,
      equityAccountId: skylineEquity.id,
      basePostingIndex: 2,
    }),
    "tax.configCoverageMissing",
    { parameter: "micro_revenue_tax", date: "2025-12-31" },
  );
  const uncovered = await previewDividend({ date: "2025-12-31", grossMinor: 5_500_000 });
  assert.ok("error" in uncovered);
  assert.equal(uncovered.error.code, "tax.configCoverageMissing");

  // Band 0 carries zero CASS; the ledger rejects a zero-amount posting, so
  // the leg and its accrual are omitted and the transaction still balances.
  const [householdBank] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, ENTITY_IDS.household),
        eq(accounts.name, "Greg — bank"),
        isNull(accounts.deletedAt),
      ),
    );
  assert.ok(householdBank);

  // saveDividend is the OTHER repointed path: previewDividend never calls
  // getActiveRule, so only this exercises the config-before-provenance
  // ordering on the booking path. Nothing is written — it throws before
  // createTransaction.
  const uncoveredBooking = await saveDividend({
    companyId: ENTITY_IDS.skyline,
    date: "2025-12-31",
    grossMinor: 5_500_000,
    personalAccountId: householdBank.id,
    stay: true,
  });
  assert.ok(uncoveredBooking && "error" in uncoveredBooking);
  assert.equal(uncoveredBooking.error.code, "tax.configCoverageMissing");
  ok("both repointed paths fail loud with the cutover's error, not tax_rules' taxRuleMissing");

  const ledgerBefore = await db.$count(transactions);
  const auditBefore = await db.$count(auditLog);
  const booked = await saveDividend({
    companyId: ENTITY_IDS.skyline,
    date: "2026-07-15",
    grossMinor: 1_000_000, // 10,000 RON — below the 24,300 RON band-0 ceiling
    personalAccountId: householdBank.id,
    stay: true,
  });
  assert.deepEqual(booked, { ok: true });
  const dividendTransactions = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.kind, "dividend"), isNull(transactions.deletedAt)));
  assert.equal(dividendTransactions.length, 1);
  const bookedId = dividendTransactions[0].id;
  const legs = await db
    .select({
      id: postings.id,
      amount: postings.amount,
      counterparty: postings.counterparty,
    })
    .from(postings)
    .where(and(eq(postings.transactionId, bookedId), isNull(postings.deletedAt)));
  assert.equal(legs.length, 4);
  assert.equal(legs.filter((leg) => leg.counterparty === "ESTIMATE").length, 0);
  assert.equal(
    legs.reduce((sum, leg) => sum + leg.amount, 0),
    0,
  );
  ok("band-0 dividend books no CASS leg: 4 postings, zero-sum, no ESTIMATE counterparty");

  await db.delete(auditLog).where(inArray(auditLog.rowId, [bookedId, ...legs.map((l) => l.id)]));
  await db.delete(transactions).where(eq(transactions.id, bookedId));
  assert.equal(await db.$count(transactions), ledgerBefore);
  assert.equal(await db.$count(auditLog), auditBefore);
  assert.equal(await db.$count(taxConfig), 9);
  assert.equal(await db.$count(taxConfigCassInvestmentBrackets), 4);
  ok("zero residue: ledger and audit back to baseline; config still 9 + 4");

  console.log("Tax config suite green: all checks passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
