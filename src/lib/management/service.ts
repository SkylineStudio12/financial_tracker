import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  auditLog,
  categories,
  employeeSalaryProfiles,
  employees,
  entities,
  postings,
} from "@/db/schema";
import { LedgerValidationError } from "@/lib/app-error";
import { isCategoryIconName } from "@/components/category-icons";
import { getAccountBalances } from "@/lib/ledger/dashboard";
import type { AccountOwner } from "@/lib/profiles";

export interface SalaryProfileValues {
  grossMinor: number;
  casMinor: number;
  cassMinor: number;
  incomeTaxMinor: number;
  camMinor: number;
  netMinor: number;
  personalDeductionMinor: number;
}

export interface EmployeeOption {
  id: string;
  name: string;
}

export interface ManagedEmployee extends EmployeeOption {
  isActive: boolean;
  profile: SalaryProfileValues | null;
}

export interface ManagedCategory {
  id: string;
  name: string;
  kind: "income" | "expense";
  parentId: string | null;
  icon: string | null;
  shared: boolean;
  inUseCount: number;
  postingCount: number;
  deletedAt: string | null;
}

export interface ManagedAccount {
  id: string;
  name: string;
  type: "bank" | "cash" | "brokerage";
  currency: "RON" | "EUR" | "USD";
  owner: AccountOwner | null;
  isActive: boolean;
  balanceRon: number;
  postingCount: number;
  livePostingCount: number;
  readOnly: boolean;
  deletedAt: string | null;
}

export interface ManagedAccountValues {
  name: string;
  type: "bank" | "cash";
  currency: "RON" | "EUR" | "USD";
  owner: AccountOwner | null;
  isActive: boolean;
}

const COMPANY_PROTECTED_NAMES = new Set([
  "salaries",
  "taxes",
  "revenue",
  "services",
  "software subscriptions",
  "bank fees",
]);
const HOUSEHOLD_PROTECTED_NAMES = new Set([
  "investment gains",
  "investment losses",
  "dividends",
  "brokerage fees",
]);

function normalizedName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new LedgerValidationError("manage.nameRequired");
  return normalized;
}

function normalizeCategoryIcon(icon: string | null | undefined): string | null {
  if (!icon) return null;
  if (!isCategoryIconName(icon)) {
    throw new LedgerValidationError("manage.categoryIconInvalid", { icon });
  }
  return icon;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const pg = current as { code?: string; constraint?: string; cause?: unknown };
    if (pg.code === "23505" && pg.constraint === constraint) return true;
    current = pg.cause;
  }
  return false;
}

function validateProfile(values: SalaryProfileValues): void {
  const positive = [
    ["gross", values.grossMinor],
    ["cas", values.casMinor],
    ["cass", values.cassMinor],
    ["incomeTax", values.incomeTaxMinor],
    ["cam", values.camMinor],
    ["net", values.netMinor],
  ] as const;
  for (const [field, value] of positive) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new LedgerValidationError("manage.salaryProfileAmountInvalid", { field });
    }
  }
  if (!Number.isSafeInteger(values.personalDeductionMinor) || values.personalDeductionMinor < 0) {
    throw new LedgerValidationError("manage.salaryProfileAmountInvalid", {
      field: "personalDeduction",
    });
  }
  const expectedNet =
    values.grossMinor - values.casMinor - values.cassMinor - values.incomeTaxMinor;
  if (values.netMinor !== expectedNet) {
    throw new LedgerValidationError("manage.salaryProfileNetMismatch", {
      expected: expectedNet,
      actual: values.netMinor,
    });
  }
}

async function loadEntity(entityId: string) {
  const [entity] = await db
    .select({ id: entities.id, type: entities.type })
    .from(entities)
    .where(and(eq(entities.id, entityId), isNull(entities.deletedAt)));
  if (!entity) throw new LedgerValidationError("manage.entityNotFound", { entityId });
  return entity;
}

async function requireCompany(entityId: string): Promise<void> {
  const entity = await loadEntity(entityId);
  if (entity.type !== "company") throw new LedgerValidationError("manage.companyRequired");
}

async function requireEmployee(employeeId: string, entityId: string) {
  const [employee] = await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        eq(employees.entityId, entityId),
        isNull(employees.deletedAt),
      ),
    );
  if (!employee) throw new LedgerValidationError("manage.employeeNotFound", { employeeId });
  return employee;
}

