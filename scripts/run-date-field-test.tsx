/**
 * Date-picker pattern verification (docs/reviews/date-picker-checkpoint-a.md §12):
 * §12.2 parse table per locale, §12.3 TZ round-trip in simulated non-UTC
 * zones (spawned children — mutating TZ in-process is unreliable), §12.4
 * salary touched matrix over the exact handler logic, §12.5 the static half
 * of the filter GET contract (hidden inputs + honest pill label). No DB.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  dateToIso,
  dropdownBounds,
  evaluateDateInput,
  isoToDate,
} from "../src/components/ui/date-field-engine";
import {
  defaultSalaryPaymentDate,
  salaryPayMonthAfterPaymentDateChange,
  salaryPaymentDateAfterPayMonthChange,
} from "../src/lib/ledger/salary-dates";
import { DateFilter } from "../src/components/ui/date-filter";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

/* ---------------------------------------------------- §12.3 TZ child mode */

const TZ_EDGE_DATES = [
  "2026-01-01",
  "2026-01-31",
  "2026-02-28",
  "2024-02-29",
  "2026-06-30",
  "2026-07-01",
  "2026-12-31",
];

if (process.env.DATE_FIELD_TZ_CHILD) {
  for (const iso of TZ_EDGE_DATES) {
    const date = isoToDate(iso);
    assert.ok(date, `${iso} must parse in TZ=${process.env.TZ}`);
    assert.equal(dateToIso(date), iso, `round-trip identity for ${iso} in TZ=${process.env.TZ}`);
  }
  // Prove the test bites: the forbidden UTC-string parse DOES shift the day
  // in a west-of-UTC zone (D10's failure mode), while ours does not.
  if (process.env.TZ === "America/Anchorage") {
    assert.notEqual(new Date("2026-01-01").getDate(), 1, "naive parse must shift in Anchorage");
  }
  console.log(`ok - TZ=${process.env.TZ}: ${TZ_EDGE_DATES.length} round-trips identical`);
  process.exit(0);
}

/* -------------------------------------------------- §12.2 the parse table */

test("EN accepts ISO padded and unpadded, rejects RO shape", () => {
  assert.deepEqual(evaluateDateInput("2026-03-05", "en"), { kind: "valid", iso: "2026-03-05" });
  assert.deepEqual(evaluateDateInput("2026-3-5", "en"), { kind: "valid", iso: "2026-03-05" });
  assert.deepEqual(evaluateDateInput("05.03.2026", "en"), { kind: "invalid" });
});

test("RO accepts dotted padded/unpadded and ISO paste-through", () => {
  assert.deepEqual(evaluateDateInput("05.03.2026", "ro"), { kind: "valid", iso: "2026-03-05" });
  assert.deepEqual(evaluateDateInput("5.3.2026", "ro"), { kind: "valid", iso: "2026-03-05" });
  assert.deepEqual(evaluateDateInput("2026-03-05", "ro"), { kind: "valid", iso: "2026-03-05" });
});

test("nonexistent days are rejected, leap rules respected", () => {
  assert.deepEqual(evaluateDateInput("31.02.2026", "ro"), { kind: "invalid" });
  assert.deepEqual(evaluateDateInput("2026-02-31", "en"), { kind: "invalid" });
  assert.deepEqual(evaluateDateInput("29.02.2024", "ro"), { kind: "valid", iso: "2024-02-29" });
  assert.deepEqual(evaluateDateInput("29.02.2026", "ro"), { kind: "invalid" });
  assert.deepEqual(evaluateDateInput("2026-13-01", "en"), { kind: "invalid" });
  assert.deepEqual(evaluateDateInput("2026-00-10", "en"), { kind: "invalid" });
});

test("empty and whitespace are first-class empty (the clear commit), garbage is invalid", () => {
  assert.deepEqual(evaluateDateInput("", "en"), { kind: "empty" });
  assert.deepEqual(evaluateDateInput("   ", "ro"), { kind: "empty" });
  assert.deepEqual(evaluateDateInput("abc", "ro"), { kind: "invalid" });
  assert.deepEqual(evaluateDateInput("14.03.19", "ro"), { kind: "invalid" });
  assert.deepEqual(evaluateDateInput("14.03", "ro"), { kind: "invalid" });
});

