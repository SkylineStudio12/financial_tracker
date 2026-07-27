import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { accounts, auditLog, postings, transactions } from "@/db/schema";
import {
  createTransaction,
  softDeleteNonInvestmentTransaction,
  type TransactionKind,
} from "@/lib/ledger";
import { saveDividend, saveSalary } from "@/lib/ledger/flow-actions";
import { getFlowPageData } from "@/lib/ledger/flow-page-data";
import {
  getTransactionDetail,
  listDeletedTransactions,
  listTransactions,
  profileAccountScopeCondition,
  selectProfileDisplayLeg,
} from "@/lib/ledger/queries";
import { getProfile, PROFILES, type Profile, type ProfileSlug } from "@/lib/profiles";

let fixtures = 0;
const fixture = async (name: string, work: () => Promise<void>) => {
  await work();
  fixtures += 1;
  console.log(`PASS fixture ${fixtures}: ${name}`);
};

function requiredProfile(slug: ProfileSlug): Profile {
  const profile = getProfile(slug);
  assert.ok(profile, `missing profile ${slug}`);
  return profile;
}

async function requiredAccount(entityId: string, name: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, entityId),
        eq(accounts.name, name),
        isNull(accounts.deletedAt),
      ),
    );
  assert.ok(account, `missing account ${name}`);
  return account;
}

async function listed(profile: Profile) {
  const result = await listTransactions(profile, {}, 1);
  assert.equal(result.rows.length, result.total, `${profile.slug} fixture exceeded one page`);
  return result.rows;
}

async function createFixtureTransaction(input: {
  entityId: string;
  recipientAccountId?: string;
  description: string;
  kind: TransactionKind;
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
}) {
  return createTransaction({
    entityId: input.entityId,
    recipientAccountId: input.recipientAccountId,
    date: "2026-07-10",
    description: input.description,
    kind: input.kind,
    postings: [
      { accountId: input.debitAccountId, amount: -input.amount },
      { accountId: input.creditAccountId, amount: input.amount },
    ],
  });
}

async function assertProfileBalancesCovered(profile: Profile): Promise<void> {
  const rows = await listed(profile);
  const transactionIds = rows.map((row) => row.id);
  const scopedAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(profileAccountScopeCondition(profile), isNull(accounts.deletedAt)));
  const accountIds = scopedAccounts.map((account) => account.id);
  if (accountIds.length === 0) return;

  const direct = await db
    .select({
      accountId: postings.accountId,
      balance: sql<number>`sum(${postings.amount})::int`,
    })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(
      and(
        inArray(postings.accountId, accountIds),
        isNull(postings.deletedAt),
        isNull(transactions.deletedAt),
      ),
    )
    .groupBy(postings.accountId);
  const visible = transactionIds.length
    ? await db
        .select({
          accountId: postings.accountId,
          balance: sql<number>`sum(${postings.amount})::int`,
        })
        .from(postings)
        .innerJoin(transactions, eq(transactions.id, postings.transactionId))
        .where(
          and(
            inArray(postings.accountId, accountIds),
            inArray(transactions.id, transactionIds),
            isNull(postings.deletedAt),
            isNull(transactions.deletedAt),
          ),
        )
        .groupBy(postings.accountId)
    : [];

  assert.deepEqual(
    new Map(visible.map((row) => [row.accountId, row.balance])),
    new Map(direct.map((row) => [row.accountId, row.balance])),
    `${profile.slug} visible transactions do not cover its account balances`,
  );
}

