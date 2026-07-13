import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fxRates } from "@/db/schema";

/** Earliest date for which both tracked foreign currencies are stored. */
export async function getEarliestPairedRateDate(): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT min(paired.date)::text AS floor
    FROM (
      SELECT ${fxRates.date} AS date
      FROM ${fxRates}
      WHERE ${fxRates.currency} IN ('EUR', 'USD')
      GROUP BY ${fxRates.date}
      HAVING count(DISTINCT ${fxRates.currency}) = 2
    ) AS paired
  `);
  const row = result.rows[0] as { floor: string | null } | undefined;
  return row?.floor ?? null;
}
