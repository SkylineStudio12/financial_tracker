import "dotenv/config";
import assert from "node:assert/strict";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { taxConfig, taxConfigCassInvestmentBrackets } from "@/db/schema";
import { LedgerValidationError } from "@/lib/ledger";
import {
  calculateDividendTax,
  calculateSalary,
  resolveTaxConfig,
  roundTaxRateToWholeRonMinor,
} from "./config-service";
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
  assert.equal(configRows.length, 8);
  assert.equal(bracketRows.length, 4);
  assert.ok(configRows.every((row) => row.status === "confirmed"));
  assert.ok(configRows.every((row) => row.validFrom >= "2026-01-01"));
  assertTaxConfigWindows(configRows);
  assertCassInvestmentBrackets(bracketRows);
  assert.deepEqual(bracketRows, [
    { ordinal: 0, lowerMinor: 0, upperMinor: 2_430_000, baseMinor: 0, cassMinor: 0 },
    { ordinal: 1, lowerMinor: 2_430_000, upperMinor: 4_860_000, baseMinor: 2_430_000, cassMinor: 243_000 },
    { ordinal: 2, lowerMinor: 4_860_000, upperMinor: 9_720_000, baseMinor: 4_860_000, cassMinor: 486_000 },
    { ordinal: 3, lowerMinor: 9_720_000, upperMinor: null, baseMinor: 9_720_000, cassMinor: 972_000 },
  ]);
  assert.match(
    configRows.find((row) => row.parameter === "personal_deduction")!.source,
    /gross 4500 RON, base function, zero dependents/,
  );
  ok("seed: 8 confirmed parent rows, 4 independent bracket bounds/bases, no pre-2026 rows");

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
      status: "confirmed",
    },
  );
  assert.equal(roundTaxRateToWholeRonMinor(450_000, 225, true), 10_100);
  assert.equal(roundTaxRateToWholeRonMinor(229_700, 1000, false), 23_000);
  assert.equal(roundTaxRateToWholeRonMinor(50_500, 1000, false), 5_100);
  assert.equal(roundTaxRateToWholeRonMinor(1, 225, true), 100);
  ok("salary: exact May fixture; 101.25 rounds down, 229.70 rounds up, .50 rounds up");

  await expectCode(
    calculateSalary({
      grossMinor: 450_000,
      payPeriodDate: "2026-04-30",
      isBaseFunction: false,
      dependents: 2,
    }),
    "tax.configCoverageMissing",
    { parameter: "personal_deduction", date: "2026-04-30" },
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
  ok("salary pre-May: deduction coverage-missing wins before context-unsupported, intentionally");

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

  console.log("Tax config suite green: all checks passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
