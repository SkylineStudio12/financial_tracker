/**
 * Price snapshots (Phase 4 Stage 4): manual entry is the guaranteed path;
 * the daily sync endpoint carries a PLUGGABLE source seam whose concrete
 * API is deliberately unpicked — the real tickers don't exist yet, and
 * free-API coverage of EUR/USD UCITS listings is exactly where sources
 * differ. When a source is chosen it implements PriceSource; credentials
 * live in env, never in code.
 *
 * Snapshots are synced/replaced data (no soft delete): upsert on the
 * (security_id, date) unique index, replaced not edited.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { priceSnapshots, securities, trades } from "@/db/schema";
import { LedgerValidationError } from "@/lib/ledger";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function upsertPriceSnapshot(input: {
  securityId: string;
  date: string;
  priceMinor: number;
}): Promise<void> {
  if (!DATE_RE.test(input.date)) {
    throw new LedgerValidationError("investments.invalidSnapshotDate", { date: input.date });
  }
  if (input.date > new Date().toISOString().slice(0, 10)) {
    throw new LedgerValidationError("investments.snapshotFuture");
  }
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor <= 0) {
    throw new LedgerValidationError("investments.snapshotPricePositive");
  }
  const [security] = await db
    .select({ id: securities.id })
    .from(securities)
    .where(and(eq(securities.id, input.securityId), isNull(securities.deletedAt)));
  if (!security) {
    throw new LedgerValidationError("investments.securityNotFound", {
      securityId: input.securityId,
    });
  }

  await db
    .insert(priceSnapshots)
    .values({ securityId: input.securityId, date: input.date, price: input.priceMinor })
    .onConflictDoUpdate({
      target: [priceSnapshots.securityId, priceSnapshots.date],
      set: { price: input.priceMinor, updatedAt: new Date() },
    });
}

/** Securities that currently have at least one live buy lot anywhere — the
 * set a daily price sync must cover. */
export async function listSecuritiesNeedingPrices() {
  const held = await db
    .selectDistinct({ securityId: trades.securityId })
    .from(trades)
    .where(and(eq(trades.kind, "buy"), isNull(trades.deletedAt)));
  if (held.length === 0) return [];
  return db
    .select({ id: securities.id, ticker: securities.ticker, currency: securities.currency })
    .from(securities)
    .where(
      and(
        inArray(
          securities.id,
          held.map((h) => h.securityId),
        ),
        isNull(securities.deletedAt),
      ),
    );
}

/** The pluggable daily-price seam. Implementations fetch closing prices for
 * the given securities; unpriceable tickers are simply omitted. */
export interface PriceSource {
  name: string;
  fetchDailyPrices(
    securities: { id: string; ticker: string; currency: "RON" | "EUR" | "USD" }[],
  ): Promise<{ securityId: string; priceMinor: number }[]>;
}

/** No source is configured yet (owner decision: pick the API when real
 * tickers exist to test coverage against). Manual entry is the path. */
export const NO_SOURCE: PriceSource = {
  name: "none (manual entry)",
  fetchDailyPrices: async () => [],
};

/** One daily batch: snapshot today's price for every held security via the
 * configured source. Idempotent (upsert per (security, date)). */
export async function syncDailyPrices(source: PriceSource = NO_SOURCE): Promise<{
  source: string;
  held: number;
  updated: number;
}> {
  const needing = await listSecuritiesNeedingPrices();
  if (needing.length === 0) return { source: source.name, held: 0, updated: 0 };
  const today = new Date().toISOString().slice(0, 10);
  const prices = await source.fetchDailyPrices(needing);
  for (const p of prices) {
    await upsertPriceSnapshot({ securityId: p.securityId, date: today, priceMinor: p.priceMinor });
  }
  return { source: source.name, held: needing.length, updated: prices.length };
}

/** Latest snapshot per security (for the manual-entry section's context). */
export async function listLatestSnapshots(securityIds: string[]) {
  if (securityIds.length === 0) return new Map<string, { date: string; priceMinor: number }>();
  const rows = await db
    .select({
      securityId: priceSnapshots.securityId,
      date: sql<string>`max(${priceSnapshots.date})`,
    })
    .from(priceSnapshots)
    .where(inArray(priceSnapshots.securityId, securityIds))
    .groupBy(priceSnapshots.securityId);
  const latest = new Map<string, { date: string; priceMinor: number }>();
  for (const row of rows) {
    const [snap] = await db
      .select({ priceMinor: priceSnapshots.price })
      .from(priceSnapshots)
      .where(
        and(eq(priceSnapshots.securityId, row.securityId), eq(priceSnapshots.date, row.date)),
      );
    latest.set(row.securityId, { date: row.date, priceMinor: snap.priceMinor });
  }
  return latest;
}