test("distant dates parse — the opening-balance case needs no picker", () => {
  assert.deepEqual(evaluateDateInput("14.03.2019", "ro"), { kind: "valid", iso: "2019-03-14" });
  assert.deepEqual(evaluateDateInput("2001-01-01", "en"), { kind: "valid", iso: "2001-01-01" });
});

/* ------------------------------------------- D8/Q2 dropdown bounds ruling */

test("dropdown bounds: Jan 2015 → Dec current+1, widened by out-of-window values", () => {
  const today = new Date(2026, 6, 19);
  const base = dropdownBounds([""], today);
  assert.equal(dateToIso(base.startMonth), "2015-01-01");
  assert.equal(dateToIso(base.endMonth), "2027-12-01");
  const widened = dropdownBounds(["2009-06-15"], today);
  assert.equal(dateToIso(widened.startMonth), "2009-06-01");
  assert.equal(dateToIso(widened.endMonth), "2027-12-01");
});

/* --------------------------------------------- §12.4 salary touched matrix */

/** The salary-flow handlers, verbatim as pure state transitions (§7/D6). */
type SalaryDates = {
  payMonth: string;
  paymentDate: string;
  payMonthTouched: boolean;
  paymentDateTouched: boolean;
};
const editPayMonth = (s: SalaryDates, next: string): SalaryDates => ({
  ...s,
  payMonth: next,
  payMonthTouched: true,
  paymentDate: salaryPaymentDateAfterPayMonthChange(next, s.paymentDate, s.paymentDateTouched),
});
const commitPaymentDate = (s: SalaryDates, nextIso: string): SalaryDates => ({
  ...s,
  paymentDate: nextIso,
  paymentDateTouched: true,
  payMonth: salaryPayMonthAfterPaymentDateChange(nextIso, s.payMonth, s.payMonthTouched),
});
/** DateField onOpenChange(true) / onFocus — engagement marks touched. */
const engagePaymentDate = (s: SalaryDates): SalaryDates => ({
  ...s,
  paymentDateTouched: true,
});
const fresh = (): SalaryDates => ({
  payMonth: "2026-07",
  paymentDate: defaultSalaryPaymentDate("2026-07"),
  payMonthTouched: false,
  paymentDateTouched: false,
});

test("matrix (a): payMonth edit before any paymentDate touch — default follows", () => {
  const s = editPayMonth(fresh(), "2026-08");
  assert.equal(s.paymentDate, "2026-09-10");
});

test("matrix (b): opening the picker (no commit) pins paymentDate against payMonth edits", () => {
  let s = engagePaymentDate(fresh());
  const pinned = s.paymentDate;
  s = editPayMonth(s, "2026-09");
  assert.equal(s.paymentDate, pinned);
});

test("matrix (c): typing a paymentDate back-derives payMonth once", () => {
  let s = commitPaymentDate(fresh(), "2026-05-14");
  assert.equal(s.payMonth, "2026-04");
  s = editPayMonth(s, "2026-06");
  assert.equal(s.paymentDate, "2026-05-14", "paymentDate holds after being typed");
});

test("matrix (d): repeat-last-salary marks touched at the state level — payMonth edit holds it", () => {
  let s = { ...fresh(), paymentDate: "2026-06-05", paymentDateTouched: true };
  s = editPayMonth(s, "2026-07");
  assert.equal(s.paymentDate, "2026-06-05");
});

