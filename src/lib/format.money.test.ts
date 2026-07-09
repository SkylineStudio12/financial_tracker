/**
 * MONEY-GRADE format suite (i18n Stage 2). Two guarantees:
 * 1. GOLDEN — exact expected strings for both locales, incl. the brief's
 *    edge cases (0, negatives, 40.988,95, 1.234.567,89, USD, rate, bps).
 * 2. NO-RO-REGRESSION — ro output is compared against the pre-Stage-2
 *    hardcoded formatter (replicated inline) across a value sweep: any
 *    drift means the locale parameterization broke the default the real
 *    Skyline balances render with.
 * Run: npx tsx src/lib/format.money.test.ts
 */
import assert from "node:assert/strict";
import {
  formatBpsPercent,
  formatDate,
  formatImpliedRate,
  formatMinor,
  formatMinorNumber,
} from "./format";

let checks = 0;
function ok(name: string) {
  checks += 1;
  console.log(`  ✓ ${name}`);
}

// ---- 1. GOLDEN ------------------------------------------------------------

assert.equal(formatMinor(0, "RON", "ro"), "0,00 RON");
assert.equal(formatMinor(0, "RON", "en"), "0.00 RON");
ok("zero");

assert.equal(formatMinor(-500, "RON", "ro"), "-5,00 RON");
assert.equal(formatMinor(-500, "RON", "en"), "-5.00 RON");
ok("negative");

assert.equal(formatMinor(4098895, "RON", "ro"), "40.988,95 RON");
assert.equal(formatMinor(4098895, "RON", "en"), "40,988.95 RON");
ok("thousands separator (the brief's 40.988,95 / 40,988.95)");

assert.equal(formatMinor(123456789, "RON", "ro"), "1.234.567,89 RON");
assert.equal(formatMinor(123456789, "RON", "en"), "1,234,567.89 RON");
ok("large 1.234.567,89");

assert.equal(formatMinor(-110872, "RON", "ro"), "-1.108,72 RON");
assert.equal(formatMinor(242500, "RON", "ro"), "2.425,00 RON");
ok("Stage-1 live captures reproduce byte-for-byte in ro");

assert.equal(formatMinor(-24200, "USD", "ro"), "-242,00 USD");
assert.equal(formatMinor(-24200, "USD", "en"), "-242.00 USD");
ok("non-RON currency suffix");

assert.equal(formatMinorNumber(4098895, "ro"), "40.988,95");
assert.equal(formatMinorNumber(4098895, "en"), "40,988.95");
ok("number-only variant");

assert.equal(formatImpliedRate(24200, 110872, "ro"), "4,5815");
assert.equal(formatImpliedRate(24200, 110872, "en"), "4.5815");
assert.equal(formatImpliedRate(0, 110872, "ro"), "–");
ok("implied rate 4 digits + zero guard");

assert.equal(formatDate("2026-07-09", "ro"), "09.07.2026");
assert.equal(formatDate("2026-07-09", "en"), "2026-07-09");
assert.equal(formatDate("2026-12-31", "ro"), "31.12.2026");
assert.equal(formatDate("not-a-date", "ro"), "not-a-date");
ok("dates: ro DD.MM.YYYY rearrangement, en ISO, non-date passthrough");

assert.equal(formatBpsPercent(100, "ro", { minFractionDigits: 2 }), "1,00%");
assert.equal(formatBpsPercent(100, "en", { minFractionDigits: 2 }), "1.00%");
assert.equal(formatBpsPercent(1000, "ro"), "10%");
assert.equal(formatBpsPercent(850, "ro"), "8,5%");
assert.equal(formatBpsPercent(850, "en"), "8.5%");
ok("bps percent: literal % without space, both precisions");

// ---- 2. NO-RO-REGRESSION sweep ---------------------------------------------

// The exact pre-Stage-2 implementation (src/lib/format.ts before this unit).
const legacyRo = new Intl.NumberFormat("ro-RO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const legacyFormatMinor = (amountMinor: number, currency: string) =>
  `${legacyRo.format(amountMinor / 100)} ${currency}`;

const sweep: number[] = [];
for (let i = 0; i <= 1000; i++) sweep.push(i * 733 - 250000); // negatives → positives
sweep.push(0, -1, 1, 99, -99, 100, 4098895, 123456789, -123456789, 999999999999);

for (const minor of sweep) {
  assert.equal(
    formatMinor(minor, "RON", "ro"),
    legacyFormatMinor(minor, "RON"),
    `ro drift at ${minor} minor units`,
  );
}
ok(`no-ro-regression sweep: ${sweep.length} values match the legacy formatter exactly`);

// Legacy formatDate was the identity; en must reproduce it.
for (const d of ["2026-07-09", "2026-01-01", "2031-12-31"]) {
  assert.equal(formatDate(d, "en"), d, `en date drift at ${d}`);
}
ok("en dates identical to legacy ISO display");

console.log(`\nformat.money.test: ${checks} checks passed`);
