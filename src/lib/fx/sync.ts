import { and, asc, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { fxRates } from "@/db/schema";
import {
  BNR_CURRENCIES,
  fetchLatestRates,
  fetchYearRates,
  type BnrCurrency,
  type BnrDailyRates,
} from "./bnr";

type FxClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

interface StoredRate {
  date: string;
  currency: BnrCurrency;
  rateToRon: string;
}

export interface FxRateDelta {
  date: string;
  currency: BnrCurrency;
  before: string;
  after: string;
}

export interface FxFixtureResult {
  date: string;
  currency: BnrCurrency;
  expected: string;
  actual: string;
}

export interface FxBackfillReport {
  bankingDays: number;
  upserted: number;
  inserted: number;
  existing: number;
  firstDate: string;
  lastDate: string;
  storedRows: number;
  oneSidedDates: number;
  maxGapDays: number;
  overwriteDeltaCount: number;
  overwriteDeltas: FxRateDelta[];
  fixtures: FxFixtureResult[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_RE = /^\d+(?:\.\d+)?$/;
const MAX_GAP_DAYS = 7;

const RATE_FIXTURES = [
  { date: "2024-01-10", currency: "EUR", rateToRon: "4.9724" },
  { date: "2024-01-10", currency: "USD", rateToRon: "4.5418" },
  { date: "2025-07-10", currency: "EUR", rateToRon: "5.0774" },
  { date: "2025-07-10", currency: "USD", rateToRon: "4.3275" },
  { date: "2026-07-10", currency: "EUR", rateToRon: "5.2337" },
  { date: "2026-07-10", currency: "USD", rateToRon: "4.5791" },
] as const satisfies readonly {
  date: string;
  currency: BnrCurrency;
  rateToRon: string;
}[];

function assertDate(value: string, label: string): void {
  if (!DATE_RE.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

export function canonicalRate(value: string): string {
  if (!DECIMAL_RE.test(value)) throw new Error(`Invalid BNR rate: ${value}`);
  const [whole, fraction = ""] = value.split(".");
  const normalizedWhole = BigInt(whole).toString();
  const normalizedFraction = fraction.replace(/0+$/, "");
  const normalized = normalizedFraction
    ? `${normalizedWhole}.${normalizedFraction}`
    : normalizedWhole;
  if (normalized === "0") throw new Error(`BNR rate must be positive: ${value}`);
  return normalized;
}

/** Validate and canonicalize a complete BNR source range before any write. */
export function validateBnrDailyRates(
  days: BnrDailyRates[],
  from: string,
  to: string,
): BnrDailyRates[] {
  assertDate(from, "range start");
  assertDate(to, "range end");
  if (from > to) throw new Error(`Invalid range: ${from} > ${to}`);
  if (days.length === 0) throw new Error(`BNR returned no banking days for ${from}..${to}`);

  const seenDates = new Set<string>();
  const normalized = days.map((day) => {
    assertDate(day.date, "BNR date");
    if (day.date < from || day.date > to) {
      throw new Error(`BNR date ${day.date} is outside ${from}..${to}`);
    }
    if (seenDates.has(day.date)) throw new Error(`Duplicate BNR date: ${day.date}`);
    seenDates.add(day.date);

    const byCurrency = new Map<BnrCurrency, string>();
    for (const rate of day.rates) {
      if (byCurrency.has(rate.currency)) {
        throw new Error(`Duplicate ${rate.currency} rate on ${day.date}`);
      }
      byCurrency.set(rate.currency, canonicalRate(rate.rateToRon));
    }
    for (const currency of BNR_CURRENCIES) {
      if (!byCurrency.has(currency)) throw new Error(`Missing ${currency} rate on ${day.date}`);
    }
    if (byCurrency.size !== BNR_CURRENCIES.length) {
      throw new Error(`Unexpected BNR currency count on ${day.date}: ${byCurrency.size}`);
    }
    return {
      date: day.date,
      rates: BNR_CURRENCIES.map((currency) => ({
        currency,
        rateToRon: byCurrency.get(currency)!,
      })),
    };
  });

  return normalized.sort((a, b) => a.date.localeCompare(b.date));
}

function rateKey(rate: Pick<StoredRate, "date" | "currency">): string {
  return `${rate.date}:${rate.currency}`;
}

export function findOverwriteDeltas(before: StoredRate[], after: StoredRate[]): FxRateDelta[] {
  const afterByKey = new Map(after.map((rate) => [rateKey(rate), rate]));
  return before.flatMap((previous) => {
    const replacement = afterByKey.get(rateKey(previous));
    if (!replacement || canonicalRate(previous.rateToRon) === canonicalRate(replacement.rateToRon)) {
      return [];
    }
    return [{
      date: previous.date,
      currency: previous.currency,
      before: previous.rateToRon,
      after: replacement.rateToRon,
    }];
  });
}

export class FxOverwriteDeltaError extends Error {
  constructor(readonly deltas: FxRateDelta[]) {
    super(
      [
        `BNR overwrite delta detected (${deltas.length} changed rates); transaction rolled back:`,
        ...deltas.map(
          (delta) =>
            `${delta.date} ${delta.currency}: ${delta.before} -> ${delta.after}`,
        ),
      ].join("\n"),
    );
    this.name = "FxOverwriteDeltaError";
  }
}

export class FxSourceDisagreementError extends Error {
  constructor(readonly deltas: FxRateDelta[]) {
    super(
      [
        `BNR yearly/latest source disagreement (${deltas.length} changed rates):`,
        ...deltas.map(
          (delta) =>
            `${delta.date} ${delta.currency}: yearly ${delta.before}, latest ${delta.after}`,
        ),
      ].join("\n"),
    );
    this.name = "FxSourceDisagreementError";
  }
}

function ratesForDay(day: BnrDailyRates): StoredRate[] {
  return day.rates.map((rate) => ({
    date: day.date,
    currency: rate.currency,
    rateToRon: rate.rateToRon,
  }));
}

/** Reconcile the current yearly feed with BNR's independently published latest day. */
export function mergeLatestDay(
  rawDays: BnrDailyRates[],
  rawLatest: BnrDailyRates,
  from: string,
  to: string,
): BnrDailyRates[] {
  const days = validateBnrDailyRates(rawDays, from, to);
  const [latest] = validateBnrDailyRates([rawLatest], rawLatest.date, rawLatest.date);
  if (latest.date < from || latest.date > to) return days;

  const yearlyLatest = days.find((day) => day.date === latest.date);
  if (yearlyLatest) {
    const deltas = findOverwriteDeltas(ratesForDay(yearlyLatest), ratesForDay(latest));
    if (deltas.length > 0) throw new FxSourceDisagreementError(deltas);
    return days;
  }

  const merged = [...days, latest].sort((a, b) => a.date.localeCompare(b.date));
  if (merged[merged.length - 1].date !== latest.date) {
    throw new Error(
      `BNR yearly feed extends beyond latest publication: ${merged[merged.length - 1].date} > ${latest.date}`,
    );
  }
  return merged;
}

async function readRange(client: FxClient, from: string, to: string): Promise<StoredRate[]> {
  const rows = await client
    .select({
      date: fxRates.date,
      currency: fxRates.currency,
      rateToRon: fxRates.rateToRon,
    })
    .from(fxRates)
    .where(
      and(
        gte(fxRates.date, from),
        lte(fxRates.date, to),
        inArray(fxRates.currency, [...BNR_CURRENCIES]),
      ),
    )
    .orderBy(asc(fxRates.date), asc(fxRates.currency));
  return rows as StoredRate[];
}

/** Upsert a validated batch through the sole FX write path. */
async function upsertDailyRates(
  client: FxClient,
  days: BnrDailyRates[],
): Promise<number> {
  const values = days.flatMap((day) =>
    day.rates.map((rate) => ({
      date: day.date,
      currency: rate.currency,
      rateToRon: rate.rateToRon,
    })),
  );
  if (values.length === 0) return 0;

  await client
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

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function verifyStoredRange(
  days: BnrDailyRates[],
  rows: StoredRate[],
  from: string,
  to: string,
): Omit<
  FxBackfillReport,
  "bankingDays" | "upserted" | "inserted" | "existing" | "overwriteDeltaCount" | "overwriteDeltas"
> {
  const expected = new Map(
    days.flatMap((day) =>
      day.rates.map((rate) => [
        rateKey({ date: day.date, currency: rate.currency }),
        canonicalRate(rate.rateToRon),
      ] as const),
    ),
  );
  const actual = new Map(rows.map((rate) => [rateKey(rate), canonicalRate(rate.rateToRon)]));
  if (actual.size !== expected.size) {
    throw new Error(`FX row-count mismatch for ${from}..${to}: expected ${expected.size}, got ${actual.size}`);
  }
  for (const [key, expectedRate] of expected) {
    const actualRate = actual.get(key);
    if (actualRate !== expectedRate) {
      throw new Error(`FX stored-rate mismatch for ${key}: expected ${expectedRate}, got ${actualRate ?? "missing"}`);
    }
  }

  const currenciesByDate = new Map<string, Set<BnrCurrency>>();
  for (const row of rows) {
    const currencies = currenciesByDate.get(row.date) ?? new Set<BnrCurrency>();
    currencies.add(row.currency);
    currenciesByDate.set(row.date, currencies);
  }
  const oneSidedDates = [...currenciesByDate.values()].filter(
    (currencies) => currencies.size !== BNR_CURRENCIES.length,
  ).length;
  if (oneSidedDates !== 0) throw new Error(`FX coverage has ${oneSidedDates} one-sided dates`);

  const dates = [...currenciesByDate.keys()].sort();
  let maxGapDays = 0;
  for (let index = 1; index < dates.length; index += 1) {
    maxGapDays = Math.max(maxGapDays, dayDiff(dates[index - 1], dates[index]));
  }
  if (maxGapDays > MAX_GAP_DAYS) {
    throw new Error(`FX coverage gap is ${maxGapDays} days; maximum is ${MAX_GAP_DAYS}`);
  }

  const fixtures = RATE_FIXTURES.filter(
    (fixture) => fixture.date >= from && fixture.date <= to,
  ).map((fixture) => {
    const actualRate = actual.get(rateKey(fixture));
    const expectedRate = canonicalRate(fixture.rateToRon);
    if (actualRate !== expectedRate) {
      throw new Error(
        `FX fixture mismatch for ${fixture.date} ${fixture.currency}: expected ${expectedRate}, got ${actualRate ?? "missing"}`,
      );
    }
    return {
      date: fixture.date,
      currency: fixture.currency,
      expected: expectedRate,
      actual: actualRate,
    };
  });

  return {
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    storedRows: rows.length,
    oneSidedDates,
    maxGapDays,
    fixtures,
  };
}

async function guardedUpsert(
  rawDays: BnrDailyRates[],
  from: string,
  to: string,
): Promise<FxBackfillReport> {
  const days = validateBnrDailyRates(rawDays, from, to);
  return db.transaction(async (tx) => {
    const before = await readRange(tx, from, to);
    const beforeKeys = new Set(before.map(rateKey));
    const upserted = await upsertDailyRates(tx, days);
    const after = await readRange(tx, from, to);
    const overwriteDeltas = findOverwriteDeltas(before, after);
    if (overwriteDeltas.length > 0) throw new FxOverwriteDeltaError(overwriteDeltas);

    const coverage = verifyStoredRange(days, after, from, to);
    const sourceKeys = days.flatMap((day) =>
      day.rates.map((rate) => rateKey({ date: day.date, currency: rate.currency })),
    );
    return {
      bankingDays: days.length,
      upserted,
      inserted: sourceKeys.filter((key) => !beforeKeys.has(key)).length,
      existing: sourceKeys.filter((key) => beforeKeys.has(key)).length,
      overwriteDeltaCount: overwriteDeltas.length,
      overwriteDeltas,
      ...coverage,
    };
  });
}

async function fetchSourceRange(from: string, to: string): Promise<BnrDailyRates[]> {
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  const days: BnrDailyRates[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    const yearDays = await fetchYearRates(year);
    days.push(...yearDays.filter((day) => day.date >= from && day.date <= to));
  }

  const currentYear = new Date().getUTCFullYear();
  if (fromYear <= currentYear && toYear >= currentYear) {
    return mergeLatestDay(days, await fetchLatestRates(), from, to);
  }
  return validateBnrDailyRates(days, from, to);
}

/** Sync the most recent banking day's EUR/USD rates. */
export async function syncLatestRates(): Promise<{
  date: string;
  upserted: number;
  overwriteDeltaCount: number;
}> {
  const latest = await fetchLatestRates();
  const report = await guardedUpsert([latest], latest.date, latest.date);
  return {
    date: latest.date,
    upserted: report.upserted,
    overwriteDeltaCount: report.overwriteDeltaCount,
  };
}

/**
 * Backfill an inclusive date range from BNR's yearly datasets.
 * Days without a published rate (weekends, holidays) simply don't appear.
 */
export async function backfillRange(
  from: string,
  to: string,
): Promise<FxBackfillReport> {
  assertDate(from, "range start");
  assertDate(to, "range end");
  if (from > to) throw new Error(`Invalid range: ${from} > ${to}`);
  return guardedUpsert(await fetchSourceRange(from, to), from, to);
}

/** Backfill one whole year — used by on-demand historical resolution. */
export async function backfillYear(year: number): Promise<number> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const report = await guardedUpsert(
    await fetchSourceRange(from, to),
    from,
    to,
  );
  return report.upserted;
}