async function loadOwnedCategory(categoryId: string, entityId: string) {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)));
  if (!category) throw new LedgerValidationError("manage.categoryNotFound", { categoryId });
  if (category.entityId === null) throw new LedgerValidationError("manage.sharedCategoryReadOnly");
  if (category.entityId !== entityId) {
    throw new LedgerValidationError("manage.categoryNotFound", { categoryId });
  }
  return category;
}

function assertCategoryNameMutable(entityType: "company" | "household", name: string): void {
  const protectedNames =
    entityType === "company" ? COMPANY_PROTECTED_NAMES : HOUSEHOLD_PROTECTED_NAMES;
  if (protectedNames.has(name.trim().toLowerCase())) {
    throw new LedgerValidationError("manage.categoryProtected", { name });
  }
}

async function loadManagedAccount(accountId: string, entityId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.entityId, entityId),
        isNull(accounts.deletedAt),
      ),
    );
  if (!account) throw new LedgerValidationError("manage.accountNotFound", { accountId });
  if (account.type !== "bank" && account.type !== "cash" && account.type !== "brokerage") {
    throw new LedgerValidationError("manage.accountNotFound", { accountId });
  }
  if (account.type === "brokerage") {
    throw new LedgerValidationError("manage.accountReadOnly", { accountName: account.name });
  }
  return account;
}

async function loadDeletedManagedAccount(accountId: string, entityId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.entityId, entityId),
        isNotNull(accounts.deletedAt),
      ),
    );
  if (!account || (account.type !== "bank" && account.type !== "cash")) {
    throw new LedgerValidationError("manage.accountNotFound", { accountId });
  }
  return account;
}

async function loadDeletedOwnedCategory(categoryId: string, entityId: string) {
  const [category] = await db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.entityId, entityId),
        isNotNull(categories.deletedAt),
      ),
    );
  if (!category) throw new LedgerValidationError("manage.categoryNotFound", { categoryId });
  return category;
}

function validateAccountOwner(
  entityType: "company" | "household",
  owner: AccountOwner | null,
): AccountOwner | null {
  if (entityType === "household") {
    if (!owner) throw new LedgerValidationError("manage.accountOwnerRequired");
    return owner;
  }
  if (owner !== null) throw new LedgerValidationError("manage.companyAccountOwnerForbidden");
  return null;
}

async function assertAccountNameAvailable(
  entityId: string,
  name: string,
  excludeId?: string,
  errorCode: "manage.accountDuplicate" | "manage.restoreNameTaken" = "manage.accountDuplicate",
): Promise<void> {
  const [duplicate] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, entityId),
        sql`lower(btrim(${accounts.name})) = lower(btrim(${name}))`,
        isNull(accounts.deletedAt),
        ...(excludeId ? [ne(accounts.id, excludeId)] : []),
      ),
    )
    .limit(1);
  if (duplicate) throw new LedgerValidationError(errorCode, { name });
}

export async function listEmployeeOptions(entityId: string): Promise<EmployeeOption[]> {
  await requireCompany(entityId);
  return db
    .select({ id: employees.id, name: employees.name })
    .from(employees)
    .where(
      and(
        eq(employees.entityId, entityId),
        eq(employees.isActive, true),
        isNull(employees.deletedAt),
      ),
    )
    .orderBy(asc(employees.name));
}

export async function listManagedEmployees(entityId: string): Promise<ManagedEmployee[]> {
  await requireCompany(entityId);
  const rows = await db
    .select({
      id: employees.id,
      name: employees.name,
      isActive: employees.isActive,
      grossMinor: employeeSalaryProfiles.grossMinor,
      casMinor: employeeSalaryProfiles.casMinor,
      cassMinor: employeeSalaryProfiles.cassMinor,
      incomeTaxMinor: employeeSalaryProfiles.incomeTaxMinor,
      camMinor: employeeSalaryProfiles.camMinor,
      netMinor: employeeSalaryProfiles.netMinor,
      personalDeductionMinor: employeeSalaryProfiles.personalDeductionMinor,
    })
    .from(employees)
    .leftJoin(employeeSalaryProfiles, eq(employeeSalaryProfiles.employeeId, employees.id))
    .where(and(eq(employees.entityId, entityId), isNull(employees.deletedAt)))
    .orderBy(asc(employees.name));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    profile:
      row.grossMinor === null
        ? null
        : {
            grossMinor: row.grossMinor,
            casMinor: row.casMinor!,
            cassMinor: row.cassMinor!,
            incomeTaxMinor: row.incomeTaxMinor!,
            camMinor: row.camMinor!,
            netMinor: row.netMinor!,
            personalDeductionMinor: row.personalDeductionMinor!,
          },
  }));
}

