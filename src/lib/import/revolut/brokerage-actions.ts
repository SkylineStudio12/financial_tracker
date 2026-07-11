"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toAppError, type AppError } from "@/lib/app-error";
import { getProfile } from "@/lib/profiles";
import { LedgerValidationError } from "@/lib/ledger";
import {
  approveRevolutBatch,
  createRevolutImportBatch,
  setRevolutRowExcluded,
  type ApproveRevolutBatchResult,
} from "./brokerage-service";

function validatedGregProfile(profileSlug: string, entityId: string) {
  const profile = getProfile(profileSlug);
  if (
    !profile ||
    profile.entityId !== entityId ||
    profile.owner !== "greg" ||
    !profile.investments
  ) {
    throw new LedgerValidationError("profile.unknownInvestment");
  }
  return profile;
}

export async function createRevolutImportBatchAction(payload: {
  profileSlug: string;
  entityId: string;
  sourceFileName: string;
  text: string;
}): Promise<{ error: AppError | string } | undefined> {
  try {
    const profile = validatedGregProfile(payload.profileSlug, payload.entityId);
    if (!payload.text.trim()) throw new LedgerValidationError("revolut.csvRequired");
    const result = await createRevolutImportBatch({
      entityId: payload.entityId,
      owner: "greg",
      sourceFileName: payload.sourceFileName || "All stock transactions.csv",
      text: payload.text,
    });
    redirect(`/p/${profile.slug}/imports/${result.batchId}`);
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export async function setRevolutRowExcludedAction(payload: {
  profileSlug: string;
  entityId: string;
  batchId: string;
  rowId: string;
  excluded: boolean;
}): Promise<{ ok: true } | { error: AppError }> {
  try {
    validatedGregProfile(payload.profileSlug, payload.entityId);
    await setRevolutRowExcluded(payload);
    revalidatePath(`/p/${payload.profileSlug}/imports/${payload.batchId}`);
    return { ok: true };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export async function approveRevolutBatchAction(payload: {
  profileSlug: string;
  entityId: string;
  batchId: string;
}): Promise<{ summary: ApproveRevolutBatchResult } | { error: AppError }> {
  try {
    validatedGregProfile(payload.profileSlug, payload.entityId);
    const summary = await approveRevolutBatch(payload.batchId);
    for (const path of ["imports", "transactions", "investments", "dashboard"]) {
      revalidatePath(`/p/${payload.profileSlug}/${path}`);
    }
    return { summary };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}
