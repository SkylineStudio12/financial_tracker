/**
 * Parser tests against the REAL fixture (Skyline Nr.6 / 30.06.2026), per the
 * parked plan: real data beats invented. Run: npx tsx src/lib/import/ing/parse.test.ts
 * (no test runner in the repo yet — this exits non-zero on any failure).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseEnglishAmountToMinor,
  parseIngStatement,
  parseRomanianAmountToMinor,
} from "./parse";
import { IngParseError } from "./types";

const fixture = readFileSync(
  join(import.meta.dirname, "fixtures", "skyline-2026-06.txt"),
  "utf8",
);

let checks = 0;
function ok(name: string, fn: () => void) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

/* ---------------------------------------------------- amount conventions */
ok("English convention parses to minor units", () => {
  assert.equal(parseEnglishAmountToMinor("40,988.95"), 4_098_895);
  assert.equal(parseEnglishAmountToMinor("-2,695.00"), -269_500);
  assert.equal(parseEnglishAmountToMinor("-0.45"), -45);
});
ok("Romanian convention (FX sub-lines) parses to minor units", () => {
  assert.equal(parseRomanianAmountToMinor("24,20"), 2_420);
});
ok("wrong-convention input fails loudly instead of mis-parsing", () => {
  assert.throws(() => parseEnglishAmountToMinor("40.988,95"), IngParseError);
  assert.throws(() => parseRomanianAmountToMinor("24.20"), IngParseError);
});

/* ------------------------------------------------------------ happy path */
const stmt = parseIngStatement(fixture);
// parseIngStatement already self-verified: balance replay across all rows,
// declared counts (1 credit / 16 debits), declared totals, ref uniqueness.

ok("header: statement identity and period", () => {
  assert.equal(stmt.statementNumber, "Nr.6 / 30.06.2026");
  assert.equal(stmt.accountIban, "RO96INGB0000999912479494");
  assert.equal(stmt.period, "01 - 30.06.2026");
});
ok("header: opening 40,988.95 and closing 59,012.95 in minor units", () => {
  assert.equal(stmt.openingBalanceMinor, 4_098_895);
  assert.equal(stmt.closingBalanceMinor, 5_901_295);
});
ok("17 rows: 1 credit, 16 debits (matches declared header counts)", () => {
  assert.equal(stmt.rows.length, 17);
  assert.equal(stmt.declaredCreditCount, 1);
  assert.equal(stmt.declaredDebitCount, 16);
});

const byLineNo = new Map(stmt.rows.map((r) => [r.lineNo, r]));

