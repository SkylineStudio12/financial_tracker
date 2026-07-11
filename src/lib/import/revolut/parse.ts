import { createHash } from "node:crypto";

export const REVOLUT_TYPES = [
  "BUY - MARKET",
  "SELL - MARKET",
  "CASH TOP-UP",
  "CASH WITHDRAWAL",
  "CUSTODY FEE",
  "DIVIDEND",
  "DIVIDEND TAX (CORRECTION)",
  "STOCK SPLIT",
] as const;

export type RevolutType = (typeof REVOLUT_TYPES)[number];
export type RevolutKind =
  | "buy"
  | "sell"
  | "cash_top_up"
  | "cash_withdrawal"
  | "custody_fee"
  | "dividend"
  | "dividend_tax_correction"
  | "stock_split";
export type RevolutCurrency = "USD" | "EUR";

export class RevolutParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevolutParseError";
  }
}

export interface RevolutRow {
  lineNo: number;
  timestamp: string;
  timestampMicros: bigint;
  ticker: string | null;
  type: RevolutType;
  kind: RevolutKind;
  quantityText: string | null;
  quantityScaled: bigint | null;
  priceText: string | null;
  priceMinor: number | null;
  totalAmountText: string;
  totalMinor: number;
  currency: RevolutCurrency;
  fxRate: string;
  contentHash: string;
  semanticKey: string;
}

