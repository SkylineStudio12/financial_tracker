import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { DevDatabaseBadge, getDevDatabaseBadgeInfo } from "../src/components/dev-database-badge";
import {
  decideEntryTypeChange,
  SEGMENT_MIN_WIDTH_REM,
} from "../src/components/new-transaction-dialog-state";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

test("clean type switch selects immediately", () => {
  assert.deepEqual(decideEntryTypeChange("standard", "transfer", false), {
    kind: "select",
    type: "transfer",
  });
});

test("dirty type switch requires discard confirmation", () => {
  assert.deepEqual(decideEntryTypeChange("standard", "salary", true), {
    kind: "confirm",
    type: "salary",
  });
  assert.deepEqual(decideEntryTypeChange("standard", "standard", true), { kind: "noop" });
});

test("modal pins manual activation, static title, and guarded switching", () => {
  const source = readFileSync("src/components/new-transaction-dialog.tsx", "utf8");
  assert.match(source, /activateOnFocus=\{false\}/);
  assert.match(source, /<DialogTitle>\{t\("newTransaction"\)\}<\/DialogTitle>/);
  assert.match(source, /onValueChange=\{handleTypeChange\}/);
  assert.doesNotMatch(source, /salaryTitle/);
  assert.doesNotMatch(source, /onClick=\{\(\) => setType/);
});

test("three-segment Urbanist width fixtures fit wide and wrap 2+1 narrow", () => {
  const urbanistLabelPx = 103.90625;
  const horizontalPaddingPx = 24;
  const minSegmentPx = SEGMENT_MIN_WIDTH_REM * 16;
  const trackPaddingPx = 8;
  const gapPx = 2;
  const columns = (trackPx: number) =>
    Math.min(3, Math.floor((trackPx - trackPaddingPx + gapPx) / (minSegmentPx + gapPx)));

  assert.ok(urbanistLabelPx + horizontalPaddingPx <= minSegmentPx);
  assert.equal(columns(530), 3);
  assert.equal(columns(310), 2);
  console.log(
    `  Urbanist 14px RO label ${urbanistLabelPx}px + padding = ${urbanistLabelPx + horizontalPaddingPx}px; ` +
      `530px => 3 columns, 310px => 2+1`,
  );
});

test("live database badge is loud and never exposes credentials", () => {
  const url = "postgresql://secret-user:secret-pass@localhost:5432/financial_tracker";
  const info = getDevDatabaseBadgeInfo(url, "development");
  assert.deepEqual(info, { label: "DB: financial_tracker", isLive: true });
  const markup = renderToStaticMarkup(<DevDatabaseBadge databaseUrl={url} nodeEnv="development" />);
  assert.match(markup, /data-live="true"/);
  assert.match(markup, /bg-status-negative-fill/);
  assert.doesNotMatch(markup, /secret-user|secret-pass/);
});

test("non-local test database names host and uses quiet treatment", () => {
  const url = "postgresql://user:pass@db.internal:5433/financial_tracker_test";
  const info = getDevDatabaseBadgeInfo(url, "development");
  assert.deepEqual(info, {
    label: "DB: financial_tracker_test @ db.internal:5433",
    isLive: false,
  });
  const markup = renderToStaticMarkup(<DevDatabaseBadge databaseUrl={url} nodeEnv="development" />);
  assert.match(markup, /data-live="false"/);
  assert.match(markup, /bg-surface-inactive/);
});

test("production renders no database badge", () => {
  assert.equal(getDevDatabaseBadgeInfo("postgresql://user:pass@db/live", "production"), null);
  assert.equal(
    renderToStaticMarkup(
      <DevDatabaseBadge databaseUrl="postgresql://user:pass@db/live" nodeEnv="production" />,
    ),
    "",
  );
});

console.log(`\n${passed} tests passed`);
