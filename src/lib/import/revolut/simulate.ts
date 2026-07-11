import {
  formatQuantityScaled,
  REVOLUT_TYPES,
  REVOLUT_QUANTITY_SCALE,
  RevolutParseError,
  type RevolutCurrency,
  type RevolutRow,
  type RevolutType,
} from "./parse";

interface OpenLot {
  buyLineNo: number;
  remainingQuantity: bigint;
}

export interface SplitCheck {
  lineNo: number;
  timestamp: string;
  ticker: string;
  heldBefore: string;
  delta: string;
  ratio: number | null;
  passed: boolean;
}

export interface SellSimulation {
  lineNo: number;
  timestamp: string;
  ticker: string;
  quantity: string;
  consumptions: { buyLineNo: number; quantity: string }[];
  remainingPosition: string;
}

export interface CorrectionPair {
  ticker: string;
  amountMinor: number;
  currency: RevolutCurrency;
  firstLineNo: number;
  secondLineNo: number;
  secondsApart: number;
}

export interface CorrectionPairing {
  pairs: CorrectionPair[];
  unpaired: RevolutRow[];
}

export interface ResidualDistribution {
  group: string;
  count: number;
  minMinor: number;
  p50Minor: number;
  p95Minor: number;
  maxMinor: number;
  meanMinor: number;
}

export interface RevolutSimulation {
  cashMinor: Record<RevolutCurrency, number>;
  holdings: Record<string, string>;
  splitChecks: SplitCheck[];
  sells: SellSimulation[];
  corrections: CorrectionPairing;
  buyResiduals: ResidualDistribution[];
}

function safeNumber(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RevolutParseError(`${label} exceeds safe integer range`);
  return result;
}

function roundHalfUpPositive(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarizeResiduals(rows: readonly RevolutRow[]): ResidualDistribution[] {
  const residuals = rows
    .filter((row) => row.kind === "buy")
    .map((row) => {
      const expected = roundHalfUpPositive(
        BigInt(row.priceMinor!) * row.quantityScaled!,
        REVOLUT_QUANTITY_SCALE,
      );
      return {
        group: `${row.timestamp.slice(0, 4)} ${row.currency}`,
        residual: row.totalMinor - safeNumber(expected, `CSV line ${row.lineNo} expected buy total`),
      };
    });
  const groups = new Map<string, number[]>();
  for (const row of residuals) {
    const values = groups.get(row.group) ?? [];
    values.push(row.residual);
    groups.set(row.group, values);
  }
  return [...groups.entries()].map(([group, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      group,
      count: sorted.length,
      minMinor: sorted[0],
      p50Minor: percentile(sorted, 0.5),
      p95Minor: percentile(sorted, 0.95),
      maxMinor: sorted[sorted.length - 1],
      meanMinor: Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(2)),
    };
  });
}

export function pairDividendTaxCorrections(rows: readonly RevolutRow[]): CorrectionPairing {
  const corrections = rows.filter((row) => row.kind === "dividend_tax_correction");
  const used = new Set<number>();
  const pairs: CorrectionPair[] = [];

  for (let i = 0; i < corrections.length; i += 1) {
    if (used.has(i)) continue;
    const first = corrections[i];
    const twinIndex = corrections.findIndex((candidate, index) => {
      if (index <= i || used.has(index)) return false;
      const microsApart = candidate.timestampMicros - first.timestampMicros;
      return (
        candidate.ticker === first.ticker &&
        candidate.currency === first.currency &&
        candidate.totalMinor === -first.totalMinor &&
        microsApart >= 0n &&
        microsApart <= 60_000_000n
      );
    });
    if (twinIndex === -1) continue;
    const twin = corrections[twinIndex];
    used.add(i);
    used.add(twinIndex);
    pairs.push({
      ticker: first.ticker!,
      amountMinor: Math.abs(first.totalMinor),
      currency: first.currency,
      firstLineNo: first.lineNo,
      secondLineNo: twin.lineNo,
      secondsApart: Number(twin.timestampMicros - first.timestampMicros) / 1_000_000,
    });
  }

  return {
    pairs,
    unpaired: corrections.filter((_, index) => !used.has(index)),
  };
}

