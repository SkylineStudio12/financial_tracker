"use server";

import { revalidatePath } from "next/cache";
import { toAppError, type AppError } from "@/lib/app-error";
import {
  createCategory,
  createManagedAccount,
  createEmployee,
  deleteSalaryProfile,
  getEmployeeSalaryPrefill,
  purgeCategory,
  purgeManagedAccount,
  restoreCategory,
  restoreEmployee,
  restoreManagedAccount,
  saveSalaryProfile,
  softDeleteCategory,
  softDeleteEmployee,
  softDeleteManagedAccount,
  updateCategory,
  updateEmployee,
  updateManagedAccount,
  type ManagedAccountValues,
  type SalaryProfileValues,
} from "./service";

export type ActionResult<T = void> = { ok: true; value?: T } | { error: AppError };

async function runAction<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

function refreshManage(profileSlug: string): void {
  revalidatePath(`/p/${profileSlug}/manage`);
}

export async function getEmployeeSalaryPrefillAction(
  entityId: string,
  employeeId: string,
  referenceDate: string,
) {
  return runAction(() => getEmployeeSalaryPrefill(entityId, employeeId, referenceDate));
}

export async function createEmployeeAction(
  profileSlug: string,
  entityId: string,
  name: string,
): Promise<ActionResult<string>> {
  const result = await runAction(() => createEmployee(entityId, name));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function updateEmployeeAction(
  profileSlug: string,
  entityId: string,
  employeeId: string,
  input: { name: string; isActive: boolean },
): Promise<ActionResult> {
  const result = await runAction(() => updateEmployee(employeeId, entityId, input));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function updateEmployeeDetailsAction(
  profileSlug: string,
  entityId: string,
  employeeId: string,
  referenceDate: string,
  input: { name: string; isActive: boolean },
  profile: SalaryProfileValues | null,
): Promise<ActionResult> {
  const result = await runAction(async () => {
    await updateEmployee(employeeId, entityId, input);
    if (profile) await saveSalaryProfile(employeeId, entityId, referenceDate, profile);
  });
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function deleteEmployeeAction(
  profileSlug: string,
  entityId: string,
  employeeId: string,
): Promise<ActionResult> {
  const result = await runAction(() => softDeleteEmployee(employeeId, entityId));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function restoreEmployeeAction(
  profileSlug: string,
  entityId: string,
  employeeId: string,
): Promise<ActionResult> {
  const result = await runAction(() => restoreEmployee(employeeId, entityId));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function saveSalaryProfileAction(
  profileSlug: string,
  entityId: string,
  employeeId: string,
  referenceDate: string,
  values: SalaryProfileValues,
): Promise<ActionResult> {
  const result = await runAction(() =>
    saveSalaryProfile(employeeId, entityId, referenceDate, values),
  );
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function deleteSalaryProfileAction(
  profileSlug: string,
  entityId: string,
  employeeId: string,
  referenceDate: string,
): Promise<ActionResult> {
  const result = await runAction(() => deleteSalaryProfile(employeeId, entityId, referenceDate));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function createManagedAccountAction(
  profileSlug: string,
  entityId: string,
  values: ManagedAccountValues,
): Promise<ActionResult<string>> {
  const result = await runAction(() => createManagedAccount(entityId, values));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function updateManagedAccountAction(
  profileSlug: string,
  entityId: string,
  accountId: string,
  values: ManagedAccountValues,
): Promise<ActionResult> {
  const result = await runAction(() => updateManagedAccount(accountId, entityId, values));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function deleteManagedAccountAction(
  profileSlug: string,
  entityId: string,
  accountId: string,
): Promise<ActionResult> {
  const result = await runAction(() => softDeleteManagedAccount(accountId, entityId));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function restoreManagedAccountAction(
  profileSlug: string,
  entityId: string,
  accountId: string,
): Promise<ActionResult> {
  const result = await runAction(() => restoreManagedAccount(accountId, entityId));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function purgeManagedAccountAction(
  profileSlug: string,
  entityId: string,
  accountId: string,
): Promise<ActionResult> {
  const result = await runAction(() => purgeManagedAccount(accountId, entityId));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function createCategoryAction(
  profileSlug: string,
  input: {
    entityId: string;
    name: string;
    kind: "income" | "expense";
    parentId?: string | null;
    icon?: string | null;
  },
): Promise<ActionResult<string>> {
  const result = await runAction(() => createCategory(input));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function updateCategoryAction(
  profileSlug: string,
  entityId: string,
  categoryId: string,
  input: { name: string; kind: "income" | "expense"; icon?: string | null },
): Promise<ActionResult> {
  const result = await runAction(() => updateCategory(categoryId, entityId, input));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function deleteCategoryAction(
  profileSlug: string,
  entityId: string,
  categoryId: string,
): Promise<ActionResult> {
  const result = await runAction(() => softDeleteCategory(categoryId, entityId));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function restoreCategoryAction(
  profileSlug: string,
  entityId: string,
  categoryId: string,
): Promise<ActionResult> {
  const result = await runAction(() => restoreCategory(categoryId, entityId));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function purgeCategoryAction(
  profileSlug: string,
  entityId: string,
  categoryId: string,
): Promise<ActionResult> {
  const result = await runAction(() => purgeCategory(categoryId, entityId));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}