const HEADER = [
  "Date",
  "Ticker",
  "Type",
  "Quantity",
  "Price per share",
  "Total Amount",
  "Currency",
  "FX Rate",
] as const;
const QTY_SCALE = 100_000_000n;
const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3}|\d{6})Z$/;
const DECIMAL = /^(0|[1-9]\d*)(?:\.(\d+))?$/;
const MONEY = /^([A-Z]{3}) (-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

function canonicalFields(fields: readonly string[]): string {
  return fields.map((field) => `${Buffer.byteLength(field, "utf8")}:${field}`).join("|");
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
      throw new RevolutParseError(`Unexpected character after closing quote at byte ${i}`);
    }
    if (char === '"') {
      if (field.length > 0) {
        throw new RevolutParseError(`Unexpected quote inside unquoted field at byte ${i}`);
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
  if (quoted) throw new RevolutParseError("Unclosed quoted CSV field");
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((fields) => fields.some((value) => value.length > 0));
}

function parseSafeInteger(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RevolutParseError(`${label} exceeds safe integer range`);
  return result;
}

function parseMoney(text: string, expectedCurrency: RevolutCurrency, label: string): number {
  const match = text.match(MONEY);
  if (!match || match[1] !== expectedCurrency) {
    throw new RevolutParseError(`${label}: expected "${expectedCurrency} amount", got "${text}"`);
  }
  const minor = BigInt(match[3]) * 100n + BigInt((match[4] ?? "").padEnd(2, "0"));
  return parseSafeInteger(match[2] === "-" ? -minor : minor, label);
}

export function parseQuantityScaled(text: string): bigint {
  const match = text.match(DECIMAL);
  if (!match || (match[1] === "0" && !match[2])) {
    throw new RevolutParseError(`Invalid share quantity "${text}"`);
  }
  const fraction = match[2] ?? "";
  if (fraction.length > 8) {
    throw new RevolutParseError(`Share quantity exceeds 8 decimal places: "${text}"`);
  }
  const scaled = BigInt(match[1]) * QTY_SCALE + BigInt(fraction.padEnd(8, "0"));
  if (scaled <= 0n) throw new RevolutParseError(`Share quantity must be positive: "${text}"`);
  return scaled;
}

export function formatQuantityScaled(quantity: bigint): string {
  const whole = quantity / QTY_SCALE;
  const fraction = (quantity % QTY_SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function timestampToMicros(text: string): bigint {
  const match = text.match(ISO_UTC);
  if (!match) {
    throw new RevolutParseError(`Timestamp must be UTC with millisecond or microsecond precision: "${text}"`);
  }
  const millis = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  if (!Number.isFinite(millis)) throw new RevolutParseError(`Invalid timestamp "${text}"`);
  const date = new Date(millis);
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3]) ||
    date.getUTCHours() !== Number(match[4]) ||
    date.getUTCMinutes() !== Number(match[5]) ||
    date.getUTCSeconds() !== Number(match[6])
  ) {
    throw new RevolutParseError(`Invalid timestamp "${text}"`);
  }
  return BigInt(millis) * 1_000n + BigInt(match[7].padEnd(6, "0"));
}

export function classifyRevolutType(type: RevolutType): RevolutKind {
  switch (type) {
    case "BUY - MARKET":
      return "buy";
    case "SELL - MARKET":
      return "sell";
    case "CASH TOP-UP":
      return "cash_top_up";
    case "CASH WITHDRAWAL":
      return "cash_withdrawal";
    case "CUSTODY FEE":
      return "custody_fee";
    case "DIVIDEND":
      return "dividend";
    case "DIVIDEND TAX (CORRECTION)":
      return "dividend_tax_correction";
    case "STOCK SPLIT":
      return "stock_split";
  }
}

function assertShape(row: RevolutRow): void {
  const trade = row.kind === "buy" || row.kind === "sell";
  const split = row.kind === "stock_split";
  const tickerRequired = trade || split || row.kind === "dividend" || row.kind === "dividend_tax_correction";
  if (tickerRequired !== (row.ticker !== null)) {
    throw new RevolutParseError(`CSV line ${row.lineNo}: ticker presence does not match ${row.type}`);
  }
  if ((trade || split) !== (row.quantityScaled !== null)) {
    throw new RevolutParseError(`CSV line ${row.lineNo}: quantity presence does not match ${row.type}`);
  }
  if (trade !== (row.priceMinor !== null)) {
    throw new RevolutParseError(`CSV line ${row.lineNo}: price presence does not match ${row.type}`);
  }
  if (split && row.totalMinor !== 0) {
    throw new RevolutParseError(`CSV line ${row.lineNo}: stock split must have zero total`);
  }
  if (
    (["buy", "sell", "cash_top_up", "dividend"] as RevolutKind[]).includes(row.kind) &&
    row.totalMinor <= 0
  ) {
    throw new RevolutParseError(`CSV line ${row.lineNo}: ${row.type} total must be positive`);
  }
  if (
    (["cash_withdrawal", "custody_fee"] as RevolutKind[]).includes(row.kind) &&
    row.totalMinor >= 0
  ) {
    throw new RevolutParseError(`CSV line ${row.lineNo}: ${row.type} total must be negative`);
  }
  if (row.kind === "dividend_tax_correction" && row.totalMinor === 0) {
    throw new RevolutParseError(`CSV line ${row.lineNo}: correction total must be non-zero`);
  }
}

export function parseRevolutCsv(text: string): RevolutRow[] {
  const csv = parseCsv(text);
  if (csv.length === 0 || csv[0].length !== HEADER.length || csv[0].some((v, i) => v !== HEADER[i])) {
    throw new RevolutParseError(`Expected Revolut header: ${HEADER.join(",")}`);
  }

  const knownTypes = new Set<string>(REVOLUT_TYPES);
  const seenHashes = new Map<string, number>();
  const parsed: RevolutRow[] = [];
  let priorMicros: bigint | null = null;

  for (let index = 1; index < csv.length; index += 1) {
    const fields = csv[index];
    const lineNo = index + 1;
    if (fields.length !== HEADER.length) {
      throw new RevolutParseError(`CSV line ${lineNo}: expected ${HEADER.length} columns, got ${fields.length}`);
    }
    const [timestamp, tickerText, typeText, quantityText, priceText, totalText, currencyText, fxRate] = fields;
    if (fields.some((field) => field !== field.trim())) {
      throw new RevolutParseError(`CSV line ${lineNo}: unexpected surrounding whitespace`);
    }
    if (!knownTypes.has(typeText)) {
      throw new RevolutParseError(`CSV line ${lineNo}: unsupported Type "${typeText}"`);
    }
    if (currencyText !== "USD" && currencyText !== "EUR") {
      throw new RevolutParseError(`CSV line ${lineNo}: unsupported currency "${currencyText}"`);
    }
    if (!DECIMAL.test(fxRate) || decimalToRatio(fxRate).numerator <= 0n) {
      throw new RevolutParseError(`CSV line ${lineNo}: invalid FX Rate "${fxRate}"`);
    }

    const timestampMicros = timestampToMicros(timestamp);
    if (priorMicros !== null && timestampMicros < priorMicros) {
      throw new RevolutParseError(`CSV line ${lineNo}: rows are not chronological`);
    }
    priorMicros = timestampMicros;

    const type = typeText as RevolutType;
    const currency = currencyText as RevolutCurrency;
    const contentHash = createHash("sha256").update(canonicalFields(fields)).digest("hex");
    const duplicateLine = seenHashes.get(contentHash);
    if (duplicateLine !== undefined) {
      throw new RevolutParseError(
        `Duplicate content hash within batch at CSV lines ${duplicateLine} and ${lineNo}`,
      );
    }
    seenHashes.set(contentHash, lineNo);

    const ticker = tickerText || null;
    const totalMinor = parseMoney(totalText, currency, `CSV line ${lineNo} Total Amount`);
    const row: RevolutRow = {
      lineNo,
      timestamp,
      timestampMicros,
      ticker,
      type,
      kind: classifyRevolutType(type),
      quantityText: quantityText || null,
      quantityScaled: quantityText ? parseQuantityScaled(quantityText) : null,
      priceText: priceText || null,
      priceMinor: priceText ? parseMoney(priceText, currency, `CSV line ${lineNo} Price per share`) : null,
      totalAmountText: totalText,
      totalMinor,
      currency,
      fxRate,
      contentHash,
      semanticKey: canonicalFields([timestamp, type, tickerText, String(totalMinor), currency]),
    };
    assertShape(row);
    parsed.push(row);
  }
  return parsed;
}

function decimalToRatio(text: string): { numerator: bigint; denominator: bigint } {
  const match = text.match(DECIMAL);
  if (!match) throw new RevolutParseError(`Invalid decimal "${text}"`);
  const fraction = match[2] ?? "";
  const denominator = 10n ** BigInt(fraction.length);
  return { numerator: BigInt(match[1]) * denominator + BigInt(fraction || "0"), denominator };
}

function roundHalfUpSigned(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((2n * absolute + denominator) / (2n * denominator));
}

/** Revolut exports foreign units per RON, so conversion DIVIDES by the rate. */
export function convertForeignMinorToRon(amountMinor: number, fxRate: string): number {
  if (!Number.isSafeInteger(amountMinor)) throw new RevolutParseError("Foreign amount is not a safe integer");
  const rate = decimalToRatio(fxRate);
  if (rate.numerator <= 0n) throw new RevolutParseError(`FX rate must be positive: "${fxRate}"`);
  return parseSafeInteger(
    roundHalfUpSigned(BigInt(amountMinor) * rate.denominator, rate.numerator),
    "Converted RON amount",
  );
}

export const REVOLUT_QUANTITY_SCALE = QTY_SCALE;
