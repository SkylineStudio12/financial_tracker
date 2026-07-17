"use server";

import { revalidatePath } from "next/cache";
import { toAppError, type AppError } from "@/lib/app-error";
import {
  createCategory,
  createEmployee,
  deleteSalaryProfile,
  getEmployeeSalaryPrefill,
  saveSalaryProfile,
  softDeleteCategory,
  softDeleteEmployee,
  updateCategory,
  updateEmployee,
  type SalaryProfileValues,
} from "./service";

type ActionResult<T = void> = { ok: true; value?: T } | { error: AppError };

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

export async function getEmployeeSalaryPrefillAction(entityId: string, employeeId: string) {
  return runAction(() => getEmployeeSalaryPrefill(entityId, employeeId));
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

export async function deleteEmployeeAction(
  profileSlug: string,
  entityId: string,
  employeeId: string,
): Promise<ActionResult> {
  const result = await runAction(() => softDeleteEmployee(employeeId, entityId));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function saveSalaryProfileAction(
  profileSlug: string,
  entityId: string,
  employeeId: string,
  values: SalaryProfileValues,
): Promise<ActionResult> {
  const result = await runAction(() => saveSalaryProfile(employeeId, entityId, values));
  if ("ok" in result) refreshManage(profileSlug);
  return result;
}

export async function deleteSalaryProfileAction(
  profileSlug: string,
  entityId: string,
  employeeId: string,
): Promise<ActionResult> {
  const result = await runAction(() => deleteSalaryProfile(employeeId, entityId));
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
  input: { name: string; kind: "income" | "expense" },
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
