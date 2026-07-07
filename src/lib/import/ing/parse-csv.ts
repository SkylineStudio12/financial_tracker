/**
 * ING CSV account-history export parser — the DEFAULT statement input format
 * (Stage 4 scope amendment). PURE: CSV text in, the SAME typed statement
 * shape out as the PDF-text parser (parse.ts).
 *
 * ANTI-FORK DESIGN: this module only converts semicolon rows into the shared
 * RawRow body-line shape, then REUSES parse.ts's interpretRow (field
 * extraction: refs, IBAN, FX, counterparty) and selfVerify (balance replay,
 * ref uniqueness). One interpretation path for both formats; the
 * cross-format equivalence test pins that adding CSV didn't fork behavior.
 *
 * Format (verified against the real export, fixtures/skyline-2026-06.csv):
 * - semicolon-delimited, 14 columns, no quoting observed — strict: any data
 *   line with a different column count throws;
 * - Romanian decimal comma everywhere ("40988,95", signed "-457,10") —
 *   unlike the PDF text, which mixes English main amounts with Romanian FX
 *   sub-lines; dates DD.MM.YYYY;
 * - the FIRST data row is the opening-balance SENTINEL (only "Initial
 *   balance" + book date filled) and the LAST is the closing sentinel
 *   ("End balance") — they are not transactions;
 * - bank/internal/instant references, card facts, and FX live as free text
 *   in "transaction details", exactly as in the PDF — so the refless-row
 *   set is UNCHANGED (L-0010 stands) and the twin fees stay content-
 *   identical; "transaction type" (POS purchase / Transfer ING Business /
 *   Service Fee / Incoming funds) carries the classifier's structural
 *   signal as a synthesized body line — same classifier, extra input.
 *
 * POSITION ANCHOR (the amendment's one genuine design point): the CSV has
 * NO per-line statement number (no 1461…1491) and no printed "Nr.N", so the
 * synthetic refless key's components are FORMAT-DEPENDENT:
 * - position: CSV ROW POSITION (1-based over transaction rows) instead of
 *   the PDF lineNo — both stable and unique within a single export;
 * - statement scope: "CSV {firstDate} - {lastDate}" derived from the
 *   sentinel dates instead of the printed number — deterministic for the
 *   same file.
 * CONSEQUENCE: the same statement imported once as PDF text and once as CSV
 * does NOT cross-dedup at row level (different anchors → different
 * synthetic keys). Accepted because CSV is the default and a statement is
 * not normally imported both ways — and the batch-level (account, period)
 * overlap guard is format-agnostic, so the two-format case IS caught and
 * each refless row in the overlap window demands individual confirmation.
 * Ref-BEARING rows carry the bank's own reference in both formats and
 * hard-dedup across formats regardless.
 */
import { interpretRow, selfVerify, toIsoDate, type RawRow } from "./parse";
import { IngParseError, type IngStatement } from "./types";

export const ING_CSV_HEADER =
  "Initial balance;End balance;account number;book date;amount;currency;" +
  "transaction type;counterparty's name;counterparty's address;counterparty's " +
  "account;counterparty's bank;transaction details;balance after transaction;" +
  "CUI Counterparty";

const COLUMN_COUNT = 14;
const DATE_RO = /^\d{2}\.\d{2}\.\d{4}$/;
const AMOUNT_RO_SIGNED = /^-?\d+(?:\.\d{3})*,\d{2}$/;

/** Format detection for input routing: is this text an ING CSV export? */
export function isIngCsv(text: string): boolean {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0);
  return firstLine?.trim() === ING_CSV_HEADER;
}

/** "-457,10" / "40988,95" (Romanian convention, optional sign) → signed
 * integer minor units. Strict-rejects anything off-pattern. */
function parseSignedRomanianToMinor(text: string): number {
  if (!AMOUNT_RO_SIGNED.test(text)) {
    throw new IngParseError(`Unparseable CSV amount (expected Romanian convention): "${text}"`);
  }
  const negative = text.startsWith("-");
  const [whole, cents] = text.replace("-", "").replace(/\./g, "").split(",");
  const minor = Number(whole) * 100 + Number(cents);
  if (!Number.isSafeInteger(minor)) throw new IngParseError(`Amount overflow: "${text}"`);
  return negative ? -minor : minor;
}

/**
 * "transaction details" free text → the body-line shape interpretRow expects
 * (one line per structured fact, exactly as the PDF prints them). Cuts the
 * string before each known ING marker; text before the first marker is the
 * free-text line (cardholder name, payment description, fee text).
 */
const DETAIL_MARKERS = [
  "Card No:",
  "Date:",
  "Settlement Amount:",
  "Amount:",
  "Internal reference:",
  "Instant reference:",
  "Bank reference",
];

function segmentDetails(details: string): string[] {
  const cuts = new Set<number>();
  for (const marker of DETAIL_MARKERS) {
    for (let idx = details.indexOf(marker); idx !== -1; idx = details.indexOf(marker, idx + 1)) {
      // "Amount:" also occurs inside "Settlement Amount:" — that occurrence
      // belongs to the Settlement cut, not a cut of its own.
      if (marker === "Amount:" && details.slice(0, idx).endsWith("Settlement ")) continue;
      cuts.add(idx);
    }
  }
  const sorted = [0, ...[...cuts].sort((a, b) => a - b), details.length];
  const segments: string[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const segment = details.slice(sorted[i], sorted[i + 1]).trim();
    if (segment) segments.push(segment);
  }
  return segments;
}

