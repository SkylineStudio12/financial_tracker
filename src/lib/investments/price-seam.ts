import { eq } from "drizzle-orm";
import { db } from "@/db";
import { securityPriceMappings } from "@/db/schema";
import { fetchEodhdSeries } from "./eodhd";
import { priceDecimalsEqual } from "./price-decimal";
import {
  MANDATORY_BACKFILL_TICKERS,
  type BackfillWriteGateEvidence,
  type StooqBackfillPlan,
} from "./stooq";

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export interface PriceSeamCheck {
  ticker: string;
  overlapDates: string[];
  exactDecimalMismatches: Array<{ date: string; stooq: string; eodhd: string }>;
  minorUnitMismatches: Array<{ date: string; stooq: number; eodhd: number }>;
  error?: string;
}

export interface MandatoryPriceSeamReport extends BackfillWriteGateEvidence {
  callsUsed: number;
  checks: PriceSeamCheck[];
}

export async function verifyMandatoryPriceSeam(
  plan: StooqBackfillPlan,
  options: {
    apiToken: string;
    fetchSeries?: typeof fetchEodhdSeries;
    eodhdSymbols?: Map<string, string>;
  },
): Promise<MandatoryPriceSeamReport> {
  const readyByTicker = new Map(
    plan.items
      .filter((item) => item.status === "ready")
      .map((item) => [item.ticker, item] as const),
  );
  const mandatoryMissing = MANDATORY_BACKFILL_TICKERS.filter(
    (ticker) => !readyByTicker.has(ticker),
  );
  if (mandatoryMissing.length > 0) {
    return {
      planHash: plan.hash,
      passed: false,
      mandatoryMissing: [...mandatoryMissing],
      minorMismatchCount: 0,
      callsUsed: 0,
      checks: [],
    };
  }

  let eodhdSymbols = options.eodhdSymbols;
  if (!eodhdSymbols) {
    const mappings = await db
      .select({ securityId: securityPriceMappings.securityId, symbol: securityPriceMappings.symbol })
      .from(securityPriceMappings)
      .where(eq(securityPriceMappings.provider, "eodhd"));
    eodhdSymbols = new Map(mappings.map((mapping) => [mapping.securityId, mapping.symbol]));
  }

  const fetchSeries = options.fetchSeries ?? fetchEodhdSeries;
  const checks: PriceSeamCheck[] = [];
  for (const ticker of MANDATORY_BACKFILL_TICKERS) {
    const item = readyByTicker.get(ticker)!;
    const eodhdSymbol = eodhdSymbols.get(item.securityId);
    if (!eodhdSymbol) {
      checks.push({
        ticker,
        overlapDates: [],
        exactDecimalMismatches: [],
        minorUnitMismatches: [],
        error: "No explicit EODHD mapping",
      });
      continue;
    }
    try {
      const eodhd = await fetchSeries({
        symbol: eodhdSymbol,
        from: addDays(item.lastAvailableDate, -45),
        to: item.lastAvailableDate,
        apiToken: options.apiToken,
      });
      const stooqByDate = new Map(item.rows.map((row) => [row.date, row]));
      const overlaps = eodhd.filter((row) => stooqByDate.has(row.date)).slice(-3);
      checks.push({
        ticker,
        overlapDates: overlaps.map((row) => row.date),
        exactDecimalMismatches: overlaps.flatMap((row) => {
          const stooq = stooqByDate.get(row.date)!;
          return priceDecimalsEqual(stooq.rawClose, row.close)
            ? []
            : [{ date: row.date, stooq: stooq.rawClose, eodhd: row.close }];
        }),
        minorUnitMismatches: overlaps.flatMap((row) => {
          const stooq = stooqByDate.get(row.date)!;
          return stooq.priceMinor === row.priceMinor
            ? []
            : [{ date: row.date, stooq: stooq.priceMinor, eodhd: row.priceMinor }];
        }),
      });
    } catch (error) {
      checks.push({
        ticker,
        overlapDates: [],
        exactDecimalMismatches: [],
        minorUnitMismatches: [],
        error: (error as Error).message,
      });
    }
  }

  const minorMismatchCount = checks.reduce(
    (sum, check) => sum + check.minorUnitMismatches.length,
    0,
  );
  const passed = checks.every(
    (check) => !check.error && check.overlapDates.length >= 3 && check.minorUnitMismatches.length === 0,
  );
  return {
    planHash: plan.hash,
    passed,
    mandatoryMissing: [],
    minorMismatchCount,
    callsUsed: checks.length,
    checks,
  };
}
