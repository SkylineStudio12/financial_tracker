import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  categories,
  employeeSalaryProfiles,
  employees,
  entities,
  postings,
} from "@/db/schema";
import { LedgerValidationError } from "@/lib/app-error";

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
  shared: boolean;
  inUseCount: number;
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

export async function listManagedCategories(entityId: string): Promise<ManagedCategory[]> {
  await loadEntity(entityId);
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      kind: categories.kind,
      parentId: categories.parentId,
      categoryEntityId: categories.entityId,
      inUseCount: count(postings.id),
    })
    .from(categories)
    .leftJoin(
      postings,
      and(eq(postings.categoryId, categories.id), isNull(postings.deletedAt)),
    )
    .where(
      and(
        or(eq(categories.entityId, entityId), isNull(categories.entityId)),
        isNull(categories.deletedAt),
      ),
    )
    .groupBy(categories.id)
    .orderBy(asc(categories.kind), asc(categories.name));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parentId,
    shared: row.categoryEntityId === null,
    inUseCount: Number(row.inUseCount),
  }));
}

export async function createCategory(input: {
  entityId: string;
  name: string;
  kind: "income" | "expense";
  parentId?: string | null;
}): Promise<string> {
  await loadEntity(input.entityId);
  const cleanName = normalizedName(input.name);
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
  input: { name: string; kind: "income" | "expense" },
): Promise<void> {
  const cleanName = normalizedName(input.name);
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
      await tx
        .update(categories)
        .set({ name: cleanName, updatedAt: new Date() })
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