export async function getEmployeeSalaryPrefill(
  entityId: string,
  employeeId: string,
): Promise<{ employee: EmployeeOption; profile: SalaryProfileValues | null }> {
  const employee = await requireEmployee(employeeId, entityId);
  if (!employee.isActive) {
    throw new LedgerValidationError("manage.employeeNotFound", { employeeId });
  }
  const [profile] = await db
    .select()
    .from(employeeSalaryProfiles)
    .where(eq(employeeSalaryProfiles.employeeId, employeeId));
  return {
    employee: { id: employee.id, name: employee.name },
    profile: profile
      ? {
          grossMinor: profile.grossMinor,
          casMinor: profile.casMinor,
          cassMinor: profile.cassMinor,
          incomeTaxMinor: profile.incomeTaxMinor,
          camMinor: profile.camMinor,
          netMinor: profile.netMinor,
          personalDeductionMinor: profile.personalDeductionMinor,
        }
      : null,
  };
}

export async function createEmployee(entityId: string, name: string): Promise<string> {
  await requireCompany(entityId);
  const cleanName = normalizedName(name);
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(employees)
        .values({ entityId, name: cleanName })
        .returning({ id: employees.id });
      await tx.insert(auditLog).values({
        tableName: "employees",
        rowId: created.id,
        action: "insert",
        previousValues: null,
      });
      return created.id;
    });
  } catch (error) {
    if (isUniqueViolation(error, "employees_entity_lower_name_live_uidx")) {
      throw new LedgerValidationError("manage.employeeDuplicate", { name: cleanName });
    }
    throw error;
  }
}

export async function updateEmployee(
  employeeId: string,
  entityId: string,
  input: { name: string; isActive: boolean },
): Promise<void> {
  await requireCompany(entityId);
  const cleanName = normalizedName(input.name);
  try {
    await db.transaction(async (tx) => {
      const [prior] = await tx
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.id, employeeId),
            eq(employees.entityId, entityId),
            isNull(employees.deletedAt),
          ),
        )
        .for("update");
      if (!prior) throw new LedgerValidationError("manage.employeeNotFound", { employeeId });
      await tx
        .update(employees)
        .set({ name: cleanName, isActive: input.isActive, updatedAt: new Date() })
        .where(eq(employees.id, employeeId));
      await tx.insert(auditLog).values({
        tableName: "employees",
        rowId: employeeId,
        action: "update",
        previousValues: prior,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, "employees_entity_lower_name_live_uidx")) {
      throw new LedgerValidationError("manage.employeeDuplicate", { name: cleanName });
    }
    throw error;
  }
}

export async function softDeleteEmployee(employeeId: string, entityId: string): Promise<void> {
  await requireCompany(entityId);
  await db.transaction(async (tx) => {
    const [prior] = await tx
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.id, employeeId),
          eq(employees.entityId, entityId),
          isNull(employees.deletedAt),
        ),
      )
      .for("update");
    if (!prior) throw new LedgerValidationError("manage.employeeNotFound", { employeeId });
    await tx
      .update(employees)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(employees.id, employeeId));
    await tx.insert(auditLog).values({
      tableName: "employees",
      rowId: employeeId,
      action: "delete",
      previousValues: prior,
    });
  });
}

