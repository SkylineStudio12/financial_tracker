import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  accounts,
  auditLog,
  categories,
  fxRates,
  postings,
  salaryTransactionDetails,
  taxAccruals,
  taxConfig,
  taxConfigCassInvestmentBrackets,
  taxRules,
  transactions,
} from "@/db/schema";
import { ENTITY_IDS } from "@/lib/profiles";
import {
  purgeTransaction,
  restoreTransaction,
  softDeleteNonInvestmentTransaction,
  type TransactionInput,
} from "@/lib/ledger";
import {
  previewSalary,
  repeatLastSalary,
  saveSalary,
  type SalaryFlowPayload,
} from "./flow-actions";
import { loadTransactionEditDraftAction } from "./actions";
import { getTransactionEditDraft } from "./edit-drafts";
import {
  defaultSalaryPaymentDate,
  salaryPaymentDateAfterPayMonthChange,
} from "./salary-dates";

let fixtureNumber = 0;
async function fixture(name: string, work: () => Promise<void>): Promise<void> {
  await work();
  fixtureNumber += 1;
  console.log(`PASS fixture ${fixtureNumber}: ${name}`);
}

function entered(
  employeeName: string,
  payMonth = "2026-06",
  overrides: Partial<SalaryFlowPayload> = {},
): SalaryFlowPayload {
  return {
    stay: true,
    companyId: ENTITY_IDS.skyline,
    employeeName,
    payMonth,
    paymentDate: defaultSalaryPaymentDate(payMonth),
    grossMinor: 450_000,
    casMinor: 112_500,
    cassMinor: 45_000,
    incomeTaxMinor: 23_000,
    camMinor: 10_100,
    netMinor: 269_500,
    personalDeductionMinor: 45_000,
    personalAccountId: "",
    ...overrides,
  };
}