ok("POS row (1461 Rompetrol): merchant captured, NO IBAN, NO long ref", () => {
  const row = byLineNo.get("1461")!;
  assert.equal(row.bookDate, "2026-06-02");
  assert.equal(row.direction, "debit");
  assert.equal(row.amountMinor, 45_710);
  assert.equal(row.counterpartyName, "ROMPETROL DWS R081 C1");
  assert.equal(row.counterpartyIban, null);
  assert.equal(row.bankReference, null);
});
ok("transfer row (1462): wrapped UUID ref joined; IBAN + instant ref captured", () => {
  const row = byLineNo.get("1462")!;
  assert.equal(row.counterpartyName, "Coman N Ciprian Expert Contabil");
  assert.equal(row.counterpartyIban, "RO08BTRL01601202M17970XX");
  assert.equal(row.bankReference, "71cf08f6-b8ab-3adf-b8b0-7399ff939582");
  assert.equal(row.instantReference, "1780914896626777164009");
  assert.equal(row.amountMinor, 2_500);
});
ok("owner transfer (1465): trailing whitespace trimmed, 2,695.00", () => {
  const row = byLineNo.get("1465")!;
  assert.equal(row.counterpartyName, "Grigore Filimon");
  assert.equal(row.counterpartyIban, "RO02INGB0000999910829858");
  assert.equal(row.amountMinor, 269_500);
});
ok("treasury row (1475): long numeric ref on its own line, internal ref", () => {
  const row = byLineNo.get("1475")!;
  assert.equal(row.bankReference, "050002100000000000000197278918");
  assert.equal(row.internalReference, "953601288");
  assert.equal(row.counterpartyIban, "RO14TREZ7015503XXXXXXXXX");
  assert.equal(row.amountMinor, 392_700);
});
ok("CAM row (1478): 101.00 to treasury", () => {
  const row = byLineNo.get("1478")!;
  assert.equal(row.amountMinor, 10_100);
  assert.equal(row.bankReference, "050002100000000000000197278963");
});
ok("revenue credit (1482 HolyCode): 26,213.76 in, internal ref only", () => {
  const row = byLineNo.get("1482")!;
  assert.equal(row.direction, "credit");
  assert.equal(row.amountMinor, 2_621_376);
  assert.equal(row.counterpartyName, "HOLYCODE SRL");
  assert.equal(row.counterpartyIban, "RO47RZBR0000060022862253");
  assert.equal(row.bankReference, null);
  assert.equal(row.internalReference, "954344576");
});
ok("FX row (1471 OpenAI): USD original, EUR settlement, printed rate 5.42", () => {
  const row = byLineNo.get("1471")!;
  assert.equal(row.amountMinor, 11_431);
  assert.deepEqual(row.fx, {
    originalCurrency: "USD",
    originalAmountMinor: 2_420,
    settlementCurrency: "EUR",
    settlementAmountMinor: 2_109,
    printedRate: "5.42",
  });
});
ok("FX row (1486 Anthropic): rate wrapped to next line, kept verbatim", () => {
  const row = byLineNo.get("1486")!;
  assert.equal(row.fx?.printedRate, "5.4216");
  assert.equal(row.fx?.originalCurrency, "EUR");
  assert.equal(row.fx?.originalAmountMinor, 2_178);
});
ok("FX row (1489 Figma): wrapped rate 5.4288", () => {
  const row = byLineNo.get("1489")!;
  assert.equal(row.fx?.printedRate, "5.4288");
  assert.equal(row.amountMinor, 13_138);
});
ok("non-FX POS row (1473 Orange) has fx: null", () => {
  assert.equal(byLineNo.get("1473")!.fx, null);
});
ok("bank-fee rows: no counterparty, description keeps the fee text", () => {
  const small = byLineNo.get("1463")!;
  assert.equal(small.counterpartyName, null);
  assert.equal(small.amountMinor, 45);
  assert.match(small.description, /Service Fee/);
  const monthly = byLineNo.get("1491")!;
  assert.equal(monthly.amountMinor, 4_000);
  assert.match(monthly.description, /Monthly fee ING FIX UTIL offer 40/);
});
ok("dedup-key coverage is PARTIAL on this statement (design input)", () => {
  // Only the 6 transfer/treasury rows print a long bank reference;
  // 11 of 17 (POS, fees, the incoming credit) have NO long ref at all.
  const withRef = stmt.rows.filter((r) => r.bankReference !== null);
  assert.equal(withRef.length, 6);
});

/* --------------------------------------------- self-verification failure */
ok("corrupted balance fails loudly naming the diverging row", () => {
  const corrupted = fixture.replace("-457.10 40,531.85", "-457.10 40,531.86");
  assert.throws(
    () => parseIngStatement(corrupted),
    (e: unknown) => e instanceof IngParseError && /diverged at row 1461/.test(e.message),
  );
});
ok("duplicate long reference within one statement fails loudly", () => {
  const duplicated = fixture.replace(
    "Bank reference afbefaf7-61f9-30b2-9038-\nf7fd93df4292",
    "Bank reference 71cf08f6-b8ab-3adf-b8b0-\n7399ff939582",
  );
  assert.throws(
    () => parseIngStatement(duplicated),
    (e: unknown) => e instanceof IngParseError && /stability assumption is broken/.test(e.message),
  );
});
ok("tampered closing balance fails the replay", () => {
  const tampered = fixture.replace("59,012.95   01", "59,012.96   01");
  assert.throws(
    () => parseIngStatement(tampered),
    (e: unknown) => e instanceof IngParseError && /Closing balance mismatch/.test(e.message),
  );
});

console.log(`\nAll ${checks} checks passed.`);