interface CsvLine {
  cols: string[];
  csvLineNo: number;
}

export function parseIngCsvStatement(text: string): IngStatement {
  const lines: CsvLine[] = text
    .split("\n")
    .map((raw, i) => ({ raw: raw.trim(), csvLineNo: i + 1 }))
    .filter((l) => l.raw.length > 0)
    .map((l) => ({ cols: l.raw.split(";"), csvLineNo: l.csvLineNo }));

  if (lines.length === 0 || lines[0].cols.join(";") !== ING_CSV_HEADER) {
    throw new IngParseError("Not an ING CSV export: header row missing or unrecognized");
  }
  const data = lines.slice(1);
  if (data.length < 3) {
    throw new IngParseError("ING CSV has no transaction rows between the balance sentinels");
  }
  for (const line of data) {
    if (line.cols.length !== COLUMN_COUNT) {
      throw new IngParseError(
        `CSV line ${line.csvLineNo}: expected ${COLUMN_COUNT} columns, got ${line.cols.length}`,
      );
    }
  }

  // Sentinels: first data row carries the opening balance, last the closing.
  const opening = data[0];
  const closing = data[data.length - 1];
  if (!opening.cols[0].trim() || opening.cols[4].trim()) {
    throw new IngParseError("First CSV data row is not the opening-balance sentinel");
  }
  if (!closing.cols[1].trim() || closing.cols[4].trim()) {
    throw new IngParseError("Last CSV data row is not the closing-balance sentinel");
  }
  const openingDate = opening.cols[3].trim();
  const closingDate = closing.cols[3].trim();
  if (!DATE_RO.test(openingDate) || !DATE_RO.test(closingDate)) {
    throw new IngParseError("CSV balance sentinels carry no readable dates");
  }
  const openingBalanceMinor = parseSignedRomanianToMinor(opening.cols[0].trim());
  const closingBalanceMinor = parseSignedRomanianToMinor(closing.cols[1].trim());

  // Transaction rows → the shared RawRow shape.
  const raws: RawRow[] = [];
  let accountIban: string | null = null;
  for (const [position, line] of data.slice(1, -1).entries()) {
    const c = line.cols.map((v) => v.trim());
    const [, , iban, bookDate, amount, currency, type, name, , counterpartyIban, , details, balanceAfter] = c;
    if (!DATE_RO.test(bookDate)) {
      throw new IngParseError(`CSV line ${line.csvLineNo}: unreadable book date "${bookDate}"`);
    }
    if (currency !== "RON") {
      throw new IngParseError(`CSV line ${line.csvLineNo}: unexpected currency "${currency}"`);
    }
    if (accountIban === null) accountIban = iban;
    else if (iban !== accountIban) {
      throw new IngParseError(`CSV line ${line.csvLineNo}: mixed account IBANs in one export`);
    }

    // Body lines in the PDF's print order: counterparty, IBAN, transaction
    // type, then the structured detail facts. interpretRow consumes them
    // identically for both formats.
    const bodyLines: string[] = [];
    if (name) bodyLines.push(name);
    if (counterpartyIban) bodyLines.push(counterpartyIban);
    if (type) bodyLines.push(type);
    bodyLines.push(...segmentDetails(details));

    raws.push({
      // Position anchor: 1-based CSV row position (see header comment) —
      // the CSV has no statement lineNo.
      lineNo: String(position + 1),
      bookDate: toIsoDate(bookDate),
      bodyLines,
      signedAmountMinor: parseSignedRomanianToMinor(amount),
      balanceAfterMinor: parseSignedRomanianToMinor(balanceAfter),
    });
  }
  if (!accountIban) throw new IngParseError("CSV export names no account IBAN");

  const rows = raws.map(interpretRow);

  // The CSV declares NO credit/debit counts or totals (the PDF header does),
  // so checks 2–3 of selfVerify get row-derived expectations here and only
  // the balance replay (1) and ref-uniqueness tripwire (4) can actually
  // fail — they are the load-bearing checks for this format.
  const credits = rows.filter((r) => r.direction === "credit");
  const debits = rows.filter((r) => r.direction === "debit");
  const header = {
    // Format-dependent statement scope: no printed "Nr.N" exists, so the
    // sentinel dates identify the export (deterministic for the same file).
    statementNumber: `CSV ${openingDate} - ${closingDate}`,
    accountIban,
    period: `${openingDate} - ${closingDate}`,
    openingBalanceMinor,
    closingBalanceMinor,
    declaredCreditCount: credits.length,
    declaredDebitCount: debits.length,
    declaredTotalCreditsMinor: credits.reduce((s, r) => s + r.amountMinor, 0),
    declaredTotalDebitsMinor: debits.reduce((s, r) => s + r.amountMinor, 0),
  };
  selfVerify(header, rows, raws);
  return { ...header, rows };
}
