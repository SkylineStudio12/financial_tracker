/**
 * ING RON current-account statement parser — Stage 2 of the import path.
 *
 * PURE: string in (already-extracted PDF text), typed rows out. No DB, no
 * ledger writes, no categorization, no double-entry. The extraction boundary
 * is deliberately outside this module: a later stage feeds it text produced
 * by plain per-page PDF text extraction (the committed fixture pins that
 * contract), so the parser stays testable without a PDF library.
 *
 * Number conventions VERIFIED against the fixture (they are mixed!):
 * - Main amounts and balances: English convention — comma thousands, dot
 *   decimals ("40,988.95", "-2,695.00").
 * - FX sub-lines: Romanian convention — comma decimals ("24,20 USD").
 * - Printed FX rates: dot decimals with varying precision ("5.42", "5.4216").
 *
 * Self-verification (all four run on every parse; any failure throws):
 * 1. Balance replay: opening balance + each signed row must reproduce every
 *    printed "balance after" and the printed closing balance.
 * 2. Row counts must match the header's declared credit/debit counts.
 * 3. Row sums must match the header's declared credit/debit totals.
 * 4. No two rows may share a long bank reference (intra-statement half of
 *    the L-0010 dedup assumption; the cross-import half lives in the ledger
 *    service as assertBatchExternalRefsUnique).
 */
import {
  IngParseError,
  type IngFxDetails,
  type IngStatement,
  type IngStatementRow,
} from "./types";

const AMOUNT_EN = /^-?\d{1,3}(?:,\d{3})*\.\d{2}$/;
const AMOUNT_RO = /^\d+(?:\.\d{3})*,\d{2}$/;
const DATE_LINE = /^\d{2}\.\d{2}\.\d{4}$/;
const LINE_NO = /^\d{1,6}$/;
const RO_IBAN = /^RO\d{2}[A-Z]{4}[A-Z0-9]{16}$/;
/** Row terminator: a line ENDING in "<amount> <balance>" (both English
 * convention). Fee rows glue text before it ("Service Fee -0.45 40,506.40"). */
const AMOUNTS_TAIL =
  /^(.*?)\s*(-?\d{1,3}(?:,\d{3})*\.\d{2})\s+(\d{1,3}(?:,\d{3})*\.\d{2})$/;
const REF_CHUNK = /^[0-9a-fA-F-]+$/;
const RATE_ONLY = /^\d+\.\d+$/;

/** "40,988.95" / "-2,695.00" → signed integer minor units. Strict: anything
 * off-pattern throws, because a silently mis-read amount corrupts money. */
export function parseEnglishAmountToMinor(text: string): number {
  if (!AMOUNT_EN.test(text)) {
    throw new IngParseError(`Unparseable amount (expected English convention): "${text}"`);
  }
  const negative = text.startsWith("-");
  const [whole, cents] = text.replace("-", "").replace(/,/g, "").split(".");
  const minor = Number(whole) * 100 + Number(cents);
  if (!Number.isSafeInteger(minor)) throw new IngParseError(`Amount overflow: "${text}"`);
  return negative ? -minor : minor;
}

/** "24,20" (Romanian FX sub-line convention) → integer minor units. */
export function parseRomanianAmountToMinor(text: string): number {
  if (!AMOUNT_RO.test(text)) {
    throw new IngParseError(`Unparseable amount (expected Romanian convention): "${text}"`);
  }
  const [whole, cents] = text.replace(/\./g, "").split(",");
  const minor = Number(whole) * 100 + Number(cents);
  if (!Number.isSafeInteger(minor)) throw new IngParseError(`Amount overflow: "${text}"`);
  return minor;
}

/** "02.06.2026" → "2026-06-02" */
function toIsoDate(text: string): string {
  const [d, m, y] = text.split(".");
  return `${y}-${m}-${d}`;
}

