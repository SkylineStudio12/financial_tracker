import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fxRates } from "@/db/schema";
import { fetchLatestRates, fetchYearRates, type BnrDailyRates } from "./bnr";

/** Upsert a batch of daily rates (unique on date + currency). */
export async function upsertDailyRates(days: BnrDailyRates[]): Promise<number> {
  const values = days.flatMap((day) =>
    day.rates.map((rate) => ({
      date: day.date,
      currency: rate.currency,
      rateToRon: rate.rateToRon,
    })),
  );
  if (values.length === 0) return 0;

  await db
    .insert(fxRates)
    .values(values)
    .onConflictDoUpdate({
      target: [fxRates.date, fxRates.currency],
      set: {
        rateToRon: sql`excluded.rate_to_ron`,
        updatedAt: new Date(),
      },
    });
  return values.length;
}

/** Sync the most recent banking day's EUR/USD rates. */
export async function syncLatestRates(): Promise<{ date: string; upserted: number }> {
  const latest = await fetchLatestRates();
  const upserted = await upsertDailyRates([latest]);
  return { date: latest.date, upserted };
}

/**
 * Backfill an inclusive date range from BNR's yearly datasets.
 * Days without a published rate (weekends, holidays) simply don't appear.
 */
export async function backfillRange(
  from: string,
  to: string,
): Promise<{ bankingDays: number; upserted: number }> {
  if (from > to) throw new Error(`Invalid range: ${from} > ${to}`);
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));

  const days: BnrDailyRates[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    const yearDays = await fetchYearRates(year);
    days.push(...yearDays.filter((day) => day.date >= from && day.date <= to));
  }
  const upserted = await upsertDailyRates(days);
  return { bankingDays: days.length, upserted };
}

/** Backfill one whole year — used by on-demand historical resolution. */
export async function backfillYear(year: number): Promise<number> {
  return upsertDailyRates(await fetchYearRates(year));
}