async function salaryByDescription(description: string) {
  const [row] = await db.select().from(transactions).where(eq(transactions.description, description));
  assert.ok(row, `missing salary transaction: ${description}`);
  return row;
}

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL;
  assert.ok(raw, "DATABASE_URL is required");
  const databaseName = decodeURIComponent(new URL(raw).pathname.slice(1));
  assert.match(databaseName, /_test$/, "salary suite refuses a database without an _test suffix");

  const [companyBank, taxLiability, equity, personalAccount, salariesCategory] =
    await Promise.all([
      db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.entityId, ENTITY_IDS.skyline),
            eq(accounts.type, "bank"),
            eq(accounts.currency, "RON"),
            isNull(accounts.deletedAt),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.entityId, ENTITY_IDS.skyline),
            eq(accounts.type, "tax_liability"),
            isNull(accounts.deletedAt),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.entityId, ENTITY_IDS.skyline),
            eq(accounts.type, "equity"),
            isNull(accounts.deletedAt),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.entityId, ENTITY_IDS.household),
            eq(accounts.owner, "greg"),
            inArray(accounts.type, ["bank", "cash"]),
            eq(accounts.currency, "RON"),
            isNull(accounts.deletedAt),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.entityId, ENTITY_IDS.skyline),
            eq(categories.name, "Salaries"),
            isNull(categories.deletedAt),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
    ]);
  assert.ok(companyBank && taxLiability && equity && personalAccount);

  await db.transaction(async (tx) => {
    await tx.delete(taxConfigCassInvestmentBrackets);
    await tx.delete(taxConfig);
  });
  assert.equal(await db.$count(taxConfig), 0);

  const allFixtureIds = new Set<string>();
  const track = (id: string) => {
    allFixtureIds.add(id);
    return id;
  };

  const ruleRows = await db
    .select({ id: taxRules.id, ruleType: taxRules.ruleType })
    .from(taxRules)
    .where(
      inArray(taxRules.ruleType, ["salary_cas", "salary_cass", "salary_income_tax", "cam"]),
    );
  const ruleId = (type: (typeof ruleRows)[number]["ruleType"]) => {
    const row = ruleRows.find((candidate) => candidate.ruleType === type);
    assert.ok(row, `missing tax rule ${type}`);
    return row.id;
  };
  const boundaryRules = await db
    .insert(taxRules)
    .values(
      (["salary_cas", "salary_cass", "salary_income_tax", "cam"] as const).map(
        (ruleType) => ({
          ruleType,
          rateBps: 1,
          validFrom: "2026-07-01",
          notes: "__test__ payment-date rule boundary",
        }),
      ),
    )
    .returning({ id: taxRules.id });
  const boundaryRuleIds = new Set(boundaryRules.map((row) => row.id));

  try {
    await fixture("June paid 10 July books exact legs but accrues to 2026 Q2", async () => {
      const payload = entered("__test__ Payslip Employee", "2026-06", {
        personalAccountId: personalAccount.id,
      });
      assert.deepEqual(await saveSalary(payload), { ok: true });
      const transaction = await salaryByDescription("Salary __test__ Payslip Employee 2026-06");
      track(transaction.id);
      assert.equal(transaction.date, "2026-07-10");
      const legs = await db
        .select({ amount: postings.amount, accountType: accounts.type })
        .from(postings)
        .innerJoin(accounts, eq(accounts.id, postings.accountId))
        .where(and(eq(postings.transactionId, transaction.id), isNull(postings.deletedAt)));
      assert.equal(legs.length, 7);
      assert.deepEqual(
        legs.map((row) => row.amount).sort((a, b) => a - b),
        [-269_500, -112_500, -45_000, -23_000, -10_100, 190_600, 269_500],
      );
      assert.equal(legs.reduce((sum, row) => sum + row.amount, 0), 0);
      const accruals = await db
        .select({
          taxRuleId: taxAccruals.taxRuleId,
          ruleType: taxRules.ruleType,
          amount: postings.amount,
          year: taxAccruals.year,
          quarter: taxAccruals.quarter,
        })
        .from(taxAccruals)
        .innerJoin(taxRules, eq(taxRules.id, taxAccruals.taxRuleId))
        .innerJoin(postings, eq(postings.id, taxAccruals.postingId))
        .where(and(eq(taxAccruals.transactionId, transaction.id), isNull(taxAccruals.deletedAt)));
      assert.deepEqual(
        accruals
          .map((row) => [row.ruleType, row.amount] as const)
          .sort(([left], [right]) => left.localeCompare(right)),
        [
          ["cam", -10_100],
          ["salary_cas", -112_500],
          ["salary_cass", -45_000],
          ["salary_income_tax", -23_000],
        ],
      );
      assert.ok(accruals.every((row) => row.year === 2026 && row.quarter === 2));
      assert.ok(accruals.every((row) => !boundaryRuleIds.has(row.taxRuleId)));
      const [detail] = await db
        .select()
        .from(salaryTransactionDetails)
        .where(eq(salaryTransactionDetails.transactionId, transaction.id));
      assert.equal(detail.revision, 1);
      assert.equal(detail.payMonth, "2026-06-01");
      assert.equal(detail.personalDeductionMinor, 45_000);
      console.log(
        "  payMonth=2026-06 paymentDate=2026-07-10 accrual=2026-Q2 rules=June-anchor gross=450000 cas=112500 cass=45000 incomeTax=23000 cam=10100 net=269500 deduction=45000 legs=7 sum=0",
      );
    });

    await fixture("December paid in January stays in the prior year's Q4", async () => {
      const payload = entered("__test__ Year Boundary Employee", "2026-12", {
        personalAccountId: personalAccount.id,
        paymentDate: "2027-01-10",
      });
      assert.deepEqual(await saveSalary(payload), { ok: true });
      const transaction = await salaryByDescription(
        "Salary __test__ Year Boundary Employee 2026-12",
      );
      track(transaction.id);
      assert.equal(transaction.date, "2027-01-10");
      const periods = await db
        .select({ year: taxAccruals.year, quarter: taxAccruals.quarter })
        .from(taxAccruals)
        .where(and(eq(taxAccruals.transactionId, transaction.id), isNull(taxAccruals.deletedAt)));
      assert.equal(periods.length, 4);
      assert.ok(periods.every((row) => row.year === 2026 && row.quarter === 4));
      const [detail] = await db
        .select()
        .from(salaryTransactionDetails)
        .where(eq(salaryTransactionDetails.transactionId, transaction.id));
      assert.equal(detail.payMonth, "2026-12-01");
      console.log("  payMonth=2026-12 paymentDate=2027-01-10 accruals=4 period=2026-Q4");
    });

    await fixture("invalid calendar payment date fails preview and save with zero writes", async () => {
      const payload = entered("__test__ Invalid Date Employee", "2026-02", {
        personalAccountId: personalAccount.id,
        paymentDate: "2026-02-30",
      });
      const before = {
        transactions: await db.$count(transactions),
        postings: await db.$count(postings),
        accruals: await db.$count(taxAccruals),
        details: await db.$count(salaryTransactionDetails),
        audit: await db.$count(auditLog),
      };
      const preview = await previewSalary(payload);
      assert.ok("error" in preview);
      assert.equal(preview.error.code, "flows.invalidPaymentDate");
      assert.deepEqual(preview.error.params, { date: "2026-02-30" });
      const saved = await saveSalary(payload);
      assert.ok(saved && "error" in saved);
      assert.equal(saved.error.code, "flows.invalidPaymentDate");
      assert.deepEqual(
        {
          transactions: await db.$count(transactions),
          postings: await db.$count(postings),
          accruals: await db.$count(taxAccruals),
          details: await db.$count(salaryTransactionDetails),
          audit: await db.$count(auditLog),
        },
        before,
      );
      console.log("  paymentDate=2026-02-30 code=flows.invalidPaymentDate writes=0");
    });

    await fixture("valid arbitrary payment date is accepted without a 10th-of-month rule", async () => {
      const payload = entered("__test__ Arbitrary Date Employee", "2026-06", {
        personalAccountId: personalAccount.id,
        paymentDate: "2026-08-23",
      });
      assert.deepEqual(await saveSalary(payload), { ok: true });
      const transaction = await salaryByDescription(
        "Salary __test__ Arbitrary Date Employee 2026-06",
      );
      track(transaction.id);
      assert.equal(transaction.date, "2026-08-23");
      console.log("  payMonth=2026-06 paymentDate=2026-08-23 accepted=true");
    });

    await fixture("payment-date default rolls year and never overwrites a touched value", async () => {
      assert.equal(defaultSalaryPaymentDate("2026-06"), "2026-07-10");
      assert.equal(defaultSalaryPaymentDate("2026-12"), "2027-01-10");
      assert.equal(
        salaryPaymentDateAfterPayMonthChange("2026-07", "2026-07-17", true),
        "2026-07-17",
      );
      assert.equal(
        salaryPaymentDateAfterPayMonthChange("2026-07", "2026-07-10", false),
        "2026-08-10",
      );
      console.log(
        "  defaults 2026-06->2026-07-10 2026-12->2027-01-10 touched=2026-07-17 preserved untouchedJuly->2026-08-10",
      );
    });

    await fixture("one-ban net mismatch blocks preview and save with zero writes", async () => {
      const payload = entered("__test__ Mismatch Employee", "2026-06", {
        personalAccountId: personalAccount.id,
        netMinor: 269_501,
      });
      const before = {
        transactions: await db.$count(transactions),
        details: await db.$count(salaryTransactionDetails),
        audit: await db.$count(auditLog),
      };
      const preview = await previewSalary(payload);
      assert.ok("error" in preview);
      assert.equal(preview.error.code, "flows.salaryNetMismatch");
      assert.deepEqual(preview.error.params, { expected: 269_500, actual: 269_501 });
      const saved = await saveSalary(payload);
      assert.ok(saved && "error" in saved);
      assert.equal(saved.error.code, "flows.salaryNetMismatch");
      assert.deepEqual(
        {
          transactions: await db.$count(transactions),
          details: await db.$count(salaryTransactionDetails),
          audit: await db.$count(auditLog),
        },
        before,
      );
      console.log("  expectedNet=269500 actualNet=269501 writes=0");
    });

    await fixture("CAM changes independently of employee net", async () => {
      const payload = entered("__test__ CAM Employee", "2026-06", {
        personalAccountId: personalAccount.id,
      });
      assert.deepEqual(await saveSalary(payload), { ok: true });
      const transaction = await salaryByDescription("Salary __test__ CAM Employee 2026-06");
      track(transaction.id);
      assert.deepEqual(
        await saveSalary({
          ...payload,
          transactionId: transaction.id,
          expectedRevision: 1,
          camMinor: 10_200,
        }),
        { ok: true },
      );
      const revisions = await db
        .select({ revision: postings.revision, amount: postings.amount, type: accounts.type })
        .from(postings)
        .innerJoin(accounts, eq(accounts.id, postings.accountId))
        .where(eq(postings.transactionId, transaction.id));
      const amounts = (revision: number) =>
        revisions
          .filter((row) => row.revision === revision)
          .map((row) => row.amount)
          .sort((a, b) => a - b);
      assert.deepEqual(amounts(1), [-269_500, -112_500, -45_000, -23_000, -10_100, 190_600, 269_500]);
      assert.deepEqual(amounts(2), [-269_500, -112_500, -45_000, -23_000, -10_200, 190_700, 269_500]);
      console.log("  net=269500 unchanged; CAM 10100->10200; equity 190600->190700");
    });

    await fixture("salary path is independent of tax_config and salary calculators", async () => {
      assert.equal(await db.$count(taxConfig), 0);
      const preview = await previewSalary(
        entered("__test__ Config-free Employee", "2026-06", {
          personalAccountId: personalAccount.id,
        }),
      );
      assert.ok(!("error" in preview));
      assert.equal(preview.net, 269_500);
      assert.equal(preview.personalDeduction, 45_000);
      const source = readFileSync(join(import.meta.dirname, "flow-actions.ts"), "utf8");
      assert.doesNotMatch(source, /\bcomputeSalary\b|\bcalculateSalary\b/);
      console.log("  tax_config rows=0; preview net=269500; production imports computeSalary=0 calculateSalary=0");
    });

    await fixture("repeat last uses newest complete salary for exact employee only", async () => {
      const first = entered("__test__ Repeat Employee", "2026-05", {
        personalAccountId: personalAccount.id,
        personalDeductionMinor: 44_000,
        paymentDate: "2026-08-20",
      });
      const second = entered("__test__ Repeat Employee", "2026-06", {
        personalAccountId: personalAccount.id,
        paymentDate: "2026-07-10",
        grossMinor: 460_000,
        casMinor: 115_000,
        cassMinor: 46_000,
        incomeTaxMinor: 24_000,
        camMinor: 10_300,
        netMinor: 275_000,
        personalDeductionMinor: 45_000,
      });
      const other = entered("__test__ Other Employee", "2026-07", {
        personalAccountId: personalAccount.id,
      });
      assert.deepEqual(await saveSalary(first), { ok: true });
      assert.deepEqual(await saveSalary(second), { ok: true });
      assert.deepEqual(await saveSalary(other), { ok: true });
      track((await salaryByDescription("Salary __test__ Repeat Employee 2026-05")).id);
      track((await salaryByDescription("Salary __test__ Repeat Employee 2026-06")).id);
      track((await salaryByDescription("Salary __test__ Other Employee 2026-07")).id);
      const repeated = await repeatLastSalary(ENTITY_IDS.skyline, "  __TEST__ repeat employee ");
      assert.ok(repeated && !("error" in repeated));
      assert.equal(repeated.payMonth, "2026-06");
      assert.equal(repeated.paymentDate, "2026-07-10");
      assert.equal(repeated.gross, "4600,00");
      assert.equal(repeated.net, "2750,00");
      assert.equal(repeated.personalDeduction, "450,00");
      console.log("  paymentOrder May=2026-08-20 June=2026-07-10 selectedPayMonth=2026-06 storedPaymentDate=2026-07-10 gross=460000 net=275000 deduction=45000");
    });

    let legacyId = "";
    await fixture("legacy salary without detail is excluded from repeat baseline", async () => {
      const input: TransactionInput = {
        entityId: ENTITY_IDS.skyline,
        date: "2026-04-30",
        description: "Salary __test__ Legacy Employee 2026-04",
        kind: "salary",
        postings: [
          { accountId: companyBank.id, amount: -269_500, counterparty: "__test__ Legacy Employee" },
          { accountId: personalAccount.id, amount: 269_500, counterparty: "Skyline Studio SRL" },
          { accountId: taxLiability.id, amount: -112_500 },
          { accountId: taxLiability.id, amount: -45_000 },
          { accountId: taxLiability.id, amount: -23_000 },
          { accountId: taxLiability.id, amount: -10_100 },
          {
            accountId: equity.id,
            amount: 190_600,
            categoryId: salariesCategory?.id ?? null,
          },
        ],
        accruals: [
          { postingIndex: 2, taxRuleId: ruleId("salary_cas"), year: 2026, quarter: 2 },
          { postingIndex: 3, taxRuleId: ruleId("salary_cass"), year: 2026, quarter: 2 },
          {
            postingIndex: 4,
            taxRuleId: ruleId("salary_income_tax"),
            year: 2026,
            quarter: 2,
          },
          { postingIndex: 5, taxRuleId: ruleId("cam"), year: 2026, quarter: 2 },
        ],
      };
      const { createTransaction } = await import("./service");
      legacyId = track(await createTransaction(input));
      assert.equal(
        await repeatLastSalary(ENTITY_IDS.skyline, "__test__ Legacy Employee"),
        null,
      );
      const draft = await getTransactionEditDraft(legacyId, ENTITY_IDS.skyline);
      assert.equal(draft.type, "salary");
      assert.equal(draft.payMonth, "2026-04");
      assert.equal(draft.paymentDate, "2026-04-30");
      assert.equal(draft.personalDeduction, "");
      console.log("  legacy detail rows=0 repeatResult=null payMonth=2026-04 paymentDate=2026-04-30 editDeduction=blank");
    });

    await fixture("legacy edit requires entered deduction and creates revision-2 detail", async () => {
      assert.deepEqual(
        await saveSalary({
          ...entered("__test__ Legacy Employee", "2026-04", {
            personalAccountId: personalAccount.id,
            paymentDate: "2026-04-30",
          }),
          transactionId: legacyId,
          expectedRevision: 1,
        }),
        { ok: true },
      );
      const [transaction] = await db.select().from(transactions).where(eq(transactions.id, legacyId));
      assert.equal(transaction.currentRevision, 2);
      const details = await db
        .select()
        .from(salaryTransactionDetails)
        .where(eq(salaryTransactionDetails.transactionId, legacyId));
      assert.deepEqual(
        details.map((row) => [row.revision, row.payMonth, row.personalDeductionMinor]),
        [[2, "2026-04-01", 45_000]],
      );
      assert.equal(transaction.date, "2026-04-30");
      const oldLive = await db
        .select()
        .from(postings)
        .where(
          and(
            eq(postings.transactionId, legacyId),
            eq(postings.revision, 1),
            isNull(postings.deletedAt),
          ),
        );
      assert.equal(oldLive.length, 0);
      console.log("  currentRevision=2 paymentDate=2026-04-30 details=[[2,2026-04-01,45000]] revision1LivePostings=0");
    });

    await fixture("cross-profile salary edit resolves booking entity and preserves revision", async () => {
      const payload = entered("__test__ Edit Employee", "2026-06", {
        personalAccountId: personalAccount.id,
      });
      assert.deepEqual(await saveSalary(payload), { ok: true });
      const transaction = await salaryByDescription("Salary __test__ Edit Employee 2026-06");
      track(transaction.id);

      const householdResult = await loadTransactionEditDraftAction(
        transaction.id,
        ENTITY_IDS.household,
        "household",
      );
      assert.ok(!("error" in householdResult));
      assert.equal(householdResult.draft.type, "salary");
      assert.equal(householdResult.draft.bookingEntityId, ENTITY_IDS.skyline);
      assert.equal(householdResult.draft.bookingEntityName, "Skyline Studio SRL");
      assert.equal(householdResult.draft.gross, "4500,00");
      assert.equal(householdResult.draft.net, "2695,00");
      assert.equal(householdResult.draft.personalAccountId, personalAccount.id);

      const gregResult = await loadTransactionEditDraftAction(
        transaction.id,
        ENTITY_IDS.household,
        "greg",
      );
      assert.ok(!("error" in gregResult));
      assert.deepEqual(gregResult.draft, householdResult.draft);

      const andraResult = await loadTransactionEditDraftAction(
        transaction.id,
        ENTITY_IDS.household,
        "andra",
      );
      assert.ok("error" in andraResult);
      assert.ok(andraResult.error);
      assert.equal(andraResult.error.code, "ledger.transactionNotFound");

      const beforePostings = await db
        .select()
        .from(postings)
        .where(
          and(
            eq(postings.transactionId, transaction.id),
            eq(postings.revision, 1),
            isNull(postings.deletedAt),
          ),
        );
      const beforeAccruals = await db
        .select()
        .from(taxAccruals)
        .where(
          and(
            eq(taxAccruals.transactionId, transaction.id),
            eq(taxAccruals.revision, 1),
            isNull(taxAccruals.deletedAt),
          ),
        );
      assert.equal(beforePostings.length, 7);
      assert.equal(beforeAccruals.length, 4);

      assert.deepEqual(
        await saveSalary({
          ...payload,
          transactionId: transaction.id,
          expectedRevision: 1,
          companyId: gregResult.draft.bookingEntityId,
          personalDeductionMinor: 46_000,
        }),
        { ok: true },
      );
      const [updatedTransaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transaction.id));
      assert.equal(updatedTransaction.entityId, ENTITY_IDS.skyline);
      assert.equal(updatedTransaction.currentRevision, 2);
      assert.equal(
        await db.$count(
          postings,
          and(
            eq(postings.transactionId, transaction.id),
            eq(postings.revision, 1),
            isNull(postings.deletedAt),
          ),
        ),
        0,
      );
      assert.equal(
        await db.$count(
          postings,
          and(
            eq(postings.transactionId, transaction.id),
            eq(postings.revision, 2),
            isNull(postings.deletedAt),
          ),
        ),
        7,
      );
      assert.equal(
        await db.$count(
          taxAccruals,
          and(
            eq(taxAccruals.transactionId, transaction.id),
            eq(taxAccruals.revision, 1),
            isNull(taxAccruals.deletedAt),
          ),
        ),
        0,
      );
      assert.equal(
        await db.$count(
          taxAccruals,
          and(
            eq(taxAccruals.transactionId, transaction.id),
            eq(taxAccruals.revision, 2),
            isNull(taxAccruals.deletedAt),
          ),
        ),
        4,
      );
      const details = await db
        .select()
        .from(salaryTransactionDetails)
        .where(eq(salaryTransactionDetails.transactionId, transaction.id))
        .orderBy(salaryTransactionDetails.revision);
      assert.deepEqual(
        details.map((row) => [row.revision, row.payMonth, row.personalDeductionMinor]),
        [
          [1, "2026-06-01", 45_000],
          [2, "2026-06-01", 46_000],
        ],
      );
      const draft = await getTransactionEditDraft(transaction.id, ENTITY_IDS.skyline);
      assert.equal(draft.type, "salary");
      assert.equal(draft.payMonth, "2026-06");
      assert.equal(draft.paymentDate, "2026-07-10");
      assert.equal(draft.personalDeduction, "460,00");
      console.log(
        "  household+greg=draft loaded andra=transactionNotFound bookingEntity=Skyline revision=1→2 postings=7→7 accruals=4→4 entityId=unchanged details=45000→46000",
      );
    });

    await fixture("detail survives delete/restore exactly and purge removes it", async () => {
      const payload = entered("__test__ Lifecycle Employee", "2026-06", {
        personalAccountId: personalAccount.id,
      });
      assert.deepEqual(await saveSalary(payload), { ok: true });
      const transaction = await salaryByDescription("Salary __test__ Lifecycle Employee 2026-06");
      track(transaction.id);
      const before = {
        fxCount: await db.$count(fxRates),
        taxCount: await db.$count(taxAccruals),
        detail: await db
          .select()
          .from(salaryTransactionDetails)
          .where(eq(salaryTransactionDetails.transactionId, transaction.id)),
      };
      await softDeleteNonInvestmentTransaction(transaction.id);
      await restoreTransaction(transaction.id, 1);
      const afterRestore = await db
        .select()
        .from(salaryTransactionDetails)
        .where(eq(salaryTransactionDetails.transactionId, transaction.id));
      assert.deepEqual(afterRestore, before.detail);
      assert.equal(await db.$count(fxRates), before.fxCount);
      assert.equal(await db.$count(taxAccruals), before.taxCount);
      await softDeleteNonInvestmentTransaction(transaction.id);
      await purgeTransaction(transaction.id);
      assert.equal(
        await db.$count(
          salaryTransactionDetails,
          eq(salaryTransactionDetails.transactionId, transaction.id),
        ),
        0,
      );
      console.log(`  detail unchanged after restore; fx=${before.fxCount}->${before.fxCount}; taxAccruals=${before.taxCount}->${before.taxCount}; postPurgeDetails=0`);
    });

    await fixture("zero leg-bearing values reject; zero deduction stores", async () => {
      const base = entered("__test__ Zero Employee", "2026-06", {
        personalAccountId: personalAccount.id,
      });
      const fields = [
        "grossMinor",
        "casMinor",
        "cassMinor",
        "incomeTaxMinor",
        "camMinor",
        "netMinor",
      ] as const;
      const before = await db.$count(transactions);
      for (const field of fields) {
        const payload = { ...base, [field]: 0 };
        const preview = await previewSalary(payload);
        assert.ok("error" in preview);
        assert.equal(preview.error.code, "flows.salaryAmountInvalid");
        const saved = await saveSalary(payload);
        assert.ok(saved && "error" in saved);
        assert.equal(saved.error.code, "flows.salaryAmountInvalid");
      }
      assert.equal(await db.$count(transactions), before);
      assert.deepEqual(
        await saveSalary({ ...base, employeeName: "__test__ Zero Deduction", personalDeductionMinor: 0 }),
        { ok: true },
      );
      const zeroDeduction = await salaryByDescription("Salary __test__ Zero Deduction 2026-06");
      track(zeroDeduction.id);
      const [detail] = await db
        .select()
        .from(salaryTransactionDetails)
        .where(eq(salaryTransactionDetails.transactionId, zeroDeduction.id));
      assert.equal(detail.personalDeductionMinor, 0);
      console.log("  rejectedFields=gross,cas,cass,incomeTax,cam,net writes=0; deduction=0 stored");
    });
  } finally {
    const ids = [...allFixtureIds];
    if (ids.length > 0) {
      await db
        .delete(auditLog)
        .where(and(eq(auditLog.tableName, "transactions"), inArray(auditLog.rowId, ids)));
      await db.delete(transactions).where(inArray(transactions.id, ids));
    }
    await db.delete(taxRules).where(inArray(taxRules.id, [...boundaryRuleIds]));
    assert.equal(
      await db.$count(
        transactions,
        sql`${transactions.description} like 'Salary __test__%'`,
      ),
      0,
    );
    assert.equal(
      await db.$count(
        salaryTransactionDetails,
        inArray(salaryTransactionDetails.transactionId, ids),
      ),
      0,
    );
    console.log(`PASS zero fixture residue: transactions=0 details=0 tracked=${ids.length}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