test("salary-flow wires the DateField engagement hooks (source contract)", () => {
  const source = readFileSync("src/components/flows/salary-flow.tsx", "utf8");
  assert.match(source, /<DateField/);
  assert.match(source, /onOpenChange=\{\(open\) => \{\s*if \(open\) paymentDateTouched\.current = true;/);
  assert.match(source, /onFocus=\{\(\) => \{\s*paymentDateTouched\.current = true;/);
  assert.doesNotMatch(source, /type="date"/);
  assert.match(source, /type="month"/, "payMonth stays native by scope (Q3)");
});

/* ---------------------- pattern source contracts (browser-verified live;
   these greps keep the wiring from regressing silently) */

test("DateField wires blur-normalize, blur-invalid, and the L-0004 month reset", () => {
  const source = readFileSync("src/components/ui/date-field.tsx", "utf8");
  assert.match(source, /onBlur=\{\(\) => \{/);
  assert.match(source, /setInvalid\(true\)/, "invalid is flagged on blur");
  assert.match(source, /setText\(formatDate\(evaluation\.iso, locale\)\)/, "valid blur normalizes");
  assert.match(source, /if \(nextOpen\) setMonth\(selectedDate \?\? new Date\(\)\)/, "controlled month resets on open");
  assert.match(source, /initialFocus=\{focusCalendarDay\}/);
  assert.match(source, /event\.altKey && event\.key === "ArrowDown"/, "Alt+ArrowDown opens");
});

test("DateFilter wires the controlled month reset and initial focus", () => {
  const source = readFileSync("src/components/ui/date-filter.tsx", "utf8");
  assert.match(source, /if \(nextOpen\) setMonth\(fromDate \?\? toDate \?\? new Date\(\)\)/);
  assert.match(source, /initialFocus=\{focusCalendarDay\}/);
});

test("calendar defaults: weekStartsOn Monday, Q6 ruled sans (11-11C)", () => {
  const source = readFileSync("src/components/ui/calendar.tsx", "utf8");
  assert.match(source, /weekStartsOn = 1/);
  assert.match(source, /const DEFAULT_NUMERIC_DAY_GRID = false/);
});

/* ------------------------------------ §12.5 filter GET contract (static) */

const messages = {
  en: JSON.parse(readFileSync("messages/en.json", "utf8")),
  ro: JSON.parse(readFileSync("messages/ro.json", "utf8")),
};

function renderFilter(locale: "en" | "ro", from?: string, to?: string): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <DateFilter from={from} to={to} className="pill" />
    </NextIntlClientProvider>,
  );
}

const hiddenInput = (name: string, value: string) =>
  new RegExp(`<input[^>]*type="hidden"[^>]*name="${name}"[^>]*value="${value}"`);

test("full range: hidden inputs carry the ISO values, pill label is the RO span", () => {
  const markup = renderFilter("ro", "2026-03-01", "2026-03-31");
  assert.match(markup, hiddenInput("from", "2026-03-01"));
  assert.match(markup, hiddenInput("to", "2026-03-31"));
  assert.match(markup, /Perioadă/);
  assert.match(markup, /01\.03\.2026 – 31\.03\.2026/);
});

test("open-ended ranges render honestly in both directions", () => {
  const fromOnly = renderFilter("ro", "2026-03-01", undefined);
  assert.match(fromOnly, hiddenInput("from", "2026-03-01"));
  assert.match(fromOnly, hiddenInput("to", ""));
  assert.match(fromOnly, /01\.03\.2026 –/);
  const toOnly = renderFilter("en", undefined, "2026-03-31");
  assert.match(toOnly, hiddenInput("from", ""));
  assert.match(toOnly, hiddenInput("to", "2026-03-31"));
  assert.match(toOnly, /– 2026-03-31/);
});

test("empty filter: both hidden inputs submit empty — the URL contract's empty shape", () => {
  const markup = renderFilter("en");
  assert.match(markup, hiddenInput("from", ""));
  assert.match(markup, hiddenInput("to", ""));
  assert.match(markup, /Period/);
  assert.doesNotMatch(markup, /–/);
});

/* -------------------------------------------- §12.8 pattern-wide greps */

test("zero native date inputs remain outside payMonth (grep gate)", () => {
  const grep = spawnSync("grep", ["-rn", 'type="date"', "src", "--include=*.tsx"], {
    encoding: "utf8",
  });
  assert.equal(grep.stdout.trim(), "", `native date inputs remain:\n${grep.stdout}`);
});

/* ----------------------------------------------- §12.3 spawn TZ children */

for (const tz of ["Pacific/Kiritimati", "America/Anchorage"]) {
  const child = spawnSync("npx", ["tsx", "scripts/run-date-field-test.tsx"], {
    env: { ...process.env, TZ: tz, DATE_FIELD_TZ_CHILD: "1" },
    encoding: "utf8",
  });
  process.stdout.write(child.stdout);
  if (child.status !== 0) {
    process.stderr.write(child.stderr);
    process.exit(child.status ?? 1);
  }
  passed++;
}

console.log(`\n${passed} tests passed`);
