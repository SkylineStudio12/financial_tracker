/**
 * Holdings valuation (Phase 4 Stage 4) — a READ path, no writes.
 *
 * Value = latest price ON OR BEFORE the valuation date × open quantity,
 * converted to RON at the valuation date's resolved rate. Open quantity and
 * cost basis come from the SAME lot machinery that books (loadLots) — never
 * a parallel computation.
 *
 * MISSING-PRICE RULE (the resolveRonRate mental model, reused): most recent
 * snapshot on-or-before; older than STALE_DAYS → valued but stale-flagged
 * with the price's actual date; no snapshot at all → the holding is NOT
 * valued (never zero, never silent) and totals say how many were excluded.
 *
 * SUPPORTED DATE RANGE, hard-enforced: FX_FLOOR (first local BNR rate) ≤
 * date ≤ today. Outside it: LedgerValidationError — no silent wrong number.
 * Today may trigger the on-demand BNR fetch (the app's normal FX mechanism).
 *
 * Unrealized gain is TOTAL-only here (value − basis, both currencies); the
 * price-vs-FX decomposition is Phase-5 reporting — its inputs (per-lot ccy
 * basis, buy rates, valuation rate) are all already persisted.
 */
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { priceSnapshots, securities, trades } from "@/db/schema";
import { convertMinorToRon, resolveRonRate } from "@/lib/fx";
import { LedgerValidationError } from "@/lib/ledger";
import { listBrokerageAccounts, loadLots } from "./service";
import { formatQuantity, valueAtPrice } from "./trade-rules";

/** First banking day with a locally-synced BNR rate (Stage-0 verified). */
const FX_FLOOR = "2025-01-03";
/** Same tolerance the FX fallback uses — one mental model. */
const STALE_DAYS = 7;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export interface HoldingValuation {
  cashAccountId: string;
  cashAccountName: string;
  owner: "greg" | "andra" | null;
  securityId: string;
  ticker: string;
  securityName: string;
  currency: "RON" | "EUR" | "USD";
  quantity: string;
  basisMinor: number;
  basisRonMinor: number;
  /** Null = no snapshot exists on or before the valuation date. */
  price: { priceMinor: number; priceDate: string; stale: boolean } | null;
  valueMinor: number | null;
  valueRonMinor: number | null;
  unrealizedMinor: number | null;
  unrealizedRonMinor: number | null;
}

export interface ValuationResult {
  date: string;
  holdings: HoldingValuation[];
  totals: {
    /** Basis of ALL open holdings (priced or not). */
    basisRonMinor: number;
    /** Basis of only the priced holdings — the honest denominator. */
    valuedBasisRonMinor: number;
    valueRonMinor: number;
    unrealizedRonMinor: number;
    unpricedCount: number;
  };
}

async function latestPriceOnOrBefore(securityId: string, date: string) {
  const [row] = await db
    .select({ priceMinor: priceSnapshots.price, priceDate: priceSnapshots.date })
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.securityId, securityId), lte(priceSnapshots.date, date)))
    .orderBy(desc(priceSnapshots.date))
    .limit(1);
  return row ?? null;
}

export async function valueHoldings(params: {
  entityId: string;
  owner?: "greg" | "andra";
  /** YYYY-MM-DD; defaults to today. */
  date?: string;
}): Promise<ValuationResult> {
  const today = new Date().toISOString().slice(0, 10);
  const date = params.date ?? today;
  if (!DATE_RE.test(date) || date < FX_FLOOR || date > today) {
    throw new LedgerValidationError(
      `Valuation date ${date} is outside the supported FX range (${FX_FLOOR} to today)`,
    );
  }

  const cashAccounts = (await listBrokerageAccounts(params.entityId, params.owner)).filter(
    (a) => a.type === "brokerage",
  );

  const rateByCurrency = new Map<string, string>();
  const resolveRate = async (currency: "RON" | "EUR" | "USD") => {
    if (currency === "RON") return "1";
    const cached = rateByCurrency.get(currency);
    if (cached) return cached;
    const resolved = await resolveRonRate(date, currency);
    rateByCurrency.set(currency, resolved.rate);
    return resolved.rate;
  };

  const holdings: HoldingValuation[] = [];
  for (const account of cashAccounts) {
    const held = await db
      .selectDistinct({ securityId: trades.securityId })
      .from(trades)
      .where(
        and(eq(trades.accountId, account.id), eq(trades.kind, "buy"), isNull(trades.deletedAt)),
      );
    for (const { securityId } of held) {
      const lots = await db.transaction((tx) => loadLots(tx, account.id, securityId));
      let openQty = 0n;
      let basisMinor = 0n;
      let basisRonMinor = 0n;
      for (const lot of lots) {
        openQty += lot.quantity - lot.consumedQuantity;
        basisMinor += lot.totalMinor - lot.allocatedMinor;
        basisRonMinor += lot.totalRonMinor - lot.allocatedRonMinor;
      }
      if (openQty === 0n) continue;

      const [security] = await db
        .select()
        .from(securities)
        .where(eq(securities.id, securityId));
      const snapshot = await latestPriceOnOrBefore(securityId, date);
      const price = snapshot
        ? { ...snapshot, stale: dayDiff(snapshot.priceDate, date) > STALE_DAYS }
        : null;

      let valueMinor: number | null = null;
      let valueRonMinor: number | null = null;
      if (price) {
        valueMinor = valueAtPrice(price.priceMinor, openQty);
        valueRonMinor = convertMinorToRon(valueMinor, await resolveRate(security.currency));
      }
      holdings.push({
        cashAccountId: account.id,
        cashAccountName: account.name,
        owner: account.owner,
        securityId,
        ticker: security.ticker,
        securityName: security.name,
        currency: security.currency,
        quantity: formatQuantity(openQty),
        basisMinor: Number(basisMinor),
        basisRonMinor: Number(basisRonMinor),
        price,
        valueMinor,
        valueRonMinor,
        unrealizedMinor: valueMinor === null ? null : valueMinor - Number(basisMinor),
        unrealizedRonMinor: valueRonMinor === null ? null : valueRonMinor - Number(basisRonMinor),
      });
    }
  }
  holdings.sort((a, b) => a.ticker.localeCompare(b.ticker) || a.cashAccountName.localeCompare(b.cashAccountName));

  const priced = holdings.filter((h) => h.valueRonMinor !== null);
  return {
    date,
    holdings,
    totals: {
      basisRonMinor: holdings.reduce((s, h) => s + h.basisRonMinor, 0),
      valuedBasisRonMinor: priced.reduce((s, h) => s + h.basisRonMinor, 0),
      valueRonMinor: priced.reduce((s, h) => s + (h.valueRonMinor ?? 0), 0),
      unrealizedRonMinor: priced.reduce((s, h) => s + (h.unrealizedRonMinor ?? 0), 0),
      unpricedCount: holdings.length - priced.length,
    },
  };
}