/**
 * Drop repeated page chrome (bank letterhead, guarantee notice, column
 * headers, end marker). Each page repeats the block from "Account Statement"
 * through "...Valid without signature and stamp."
 */
function stripChrome(lines: string[]): { body: string[]; headerMeta: string[] } {
  const body: string[] = [];
  const headerMeta: string[] = [];
  let inChrome = false;
  for (const line of lines) {
    if (line === "Account Statement") {
      inChrome = true;
      headerMeta.push(line);
      continue;
    }
    if (inChrome) {
      headerMeta.push(line);
      if (line.startsWith("is eligible.")) inChrome = false;
      continue;
    }
    if (
      line.startsWith("Book Date Counterparty") ||
      line.startsWith("Bank Reference Transaction Description") ||
      line === "END OF ACCOUNT STATEMENT"
    ) {
      continue;
    }
    body.push(line);
  }
  return { body, headerMeta };
}

interface HeaderInfo {
  statementNumber: string;
  accountIban: string;
  period: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  declaredCreditCount: number;
  declaredDebitCount: number;
  declaredTotalCreditsMinor: number;
  declaredTotalDebitsMinor: number;
}

function parseHeader(headerMeta: string[], body: string[]): HeaderInfo {
  const statementNumber = headerMeta.find((l) => /^Nr\.\d+\s*\/\s*[\d.]+$/.test(l));
  if (!statementNumber) throw new IngParseError("Statement number line not found");
  const ibanLine = headerMeta.find((l) => /^RO\d{2}(?: ?[A-Z0-9]{4}){5}$/.test(l.trim()));
  if (!ibanLine) throw new IngParseError("Account IBAN line not found");

  const labelIdx = body.findIndex((l) => l.startsWith("Opening balance:"));
  if (labelIdx === -1) throw new IngParseError("Balance header labels not found");
  const labels = body[labelIdx];
  const counts = labels.match(
    /Total credits \((\d+)\):\s+Total debits \((\d+)\):/,
  );
  if (!counts) throw new IngParseError(`Cannot read declared counts from: "${labels}"`);

  const values = body[labelIdx + 1]?.match(
    /^(-?[\d,.]+) (-?[\d,.]+) (-?[\d,.]+) (-?[\d,.]+)\s+(.+)$/,
  );
  if (!values) {
    throw new IngParseError(`Cannot read balance header values from: "${body[labelIdx + 1]}"`);
  }
  body.splice(labelIdx, 2); // consumed — not transaction rows

  return {
    statementNumber,
    accountIban: ibanLine.replace(/\s/g, ""),
    period: values[5],
    openingBalanceMinor: parseEnglishAmountToMinor(values[1]),
    declaredTotalCreditsMinor: Math.abs(parseEnglishAmountToMinor(values[2])),
    declaredTotalDebitsMinor: Math.abs(parseEnglishAmountToMinor(values[3])),
    closingBalanceMinor: parseEnglishAmountToMinor(values[4]),
    declaredCreditCount: Number(counts[1]),
    declaredDebitCount: Number(counts[2]),
  };
}

/** One raw row: its date, line number, body lines, amount, and balance. */
interface RawRow {
  bookDate: string;
  lineNo: string;
  bodyLines: string[];
  signedAmountMinor: number;
  balanceAfterMinor: number;
}

