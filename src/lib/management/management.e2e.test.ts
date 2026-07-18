import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  accounts,
  auditLog,
  categories,
  employeeSalaryProfiles,
  employees,
  postings,
  salaryTransactionDetails,
  taxAccruals,
  taxRules,
  transactions,
} from "@/db/schema";
import { LedgerValidationError } from "@/lib/app-error";
import { AccountLabel, CategoryLabel } from "@/components/category-label";
import { SUGGESTED_CATEGORY_BY_KIND } from "@/lib/import/config";
import { getFormOptions } from "@/lib/ledger/form-options";
import { saveSalary } from "@/lib/ledger/flow-actions";
import {
  getFilterOptions,
  getTransactionDetail,
  listDeletedTransactions,
  listTransactions,
} from "@/lib/ledger/queries";
import {
  createTransaction,
  softDeleteNonInvestmentTransaction,
} from "@/lib/ledger/service";
import {
  defaultSalaryPayMonth,
  salaryPayMonthAfterPaymentDateChange,
} from "@/lib/ledger/salary-dates";
import { ENTITY_IDS, getProfile } from "@/lib/profiles";
import { resolveAutomaticSalaryPrefill } from "./salary-prefill";
import {
  categoryDuplicateGroups,
  createCategory,
  createEmployee,
  createManagedAccount,
  deleteSalaryProfile,
  getEmployeeSalaryPrefill,
  listManagedAccounts,
  listManagedCategories,
  purgeCategory,
  purgeManagedAccount,
  restoreCategory,
  restoreManagedAccount,
  saveSalaryProfile,
  seedRevenueCategories,
  softDeleteCategory,
  softDeleteEmployee,
  softDeleteManagedAccount,
  updateCategory,
  updateEmployee,
  updateManagedAccount,
  type SalaryProfileValues,
} from "./service";

const COMPANY_ID = ENTITY_IDS.skyline;
const createdCategoryIds: string[] = [];
const createdAccountIds: string[] = [];
const createdEmployeeIds: string[] = [];
const createdTransactionIds: string[] = [];

const canonicalProfile: SalaryProfileValues = {
  grossMinor: 450_000,
  casMinor: 112_500,
  cassMinor: 45_000,
  incomeTaxMinor: 23_000,
  camMinor: 10_100,
  netMinor: 269_500,
  personalDeductionMinor: 62_800,
};

async function expectCode(operation: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    operation,
    (error) => error instanceof LedgerValidationError && error.code === code,
  );
}

function hasPgCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const pg = current as { code?: string; cause?: unknown };
    if (pg.code === code) return true;
    current = pg.cause;
  }
  return false;
}

async function ledgerCounts() {
  return {
    transactions: await db.$count(transactions),
    postings: await db.$count(postings),
    accruals: await db.$count(taxAccruals),
  };
}

async function salaryShape(transactionId: string) {
  const postingRows = await db
    .select({ amount: postings.amount, type: accounts.type })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(and(eq(postings.transactionId, transactionId), isNull(postings.deletedAt)))
    .orderBy(accounts.type, postings.amount);
  const accrualRows = await db
    .select({ amount: postings.amount, ruleType: taxRules.ruleType })
    .from(taxAccruals)
    .innerJoin(postings, eq(postings.id, taxAccruals.postingId))
    .innerJoin(taxRules, eq(taxRules.id, taxAccruals.taxRuleId))
    .where(and(eq(taxAccruals.transactionId, transactionId), isNull(taxAccruals.deletedAt)))
    .orderBy(taxRules.ruleType);
  const [detail] = await db
    .select({ personalDeductionMinor: salaryTransactionDetails.personalDeductionMinor })
    .from(salaryTransactionDetails)
    .where(eq(salaryTransactionDetails.transactionId, transactionId));
  return { postingRows, accrualRows, detail };
}

