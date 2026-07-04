import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { fxRates } from "@/db/schema";
import { backfillYear } from "./sync";

export interface ResolvedRate {
  /** Rate to RON as a decimal string (numeric column, never a float). */
  rate: string;
  /** Banking day the rate was published for — equals the requested date, or
   * the most recent prior banking day (weekend/holiday fallback). */
  rateDate: string;
}

/** Longest expected gap between banking days (long holiday bridges). A prior
 * rate older than this suggests missing data and triggers an on-demand fetch. */
const MAX_GAP_DAYS = 7;

const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

async function latestRateOnOrBefore(date: string, currency: "EUR" | "USD") {
  const [row] = await db
    .select({ rate: fxRates.rateToRon, rateDate: fxRates.date })
    .from(fxRates)
    .where(and(eq(fxRates.currency, currency), lte(fxRates.date, date)))
    .orderBy(desc(fxRates.date))
    .limit(1);
  return row;
}

/**
 * THE rate resolution rule, used by every conversion in the app:
 * - RON is always 1.
 * - Use the rate published for the transaction date itself.
 * - If none exists (weekend, holiday), use the most recent prior rate.
 * - If the date is older than locally available data (or there is a
 *   suspicious gap), fetch BNR's yearly dataset(s) on demand and retry.
 */
export async function resolveRonRate(
  date: string,
  currency: "RON" | "EUR" | "USD",
): Promise<ResolvedRate> {
  if (currency === "RON") return { rate: "1", rateDate: date };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date: ${date}`);

  let row = await latestRateOnOrBefore(date, currency);
  if (row && dayDiff(row.rateDate, date) <= MAX_GAP_DAYS) return row;

  // Missing or stale: pull the target year, then the year before (covers
  // early-January dates whose prior banking day is in the previous year).
  for (const year of [Number(date.slice(0, 4)), Number(date.slice(0, 4)) - 1]) {
    await backfillYear(year);
    row = await latestRateOnOrBefore(date, currency);
    if (row && dayDiff(row.rateDate, date) <= MAX_GAP_DAYS) return row;
  }

  // After backfilling, accept any prior rate even across a long gap.
  if (row) return row;
  throw new Error(`No ${currency} rate available on or before ${date}`);
}