export async function saveSalaryProfile(
  employeeId: string,
  entityId: string,
  values: SalaryProfileValues,
): Promise<void> {
  validateProfile(values);
  await requireCompany(entityId);
  await db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.id, employeeId),
          eq(employees.entityId, entityId),
          isNull(employees.deletedAt),
        ),
      )
      .for("update");
    if (!employee) throw new LedgerValidationError("manage.employeeNotFound", { employeeId });
    const [prior] = await tx
      .select()
      .from(employeeSalaryProfiles)
      .where(eq(employeeSalaryProfiles.employeeId, employeeId))
      .for("update");
    if (prior) {
      await tx
        .update(employeeSalaryProfiles)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(employeeSalaryProfiles.employeeId, employeeId));
    } else {
      await tx.insert(employeeSalaryProfiles).values({ employeeId, ...values });
    }
    await tx.insert(auditLog).values({
      tableName: "employee_salary_profiles",
      rowId: employeeId,
      action: prior ? "update" : "insert",
      previousValues: prior ?? null,
    });
  });
}

export async function deleteSalaryProfile(employeeId: string, entityId: string): Promise<void> {
  await requireCompany(entityId);
  await db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.id, employeeId),
          eq(employees.entityId, entityId),
          isNull(employees.deletedAt),
        ),
      );
    if (!employee) throw new LedgerValidationError("manage.employeeNotFound", { employeeId });
    const [prior] = await tx
      .select()
      .from(employeeSalaryProfiles)
      .where(eq(employeeSalaryProfiles.employeeId, employeeId))
      .for("update");
    if (!prior) throw new LedgerValidationError("manage.salaryProfileNotFound");
    await tx
      .delete(employeeSalaryProfiles)
      .where(eq(employeeSalaryProfiles.employeeId, employeeId));
    await tx.insert(auditLog).values({
      tableName: "employee_salary_profiles",
      rowId: employeeId,
      action: "delete",
      previousValues: prior,
    });
  });
}

export async function listManagedAccounts(
  entityId: string,
  mode: "live" | "deleted" = "live",
): Promise<ManagedAccount[]> {
  await loadEntity(entityId);
  const [rows, balances] = await Promise.all([
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        currency: accounts.currency,
        owner: accounts.owner,
        isActive: accounts.isActive,
        deletedAt: accounts.deletedAt,
        postingCount: count(postings.id),
        livePostingCount: sql<number>`count(${postings.id}) filter (where ${postings.deletedAt} is null)`,
      })
      .from(accounts)
      .leftJoin(postings, eq(postings.accountId, accounts.id))
      .where(
        and(
          eq(accounts.entityId, entityId),
          inArray(accounts.type, ["bank", "cash", "brokerage"]),
          mode === "live" ? isNull(accounts.deletedAt) : isNotNull(accounts.deletedAt),
        ),
      )
      .groupBy(accounts.id)
      .orderBy(desc(accounts.isActive), asc(accounts.name)),
    getAccountBalances(entityId, undefined, { includeInactive: true }),
  ]);
  const balanceById = new Map(balances.map((balance) => [balance.accountId, balance.balanceRon]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as ManagedAccount["type"],
    currency: row.currency,
    owner: row.owner,
    isActive: row.isActive,
    balanceRon: balanceById.get(row.id) ?? 0,
    postingCount: Number(row.postingCount),
    livePostingCount: Number(row.livePostingCount),
    readOnly: row.type === "brokerage",
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }));
}

export async function createManagedAccount(
  entityId: string,
  values: ManagedAccountValues,
): Promise<string> {
  const entity = await loadEntity(entityId);
  const name = normalizedName(values.name);
  const owner = validateAccountOwner(entity.type, values.owner);
  await assertAccountNameAvailable(entityId, name);
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(accounts)
      .values({
        entityId,
        name,
        type: values.type,
        currency: values.currency,
        owner,
        isActive: values.isActive,
      })
      .returning({ id: accounts.id });
    await tx.insert(auditLog).values({
      tableName: "accounts",
      rowId: created.id,
      action: "insert",
      previousValues: null,
    });
    return created.id;
  });
}

