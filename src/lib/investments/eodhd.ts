import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { securityPriceMappings, stockSplits } from "@/db/schema";
import { scalePriceToMinor } from "./price-decimal";
import {
  listLatestSnapshots,
  listSecuritiesNeedingPrices,
  upsertPriceSnapshot,
  type PriceSnapshotWriteAction,
} from "./prices";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COMMON_SPLIT_RATIOS = [2, 3, 4, 5, 10] as const;
const SPLIT_RATIO_TOLERANCE = 0.12;
const EODHD_DAILY_CALL_LIMIT = 20;

export interface EodhdPriceRow {
  date: string;
  close: string;
  priceMinor: number;
}

export type EodhdSeriesAssessment =
  | { status: "ready"; rows: EodhdPriceRow[] }
  | {
      status: "quarantined";
      rows: EodhdPriceRow[];
      suspectedDate: string;
      observedRatio: number;
      nearestCommonRatio: number;
    };

interface PreviousPrice {
  date: string;
  priceMinor: number;
}

interface HeldSecurity {
  id: string;
  ticker: string;
  currency: "RON" | "EUR" | "USD";
}

interface EodhdMapping {
  securityId: string;
  symbol: string;
}

export function buildEodhdQueue(
  held: HeldSecurity[],
  mappings: EodhdMapping[],
  latest: Map<string, PreviousPrice & { source: "manual" | "stooq" | "eodhd" }>,
  callLimit: number,
  today?: string,
) {
  const mappingBySecurity = new Map(mappings.map((mapping) => [mapping.securityId, mapping.symbol]));
  const candidates = held
    .flatMap((security) => {
      const symbol = mappingBySecurity.get(security.id);
      return symbol ? [{ ...security, symbol, latest: latest.get(security.id) ?? null }] : [];
    })
    .filter((security) => !today || !security.latest || security.latest.date < today)
    .sort((left, right) => {
      const dateOrder = (left.latest?.date ?? "").localeCompare(right.latest?.date ?? "");
      return dateOrder || left.ticker.localeCompare(right.ticker);
    })
    .slice(0, callLimit);
  return {
    candidates,
    unmapped: held
      .filter((security) => !mappingBySecurity.has(security.id))
      .map((security) => security.ticker),
  };
}

function validIsoDate(value: string) {
  return DATE_RE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function parseEodhdResponse(text: string): EodhdPriceRow[] {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("EODHD response is not valid JSON");
  }
  if (!Array.isArray(payload)) throw new Error("EODHD response must be an array");

  const dates = new Set<string>();
  const rows = payload.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error(`EODHD row ${index + 1} is not an object`);
    }
    const row = value as Record<string, unknown>;
    if (typeof row.date !== "string" || !validIsoDate(row.date)) {
      throw new Error(`EODHD row ${index + 1} has invalid date`);
    }
    if (dates.has(row.date)) throw new Error(`EODHD response duplicates ${row.date}`);
    dates.add(row.date);
    if (typeof row.close !== "string" && typeof row.close !== "number") {
      throw new Error(`EODHD row ${index + 1} has invalid raw close`);
    }
    const close = String(row.close);
    const converted = scalePriceToMinor(close);
    return { date: row.date, close, priceMinor: converted.priceMinor };
  });
  return rows.sort((left, right) => left.date.localeCompare(right.date));
}

function daysBetween(left: string, right: string) {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}

export function assessEodhdSeries(
  rows: EodhdPriceRow[],
  previous: PreviousPrice | null,
  bookedSplitDates: readonly string[],
): EodhdSeriesAssessment {
  const points: PreviousPrice[] = [
    ...(previous ? [previous] : []),
    ...rows.map((row) => ({ date: row.date, priceMinor: row.priceMinor })),
  ];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    const observedRatio = before.priceMinor / after.priceMinor;
    const nearestCommonRatio = COMMON_SPLIT_RATIOS.reduce((nearest, candidate) =>
      Math.abs(observedRatio - candidate) < Math.abs(observedRatio - nearest) ? candidate : nearest,
    );
    const looksLikeSplit =
      observedRatio > 1 &&
      Math.abs(observedRatio - nearestCommonRatio) / nearestCommonRatio <= SPLIT_RATIO_TOLERANCE;
    const hasBookedSplit = bookedSplitDates.some((date) => daysBetween(date, after.date) <= 3);
    if (looksLikeSplit && !hasBookedSplit) {
      return {
        status: "quarantined",
        rows,
        suspectedDate: after.date,
        observedRatio,
        nearestCommonRatio,
      };
    }
  }
  return { status: "ready", rows };
}

export async function writeAssessedEodhdRows(
  assessment: EodhdSeriesAssessment,
  writer: (row: EodhdPriceRow) => Promise<{ action: PriceSnapshotWriteAction }>,
) {
  const actions: Record<PriceSnapshotWriteAction, number> = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    preserved_manual: 0,
    preserved_eodhd: 0,
  };
  if (assessment.status === "quarantined") return { written: 0, actions };
  for (const row of assessment.rows) {
    const result = await writer(row);
    actions[result.action] += 1;
  }
  return { written: assessment.rows.length, actions };
}

