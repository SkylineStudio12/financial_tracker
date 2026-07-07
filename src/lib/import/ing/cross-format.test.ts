/**
 * CROSS-FORMAT EQUIVALENCE — the CSV amendment's safety property.
 *
 * Parses the SAME real statement (Skyline June 2026) from both committed
 * fixtures — the PDF-extracted text and the ING CSV export — and asserts the
 * typed-row output is IDENTICAL IN CONTENT for all 17 rows: amounts in minor
 * units, balances, dates, directions, counterparty names and IBANs, resolved
 * bank/internal/instant references, FX facts, and classifier kind/confidence.
 *
 * The ONLY permitted difference is the synthetic key's position/scope
 * components (PDF "Nr.N"+lineNo vs CSV sentinel-dates+row-index) — asserted
 * explicitly, including the documented consequence that refless synthetic
 * keys do NOT match across formats while ref-bearing keys DO.
 *
 * This test is what proves adding the CSV format didn't fork behavior.
 * Run: npx tsx src/lib/import/ing/cross-format.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyStatementRows } from "./classify";
import { resolveExternalRef } from "./identity";
import { parseIngStatement } from "./parse";
import { isIngCsv, parseIngCsvStatement } from "./parse-csv";

const read = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
const pdfText = read("skyline-2026-06.txt");
const csvText = read("skyline-2026-06.csv");

let checks = 0;
function ok(name: string, fn: () => void) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

ok("format detection routes each fixture to its own parser", () => {
  assert.equal(isIngCsv(csvText), true);
  assert.equal(isIngCsv(pdfText), false);
});

const pdf = parseIngStatement(pdfText);
const csv = parseIngCsvStatement(csvText);
// Both parses passed their own self-verification (balance replay, ref
// uniqueness) or they would have thrown above.

ok("both formats: balance self-verification on the same money", () => {
  assert.equal(pdf.openingBalanceMinor, 40_988_95);
  assert.equal(csv.openingBalanceMinor, 40_988_95);
  assert.equal(pdf.closingBalanceMinor, 59_012_95);
  assert.equal(csv.closingBalanceMinor, 59_012_95);
  assert.equal(pdf.accountIban, csv.accountIban);
});

ok("both formats: 17 rows in the same statement order", () => {
  assert.equal(pdf.rows.length, 17);
  assert.equal(csv.rows.length, 17);
});

const ctx = { ownerNames: ["Grigore Filimon"] };
const pdfClassified = classifyStatementRows(pdf.rows, ctx);
const csvClassified = classifyStatementRows(csv.rows, ctx);

ok("ALL 17 rows content-identical across formats (the equivalence bar)", () => {
  for (let i = 0; i < 17; i += 1) {
    const a = pdfClassified[i];
    const b = csvClassified[i];
    const at = `row ${i + 1} (pdf lineNo ${a.row.lineNo})`;
    assert.equal(a.row.bookDate, b.row.bookDate, `${at}: bookDate`);
    assert.equal(a.row.direction, b.row.direction, `${at}: direction`);
    assert.equal(a.row.amountMinor, b.row.amountMinor, `${at}: amountMinor`);
    assert.equal(a.row.balanceAfterMinor, b.row.balanceAfterMinor, `${at}: balanceAfter`);
    assert.equal(a.row.counterpartyName, b.row.counterpartyName, `${at}: counterpartyName`);
    assert.equal(a.row.counterpartyIban, b.row.counterpartyIban, `${at}: counterpartyIban`);
    assert.equal(a.row.bankReference, b.row.bankReference, `${at}: bankReference`);
    assert.equal(a.row.internalReference, b.row.internalReference, `${at}: internalReference`);
    assert.equal(a.row.instantReference, b.row.instantReference, `${at}: instantReference`);
    assert.deepEqual(a.row.fx, b.row.fx, `${at}: fx facts`);
    assert.equal(a.kind, b.kind, `${at}: classifier kind`);
    assert.equal(a.confidence, b.confidence, `${at}: classifier confidence`);
    assert.deepEqual(a.identity, b.identity, `${at}: identity inventory`);
  }
});

ok("ref-bearing rows (6): resolved external_ref IDENTICAL across formats", () => {
  const pairs = pdfClassified
    .map((a, i) => [a, csvClassified[i]] as const)
    .filter(([a]) => a.row.bankReference !== null);
  assert.equal(pairs.length, 6);
  for (const [a, b] of pairs) {
    assert.equal(resolveExternalRef(a.row, pdf), resolveExternalRef(b.row, csv));
  }
});

ok("refless rows (11): synthetic keys differ ONLY in scope/position anchor", () => {
  const pairs = pdfClassified
    .map((a, i) => [a, csvClassified[i]] as const)
    .filter(([a]) => a.row.bankReference === null);
  assert.equal(pairs.length, 11);
  for (const [a, b] of pairs) {
    const pdfKey = resolveExternalRef(a.row, pdf);
    const csvKey = resolveExternalRef(b.row, csv);
    // Same namespace and account; the statement-scope + position components
    // are format-dependent by design (documented consequence: no row-level
    // cross-format dedup — the batch overlap guard covers that case).
    assert.match(pdfKey, /^ING:RO96INGB0000999912479494:Nr\.6\/30\.06\.2026:\d+$/);
    assert.match(csvKey, /^ING:RO96INGB0000999912479494:CSV02\.06\.2026-30\.06\.2026:\d+$/);
    assert.notEqual(pdfKey, csvKey);
  }
});

ok("twin fees stay DISTINCT within the CSV format too", () => {
  // PDF 1476/1479 are CSV positions 10 and 12.
  const [a, b] = [csvClassified[9], csvClassified[11]];
  assert.equal(a.kind, "bank_fee");
  assert.equal(b.kind, "bank_fee");
  assert.equal(a.row.amountMinor, 51);
  assert.equal(b.row.amountMinor, 51);
  assert.equal(a.row.bookDate, b.row.bookDate);
  assert.notEqual(resolveExternalRef(a.row, csv), resolveExternalRef(b.row, csv));
});

ok("CSV re-parse is deterministic: identical keys on every parse", () => {
  const again = parseIngCsvStatement(csvText);
  for (let i = 0; i < 17; i += 1) {
    assert.equal(resolveExternalRef(csv.rows[i], csv), resolveExternalRef(again.rows[i], again));
  }
});

ok("corrupted CSV balance fails the shared replay check loudly", () => {
  const corrupted = csvText.replace("40531,85", "40531,86");
  assert.throws(corrupted === csvText ? () => {} : () => parseIngCsvStatement(corrupted), /diverged/);
});

console.log(`\nAll ${checks} cross-format checks passed.`);