export async function updateManagedAccount(
  accountId: string,
  entityId: string,
  values: ManagedAccountValues,
): Promise<void> {
  await loadManagedAccount(accountId, entityId);
  const entity = await loadEntity(entityId);
  const name = normalizedName(values.name);
  const owner = validateAccountOwner(entity.type, values.owner);
  await assertAccountNameAvailable(entityId, name, accountId);
  await db.transaction(async (tx) => {
    const [prior] = await tx
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.entityId, entityId),
          isNull(accounts.deletedAt),
        ),
      )
      .for("update");
    if (!prior) throw new LedgerValidationError("manage.accountNotFound", { accountId });
    if (prior.type === "brokerage") {
      throw new LedgerValidationError("manage.accountReadOnly", { accountName: prior.name });
    }
    if (prior.type !== "bank" && prior.type !== "cash") {
      throw new LedgerValidationError("manage.accountNotFound", { accountId });
    }
    const [usage] = await tx
      .select({ count: count() })
      .from(postings)
      .where(eq(postings.accountId, accountId));
    const postingCount = Number(usage?.count ?? 0);
    const changesHistoricalShape =
      prior.type !== values.type || prior.currency !== values.currency || prior.owner !== owner;
    if (postingCount > 0 && changesHistoricalShape) {
      throw new LedgerValidationError("manage.accountHistoryLocked", { count: postingCount });
    }
    await tx
      .update(accounts)
      .set({
        name,
        type: values.type,
        currency: values.currency,
        owner,
        isActive: values.isActive,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));
    await tx.insert(auditLog).values({
      tableName: "accounts",
      rowId: accountId,
      action: "update",
      previousValues: prior,
    });
  });
}

export async function softDeleteManagedAccount(
  accountId: string,
  entityId: string,
): Promise<void> {
  await loadManagedAccount(accountId, entityId);
  await db.transaction(async (tx) => {
    const [prior] = await tx
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.entityId, entityId),
          isNull(accounts.deletedAt),
        ),
      )
      .for("update");
    if (!prior) throw new LedgerValidationError("manage.accountNotFound", { accountId });
    if (prior.type === "brokerage") {
      throw new LedgerValidationError("manage.accountReadOnly", { accountName: prior.name });
    }
    if (prior.type !== "bank" && prior.type !== "cash") {
      throw new LedgerValidationError("manage.accountNotFound", { accountId });
    }
    const [usage] = await tx
      .select({ count: count() })
      .from(postings)
      .where(and(eq(postings.accountId, accountId), isNull(postings.deletedAt)));
    const livePostingCount = Number(usage?.count ?? 0);
    if (livePostingCount > 0) {
      throw new LedgerValidationError("manage.accountInUse", { count: livePostingCount });
    }
    await tx
      .update(accounts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(accounts.id, accountId));
    await tx.insert(auditLog).values({
      tableName: "accounts",
      rowId: accountId,
      action: "delete",
      previousValues: prior,
    });
  });
}

export async function restoreManagedAccount(accountId: string, entityId: string): Promise<void> {
  const account = await loadDeletedManagedAccount(accountId, entityId);
  await assertAccountNameAvailable(
    entityId,
    account.name,
    undefined,
    "manage.restoreNameTaken",
  );
  await db.transaction(async (tx) => {
    const [prior] = await tx
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.entityId, entityId),
          isNotNull(accounts.deletedAt),
        ),
      )
      .for("update");
    if (!prior) throw new LedgerValidationError("manage.accountNotFound", { accountId });
    await tx
      .update(accounts)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(accounts.id, accountId));
    await tx.insert(auditLog).values({
      tableName: "accounts",
      rowId: accountId,
      action: "restore",
      previousValues: prior,
    });
  });
}

export async function purgeManagedAccount(accountId: string, entityId: string): Promise<void> {
  await loadDeletedManagedAccount(accountId, entityId);
  await db.transaction(async (tx) => {
    const [prior] = await tx
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.entityId, entityId),
          isNotNull(accounts.deletedAt),
        ),
      )
      .for("update");
    if (!prior) throw new LedgerValidationError("manage.accountNotFound", { accountId });
    const [usage] = await tx
      .select({ count: count() })
      .from(postings)
      .where(eq(postings.accountId, accountId));
    const postingCount = Number(usage?.count ?? 0);
    if (postingCount > 0) {
      throw new LedgerValidationError("manage.accountReferencedCannotPurge", {
        count: postingCount,
      });
    }
    await tx.delete(accounts).where(eq(accounts.id, accountId));
    await tx.insert(auditLog).values({
      tableName: "accounts",
      rowId: accountId,
      action: "purge",
      previousValues: prior,
    });
  });
}