async function main() {
  const skyline = requiredProfile("skyline");
  const greg = requiredProfile("greg");
  const household = requiredProfile("household");
  const andra = requiredProfile("andra");
  const drmx = requiredProfile("drmx");
  const skylineBank = await requiredAccount(skyline.entityId, "Company bank");
  const skylineEquity = await requiredAccount(skyline.entityId, "Owner equity");
  const gregBank = await requiredAccount(household.entityId, "Greg — bank");
  const andraBank = await requiredAccount(household.entityId, "Andra — bank");
  const createdIds: string[] = [];
  const createdAccountIds: string[] = [];

  try {
    const [gregOwnedDrmxBank] = await db
      .insert(accounts)
      .values({
        entityId: drmx.entityId,
        name: "__test__ Greg-owned non-Household bank",
        type: "bank",
        currency: "RON",
        owner: "greg",
      })
      .returning();
    createdAccountIds.push(gregOwnedDrmxBank.id);

    const crossoverSalary = await saveSalary({
      stay: true,
      companyId: skyline.entityId,
      employeeName: "__test__ Crossover Employee",
      payMonth: "2026-06",
      paymentDate: "2026-07-11",
      grossMinor: 450_000,
      casMinor: 112_500,
      cassMinor: 45_000,
      incomeTaxMinor: 23_000,
      camMinor: 10_100,
      netMinor: 269_500,
      personalDeductionMinor: 45_000,
      personalAccountId: andraBank.id,
    });
    const crossoverDividend = await saveDividend({
      stay: true,
      companyId: drmx.entityId,
      date: "2026-07-11",
      grossMinor: 100_000,
      personalAccountId: gregBank.id,
    });
    const sameEntitySalary = await saveSalary({
      stay: true,
      companyId: skyline.entityId,
      employeeName: "__test__ Same-entity Recipient",
      payMonth: "2026-06",
      paymentDate: "2026-07-12",
      grossMinor: 450_000,
      casMinor: 112_500,
      cassMinor: 45_000,
      incomeTaxMinor: 23_000,
      camMinor: 10_100,
      netMinor: 269_500,
      personalDeductionMinor: 45_000,
      personalAccountId: skylineBank.id,
    });
    const sameOwnerWrongEntityDividend = await saveDividend({
      stay: true,
      companyId: skyline.entityId,
      date: "2026-07-12",
      grossMinor: 100_000,
      personalAccountId: gregOwnedDrmxBank.id,
    });
    const crossoverWrites = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        inArray(transactions.description, [
          "Salary __test__ Crossover Employee 2026-06",
          "Dividend distribution 2026-07-11",
          "Salary __test__ Same-entity Recipient 2026-06",
          "Dividend distribution 2026-07-12",
        ]),
      );
    createdIds.push(...crossoverWrites.map((row) => row.id));

    await fixture("salary and dividend writes reject a cross-owner recipient", async () => {
      assert.deepEqual(crossoverSalary, {
        error: { code: "flows.recipientAccountOwnerMismatch" },
      });
      assert.deepEqual(crossoverDividend, {
        error: { code: "flows.recipientAccountOwnerMismatch" },
      });
      assert.equal(crossoverWrites.length, 0);
      console.log("  Skyline→Andra salary + DRMX→Greg dividend code=flows.recipientAccountOwnerMismatch writes=0");
    });

    await fixture("writer rejects same-entity and same-owner non-Household recipients", async () => {
      assert.deepEqual(
        {
          sameEntity: sameEntitySalary,
          sameOwnerWrongEntity: sameOwnerWrongEntityDividend,
        },
        {
          sameEntity: { error: { code: "flows.recipientAccountOwnerMismatch" } },
          sameOwnerWrongEntity: {
            error: { code: "flows.recipientAccountOwnerMismatch" },
          },
        },
      );
      console.log("  same-entity + same-owner/non-Household code=flows.recipientAccountOwnerMismatch");
    });

    await fixture("company flow recipient pickers expose only the mapped owner", async () => {
      const [skylineFlow, drmxFlow] = await Promise.all([
        getFlowPageData(skyline.entityId),
        getFlowPageData(drmx.entityId),
      ]);
      assert.deepEqual(
        skylineFlow.personalAccounts.map((account) => account.name),
        ["Greg — bank", "Greg — cash"],
      );
      assert.deepEqual(
        drmxFlow.personalAccounts.map((account) => account.name),
        ["Andra — bank", "Andra — savings"],
      );
      console.log("  Skyline=[Greg — bank, Greg — cash]; DRMX=[Andra — bank, Andra — savings]");
    });

    const compliantSalaryPayload = {
      stay: true,
      companyId: skyline.entityId,
      employeeName: "__test__ Visibility Employee",
      payMonth: "2026-06",
      paymentDate: "2026-07-10",
      grossMinor: 450_000,
      casMinor: 112_500,
      cassMinor: 45_000,
      incomeTaxMinor: 23_000,
      camMinor: 10_100,
      netMinor: 269_500,
      personalDeductionMinor: 45_000,
      personalAccountId: gregBank.id,
    } as const;
    const salaryResult = await saveSalary({
      ...compliantSalaryPayload,
    });
    assert.deepEqual(salaryResult, { ok: true });
    const [salary] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.description, "Salary __test__ Visibility Employee 2026-06"));
    assert.ok(salary);
    const salaryId = salary.id;
    createdIds.push(salaryId);

    await fixture("a compliant salary booking and edit both pass", async () => {
      assert.deepEqual(
        await saveSalary({
          ...compliantSalaryPayload,
          transactionId: salaryId,
          expectedRevision: 1,
        }),
        { ok: true },
      );
      const [edited] = await db
        .select({ revision: transactions.currentRevision })
        .from(transactions)
        .where(eq(transactions.id, salaryId));
      assert.equal(edited.revision, 2);
      console.log("  Skyline→Greg create=ok edit=ok revision=2");
    });

    await fixture("June salary shows each profile's own signed side", async () => {
      const skylineRow = (await listed(skyline)).find((row) => row.id === salaryId);
      const gregRow = (await listed(greg)).find((row) => row.id === salaryId);
      const householdRow = (await listed(household)).find((row) => row.id === salaryId);
      assert.deepEqual(
        [skylineRow?.amount, skylineRow?.accountName],
        [-269_500, "Company bank"],
      );
      assert.deepEqual([gregRow?.amount, gregRow?.accountName], [269_500, "Greg — bank"]);
      assert.deepEqual(
        [householdRow?.amount, householdRow?.accountName],
        [269_500, "Greg — bank"],
      );
      console.log("  Skyline=-269500 Company bank; Greg=+269500 Greg bank; Household=+269500 Greg bank");
    });

    await fixture("salary detail follows profile posting visibility", async () => {
      const [skylineDetail, gregDetail, householdDetail, andraDetail, drmxDetail] =
        await Promise.all([
          getTransactionDetail(salaryId, skyline),
          getTransactionDetail(salaryId, greg),
          getTransactionDetail(salaryId, household),
          getTransactionDetail(salaryId, andra),
          getTransactionDetail(salaryId, drmx),
        ]);
      assert.equal(skylineDetail?.transaction.id, salaryId);
      assert.equal(gregDetail?.transaction.id, salaryId);
      assert.equal(householdDetail?.transaction.id, salaryId);
      assert.equal(andraDetail, null);
      assert.equal(drmxDetail, null);
      console.log("  Skyline/Greg/Household=accessible; Andra/DRMX=not found");
    });

    const companyOnlyId = await createFixtureTransaction({
      entityId: skyline.entityId,
      description: "__test__ Skyline-only fee",
      kind: "transfer",
      debitAccountId: skylineBank.id,
      creditAccountId: skylineEquity.id,
      amount: 10_000,
    });
    createdIds.push(companyOnlyId);

    await fixture("Skyline-only transaction appears only in Skyline", async () => {
      const visibility = await Promise.all(
        PROFILES.map(async (profile) => [
          profile.slug,
          (await listed(profile)).some((row) => row.id === companyOnlyId),
        ] as const),
      );
      assert.deepEqual(
        Object.fromEntries(visibility),
        { household: false, greg: false, skyline: true, andra: false, drmx: false },
      );
      console.log("  visible=skyline only");
    });

    await fixture("Andra gains nothing from Greg's salary", async () => {
      assert.equal((await listed(andra)).some((row) => row.id === salaryId), false);
      assert.equal((await listed(drmx)).some((row) => row.id === salaryId), false);
      console.log("  andra=false drmx=false");
    });

    await fixture("profile-visible transactions cover every scoped account balance", async () => {
      for (const profile of PROFILES) await assertProfileBalancesCovered(profile);
      console.log("  profiles=household,greg,skyline,andra,drmx account-balance coverage exact");
    });

    const trashedSalaryId = await createFixtureTransaction({
      entityId: skyline.entityId,
      recipientAccountId: gregBank.id,
      description: "__test__ Trashed cross-profile salary",
      kind: "salary",
      debitAccountId: skylineBank.id,
      creditAccountId: gregBank.id,
      amount: 269_500,
    });
    createdIds.push(trashedSalaryId);
    await softDeleteNonInvestmentTransaction(trashedSalaryId);

    await fixture("trashed cross-profile row keeps profile visibility and signed sides", async () => {
      const skylineRow = (await listDeletedTransactions(skyline)).find(
        (row) => row.id === trashedSalaryId,
      );
      const gregRow = (await listDeletedTransactions(greg)).find(
        (row) => row.id === trashedSalaryId,
      );
      const householdRow = (await listDeletedTransactions(household)).find(
        (row) => row.id === trashedSalaryId,
      );
      assert.deepEqual(
        [skylineRow?.amount, skylineRow?.accountName],
        [-269_500, "Company bank"],
      );
      assert.deepEqual([gregRow?.amount, gregRow?.accountName], [269_500, "Greg — bank"]);
      assert.deepEqual(
        [householdRow?.amount, householdRow?.accountName],
        [269_500, "Greg — bank"],
      );
      assert.equal(
        (await listDeletedTransactions(andra)).some((row) => row.id === trashedSalaryId),
        false,
      );
      assert.equal(
        (await listDeletedTransactions(drmx)).some((row) => row.id === trashedSalaryId),
        false,
      );
      console.log("  trash Skyline=-269500; Greg=+269500; Household=+269500; Andra/DRMX absent");
    });

    const trashedCompanyOnlyId = await createFixtureTransaction({
      entityId: skyline.entityId,
      description: "__test__ 2951-style ownerless company transfer",
      kind: "transfer",
      debitAccountId: skylineBank.id,
      creditAccountId: skylineEquity.id,
      amount: 269_500,
    });
    createdIds.push(trashedCompanyOnlyId);
    await softDeleteNonInvestmentTransaction(trashedCompanyOnlyId);

    await fixture("ownerless company trash row appears only in Skyline", async () => {
      const visibility = await Promise.all(
        PROFILES.map(async (profile) => [
          profile.slug,
          (await listDeletedTransactions(profile)).some(
            (row) => row.id === trashedCompanyOnlyId,
          ),
        ] as const),
      );
      assert.deepEqual(
        Object.fromEntries(visibility),
        { household: false, greg: false, skyline: true, andra: false, drmx: false },
      );
      console.log("  trash visible=skyline only");
    });

    await fixture("empty profile display candidates fail loudly", async () => {
      assert.throws(
        () => selectProfileDisplayLeg([], "__test__ empty"),
        /has no posting in the viewing profile/,
      );
      console.log("  empty candidates throw");
    });
  } finally {
    if (createdIds.length > 0) {
      await db
        .delete(auditLog)
        .where(and(eq(auditLog.tableName, "transactions"), inArray(auditLog.rowId, createdIds)));
      await db.delete(transactions).where(inArray(transactions.id, createdIds));
    }
    if (createdAccountIds.length > 0) {
      await db.delete(accounts).where(inArray(accounts.id, createdAccountIds));
    }
    assert.equal(
      await db.$count(
        transactions,
        sql`${transactions.description} like '__test__ %'`,
      ),
      0,
    );
    console.log(`PASS zero fixture residue: transactions=0 tracked=${createdIds.length}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