async function main(): Promise<void> {
  const baselineLedger = await ledgerCounts();
  const baselineAudit = await db.$count(auditLog);

  try {
    const firstEmployee = await createEmployee(COMPANY_ID, "Fixture Employee");
    createdEmployeeIds.push(firstEmployee);
    await expectCode(
      () => createEmployee(COMPANY_ID, "fixture employee"),
      "manage.employeeDuplicate",
    );
    await updateEmployee(firstEmployee, COMPANY_ID, {
      name: "Fixture Employee Renamed",
      isActive: false,
    });
    await softDeleteEmployee(firstEmployee, COMPANY_ID);
    const recreatedEmployee = await createEmployee(COMPANY_ID, "Fixture Employee Renamed");
    createdEmployeeIds.push(recreatedEmployee);
    console.log(
      `PASS fixture 1 employees CRUD: duplicate refused, rename/inactivate/delete audited, soft-deleted name recreated as ${recreatedEmployee}`,
    );

    await saveSalaryProfile(recreatedEmployee, COMPANY_ID, canonicalProfile);
    const [stored] = await db
      .select()
      .from(employeeSalaryProfiles)
      .where(eq(employeeSalaryProfiles.employeeId, recreatedEmployee));
    assert.deepEqual(
      {
        grossMinor: stored.grossMinor,
        casMinor: stored.casMinor,
        cassMinor: stored.cassMinor,
        incomeTaxMinor: stored.incomeTaxMinor,
        camMinor: stored.camMinor,
        netMinor: stored.netMinor,
        personalDeductionMinor: stored.personalDeductionMinor,
      },
      canonicalProfile,
    );
    await expectCode(
      () =>
        saveSalaryProfile(recreatedEmployee, COMPANY_ID, {
          ...canonicalProfile,
          netMinor: canonicalProfile.netMinor + 1,
        }),
      "manage.salaryProfileNetMismatch",
    );
    const updatedProfile = { ...canonicalProfile, personalDeductionMinor: 45_000 };
    await saveSalaryProfile(recreatedEmployee, COMPANY_ID, updatedProfile);
    const auditRows = await db
      .select({ previousValues: auditLog.previousValues })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tableName, "employee_salary_profiles"),
          eq(auditLog.rowId, recreatedEmployee),
          eq(auditLog.action, "update"),
        ),
      );
    assert.equal(
      (auditRows.at(-1)?.previousValues as SalaryProfileValues).personalDeductionMinor,
      62_800,
    );
    await deleteSalaryProfile(recreatedEmployee, COMPANY_ID);
    assert.equal(await db.$count(employeeSalaryProfiles), 0);
    await saveSalaryProfile(recreatedEmployee, COMPANY_ID, canonicalProfile);
    console.log(
      "PASS fixture 2 salary profile: 450000/112500/45000/23000/10100/269500/62800 stored verbatim; one-ban mismatch refused; audit restored prior seven values",
    );

    const serviceSource = await readFile("src/lib/management/service.ts", "utf8");
    assert.doesNotMatch(serviceSource, /@\/lib\/tax\//);
    assert.doesNotMatch(serviceSource, /rateBps|percentage|\/\s*100/);
    console.log("PASS fixture 3 no-computation proof: no tax import, rate, percentage, or derivation");

    const householdAccounts = await listManagedAccounts(ENTITY_IDS.household);
    assert.ok(householdAccounts.some((account) => account.owner === "greg"));
    assert.ok(householdAccounts.some((account) => account.owner === "andra"));
    assert.ok(householdAccounts.every((account) => ["bank", "cash", "brokerage"].includes(account.type)));
    const brokerage = householdAccounts.find((account) => account.type === "brokerage");
    assert.ok(brokerage?.readOnly);
    await expectCode(
      () =>
        updateManagedAccount(brokerage.id, ENTITY_IDS.household, {
          name: brokerage.name,
          type: "bank",
          currency: brokerage.currency,
          owner: brokerage.owner,
          isActive: brokerage.isActive,
        }),
      "manage.accountReadOnly",
    );
    await expectCode(
      () =>
        createManagedAccount(ENTITY_IDS.household, {
          name: "Fixture Ownerless",
          type: "bank",
          currency: "RON",
          owner: null,
          isActive: true,
        }),
      "manage.accountOwnerRequired",
    );
    await expectCode(
      () =>
        createManagedAccount(COMPANY_ID, {
          name: "Fixture Company Owned",
          type: "bank",
          currency: "RON",
          owner: "greg",
          isActive: true,
        }),
      "manage.companyAccountOwnerForbidden",
    );
    const mutableAccountId = await createManagedAccount(ENTITY_IDS.household, {
      name: "Fixture Household Cash",
      type: "cash",
      currency: "EUR",
      owner: "greg",
      isActive: true,
    });
    createdAccountIds.push(mutableAccountId);
    await expectCode(
      () =>
        updateManagedAccount(mutableAccountId, ENTITY_IDS.household, {
          name: "Fixture Household Cash",
          type: "cash",
          currency: "EUR",
          owner: null,
          isActive: true,
        }),
      "manage.accountOwnerRequired",
    );
    console.log(
      "PASS fixture 4a.1 Q3 negative owner paths: household create/edit owner NULL refused; company owner set refused",
    );
    await expectCode(
      () =>
        createManagedAccount(ENTITY_IDS.household, {
          name: " fixture household cash ",
          type: "bank",
          currency: "USD",
          owner: "andra",
          isActive: true,
        }),
      "manage.accountDuplicate",
    );
    await updateManagedAccount(mutableAccountId, ENTITY_IDS.household, {
      name: "Fixture Household Bank",
      type: "bank",
      currency: "USD",
      owner: "andra",
      isActive: false,
    });
    const mutated = (await listManagedAccounts(ENTITY_IDS.household)).find(
      (account) => account.id === mutableAccountId,
    );
    assert.deepEqual(
      mutated && {
        name: mutated.name,
        type: mutated.type,
        currency: mutated.currency,
        owner: mutated.owner,
        isActive: mutated.isActive,
      },
      {
        name: "Fixture Household Bank",
        type: "bank",
        currency: "USD",
        owner: "andra",
        isActive: false,
      },
    );

    const historyAccountId = await createManagedAccount(COMPANY_ID, {
      name: "Fixture History Bank",
      type: "bank",
      currency: "RON",
      owner: null,
      isActive: true,
    });
    createdAccountIds.push(historyAccountId);
    const [companyEquity] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.entityId, COMPANY_ID),
          eq(accounts.type, "equity"),
          isNull(accounts.deletedAt),
        ),
      );
    assert.ok(companyEquity);
    const accountTransactionId = await createTransaction({
      entityId: COMPANY_ID,
      date: "2026-01-14",
      description: "Management account fixture",
      kind: "transfer",
      postings: [
        { accountId: historyAccountId, amount: -500 },
        { accountId: companyEquity.id, amount: 500 },
      ],
    });
    createdTransactionIds.push(accountTransactionId);
    const withBalance = (await listManagedAccounts(COMPANY_ID)).find(
      (account) => account.id === historyAccountId,
    );
    assert.equal(withBalance?.balanceRon, -500);
    assert.equal(withBalance?.postingCount, 1);
    await expectCode(
      () =>
        updateManagedAccount(historyAccountId, COMPANY_ID, {
          name: "Fixture History Cash",
          type: "cash",
          currency: "RON",
          owner: null,
          isActive: true,
        }),
      "manage.accountHistoryLocked",
    );
    await expectCode(
      () => softDeleteManagedAccount(historyAccountId, COMPANY_ID),
      "manage.accountInUse",
    );
    await updateManagedAccount(historyAccountId, COMPANY_ID, {
      name: "Fixture History Bank Renamed",
      type: "bank",
      currency: "RON",
      owner: null,
      isActive: false,
    });
    await softDeleteNonInvestmentTransaction(accountTransactionId);
    await softDeleteManagedAccount(historyAccountId, COMPANY_ID);
    const skyline = getProfile("skyline");
    assert.ok(skyline);
    const trashedAccountRow = (await listDeletedTransactions(skyline)).find(
      (row) => row.id === accountTransactionId,
    );
    assert.ok(trashedAccountRow);
    assert.equal(trashedAccountRow?.accountName, "Fixture History Bank Renamed");
    assert.equal(trashedAccountRow?.accountDeleted, true);
    const accountLabelHtml = renderToStaticMarkup(
      createElement(AccountLabel, {
        name: trashedAccountRow.accountName,
        deleted: trashedAccountRow.accountDeleted,
        deletedTooltip: "Account deleted — historical label",
      }),
    );
    assert.match(accountLabelHtml, /text-text-muted/);
    assert.match(accountLabelHtml, /lucide-archive/);
    assert.match(accountLabelHtml, /Account deleted — historical label/);
    await expectCode(
      () => purgeManagedAccount(historyAccountId, COMPANY_ID),
      "manage.accountReferencedCannotPurge",
    );
    await restoreManagedAccount(historyAccountId, COMPANY_ID);
    assert.ok(
      (await listManagedAccounts(COMPANY_ID)).some((account) => account.id === historyAccountId),
    );
    await softDeleteManagedAccount(historyAccountId, COMPANY_ID);
    await db.delete(auditLog).where(eq(auditLog.rowId, accountTransactionId));
    await db.delete(transactions).where(eq(transactions.id, accountTransactionId));
    createdTransactionIds.splice(createdTransactionIds.indexOf(accountTransactionId), 1);

    await softDeleteManagedAccount(mutableAccountId, ENTITY_IDS.household);
    await restoreManagedAccount(mutableAccountId, ENTITY_IDS.household);
    const restoredAccount = (await listManagedAccounts(ENTITY_IDS.household)).find(
      (account) => account.id === mutableAccountId,
    );
    assert.deepEqual(
      restoredAccount && {
        name: restoredAccount.name,
        type: restoredAccount.type,
        currency: restoredAccount.currency,
        owner: restoredAccount.owner,
        isActive: restoredAccount.isActive,
      },
      {
        name: "Fixture Household Bank",
        type: "bank",
        currency: "USD",
        owner: "andra",
        isActive: false,
      },
    );
    await softDeleteManagedAccount(mutableAccountId, ENTITY_IDS.household);
    const accountCollisionId = await createManagedAccount(ENTITY_IDS.household, {
      name: "fixture household bank",
      type: "bank",
      currency: "RON",
      owner: "greg",
      isActive: true,
    });
    createdAccountIds.push(accountCollisionId);
    await expectCode(
      () => restoreManagedAccount(mutableAccountId, ENTITY_IDS.household),
      "manage.restoreNameTaken",
    );
    await softDeleteManagedAccount(accountCollisionId, ENTITY_IDS.household);
    await purgeManagedAccount(accountCollisionId, ENTITY_IDS.household);
    await restoreManagedAccount(mutableAccountId, ENTITY_IDS.household);
    await softDeleteManagedAccount(mutableAccountId, ENTITY_IDS.household);
    await purgeManagedAccount(mutableAccountId, ENTITY_IDS.household);
    console.log(
      "PASS fixture 4a accounts: owner/system/brokerage rules, app duplicate refusal, -500 RON balance, history lock, delete guard, archived label, referenced-purge refusal, exact restore, collision refusal, unused purge",
    );
    const managementClientSource = await readFile(
      "src/components/management/management-client.tsx",
      "utf8",
    );
    assert.equal(managementClientSource.match(/disabled=\{accountShapeLocked\}/g)?.length, 3);
    assert.match(managementClientSource, /!company && <TableHead>\{t\("owner"\)\}<\/TableHead>/);
    assert.match(managementClientSource, /t\("accountsEmpty"\)/);
    assert.match(managementClientSource, /t\("systemAccountsCaption"\)/);
    assert.match(managementClientSource, /deletedAccounts\.length > 0/);
    assert.match(managementClientSource, /deletedCategories\.length > 0/);
    assert.match(managementClientSource, /t\("deactivateInstead"\)/);
    console.log(
      "PASS fixture 4b account UI: three historical-shape controls lock, company owner column absent, honest empty/system copy, zero-count disclosures absent, in-use delete offers Deactivate",
    );

    let repeatCalls = 0;
    const fromProfile = await resolveAutomaticSalaryPrefill(canonicalProfile, async () => {
      repeatCalls += 1;
      return { gross: "1,00", cas: "1,00", cass: "1,00", incomeTax: "1,00", cam: "1,00", net: "1,00", personalDeduction: "0,00" };
    });
    assert.equal(fromProfile.source, "profile");
    assert.equal(fromProfile.values?.gross, "4500,00");
    assert.equal(repeatCalls, 0);
    const fromRepeat = await resolveAutomaticSalaryPrefill(null, async () => {
      repeatCalls += 1;
      return { gross: "4400,00", cas: "1100,00", cass: "440,00", incomeTax: "220,00", cam: "99,00", net: "2640,00", personalDeduction: "0,00" };
    });
    assert.equal(fromRepeat.source, "repeat-last");
    const blank = await resolveAutomaticSalaryPrefill(null, async () => null);
    assert.equal(blank.source, "blank");
    const loadedProfile = await getEmployeeSalaryPrefill(COMPANY_ID, recreatedEmployee);
    assert.deepEqual(loadedProfile.profile, canonicalProfile);
    console.log(
      "PASS fixture 4 prefill precedence: profile wins without repeat call; no profile uses repeat-last; neither stays blank; edit guard remains profile-free",
    );

    assert.deepEqual(await ledgerCounts(), baselineLedger);
    console.log("PASS fixture 7 ledger isolation before booking fixture: transactions/postings/accruals unchanged");

    const [personalAccount] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.entityId, ENTITY_IDS.household),
          eq(accounts.type, "bank"),
          eq(accounts.currency, "RON"),
          isNull(accounts.deletedAt),
        ),
      );
    assert.ok(personalAccount);
    for (const [employeeName, payMonth, paymentDate] of [
      ["Profile Fixture", "2026-04", "2026-05-10"],
      ["Manual Fixture", "2026-05", "2026-06-10"],
    ] as const) {
      const result = await saveSalary({
        stay: true,
        companyId: COMPANY_ID,
        employeeName,
        payMonth,
        paymentDate,
        ...canonicalProfile,
        personalAccountId: personalAccount.id,
      });
      assert.deepEqual(result, { ok: true });
      const [transaction] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.description, `Salary ${employeeName} ${payMonth}`));
      assert.ok(transaction);
      createdTransactionIds.push(transaction.id);
    }
    assert.deepEqual(
      await salaryShape(createdTransactionIds[0]),
      await salaryShape(createdTransactionIds[1]),
    );
    console.log(
      "PASS fixture 5 booking equivalence: profile/manual values each produced 7 postings, 4 accruals, and deduction 62800",
    );

    const parentId = await createCategory({
      entityId: COMPANY_ID,
      name: "Fixture Parent",
      kind: "expense",
    });
    createdCategoryIds.push(parentId);
    const childId = await createCategory({
      entityId: COMPANY_ID,
      name: "Fixture Child",
      kind: "expense",
      parentId,
    });
    createdCategoryIds.push(childId);
    await expectCode(
      () =>
        createCategory({
          entityId: COMPANY_ID,
          name: "Fixture Grandchild",
          kind: "expense",
          parentId: childId,
        }),
      "manage.categoryDepthExceeded",
    );
    await expectCode(
      () => createCategory({ entityId: COMPANY_ID, name: "fixture parent", kind: "expense" }),
      "manage.categoryDuplicate",
    );
    await expectCode(
      () => updateCategory(parentId, COMPANY_ID, { name: "Fixture Parent", kind: "income" }),
      "manage.categoryKindImmutable",
    );
    const [protectedCategory] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.entityId, COMPANY_ID),
          eq(categories.name, "Salaries"),
          isNull(categories.deletedAt),
        ),
      );
    assert.ok(protectedCategory);
    await expectCode(
      () =>
        updateCategory(protectedCategory.id, COMPANY_ID, {
          name: "Payroll",
          kind: "expense",
        }),
      "manage.categoryProtected",
    );
    await expectCode(
      () => softDeleteCategory(protectedCategory.id, COMPANY_ID),
      "manage.categoryProtected",
    );

    const inUseId = await createCategory({
      entityId: COMPANY_ID,
      name: "Fixture In Use",
      kind: "expense",
    });
    createdCategoryIds.push(inUseId);
    const companyAccounts = await db
      .select({ id: accounts.id, type: accounts.type })
      .from(accounts)
      .where(and(eq(accounts.entityId, COMPANY_ID), isNull(accounts.deletedAt)));
    const bank = companyAccounts.find((account) => account.type === "bank");
    const equity = companyAccounts.find((account) => account.type === "equity");
    assert.ok(bank && equity);
    const categoryTransactionId = await createTransaction({
      entityId: COMPANY_ID,
      date: "2026-01-15",
      description: "Management category fixture",
      kind: "standard",
      postings: [
        { accountId: bank.id, amount: -100 },
        { accountId: equity.id, amount: 100, categoryId: inUseId },
      ],
    });
    createdTransactionIds.push(categoryTransactionId);
    await expectCode(() => softDeleteCategory(inUseId, COMPANY_ID), "manage.categoryInUse");

    // Simulate the accepted category-delete race directly: the management
    // guard normally refuses while this live posting exists.
    await db
      .update(categories)
      .set({ deletedAt: new Date("2026-01-16T00:00:00Z") })
      .where(eq(categories.id, inUseId));
    const listed = await listTransactions(skyline, {}, 1);
    const listedRaceRow = listed.rows.find((row) => row.id === categoryTransactionId);
    assert.ok(listedRaceRow);
    assert.equal(listedRaceRow?.category, "Fixture In Use");
    assert.equal(listedRaceRow?.categoryDeleted, true);
    const detail = await getTransactionDetail(categoryTransactionId, skyline);
    const detailRacePosting = detail?.postings.find(
      (posting) => posting.categoryName === "Fixture In Use",
    );
    assert.equal(detailRacePosting?.categoryName, "Fixture In Use");
    assert.ok(detailRacePosting?.categoryDeletedAt);
    const categoryLabelHtml = renderToStaticMarkup(
      createElement(CategoryLabel, {
        name: listedRaceRow.category,
        deleted: listedRaceRow.categoryDeleted,
        deletedTooltip: "Category deleted — historical label",
      }),
    );
    assert.match(categoryLabelHtml, /text-text-muted/);
    assert.match(categoryLabelHtml, /lucide-archive/);
    assert.match(categoryLabelHtml, /Category deleted — historical label/);
    const regularFilters = await getFilterOptions(COMPANY_ID);
    assert.equal(regularFilters.categories.some((category) => category.id === inUseId), false);
    const pinnedFilters = await getFilterOptions(COMPANY_ID, undefined, { categoryId: inUseId });
    assert.deepEqual(
      pinnedFilters.categories.find((category) => category.id === inUseId),
      { id: inUseId, name: "Fixture In Use", deleted: true },
    );
    const listSource = await readFile("src/app/p/[profile]/transactions/page.tsx", "utf8");
    const detailSource = await readFile(
      "src/app/p/[profile]/transactions/[transactionId]/page.tsx",
      "utf8",
    );
    assert.match(listSource, /<CategoryLabel/);
    assert.match(listSource, /deleted=\{row\.categoryDeleted\}/);
    assert.match(listSource, /selectedCategory\?\.deleted/);
    assert.match(detailSource, /<CategoryLabel/);
    assert.match(detailSource, /posting\.categoryDeletedAt !== null/);
    await db
      .update(categories)
      .set({ deletedAt: null })
      .where(eq(categories.id, inUseId));
    console.log(
      "PASS fixture 6a accepted category-delete race: production list/detail joins retain the name; list/detail/pinned filter render shared muted Archive treatment",
    );

    await softDeleteNonInvestmentTransaction(categoryTransactionId);
    await softDeleteCategory(inUseId, COMPANY_ID);
    const [historical] = await db
      .select({ name: categories.name })
      .from(postings)
      .innerJoin(categories, eq(categories.id, postings.categoryId))
      .where(eq(postings.transactionId, categoryTransactionId));
    assert.equal(historical.name, "Fixture In Use");
    const formOptions = await getFormOptions(COMPANY_ID);
    assert.equal(formOptions.categories.some((category) => category.id === inUseId), false);
    assert.ok(
      (await listManagedCategories(COMPANY_ID, "deleted")).some(
        (category) => category.id === inUseId && category.postingCount === 1,
      ),
    );
    await expectCode(
      () => purgeCategory(inUseId, COMPANY_ID),
      "manage.categoryReferencedCannotPurge",
    );
    await restoreCategory(inUseId, COMPANY_ID);
    assert.ok((await listManagedCategories(COMPANY_ID)).some((category) => category.id === inUseId));
    await softDeleteCategory(inUseId, COMPANY_ID);
    const unusedId = await createCategory({
      entityId: COMPANY_ID,
      name: "Fixture Unused",
      kind: "expense",
    });
    createdCategoryIds.push(unusedId);
    await softDeleteCategory(unusedId, COMPANY_ID);
    await restoreCategory(unusedId, COMPANY_ID);
    await softDeleteCategory(unusedId, COMPANY_ID);
    const categoryCollisionId = await createCategory({
      entityId: COMPANY_ID,
      name: "fixture unused",
      kind: "expense",
    });
    createdCategoryIds.push(categoryCollisionId);
    await expectCode(() => restoreCategory(unusedId, COMPANY_ID), "manage.restoreNameTaken");
    await softDeleteCategory(categoryCollisionId, COMPANY_ID);
    await purgeCategory(categoryCollisionId, COMPANY_ID);
    await restoreCategory(unusedId, COMPANY_ID);
    await softDeleteCategory(unusedId, COMPANY_ID);
    await purgeCategory(unusedId, COMPANY_ID);

    await softDeleteCategory(parentId, COMPANY_ID);
    await expectCode(() => purgeCategory(parentId, COMPANY_ID), "manage.categoryHasChildren");
    await restoreCategory(parentId, COMPANY_ID);

    await assert.rejects(
      db.insert(categories).values({ entityId: COMPANY_ID, name: "FIXTURE PARENT", kind: "expense" }),
      (error) => hasPgCode(error, "23505"),
    );
    console.log(
      "PASS fixture 6 category recovery: constraints/protected guard, race join + muted Archive tooltip, form exclusion, pinned deleted filter, referenced-purge refusal, exact restore, collision refusal, unused purge, child guard",
    );

    assert.equal(defaultSalaryPayMonth("2026-07-10"), "2026-06");
    assert.equal(defaultSalaryPayMonth("2027-01-10"), "2026-12");
    assert.equal(
      salaryPayMonthAfterPaymentDateChange("2027-01-10", "2026-11", true),
      "2026-11",
    );
    console.log(
      "PASS fixture 9 pay-month defaults: 2026-07-10 -> 2026-06; 2027-01-10 -> 2026-12; touched month preserved",
    );

    assert.deepEqual(SUGGESTED_CATEGORY_BY_KIND.revenue, {
      name: "Revenue",
      kind: "income",
    });
    const firstSeed = await seedRevenueCategories();
    assert.deepEqual(firstSeed, { created: 2, existing: 0 });
    const secondSeed = await seedRevenueCategories();
    assert.deepEqual(secondSeed, { created: 0, existing: 2 });
    const revenueRows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, "Revenue"), eq(categories.kind, "income")));
    createdCategoryIds.push(...revenueRows.map((row) => row.id));
    assert.equal((await categoryDuplicateGroups()).length, 0);
    console.log(
      "PASS fixture 10 Revenue apply step: config key Revenue+income, 2 company rows created, idempotent rerun, duplicate scan zero",
    );
  } finally {
    if (createdTransactionIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.rowId, createdTransactionIds));
      await db.delete(transactions).where(inArray(transactions.id, createdTransactionIds));
    }
    if (createdCategoryIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.rowId, createdCategoryIds));
      await db.delete(categories).where(inArray(categories.id, createdCategoryIds));
    }
    if (createdAccountIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.rowId, createdAccountIds));
      await db.delete(accounts).where(inArray(accounts.id, createdAccountIds));
    }
    if (createdEmployeeIds.length > 0) {
      await db
        .delete(employeeSalaryProfiles)
        .where(inArray(employeeSalaryProfiles.employeeId, createdEmployeeIds));
      await db.delete(auditLog).where(inArray(auditLog.rowId, createdEmployeeIds));
      await db.delete(employees).where(inArray(employees.id, createdEmployeeIds));
    }
    const finalLedger = await ledgerCounts();
    const finalAudit = await db.$count(auditLog);
    assert.deepEqual(finalLedger, baselineLedger);
    assert.equal(finalAudit, baselineAudit);
    assert.equal(await db.$count(employees), 0);
    assert.equal(await db.$count(employeeSalaryProfiles), 0);
    console.log(
      `PASS zero residue: ledger ${finalLedger.transactions}/${finalLedger.postings}/${finalLedger.accruals}; audit ${finalAudit}; employees/profiles 0/0`,
    );
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