export async function listManagedCategories(
  entityId: string,
  mode: "live" | "deleted" = "live",
): Promise<ManagedCategory[]> {
  await loadEntity(entityId);
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      kind: categories.kind,
      parentId: categories.parentId,
      icon: categories.icon,
      categoryEntityId: categories.entityId,
      deletedAt: categories.deletedAt,
      postingCount: count(postings.id),
      inUseCount: sql<number>`count(${postings.id}) filter (where ${postings.deletedAt} is null)`,
    })
    .from(categories)
    .leftJoin(postings, eq(postings.categoryId, categories.id))
    .where(
      and(
        mode === "live"
          ? or(eq(categories.entityId, entityId), isNull(categories.entityId))
          : eq(categories.entityId, entityId),
        mode === "live" ? isNull(categories.deletedAt) : isNotNull(categories.deletedAt),
      ),
    )
    .groupBy(categories.id)
    .orderBy(asc(categories.kind), asc(categories.name));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parentId,
    icon: row.icon,
    shared: row.categoryEntityId === null,
    inUseCount: Number(row.inUseCount),
    postingCount: Number(row.postingCount),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }));
}

export async function createCategory(input: {
  entityId: string;
  name: string;
  kind: "income" | "expense";
  parentId?: string | null;
  icon?: string | null;
}): Promise<string> {
  await loadEntity(input.entityId);
  const cleanName = normalizedName(input.name);
  const icon = normalizeCategoryIcon(input.icon);
  if (input.parentId) {
    const parent = await loadOwnedCategory(input.parentId, input.entityId);
    if (parent.parentId !== null) throw new LedgerValidationError("manage.categoryDepthExceeded");
  }
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(categories)
        .values({
          entityId: input.entityId,
          name: cleanName,
          kind: input.kind,
          parentId: input.parentId ?? null,
          icon,
        })
        .returning({ id: categories.id });
      await tx.insert(auditLog).values({
        tableName: "categories",
        rowId: created.id,
        action: "insert",
        previousValues: null,
      });
      return created.id;
    });
  } catch (error) {
    if (isUniqueViolation(error, "categories_entity_lower_name_kind_live_uidx")) {
      throw new LedgerValidationError("manage.categoryDuplicate", { name: cleanName });
    }
    throw error;
  }
}

export async function updateCategory(
  categoryId: string,
  entityId: string,
  input: { name: string; kind: "income" | "expense"; icon?: string | null },
): Promise<void> {
  const cleanName = normalizedName(input.name);
  const icon = normalizeCategoryIcon(input.icon);
  const category = await loadOwnedCategory(categoryId, entityId);
  const entity = await loadEntity(entityId);
  if (category.kind !== input.kind) {
    throw new LedgerValidationError("manage.categoryKindImmutable");
  }
  try {
    await db.transaction(async (tx) => {
      const [prior] = await tx
        .select()
        .from(categories)
        .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
        .for("update");
      if (!prior || prior.entityId !== entityId) {
        throw new LedgerValidationError("manage.categoryNotFound", { categoryId });
      }
      if (prior.kind !== input.kind) {
        throw new LedgerValidationError("manage.categoryKindImmutable");
      }
      if (cleanName !== prior.name) assertCategoryNameMutable(entity.type, prior.name);
      // Existing non-UI callers may still omit icon; omission preserves the
      // stored value, while an explicit empty value clears it.
      const nextIcon = input.icon === undefined ? prior.icon : icon;
      await tx
        .update(categories)
        .set({ name: cleanName, icon: nextIcon, updatedAt: new Date() })
        .where(eq(categories.id, categoryId));
      await tx.insert(auditLog).values({
        tableName: "categories",
        rowId: categoryId,
        action: "update",
        previousValues: prior,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, "categories_entity_lower_name_kind_live_uidx")) {
      throw new LedgerValidationError("manage.categoryDuplicate", { name: cleanName });
    }
    throw error;
  }
}

export async function softDeleteCategory(categoryId: string, entityId: string): Promise<void> {
  await loadOwnedCategory(categoryId, entityId);
  const entity = await loadEntity(entityId);
  await db.transaction(async (tx) => {
    const [prior] = await tx
      .select()
      .from(categories)
      .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
      .for("update");
    if (!prior || prior.entityId !== entityId) {
      throw new LedgerValidationError("manage.categoryNotFound", { categoryId });
    }
    assertCategoryNameMutable(entity.type, prior.name);
    const [usage] = await tx
      .select({ count: count() })
      .from(postings)
      .where(and(eq(postings.categoryId, categoryId), isNull(postings.deletedAt)));
    const inUseCount = Number(usage?.count ?? 0);
    if (inUseCount > 0) {
      throw new LedgerValidationError("manage.categoryInUse", { count: inUseCount });
    }
    await tx
      .update(categories)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(categories.id, categoryId));
    await tx.insert(auditLog).values({
      tableName: "categories",
      rowId: categoryId,
      action: "delete",
      previousValues: prior,
    });
  });
}

export async function restoreCategory(categoryId: string, entityId: string): Promise<void> {
  const category = await loadDeletedOwnedCategory(categoryId, entityId);
  const [collision] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.entityId, entityId),
        eq(categories.kind, category.kind),
        sql`lower(btrim(${categories.name})) = lower(btrim(${category.name}))`,
        isNull(categories.deletedAt),
      ),
    )
    .limit(1);
  if (collision) {
    throw new LedgerValidationError("manage.restoreNameTaken", { name: category.name });
  }
  await db.transaction(async (tx) => {
    const [prior] = await tx
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.id, categoryId),
          eq(categories.entityId, entityId),
          isNotNull(categories.deletedAt),
        ),
      )
      .for("update");
    if (!prior) throw new LedgerValidationError("manage.categoryNotFound", { categoryId });
    await tx
      .update(categories)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(categories.id, categoryId));
    await tx.insert(auditLog).values({
      tableName: "categories",
      rowId: categoryId,
      action: "restore",
      previousValues: prior,
    });
  });
}

