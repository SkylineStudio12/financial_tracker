/**
 * Pure guard tests for BNR source validation and overwrite detection.
 * Run: npx tsx src/lib/fx/sync.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import type { BnrDailyRates } from "./bnr";
import {
  canonicalRate,
  findOverwriteDeltas,
  FxSourceDisagreementError,
  mergeLatestDay,
  validateBnrDailyRates,
} from "./sync";

let checks = 0;
function ok(name: string) {
  checks += 1;
  console.log(`  ✓ ${name}`);
}

const pairedDay = (date = "2024-01-10"): BnrDailyRates => ({
  date,
  rates: [
    { currency: "USD", rateToRon: "4.541800" },
    { currency: "EUR", rateToRon: "4.9724" },
  ],
});

assert.equal(canonicalRate("004.972400"), "4.9724");
assert.throws(() => canonicalRate("0"), /must be positive/);
assert.throws(() => canonicalRate("4.9e0"), /Invalid BNR rate/);
ok("rates canonicalize without binary floating point and reject zero/exponents");

const [normalized] = validateBnrDailyRates(
  [pairedDay()],
  "2024-01-02",
  "2024-01-10",
);
assert.deepEqual(normalized, {
  date: "2024-01-10",
  rates: [
    { currency: "EUR", rateToRon: "4.9724" },
    { currency: "USD", rateToRon: "4.5418" },
  ],
});
ok("a complete day is canonicalized and ordered EUR/USD");

assert.throws(
  () =>
    validateBnrDailyRates(
      [{ date: "2024-01-10", rates: [{ currency: "EUR", rateToRon: "4.9724" }] }],
      "2024-01-02",
      "2024-01-10",
    ),
  /Missing USD/,
);
assert.throws(
  () => validateBnrDailyRates([pairedDay(), pairedDay()], "2024-01-02", "2024-01-10"),
  /Duplicate BNR date/,
);
assert.throws(
  () =>
    validateBnrDailyRates(
      [{
        date: "2024-01-10",
        rates: [
          { currency: "EUR", rateToRon: "4.9724" },
          { currency: "EUR", rateToRon: "4.9725" },
        ],
      }],
      "2024-01-02",
      "2024-01-10",
    ),
  /Duplicate EUR/,
);
ok("one-sided, duplicate-date, and duplicate-currency source data fail preflight");

const before = [
  { date: "2024-01-10", currency: "EUR" as const, rateToRon: "4.972400" },
  { date: "2024-01-10", currency: "USD" as const, rateToRon: "4.541800" },
];
assert.deepEqual(
  findOverwriteDeltas(before, [
    { ...before[0], rateToRon: "4.9724" },
    { ...before[1], rateToRon: "4.5418" },
  ]),
  [],
);
assert.deepEqual(
  findOverwriteDeltas(before, [
    { ...before[0], rateToRon: "4.9725" },
    before[1],
  ]),
  [{
    date: "2024-01-10",
    currency: "EUR",
    before: "4.972400",
    after: "4.9725",
  }],
);
ok("overwrite comparison ignores decimal scale but reports a changed value exactly");

assert.deepEqual(
  mergeLatestDay([pairedDay()], pairedDay(), "2024-01-02", "2024-01-10"),
  validateBnrDailyRates([pairedDay()], "2024-01-02", "2024-01-10"),
);
assert.throws(
  () =>
    mergeLatestDay(
      [pairedDay()],
      {
        ...pairedDay(),
        rates: [
          { currency: "EUR", rateToRon: "4.9725" },
          { currency: "USD", rateToRon: "4.5418" },
        ],
      },
      "2024-01-02",
      "2024-01-10",
    ),
  (error) =>
    error instanceof FxSourceDisagreementError &&
    error.deltas.length === 1 &&
    error.deltas[0].currency === "EUR",
);
const appended = mergeLatestDay(
  [pairedDay("2024-01-09")],
  pairedDay(),
  "2024-01-02",
  "2024-01-10",
);
assert.deepEqual(appended.map((day) => day.date), ["2024-01-09", "2024-01-10"]);
ok("yearly/latest feeds must agree, while a newer latest day is appended before writing");

console.log(`\nAll ${checks} FX sync guard checks passed.`);