export async function fetchEodhdSeries(input: {
  symbol: string;
  from: string;
  to: string;
  apiToken: string;
}): Promise<EodhdPriceRow[]> {
  const url = new URL(`https://eodhd.com/api/eod/${encodeURIComponent(input.symbol)}`);
  url.searchParams.set("api_token", input.apiToken);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("period", "d");
  url.searchParams.set("from", input.from);
  url.searchParams.set("to", input.to);
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    const safeText = text.replaceAll(input.apiToken, "[redacted]");
    throw new Error(`EODHD ${input.symbol} returned ${response.status}: ${safeText.slice(0, 300)}`);
  }
  return parseEodhdResponse(text);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function rollingFloor(today: string) {
  return addDays(today, -364);
}

export interface EodhdSyncResult {
  source: "eodhd";
  scheduler: "manual_until_phase_7";
  held: number;
  mapped: number;
  callsUsed: number;
  callLimit: number;
  unmapped: string[];
  tickers: Array<
    | { ticker: string; symbol: string; status: "updated"; rows: number; actions: Record<PriceSnapshotWriteAction, number> }
    | { ticker: string; symbol: string; status: "no_data" }
    | { ticker: string; symbol: string; status: "failed"; error: string }
    | {
        ticker: string;
        symbol: string;
        status: "quarantined";
        suspectedDate: string;
        observedRatio: number;
        nearestCommonRatio: number;
        rowsWritten: 0;
      }
  >;
}

export async function syncEodhdPrices(options?: {
  apiToken?: string;
  today?: string;
  callLimit?: number;
  fetchSeries?: typeof fetchEodhdSeries;
}): Promise<EodhdSyncResult> {
  const apiToken = options?.apiToken ?? process.env.EODHD_API_TOKEN;
  if (!apiToken) throw new Error("EODHD_API_TOKEN is not configured");
  const today = options?.today ?? new Date().toISOString().slice(0, 10);
  if (!validIsoDate(today)) throw new Error(`Invalid EODHD sync date ${today}`);
  const callLimit = Math.min(options?.callLimit ?? EODHD_DAILY_CALL_LIMIT, EODHD_DAILY_CALL_LIMIT);
  if (!Number.isSafeInteger(callLimit) || callLimit < 1) throw new Error("EODHD call limit must be positive");

  const held = await listSecuritiesNeedingPrices();
  const heldIds = held.map((security) => security.id);
  const mappings = heldIds.length === 0
    ? []
    : await db
        .select({
          securityId: securityPriceMappings.securityId,
          symbol: securityPriceMappings.symbol,
        })
        .from(securityPriceMappings)
        .where(
          and(
            eq(securityPriceMappings.provider, "eodhd"),
            inArray(securityPriceMappings.securityId, heldIds),
          ),
        );
  const latest = await listLatestSnapshots(heldIds);
  const queue = buildEodhdQueue(held, mappings, latest, callLimit, today);
  const candidates = queue.candidates;

  const tickers: EodhdSyncResult["tickers"] = [];
  const fetchSeries = options?.fetchSeries ?? fetchEodhdSeries;
  for (const candidate of candidates) {
    try {
      const rows = await fetchSeries({
        symbol: candidate.symbol,
        from: candidate.latest ? addDays(candidate.latest.date, 1) : rollingFloor(today),
        to: today,
        apiToken,
      });
      if (rows.length === 0) {
        tickers.push({ ticker: candidate.ticker, symbol: candidate.symbol, status: "no_data" });
        continue;
      }
      const booked = await db
        .select({ occurredAt: stockSplits.occurredAt })
        .from(stockSplits)
        .where(eq(stockSplits.securityId, candidate.id))
        .orderBy(asc(stockSplits.occurredAt));
      const assessment = assessEodhdSeries(
        rows,
        candidate.latest ? { date: candidate.latest.date, priceMinor: candidate.latest.priceMinor } : null,
        booked.map((split) => split.occurredAt.slice(0, 10)),
      );
      if (assessment.status === "quarantined") {
        tickers.push({
          ticker: candidate.ticker,
          symbol: candidate.symbol,
          status: "quarantined",
          suspectedDate: assessment.suspectedDate,
          observedRatio: assessment.observedRatio,
          nearestCommonRatio: assessment.nearestCommonRatio,
          rowsWritten: 0,
        });
        continue;
      }
      const writeResult = await db.transaction((tx) =>
        writeAssessedEodhdRows(assessment, (row) =>
          upsertPriceSnapshot(
            {
              securityId: candidate.id,
              date: row.date,
              priceMinor: row.priceMinor,
              source: "eodhd",
            },
            tx,
          ),
        ),
      );
      tickers.push({
        ticker: candidate.ticker,
        symbol: candidate.symbol,
        status: "updated",
        rows: writeResult.written,
        actions: writeResult.actions,
      });
    } catch (error) {
      tickers.push({
        ticker: candidate.ticker,
        symbol: candidate.symbol,
        status: "failed",
        error: (error as Error).message,
      });
    }
  }

  return {
    source: "eodhd",
    scheduler: "manual_until_phase_7",
    held: held.length,
    mapped: mappings.length,
    callsUsed: candidates.length,
    callLimit,
    unmapped: queue.unmapped,
    tickers,
  };
}
