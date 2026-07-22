import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  ImportBatchSections,
  partitionImportBatches,
  type ImportBatchSummary,
} from "../src/components/import/import-batch-sections";

const messages = JSON.parse(readFileSync("messages/en.json", "utf8"));
let passed = 0;

function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function batch(id: string, pendingCount: number, createdAt: string): ImportBatchSummary {
  return {
    id,
    statementNumber: `Nr.${id}`,
    accountName: "ING RON",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    createdAt: new Date(createdAt),
    pendingCount,
    rowCount: 17,
  };
}

function render(batches: ImportBatchSummary[]) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} onError={() => {}}>
      <ImportBatchSections profileSlug="skyline" batches={batches} />
    </NextIntlClientProvider>,
  );
}

test("zero pending renders the empty-first state with no empty table or zero header", () => {
  const markup = render([]);
  assert.match(markup, /data-testid="import-empty-state"/);
  assert.match(markup, /Nothing awaiting review/);
  assert.match(markup, /Booked and skipped batches are kept below/);
  assert.doesNotMatch(markup, /<table|Pending \(0\)|Needs review/);
});

test("pending batches are oldest-first and closed batches are separated", () => {
  const newestPending = batch("3", 2, "2026-07-03T00:00:00Z");
  const oldestPending = batch("1", 4, "2026-07-01T00:00:00Z");
  const closed = batch("2", 0, "2026-07-02T00:00:00Z");
  const partition = partitionImportBatches([newestPending, closed, oldestPending]);
  assert.deepEqual(partition.pending.map((item) => item.id), ["1", "3"]);
  assert.deepEqual(partition.closed.map((item) => item.id), ["2"]);

  const markup = render([newestPending, closed, oldestPending]);
  assert.match(markup, /data-testid="import-pending-batches"/);
  assert.match(markup, /Needs review/);
  assert.match(markup, /<details/);
  assert.doesNotMatch(markup, /<details[^>]* open/);
  assert.ok(markup.indexOf("Nr.1") < markup.indexOf("Nr.3"));
});

test("closed-only state composes empty hero with collapsed history", () => {
  const markup = render([batch("9", 0, "2026-07-09T00:00:00Z")]);
  assert.match(markup, /data-testid="import-empty-state"/);
  assert.match(markup, /Closed batches \(1\)/);
  assert.doesNotMatch(markup, /data-testid="import-pending-batches"/);
});

test("page keeps the import entry form before the inbox state", () => {
  const source = readFileSync("src/app/p/[profile]/imports/page.tsx", "utf8");
  assert.ok(source.indexOf("<ImportPasteForm") < source.indexOf("<ImportBatchSections"));
  assert.doesNotMatch(source, /<table/);
});

test("single-row UI keeps duplicates visible and links resolved rows", () => {
  const source = readFileSync("src/components/import/import-inbox.tsx", "utf8");
  assert.match(source, /row\.status === "duplicate"/);
  assert.match(source, /t\("alreadyImported"\)/);
  assert.match(source, /<TransactionLink/);
  assert.match(source, /data-row-status=\{row\.status\}/);
  assert.match(source, /row\.status === "skipped"/);
  assert.match(source, /reopenSkippedImportRowAction/);
  const bookedBlock = source.slice(
    source.indexOf('row.status === "booked"'),
    source.indexOf('row.status === "duplicate"'),
  );
  assert.doesNotMatch(bookedBlock, /reopen/);
});

test("write service owns the transitions and confirmation delegates to createTransaction", () => {
  const source = readFileSync("src/lib/import/service.ts", "utf8");
  assert.match(source, /buildImportTransactionInput\(/);
  assert.match(source, /createTransaction\(input, tx\)/);
  assert.match(source, /export async function assertImportRowScope/);
  assert.match(source, /skipReasonCode: null, skipReasonNote: note/);
  assert.match(source, /status: "pending", skipReasonCode: null, skipReasonNote: null/);
  assert.match(source, /eq\(importRows\.status, "skipped"\)/);
  assert.doesNotMatch(source, /insert\(transactions\)/);
});

test("new import-inbox catalog values are mirrored EN-for-EN into ro.json", () => {
  const en = JSON.parse(readFileSync("messages/en.json", "utf8")).imports;
  const ro = JSON.parse(readFileSync("messages/ro.json", "utf8")).imports;
  const keys = [
    "emptyTitle",
    "emptyBody",
    "needsReview",
    "closedBatches",
    "batchIdentity",
    "countPending",
    "countBooked",
    "countSkipped",
    "countDuplicates",
    "reconciliation",
    "progress",
    "confirm",
    "skipEllipsis",
    "reopen",
    "suggested",
    "bookedStatus",
    "skippedStatus",
    "skippedWithNote",
    "alreadyImported",
    "viewTransaction",
    "skipTitle",
    "skipDescription",
    "skipNoteLabel",
    "skipNotePlaceholder",
    "cancel",
    "counterpartyUnavailable",
    "rowDetails",
    "detailCounterpartyIban",
    "detailDescription",
    "detailBankReference",
    "detailInternalReference",
    "detailInstantReference",
    "detailResolvedReference",
    "detailRawLines",
    "balanceAfter",
  ];
  for (const key of keys) assert.equal(ro[key], en[key], key);
  assert.equal(ro.status.trashed, en.status.trashed);
  assert.equal(ro.status.purged, en.status.purged);
});

console.log(`\n${passed} import-inbox component checks passed`);
