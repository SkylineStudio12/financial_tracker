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
import { getTransactionEditDraft } from "./edit-drafts";

let fixtureNumber = 0;
async function fixture(name: string, work: () => Promise<void>): Promise<void> {
  await work();
  fixtureNumber += 1;
  console.log(`PASS fixture ${fixtureNumber}: ${name}`);
}

function entered(
  employeeName: string,
  month = "2026-06",
  overrides: Partial<SalaryFlowPayload> = {},
): SalaryFlowPayload {
  return {
    stay: true,
    companyId: ENTITY_IDS.skyline,
    employeeName,
    month,
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

  try {
    await fixture("payslip values book seven exact legs, four accruals, and deduction 450 RON", async () => {
      const payload = entered("__test__ Payslip Employee", "2026-06", {
        personalAccountId: personalAccount.id,
      });
      assert.deepEqual(await saveSalary(payload), { ok: true });
      const transaction = await salaryByDescription("Salary __test__ Payslip Employee 2026-06");
      track(transaction.id);
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
        .select({ ruleType: taxRules.ruleType, amount: postings.amount })
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
      const [detail] = await db
        .select()
        .from(salaryTransactionDetails)
        .where(eq(salaryTransactionDetails.transactionId, transaction.id));
      assert.equal(detail.revision, 1);
      assert.equal(detail.personalDeductionMinor, 45_000);
      console.log(
        "  values gross=450000 cas=112500 cass=45000 incomeTax=23000 cam=10100 net=269500 deduction=45000 legs=7 accruals=4 sum=0",
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
      });
      const second = entered("__test__ Repeat Employee", "2026-06", {
        personalAccountId: personalAccount.id,
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
      assert.equal(repeated.month, "2026-06");
      assert.equal(repeated.gross, "4600,00");
      assert.equal(repeated.net, "2750,00");
      assert.equal(repeated.personalDeduction, "450,00");
      console.log("  matched=__test__ Repeat Employee newestMonth=2026-06 gross=460000 net=275000 deduction=45000");
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
      assert.equal(draft.personalDeduction, "");
      console.log("  legacy detail rows=0 repeatResult=null editDeduction=blank");
    });

    await fixture("legacy edit requires entered deduction and creates revision-2 detail", async () => {
      assert.deepEqual(
        await saveSalary({
          ...entered("__test__ Legacy Employee", "2026-04", {
            personalAccountId: personalAccount.id,
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
        details.map((row) => [row.revision, row.personalDeductionMinor]),
        [[2, 45_000]],
      );
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
      console.log("  currentRevision=2 details=[[2,45000]] revision1LivePostings=0");
    });

    await fixture("entered salary edit appends detail and preserves prior revision", async () => {
      const payload = entered("__test__ Edit Employee", "2026-06", {
        personalAccountId: personalAccount.id,
      });
      assert.deepEqual(await saveSalary(payload), { ok: true });
      const transaction = await salaryByDescription("Salary __test__ Edit Employee 2026-06");
      track(transaction.id);
      assert.deepEqual(
        await saveSalary({
          ...payload,
          transactionId: transaction.id,
          expectedRevision: 1,
          personalDeductionMinor: 46_000,
        }),
        { ok: true },
      );
      const details = await db
        .select()
        .from(salaryTransactionDetails)
        .where(eq(salaryTransactionDetails.transactionId, transaction.id))
        .orderBy(salaryTransactionDetails.revision);
      assert.deepEqual(
        details.map((row) => [row.revision, row.personalDeductionMinor]),
        [
          [1, 45_000],
          [2, 46_000],
        ],
      );
      const draft = await getTransactionEditDraft(transaction.id, ENTITY_IDS.skyline);
      assert.equal(draft.type, "salary");
      assert.equal(draft.personalDeduction, "460,00");
      console.log("  details revision1=45000 revision2=46000 currentDraftDeduction=46000");
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
