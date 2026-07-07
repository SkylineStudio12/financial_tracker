"use server";

/**
 * Server actions for the import inbox — thin wrappers over the import
 * service: validate the caller's profile, delegate, revalidate the inbox
 * routes. All ledger writes happen inside the service via createTransaction.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LedgerValidationError } from "@/lib/ledger";
import { getProfile } from "@/lib/profiles";
import { IngParseError } from "./ing/types";
import {
  bookHighConfidenceRows,
  bookImportRow,
  createImportBatch,
  skipImportRow,
} from "./service";

type ActionResult = { error: string } | { ok: true; message?: string };

/** Validated /p/{slug}/imports base for redirects and revalidation. */
function importsPath(profileSlug: string, entityId: string): string {
  const profile = getProfile(profileSlug);
  if (!profile || profile.entityId !== entityId) {
    throw new LedgerValidationError("Unknown profile for this entity");
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
      throw new LedgerValidationError("Paste the statement text first");
    }
    const result = await createImportBatch({
      entityId: payload.entityId,
      bankAccountId: payload.bankAccountId,
      text: payload.text,
    });
    batchId = result.batchId;
  } catch (error) {
    if (error instanceof LedgerValidationError || error instanceof IngParseError) {
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
      message:
        result.status === "duplicate"
          ? "Already in the ledger — linked the existing transaction instead of booking twice"
          : undefined,
    };
  } catch (error) {
    if (error instanceof LedgerValidationError) return { error: error.message };
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
    const parts = [`booked ${result.booked}`];
    if (result.duplicates) parts.push(`${result.duplicates} duplicate`);
    if (result.left) parts.push(`${result.left} left for review`);
    if (result.errors.length) return { error: result.errors.join(" · ") };
    return { ok: true, message: parts.join(", ") };
  } catch (error) {
    if (error instanceof LedgerValidationError) return { error: error.message };
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
    if (error instanceof LedgerValidationError) return { error: error.message };
    throw error;
  }
}
