/**
 * The single place where integer minor units become display strings.
 * Nothing else in the app divides by 100 or formats amounts.
 *
 * Every display function takes the active locale as a REQUIRED parameter —
 * deliberately no default, so a missing locale is a tsc error, never a
 * silent misrender of money in the wrong locale. Components acquire the
 * locale once at their boundary (getLocale in server components, useLocale
 * in client components) and pass it in; this module stays pure and
 * context-free so it behaves identically on both sides.
 */
import type { Locale } from "@/i18n/config";

/** CLDR tag per app locale — en is explicitly en-US (12,345.67). */
const CLDR: Record<Locale, string> = { en: "en-US", ro: "ro-RO" };

function makeFormatters(options: Intl.NumberFormatOptions): Record<Locale, Intl.NumberFormat> {
  return {
    en: new Intl.NumberFormat(CLDR.en, options),
    ro: new Intl.NumberFormat(CLDR.ro, options),
  };
}

const amountFormatters = makeFormatters({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rateFormatters = makeFormatters({ minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** 1234567 minor units + "RON" → ro "12.345,67 RON" / en "12,345.67 RON" */
export function formatMinor(amountMinor: number, currency: string, locale: Locale): string {
  return `${amountFormatters[locale].format(amountMinor / 100)} ${currency}`;
}

/** Number only, so the currency can render muted. */
export function formatMinorNumber(amountMinor: number, locale: Locale): string {
  return amountFormatters[locale].format(amountMinor / 100);
}

/** Effective FX rate implied by a posting's stored amounts (display only). */
export function formatImpliedRate(
  amountMinor: number,
  amountRonMinor: number,
  locale: Locale,
): string {
  if (amountMinor === 0) return "–";
  return rateFormatters[locale].format(amountRonMinor / amountMinor);
}

/**
 * Display date: en keeps ISO (2026-07-09) per the ruled decision; ro renders
 * DD.MM.YYYY — by pure string rearrangement, never via new Date(), so no
 * timezone can shift the day. Non-YYYY-MM-DD input passes through unchanged.
 */
export function formatDate(isoDate: string, locale: Locale): string {
  if (locale === "en") return isoDate;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}

/** Audit timestamp in the owner's Bucharest timezone. */
export function formatDateTime(value: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(CLDR[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Bucharest",
  }).format(typeof value === "string" ? new Date(value) : value);
}

/**
 * Basis points as a display percent: locale-formatted number + literal "%"
 * with no space (owner ruling — CLDR ro would insert one; identical shape
 * across locales wins). 100 bps → "1%"; pass minFractionDigits for a fixed
 * precision (e.g. accrual rates render "1,00%" / "1.00%").
 */
export function formatBpsPercent(
  bps: number,
  locale: Locale,
  {
    minFractionDigits = 0,
    maxFractionDigits = 2,
  }: { minFractionDigits?: number; maxFractionDigits?: number } = {},
): string {
  const formatter = new Intl.NumberFormat(CLDR[locale], {
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: Math.max(minFractionDigits, maxFractionDigits),
  });
  return `${formatter.format(bps / 100)}%`;
}

/**
 * Parse user-typed major units into integer minor units without float math.
 * Accepts "1234.56", "1234,56", "1234". Returns null when not parseable.
 */
export function parseAmountToMinor(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units → "1234,56" for prefilling form inputs (no separators). */
export function minorToInput(amountMinor: number): string {
  const abs = Math.abs(amountMinor);
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
