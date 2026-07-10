"use server";

/**
 * Server actions for the import inbox — thin wrappers over the import
 * service: validate the caller's profile, delegate, revalidate the inbox
 * routes. All ledger writes happen inside the service via createTransaction.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LedgerValidationError } from "@/lib/ledger";
import { toAppError, type AppError } from "@/lib/app-error";
import { getProfile } from "@/lib/profiles";
import { IngParseError } from "./ing/types";
import {
  bookHighConfidenceRows,
  bookImportRow,
  createImportBatch,
  skipImportRow,
} from "./service";

type ActionResult =
  | { error: AppError | string }
  | { ok: true; status?: "duplicate"; summary?: { booked: number; duplicates: number; left: number } };

/** Validated /p/{slug}/imports base for redirects and revalidation. */
function importsPath(profileSlug: string, entityId: string): string {
  const profile = getProfile(profileSlug);
  if (!profile || profile.entityId !== entityId) {
    throw new LedgerValidationError("profile.unknownEntity");
  }
  return `/p/${profile.slug}/imports`;
}

export async function createImportBatchAction(payload: {
  profileSlug: string;
  entityId: string;
  bankAccountId: string;
  text: string;
}): Promise<ActionResult | undefined> {
  let batchId: string;
  try {
    if (!payload.text.trim()) {
      throw new LedgerValidationError("imports.statementTextRequired");
    }
    const result = await createImportBatch({
      entityId: payload.entityId,
      bankAccountId: payload.bankAccountId,
      text: payload.text,
    });
    batchId = result.batchId;
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    if (error instanceof IngParseError) {
      return { error: error.message };
    }
    throw error;
  }
  redirect(`${importsPath(payload.profileSlug, payload.entityId)}/${batchId}`);
}

export async function bookImportRowAction(payload: {
  profileSlug: string;
  entityId: string;
  batchId: string;
  rowId: string;
  categoryId?: string | null;
}): Promise<ActionResult> {
  try {
    const result = await bookImportRow({ rowId: payload.rowId, categoryId: payload.categoryId });
    revalidatePath(`${importsPath(payload.profileSlug, payload.entityId)}/${payload.batchId}`);
    return {
      ok: true,
      status: result.status === "duplicate" ? "duplicate" : undefined,
    };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export async function bookHighConfidenceAction(payload: {
  profileSlug: string;
  entityId: string;
  batchId: string;
}): Promise<ActionResult> {
  try {
    const result = await bookHighConfidenceRows(payload.batchId);
    revalidatePath(`${importsPath(payload.profileSlug, payload.entityId)}/${payload.batchId}`);
    if (result.errors.length) {
      return { error: { code: "imports.highConfidenceBookingFailed", params: { count: result.errors.length } } };
    }
    return {
      ok: true,
      summary: {
        booked: result.booked,
        duplicates: result.duplicates,
        left: result.left,
      },
    };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export async function skipImportRowAction(payload: {
  profileSlug: string;
  entityId: string;
  batchId: string;
  rowId: string;
}): Promise<ActionResult> {
  try {
    await skipImportRow(payload.rowId);
    revalidatePath(`${importsPath(payload.profileSlug, payload.entityId)}/${payload.batchId}`);
    return { ok: true };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}
