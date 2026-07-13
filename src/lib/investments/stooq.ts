import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  securities,
  securityPriceMappings,
  stockSplits,
  trades,
  transactions,
} from "@/db/schema";
import {
  parsePositivePriceDecimal,
  scalePriceToMinor,
  validateNonNegativePriceDecimal,
} from "./price-decimal";
import {
  listSecuritiesNeedingPrices,
  upsertPriceSnapshot,
  type PriceSnapshotWriteAction,
} from "./prices";

const HEADER = ["Date", "Open", "High", "Low", "Close", "Volume"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class StooqParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StooqParseError";
  }
}

export interface StooqRow {
  date: string;
  close: string;
}

export interface PreparedStooqRow extends StooqRow {
  factor: number;
  rawClose: string;
  priceMinor: number;
}

export interface StooqSample {
  date: string;
  sourceClose: string;
  factor: number;
  rawClose: string;
  priceMinor: number;
}

interface StooqItemBase {
  securityId: string;
  ticker: string;
  currency: "RON" | "EUR" | "USD";
  symbol: string;
  filePath: string;
  firstTradeDate: string;
}

export type StooqPlanItem =
  | (StooqItemBase & {
      status: "ready";
      firstAvailableDate: string;
      lastAvailableDate: string;
      rows: PreparedStooqRow[];
      samples: StooqSample[];
      splitFactors: { date: string; ratio: number }[];
      warnings: string[];
      fileBytes: number;
      fileHash: string;
    })
  | (StooqItemBase & { status: "missing" | "error"; reason: string });

export interface StooqBackfillPlan {
  directory: string;
  generatedAt: string;
  hash: string;
  items: StooqPlanItem[];
  unmapped: { securityId: string; ticker: string; currency: "RON" | "EUR" | "USD" }[];
}

export const MANDATORY_BACKFILL_TICKERS = [
  "BMW",
  "CEBT",
  "INN1",
  "LYP6",
  "SPP1",
  "SPPE",
  "SPPY",
  "UIQI",
  "V50A",
  "XSX6",
  "NVDA",
  "NFLX",
] as const;

export interface BackfillWriteGateEvidence {
  planHash: string;
  passed: boolean;
  mandatoryMissing: string[];
  minorMismatchCount: number;
}

function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;

  const pushField = () => {
    row.push(field);
    field = "";
    quoteClosed = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (quoteClosed && char !== "," && char !== "\r" && char !== "\n") {
      throw new StooqParseError(`Unexpected character after closing quote at byte ${i}`);
    }
    if (char === '"') {
      if (field.length > 0) {
        throw new StooqParseError(`Unexpected quote inside unquoted field at byte ${i}`);
      }
      quoted = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char === "\r") {
      if (source[i + 1] === "\n") i += 1;
      pushRow();
    } else {
      field += char;
    }
  }
  if (quoted) throw new StooqParseError("Unclosed quoted CSV field");
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((fields) => fields.some((value) => value.length > 0));
}

function validateIsoDate(date: string, lineNo: number) {
  if (!DATE_RE.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new StooqParseError(`Line ${lineNo}: invalid date "${date}"`);
  }
}

export function parseStooqCsv(text: string): StooqRow[] {
  const records = parseCsv(text);
  if (records.length === 0) throw new StooqParseError("CSV is empty");
  if (
    records[0].length !== HEADER.length ||
    records[0].some((field, index) => field !== HEADER[index])
  ) {
    throw new StooqParseError(`Unexpected header: ${records[0].join(",")}`);
  }

  const dates = new Set<string>();
  const rows = records.slice(1).map((fields, index) => {
    const lineNo = index + 2;
    if (fields.length !== HEADER.length) {
      throw new StooqParseError(
        `Line ${lineNo}: expected ${HEADER.length} fields, got ${fields.length}`,
      );
    }
    validateIsoDate(fields[0], lineNo);
    if (dates.has(fields[0])) throw new StooqParseError(`Duplicate date ${fields[0]}`);
    dates.add(fields[0]);
    for (let column = 1; column <= 4; column += 1) {
      try {
        parsePositivePriceDecimal(fields[column], `Line ${lineNo} ${HEADER[column]}`);
      } catch (error) {
        throw new StooqParseError((error as Error).message);
      }
    }
    try {
      validateNonNegativePriceDecimal(fields[5], `Line ${lineNo} Volume`);
    } catch (error) {
      throw new StooqParseError((error as Error).message);
    }
    return { date: fields[0], close: fields[4] };
  });
  if (rows.length === 0) throw new StooqParseError("CSV has no price rows");
  return rows.sort((left, right) => left.date.localeCompare(right.date));
}