function segmentRows(body: string[]): RawRow[] {
  const rows: RawRow[] = [];
  let i = 0;
  while (i < body.length) {
    if (!DATE_LINE.test(body[i])) {
      throw new IngParseError(`Expected a row date line, got: "${body[i]}"`);
    }
    const bookDate = toIsoDate(body[i]);
    const lineNoLine = body[i + 1];
    if (!lineNoLine || !LINE_NO.test(lineNoLine)) {
      throw new IngParseError(`Expected a line number after ${body[i]}, got: "${lineNoLine}"`);
    }
    const bodyLines: string[] = [];
    let j = i + 2;
    let done = false;
    while (j < body.length) {
      const tail = body[j].match(AMOUNTS_TAIL);
      if (tail) {
        if (tail[1]) bodyLines.push(tail[1]);
        rows.push({
          bookDate,
          lineNo: lineNoLine,
          bodyLines,
          signedAmountMinor: parseEnglishAmountToMinor(tail[2]),
          balanceAfterMinor: parseEnglishAmountToMinor(tail[3]),
        });
        done = true;
        j += 1;
        break;
      }
      bodyLines.push(body[j]);
      j += 1;
    }
    if (!done) {
      throw new IngParseError(`Row ${lineNoLine} (${bookDate}) has no amount/balance line`);
    }
    i = j;
  }
  return rows;
}

/** Pull "Bank reference <value>" including wrapped continuation lines. */
function extractReference(
  lines: string[],
  startIdx: number,
  label: string,
): { value: string; consumed: Set<number> } {
  const consumed = new Set<number>([startIdx]);
  let value = lines[startIdx].slice(label.length).trim().replace(/\s+/g, "");
  let k = startIdx + 1;
  while (k < lines.length && REF_CHUNK.test(lines[k])) {
    value += lines[k];
    consumed.add(k);
    k += 1;
  }
  if (!value) throw new IngParseError(`Empty ${label.trim()} in row body: ${lines.join(" | ")}`);
  return { value, consumed };
}

function interpretRow(raw: RawRow): IngStatementRow {
  const lines = raw.bodyLines;
  const consumed = new Set<number>();
  let bankReference: string | null = null;
  let internalReference: string | null = null;
  let instantReference: string | null = null;
  let counterpartyIban: string | null = null;
  let fx: IngFxDetails | null = null;
  let fxOriginal: { currency: string; amountMinor: number } | null = null;

  for (let k = 0; k < lines.length; k += 1) {
    const line = lines[k];
    if (line.startsWith("Bank reference")) {
      const ref = extractReference(lines, k, "Bank reference");
      bankReference = ref.value;
      ref.consumed.forEach((idx) => consumed.add(idx));
    } else if (line.startsWith("Internal reference:")) {
      const ref = extractReference(lines, k, "Internal reference:");
      internalReference = ref.value;
      ref.consumed.forEach((idx) => consumed.add(idx));
    } else if (line.startsWith("Instant reference:")) {
      const ref = extractReference(lines, k, "Instant reference:");
      instantReference = ref.value;
      ref.consumed.forEach((idx) => consumed.add(idx));
    } else if (RO_IBAN.test(line)) {
      counterpartyIban = line;
      consumed.add(k);
    } else {
      const original = line.match(/^Amount:\s+(\d+(?:\.\d{3})*,\d{2})\s+([A-Z]{3})$/);
      if (original) {
        fxOriginal = {
          currency: original[2],
          amountMinor: parseRomanianAmountToMinor(original[1]),
        };
        consumed.add(k);
        continue;
      }
      const settlement = line.match(
        /^Settlement Amount:\s+(\d+(?:\.\d{3})*,\d{2})\s+([A-Z]{3})\s+Rate:\s*(.*)$/,
      );
      if (settlement) {
        consumed.add(k);
        let printedRate = settlement[3].trim();
        if (!printedRate && k + 1 < lines.length && RATE_ONLY.test(lines[k + 1])) {
          printedRate = lines[k + 1]; // rate wrapped to the next line (Anthropic/Figma)
          consumed.add(k + 1);
        }
        if (!printedRate || !RATE_ONLY.test(printedRate)) {
          throw new IngParseError(`FX row without a readable printed rate: "${line}"`);
        }
        if (!fxOriginal) {
          throw new IngParseError(`Settlement line without a preceding Amount line: "${line}"`);
        }
        fx = {
          originalCurrency: fxOriginal.currency,
          originalAmountMinor: fxOriginal.amountMinor,
          settlementCurrency: settlement[2],
          settlementAmountMinor: parseRomanianAmountToMinor(settlement[1]),
          printedRate,
        };
      }
    }
  }
  if (fxOriginal && !fx) {
    throw new IngParseError(`FX Amount line without a Settlement line in row ${raw.lineNo}`);
  }

  // Counterparty: the first body line, except bank-fee rows which have none.
  let counterpartyName: string | null = null;
  if (lines.length > 0 && !consumed.has(0) && lines[0] !== "Service Fee") {
    counterpartyName = lines[0].trim();
    consumed.add(0);
  }

  const description = lines
    .filter((_, idx) => !consumed.has(idx))
    .join(" ")
    .trim();

  return {
    lineNo: raw.lineNo,
    bookDate: raw.bookDate,
    direction: raw.signedAmountMinor < 0 ? "debit" : "credit",
    amountMinor: Math.abs(raw.signedAmountMinor),
    balanceAfterMinor: raw.balanceAfterMinor,
    counterpartyName,
    counterpartyIban,
    description,
    rawLines: [...lines],
    bankReference,
    internalReference,
    instantReference,
    fx,
  };
}