export async function purgeCategory(categoryId: string, entityId: string): Promise<void> {
  await loadDeletedOwnedCategory(categoryId, entityId);
  await db.transaction(async (tx) => {
    const [prior] = await tx
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.id, categoryId),
          eq(categories.entityId, entityId),
          isNotNull(categories.deletedAt),
        ),
      )
      .for("update");
    if (!prior) throw new LedgerValidationError("manage.categoryNotFound", { categoryId });
    const [usage] = await tx
      .select({ count: count() })
      .from(postings)
      .where(eq(postings.categoryId, categoryId));
    const [child] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.parentId, categoryId))
      .limit(1);
    const postingCount = Number(usage?.count ?? 0);
    if (postingCount > 0) {
      throw new LedgerValidationError("manage.categoryReferencedCannotPurge", {
        count: postingCount,
      });
    }
    if (child) throw new LedgerValidationError("manage.categoryHasChildren");
    await tx.delete(categories).where(eq(categories.id, categoryId));
    await tx.insert(auditLog).values({
      tableName: "categories",
      rowId: categoryId,
      action: "purge",
      previousValues: prior,
    });
  });
}

export async function categoryDuplicateGroups(): Promise<
  { entityId: string; normalizedName: string; kind: "income" | "expense"; count: number }[]
> {
  const rows = await db
    .select({
      entityId: categories.entityId,
      normalizedName: sql<string>`lower(${categories.name})`,
      kind: categories.kind,
      count: count(),
    })
    .from(categories)
    .where(and(isNull(categories.deletedAt), sql`${categories.entityId} IS NOT NULL`))
    .groupBy(categories.entityId, sql`lower(${categories.name})`, categories.kind)
    .having(sql`count(*) > 1`);
  return rows.map((row) => ({
    entityId: row.entityId!,
    normalizedName: row.normalizedName,
    kind: row.kind,
    count: Number(row.count),
  }));
}

export async function seedRevenueCategories(): Promise<{ created: number; existing: number }> {
  const companies = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.type, "company"), isNull(entities.deletedAt)))
    .orderBy(asc(entities.id));
  let created = 0;
  let existing = 0;
  for (const company of companies) {
    const [found] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.entityId, company.id),
          eq(categories.kind, "income"),
          sql`lower(btrim(${categories.name})) = 'revenue'`,
          isNull(categories.deletedAt),
        ),
      );
    if (found) {
      existing += 1;
      continue;
    }
    await createCategory({ entityId: company.id, name: "Revenue", kind: "income" });
    created += 1;
  }
  return { created, existing };
}