function typeCounts(rows: readonly RevolutRow[]): Record<RevolutType, number> {
  const counts = Object.fromEntries(
    REVOLUT_TYPES.map((type) => [type, 0]),
  ) as Record<RevolutType, number>;
  for (const row of rows) counts[row.type] += 1;
  return counts;
}

export function countRevolutTypes(rows: readonly RevolutRow[]): Record<RevolutType, number> {
  return typeCounts(rows);
}

export function simulateRevolut(rows: readonly RevolutRow[]): RevolutSimulation {
  const cash = new Map<RevolutCurrency, bigint>([
    ["USD", 0n],
    ["EUR", 0n],
  ]);
  const lots = new Map<string, OpenLot[]>();
  const splitChecks: SplitCheck[] = [];
  const sells: SellSimulation[] = [];

  for (const row of rows) {
    const currentCash = cash.get(row.currency)!;
    const cashDelta = row.kind === "buy" ? -BigInt(row.totalMinor) : row.kind === "stock_split" ? 0n : BigInt(row.totalMinor);
    cash.set(row.currency, currentCash + cashDelta);

    if (row.kind === "buy") {
      const tickerLots = lots.get(row.ticker!) ?? [];
      tickerLots.push({ buyLineNo: row.lineNo, remainingQuantity: row.quantityScaled! });
      lots.set(row.ticker!, tickerLots);
      continue;
    }

    if (row.kind === "sell") {
      const tickerLots = lots.get(row.ticker!) ?? [];
      let remaining = row.quantityScaled!;
      const consumptions: SellSimulation["consumptions"] = [];
      for (const lot of tickerLots) {
        if (remaining === 0n) break;
        const take = lot.remainingQuantity < remaining ? lot.remainingQuantity : remaining;
        if (take === 0n) continue;
        lot.remainingQuantity -= take;
        remaining -= take;
        consumptions.push({ buyLineNo: lot.buyLineNo, quantity: formatQuantityScaled(take) });
      }
      if (remaining !== 0n) {
        throw new RevolutParseError(
          `CSV line ${row.lineNo}: sell exceeds simulated ${row.ticker} holdings by ${formatQuantityScaled(remaining)}`,
        );
      }
      const remainingPosition = tickerLots.reduce((sum, lot) => sum + lot.remainingQuantity, 0n);
      sells.push({
        lineNo: row.lineNo,
        timestamp: row.timestamp,
        ticker: row.ticker!,
        quantity: formatQuantityScaled(row.quantityScaled!),
        consumptions,
        remainingPosition: formatQuantityScaled(remainingPosition),
      });
      continue;
    }

    if (row.kind === "stock_split") {
      const tickerLots = lots.get(row.ticker!) ?? [];
      const held = tickerLots.reduce((sum, lot) => sum + lot.remainingQuantity, 0n);
      const resulting = held + row.quantityScaled!;
      const integerRatio = held > 0n && resulting % held === 0n ? resulting / held : null;
      const passed = integerRatio !== null && integerRatio > 1n && integerRatio <= BigInt(Number.MAX_SAFE_INTEGER);
      splitChecks.push({
        lineNo: row.lineNo,
        timestamp: row.timestamp,
        ticker: row.ticker!,
        heldBefore: formatQuantityScaled(held),
        delta: formatQuantityScaled(row.quantityScaled!),
        ratio: passed ? Number(integerRatio) : null,
        passed,
      });
      if (!passed) continue;
      for (const lot of tickerLots) lot.remainingQuantity *= integerRatio;
    }
  }

  const holdings: Record<string, string> = {};
  for (const [ticker, tickerLots] of [...lots.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const quantity = tickerLots.reduce((sum, lot) => sum + lot.remainingQuantity, 0n);
    if (quantity > 0n) holdings[ticker] = formatQuantityScaled(quantity);
  }

  return {
    cashMinor: {
      USD: safeNumber(cash.get("USD")!, "Simulated USD cash"),
      EUR: safeNumber(cash.get("EUR")!, "Simulated EUR cash"),
    },
    holdings,
    splitChecks,
    sells,
    corrections: pairDividendTaxCorrections(rows),
    buyResiduals: summarizeResiduals(rows),
  };
}
