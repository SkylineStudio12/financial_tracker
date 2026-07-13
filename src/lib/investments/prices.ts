/** Price snapshots have one shared writer. Provenance precedence is enforced
 * here so manual corrections cannot be erased by either automated source. */
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { priceSnapshots, securities, trades } from "@/db/schema";
import { LedgerValidationError, type LedgerTx } from "@/lib/ledger";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type PriceSnapshotSource = "manual" | "stooq" | "eodhd";
export type PriceSnapshotWriteAction =
  | "inserted"
  | "updated"
  | "unchanged"
  | "preserved_manual"
  | "preserved_eodhd";

export async function upsertPriceSnapshot(input: {
  securityId: string;
  date: string;
  priceMinor: number;
  source?: PriceSnapshotSource;
  force?: boolean;
}, outerTx?: LedgerTx): Promise<{ action: PriceSnapshotWriteAction }> {
  if (!DATE_RE.test(input.date)) {
    throw new LedgerValidationError("investments.invalidSnapshotDate", { date: input.date });
  }
  if (input.date > new Date().toISOString().slice(0, 10)) {
    throw new LedgerValidationError("investments.snapshotFuture");
  }
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor <= 0) {
    throw new LedgerValidationError("investments.snapshotPricePositive");
  }
  const source = input.source ?? "manual";
  const write = async (tx: LedgerTx): Promise<{ action: PriceSnapshotWriteAction }> => {
    const [security] = await tx
      .select({ id: securities.id })
      .from(securities)
      .where(and(eq(securities.id, input.securityId), isNull(securities.deletedAt)));
    if (!security) {
      throw new LedgerValidationError("investments.securityNotFound", {
        securityId: input.securityId,
      });
    }

    const [before] = await tx
      .select({ price: priceSnapshots.price, source: priceSnapshots.source })
      .from(priceSnapshots)
      .where(
        and(
          eq(priceSnapshots.securityId, input.securityId),
          eq(priceSnapshots.date, input.date),
        ),
      )
      .for("update");

    const changed = or(
      ne(priceSnapshots.price, input.priceMinor),
      ne(priceSnapshots.source, source),
    );
    const allowed =
      input.force || source === "manual"
        ? changed
        : source === "eodhd"
          ? and(ne(priceSnapshots.source, "manual"), changed)
          : and(eq(priceSnapshots.source, "stooq"), changed);

    const [written] = await tx
      .insert(priceSnapshots)
      .values({
        securityId: input.securityId,
        date: input.date,
        price: input.priceMinor,
        source,
      })
      .onConflictDoUpdate({
        target: [priceSnapshots.securityId, priceSnapshots.date],
        set: { price: input.priceMinor, source, updatedAt: new Date() },
        setWhere: allowed,
      })
      .returning({ id: priceSnapshots.id });

    if (written) return { action: before ? "updated" : "inserted" };

    const [current] = await tx
      .select({ price: priceSnapshots.price, source: priceSnapshots.source })
      .from(priceSnapshots)
      .where(
        and(
          eq(priceSnapshots.securityId, input.securityId),
          eq(priceSnapshots.date, input.date),
        ),
      );
    if (current.price === input.priceMinor && current.source === source) {
      return { action: "unchanged" };
    }
    return { action: current.source === "manual" ? "preserved_manual" : "preserved_eodhd" };
  };

  return outerTx ? write(outerTx) : db.transaction(write);
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

/** Latest snapshot per security (for the manual-entry section's context). */
export async function listLatestSnapshots(securityIds: string[]) {
  if (securityIds.length === 0) {
    return new Map<
      string,
      { date: string; priceMinor: number; source: PriceSnapshotSource }
    >();
  }
  const rows = await db
    .select({
      securityId: priceSnapshots.securityId,
      date: sql<string>`max(${priceSnapshots.date})`,
    })
    .from(priceSnapshots)
    .where(inArray(priceSnapshots.securityId, securityIds))
    .groupBy(priceSnapshots.securityId);
  const latest = new Map<
    string,
    { date: string; priceMinor: number; source: PriceSnapshotSource }
  >();
  for (const row of rows) {
    const [snap] = await db
      .select({ priceMinor: priceSnapshots.price, source: priceSnapshots.source })
      .from(priceSnapshots)
      .where(
        and(eq(priceSnapshots.securityId, row.securityId), eq(priceSnapshots.date, row.date)),
      );
    latest.set(row.securityId, {
      date: row.date,
      priceMinor: snap.priceMinor,
      source: snap.source,
    });
  }
  return latest;
}