function selfVerify(header: HeaderInfo, rows: IngStatementRow[], raws: RawRow[]): void {
  // 1. Balance replay.
  let balance = header.openingBalanceMinor;
  for (let k = 0; k < raws.length; k += 1) {
    balance += raws[k].signedAmountMinor;
    if (balance !== raws[k].balanceAfterMinor) {
      throw new IngParseError(
        `Balance replay diverged at row ${raws[k].lineNo} (${raws[k].bookDate}): ` +
          `computed ${balance} minor units, statement prints ${raws[k].balanceAfterMinor}`,
      );
    }
  }
  if (balance !== header.closingBalanceMinor) {
    throw new IngParseError(
      `Closing balance mismatch: replay ends at ${balance}, header prints ${header.closingBalanceMinor}`,
    );
  }

  // 2 + 3. Declared counts and totals.
  const credits = rows.filter((r) => r.direction === "credit");
  const debits = rows.filter((r) => r.direction === "debit");
  if (credits.length !== header.declaredCreditCount || debits.length !== header.declaredDebitCount) {
    throw new IngParseError(
      `Row counts (${credits.length} credits / ${debits.length} debits) do not match ` +
        `declared (${header.declaredCreditCount} / ${header.declaredDebitCount})`,
    );
  }
  const creditSum = credits.reduce((s, r) => s + r.amountMinor, 0);
  const debitSum = debits.reduce((s, r) => s + r.amountMinor, 0);
  if (creditSum !== header.declaredTotalCreditsMinor || debitSum !== header.declaredTotalDebitsMinor) {
    throw new IngParseError(
      `Row sums (credits ${creditSum} / debits ${debitSum}) do not match ` +
        `declared totals (${header.declaredTotalCreditsMinor} / ${header.declaredTotalDebitsMinor})`,
    );
  }

  // 4. Long-reference uniqueness within the statement (L-0010 tripwire, parse half).
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!row.bankReference) continue;
    const prior = seen.get(row.bankReference);
    if (prior) {
      throw new IngParseError(
        `Bank reference "${row.bankReference}" appears on rows ${prior} and ${row.lineNo} — ` +
          "the long-reference stability assumption is broken for this statement",
      );
    }
    seen.set(row.bankReference, row.lineNo);
  }
}

/** Parse the extracted text of one ING statement. Throws IngParseError on
 * any structural or arithmetic inconsistency — never returns a bad parse. */
export function parseIngStatement(text: string): IngStatement {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const { body, headerMeta } = stripChrome(lines);
  const header = parseHeader(headerMeta, body);
  const raws = segmentRows(body);
  const rows = raws.map(interpretRow);
  selfVerify(header, rows, raws);
  return { ...header, rows };
}
