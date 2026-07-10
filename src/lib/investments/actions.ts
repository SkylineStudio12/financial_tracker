"use server";

/**
 * Server actions for trade entry — thin wrappers over the Stage-2 trade
 * service: validate the caller's profile, delegate, surface
 * LedgerValidationError codes for client-side translation. All writes happen inside
 * executeTrade via createTransaction (single write path).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LedgerValidationError } from "@/lib/ledger";
import { toAppError, type AppError } from "@/lib/app-error";
import { resolveRonRate } from "@/lib/fx";
import { getProfile } from "@/lib/profiles";
import {
  estimateDividendTaxes,
  executeTrade,
  getOrCreateSecurity,
  previewSell,
  type SellPreview,
  type TradeInput,
} from "./service";
import { upsertPriceSnapshot } from "./prices";

/** Validated /p/{slug} base — the same slug↔entity guard the other actions use. */
function profileBase(profileSlug: string, entityId: string): string {
  const profile = getProfile(profileSlug);
  if (!profile || profile.entityId !== entityId || !profile.investments) {
    throw new LedgerValidationError("profile.unknownInvestment");
  }
  return `/p/${profile.slug}`;
}

export async function recordTradeAction(payload: {
  profileSlug: string;
  entityId: string;
  kind: "buy" | "sell" | "dividend";
  accountId: string;
  positionAccountId?: string;
  securityId: string;
  date: string;
  /** Required for buy/sell; absent on dividend (net cash event). */
  quantity?: string;
  priceMinor?: number;
  totalMinor: number;
  totalRonMinor: number;
  notes?: string;
}): Promise<{ error: AppError } | undefined> {
  let base: string;
  try {
    base = profileBase(payload.profileSlug, payload.entityId);
    let input: TradeInput;
    if (payload.kind === "dividend") {
      input = {
        kind: "dividend",
        accountId: payload.accountId,
        securityId: payload.securityId,
        date: payload.date,
        totalMinor: payload.totalMinor,
        totalRonMinor: payload.totalRonMinor,
        notes: payload.notes,
      };
    } else {
      if (!payload.quantity || payload.priceMinor === undefined) {
        throw new LedgerValidationError("investments.buySellQuantityAndPriceRequired");
      }
      input = {
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
      };
    }
    await executeTrade(input);
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
  revalidatePath(`${base}/investments`);
  redirect(`${base}/transactions`);
}

/**
 * DISPLAY-ONLY per-dividend tax indication (nothing is ever booked from
 * this). Rate AND amount come from the active tax_rules row — never a
 * literal, so the label percentage self-updates with the config (owner fix
 * 1). No CASS number is returned AT ALL: CASS on dividends is an
 * annual-threshold calculation a single dividend cannot determine — a
 * wrong-shape number is stickier than an absence (owner fix 2), so the UI
 * renders a note instead.
 */
export async function estimateDividendAction(payload: {
  date: string;
  dividendRonMinor: number;
}): Promise<{ dividendTaxRonMinor: number; dividendTaxRateBps: number } | { error: AppError }> {
  try {
    const estimate = await estimateDividendTaxes(payload.date, payload.dividendRonMinor);
    return {
      dividendTaxRonMinor: estimate.dividendTaxRonMinor,
      dividendTaxRateBps: estimate.dividendTaxRule.rateBps,
    };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export async function previewSellAction(payload: {
  accountId: string;
  securityId: string;
  quantity: string;
  totalMinor?: number | null;
  totalRonMinor?: number | null;
}): Promise<SellPreview | { error: AppError }> {
  try {
    return await previewSell(payload);
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export async function createSecurityAction(payload: {
  ticker: string;
  name: string;
  currency: "RON" | "EUR" | "USD";
}): Promise<
  { id: string; ticker: string; name: string; currency: string } | { error: AppError }
> {
  try {
    return await getOrCreateSecurity(payload);
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
    throw error;
  }
}

export async function upsertPriceSnapshotAction(payload: {
  profileSlug: string;
  entityId: string;
  securityId: string;
  date: string;
  priceMinor: number;
}): Promise<{ ok: true } | { error: AppError }> {
  try {
    const base = profileBase(payload.profileSlug, payload.entityId);
    await upsertPriceSnapshot({
      securityId: payload.securityId,
      date: payload.date,
      priceMinor: payload.priceMinor,
    });
    revalidatePath(`${base}/investments`);
    return { ok: true };
  } catch (error) {
    const appError = toAppError(error);
    if (appError) return { error: appError };
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
