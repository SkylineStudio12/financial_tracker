"use server";

/**
 * Server actions for trade entry — thin wrappers over the Stage-2 trade
 * service: validate the caller's profile, delegate, surface
 * LedgerValidationError messages verbatim. All writes happen inside
 * executeTrade via createTransaction (single write path).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LedgerValidationError } from "@/lib/ledger";
import { resolveRonRate } from "@/lib/fx";
import { getProfile } from "@/lib/profiles";
import {
  executeTrade,
  getOrCreateSecurity,
  previewSell,
  type SellPreview,
} from "./service";

/** Validated /p/{slug} base — the same slug↔entity guard the other actions use. */
function profileBase(profileSlug: string, entityId: string): string {
  const profile = getProfile(profileSlug);
  if (!profile || profile.entityId !== entityId || !profile.investments) {
    throw new LedgerValidationError("Unknown profile for this entity");
  }
  return `/p/${profile.slug}`;
}

export async function recordTradeAction(payload: {
  profileSlug: string;
  entityId: string;
  kind: "buy" | "sell";
  accountId: string;
  positionAccountId?: string;
  securityId: string;
  date: string;
  quantity: string;
  priceMinor: number;
  totalMinor: number;
  totalRonMinor: number;
  notes?: string;
}): Promise<{ error: string } | undefined> {
  let base: string;
  try {
    base = profileBase(payload.profileSlug, payload.entityId);
    await executeTrade({
      kind: payload.kind,
      accountId: payload.accountId,
      positionAccountId: payload.positionAccountId,
      securityId: payload.securityId,
      date: payload.date,
      quantity: payload.quantity,
      priceMinor: payload.priceMinor,
      totalMinor: payload.totalMinor,
      totalRonMinor: payload.totalRonMinor,
      notes: payload.notes,
    });
  } catch (error) {
    if (error instanceof LedgerValidationError) return { error: error.message };
    throw error;
  }
  revalidatePath(`${base}/investments`);
  redirect(`${base}/transactions`);
}

export async function previewSellAction(payload: {
  accountId: string;
  securityId: string;
  quantity: string;
  totalMinor?: number | null;
  totalRonMinor?: number | null;
}): Promise<SellPreview | { error: string }> {
  try {
    return await previewSell(payload);
  } catch (error) {
    if (error instanceof LedgerValidationError) return { error: error.message };
    throw error;
  }
}

export async function createSecurityAction(payload: {
  ticker: string;
  name: string;
  currency: "RON" | "EUR" | "USD";
}): Promise<
  { id: string; ticker: string; name: string; currency: string } | { error: string }
> {
  try {
    return await getOrCreateSecurity(payload);
  } catch (error) {
    if (error instanceof LedgerValidationError) return { error: error.message };
    throw error;
  }
}

/** Best-effort BNR reference for the trade date — DISPLAY-ONLY sanity hint
 * next to the derived broker rate; never used in booking (Stage-2 rule:
 * the broker's printed amounts are the truth, BNR is never consulted). */
export async function bnrRateHintAction(payload: {
  date: string;
  currency: "EUR" | "USD";
}): Promise<{ rate: string | null }> {
  try {
    const resolved = await resolveRonRate(payload.date, payload.currency);
    return { rate: resolved.rate };
  } catch {
    return { rate: null };
  }
}