export function unadjustStooqClose(close: string, factor: number) {
  try {
    const scaled = scalePriceToMinor(close, factor);
    return { rawClose: scaled.scaled, priceMinor: scaled.priceMinor };
  } catch (error) {
    throw new StooqParseError((error as Error).message);
  }
}

export function splitFactorForDate(
  date: string,
  splits: readonly { date: string; ratio: number }[],
) {
  return splits
    .filter((split) => split.date > date)
    .reduce((product, split) => product * split.ratio, 1);
}

function filenameForSymbol(symbol: string) {
  return `${symbol.replaceAll(".", "_")}_d.csv`;
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function selectSamples(rows: PreparedStooqRow[]): StooqSample[] {
  const indexes = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
  return indexes.map((index) => ({
    date: rows[index].date,
    sourceClose: rows[index].close,
    factor: rows[index].factor,
    rawClose: rows[index].rawClose,
    priceMinor: rows[index].priceMinor,
  }));
}

function planHash(
  items: StooqPlanItem[],
  unmapped: StooqBackfillPlan["unmapped"],
) {
  const hash = createHash("sha256");
  for (const item of items) {
    hash.update(`${item.securityId}|${item.symbol}|${item.firstTradeDate}|${item.status}|`);
    if (item.status === "ready") {
      hash.update(`${item.fileHash}|`);
      for (const row of item.rows) {
        hash.update(`${row.date}:${row.close}:${row.factor}:${row.priceMinor}|`);
      }
    } else {
      hash.update(item.reason);
    }
  }
  for (const security of unmapped) {
    hash.update(`unmapped:${security.securityId}:${security.ticker}:${security.currency}|`);
  }
  return hash.digest("hex");
}

export async function buildStooqBackfillPlan(directory: string): Promise<StooqBackfillPlan> {
  const absoluteDirectory = resolve(directory);
  const mapped = await db
    .select({
      securityId: securities.id,
      ticker: securities.ticker,
      currency: securities.currency,
      symbol: securityPriceMappings.symbol,
    })
    .from(securityPriceMappings)
    .innerJoin(securities, eq(securityPriceMappings.securityId, securities.id))
    .where(
      and(
        eq(securityPriceMappings.provider, "stooq"),
        isNull(securities.deletedAt),
      ),
    )
    .orderBy(asc(securities.ticker));
  const held = await listSecuritiesNeedingPrices();
  const mappedIds = new Set(mapped.map((row) => row.securityId));
  const unmapped = held
    .filter((security) => !mappedIds.has(security.id))
    .sort((left, right) => left.ticker.localeCompare(right.ticker))
    .map((security) => ({
      securityId: security.id,
      ticker: security.ticker,
      currency: security.currency,
    }));
  const securityIds = mapped.map((row) => row.securityId);
  if (securityIds.length === 0) {
    return {
      directory: absoluteDirectory,
      generatedAt: new Date().toISOString(),
      hash: planHash([], unmapped),
      items: [],
      unmapped,
    };
  }

  const firstTrades = await db
    .select({
      securityId: trades.securityId,
      date: sql<string>`min(${transactions.date})`,
    })
    .from(trades)
    .innerJoin(transactions, eq(trades.transactionId, transactions.id))
    .where(
      and(
        inArray(trades.securityId, securityIds),
        eq(trades.kind, "buy"),
        isNull(trades.deletedAt),
        isNull(transactions.deletedAt),
      ),
    )
    .groupBy(trades.securityId);
  const firstTradeBySecurity = new Map(firstTrades.map((row) => [row.securityId, row.date]));

  const splitRows = await db
    .select({
      securityId: stockSplits.securityId,
      occurredAt: stockSplits.occurredAt,
      ratio: stockSplits.ratio,
    })
    .from(stockSplits)
    .where(inArray(stockSplits.securityId, securityIds))
    .orderBy(asc(stockSplits.occurredAt));
  const splitsBySecurity = new Map<string, { date: string; ratio: number }[]>();
  for (const split of splitRows) {
    const date = split.occurredAt.slice(0, 10);
    const current = splitsBySecurity.get(split.securityId) ?? [];
    const sameDate = current.find((item) => item.date === date);
    if (sameDate && sameDate.ratio !== split.ratio) {
      throw new Error(`Conflicting split ratios for ${split.securityId} on ${date}`);
    }
    if (!sameDate) current.push({ date, ratio: split.ratio });
    splitsBySecurity.set(split.securityId, current);
  }

  const items: StooqPlanItem[] = [];
  for (const mapping of mapped) {
    const firstTradeDate = firstTradeBySecurity.get(mapping.securityId);
    if (!firstTradeDate) continue;
    const filePath = join(absoluteDirectory, filenameForSymbol(mapping.symbol));
    const base: StooqItemBase = { ...mapping, filePath, firstTradeDate };
    try {
      const [text, metadata] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
      const parsed = parseStooqCsv(text);
      const inWindow = parsed.filter((row) => row.date >= firstTradeDate);
      if (inWindow.length === 0) {
        items.push({ ...base, status: "error", reason: "No rows on or after first trade date" });
        continue;
      }
      const splitFactors = splitsBySecurity.get(mapping.securityId) ?? [];
      const rows = inWindow.map((row) => {
        const factor = splitFactorForDate(row.date, splitFactors);
        const adjusted = unadjustStooqClose(row.close, factor);
        return { ...row, factor, ...adjusted };
      });
      const warnings: string[] = [];
      if (parsed[0].date > firstTradeDate) {
        warnings.push(`history starts ${parsed[0].date}, after first trade ${firstTradeDate}`);
      }
      if (parsed.at(-1)!.date < dateDaysAgo(7)) {
        warnings.push(`last row ${parsed.at(-1)!.date} is more than 7 calendar days old`);
      }
      items.push({
        ...base,
        status: "ready",
        firstAvailableDate: parsed[0].date,
        lastAvailableDate: parsed.at(-1)!.date,
        rows,
        samples: selectSamples(rows),
        splitFactors,
        warnings,
        fileBytes: metadata.size,
        fileHash: createHash("sha256").update(text).digest("hex"),
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      items.push({
        ...base,
        status: code === "ENOENT" ? "missing" : "error",
        reason: code === "ENOENT" ? "Expected CSV file not found" : (error as Error).message,
      });
    }
  }

  return {
    directory: absoluteDirectory,
    generatedAt: new Date().toISOString(),
    hash: planHash(items, unmapped),
    items,
    unmapped,
  };
}

export async function applyStooqBackfillPlan(
  plan: StooqBackfillPlan,
  approvedHash: string,
  seam: BackfillWriteGateEvidence,
) {
  if (plan.hash !== approvedHash) {
    throw new Error(`Approved plan hash ${approvedHash} does not match current plan ${plan.hash}`);
  }
  if (
    seam.planHash !== plan.hash ||
    !seam.passed ||
    seam.mandatoryMissing.length > 0 ||
    seam.minorMismatchCount > 0
  ) {
    throw new Error("Mandatory file and minor-unit seam gate has not passed for this plan");
  }

  const results: {
    ticker: string;
    rows: number;
    actions: Record<PriceSnapshotWriteAction, number>;
  }[] = [];
  for (const item of plan.items) {
    if (item.status !== "ready") continue;
    const actions: Record<PriceSnapshotWriteAction, number> = {
      inserted: 0,
      updated: 0,
      unchanged: 0,
      preserved_manual: 0,
      preserved_eodhd: 0,
    };
    await db.transaction(async (tx) => {
      for (const row of item.rows) {
        const result = await upsertPriceSnapshot(
          {
            securityId: item.securityId,
            date: row.date,
            priceMinor: row.priceMinor,
            source: "stooq",
          },
          tx,
        );
        actions[result.action] += 1;
      }
    });
    results.push({ ticker: item.ticker, rows: item.rows.length, actions });
  }
  return results;
}
