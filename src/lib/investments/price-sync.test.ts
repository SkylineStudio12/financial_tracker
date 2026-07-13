import "dotenv/config";
import assert from "node:assert/strict";
import {
  assessEodhdSeries,
  buildEodhdQueue,
  parseEodhdResponse,
  writeAssessedEodhdRows,
} from "./eodhd";
import { providerMappings, VERIFIED_PRICE_MAPPINGS } from "./price-mappings";
import { verifyMandatoryPriceSeam } from "./price-seam";
import {
  MANDATORY_BACKFILL_TICKERS,
  parseStooqCsv,
  splitFactorForDate,
  StooqParseError,
  type StooqBackfillPlan,
  unadjustStooqClose,
} from "./stooq";

let checks = 0;
async function ok(name: string, check: () => void | Promise<void>) {
  await check();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
await ok("the registry has 47 securities and 94 unique provider mappings", () => {
  assert.equal(VERIFIED_PRICE_MAPPINGS.length, 47);
  const mappings = providerMappings();
  assert.equal(mappings.length, 94);
  assert.equal(new Set(mappings.map((row) => `${row.provider}:${row.symbol}`)).size, 94);
  assert.equal(new Set(mappings.map((row) => `${row.ticker}:${row.provider}`)).size, 94);
  assert.ok(
    VERIFIED_PRICE_MAPPINGS.every((row) =>
      row.currency === "EUR"
        ? row.eodhd.endsWith(".XETRA") && row.stooq.endsWith(".de")
        : row.eodhd.endsWith(".US") && row.stooq.endsWith(".us"),
    ),
  );
});

const nowFixture = `Date,Open,High,Low,Close,Volume
2025-12-11,170,175,169,173.498,100
2025-12-12,170,175,169,173.012,100
2025-12-15,150,155,149,153.040,100
2025-12-16,154,158,153,156.224,100
2025-12-17,154,158,153,156.478,100
2025-12-18,150,155,149,153.38,500
`;

await ok("NOW Stooq closes un-adjust to all five exact EODHD raw fixtures", () => {
  const expected = ["867.49", "865.06", "765.2", "781.12", "782.39"];
  const rows = parseStooqCsv(nowFixture).slice(0, 5);
  assert.deepEqual(rows.map((row) => unadjustStooqClose(row.close, 5).rawClose), expected);
  assert.deepEqual(rows.map((row) => unadjustStooqClose(row.close, 5).priceMinor), [
    86_749,
    86_506,
    76_520,
    78_112,
    78_239,
  ]);
});

await ok("split factors are strict-before and compound across later splits", () => {
  const splits = [
    { date: "2024-06-10", ratio: 10 },
    { date: "2025-12-18", ratio: 5 },
  ];
  assert.equal(splitFactorForDate("2024-06-09", splits), 50);
  assert.equal(splitFactorForDate("2024-06-10", splits), 5);
  assert.equal(splitFactorForDate("2025-12-17", splits), 5);
  assert.equal(splitFactorForDate("2025-12-18", splits), 1);
});

await ok("decimal conversion applies factors before one positive half-up rounding", () => {
  assert.deepEqual(unadjustStooqClose("1.2345", 5), { rawClose: "6.1725", priceMinor: 617 });
  assert.deepEqual(unadjustStooqClose("1.235", 1), { rawClose: "1.235", priceMinor: 124 });
});

await ok("Stooq parser rejects a malformed or truncated row as a whole file", () => {
  assert.throws(
    () => parseStooqCsv("Date,Open,High,Low,Close,Volume\n2026-01-02,1,2,1,2\n"),
    (error: unknown) => error instanceof StooqParseError && /expected 6 fields/.test(error.message),
  );
});

await ok("EODHD uses raw close, not adjusted_close, and rounds USD/EUR exactly", () => {
  const rows = parseEodhdResponse(
    JSON.stringify([
      { date: "2026-07-10", close: 58.14, adjusted_close: 1.23 },
      { date: "2026-07-11", close: "315.32", adjusted_close: 2.34 },
    ]),
  );
  assert.deepEqual(rows.map((row) => row.priceMinor), [5_814, 31_532]);
});

await ok("a suspected unbooked split quarantines before any writer call", async () => {
  const assessment = assessEodhdSeries(
    [{ date: "2026-07-11", close: "20", priceMinor: 2_000 }],
    { date: "2026-07-10", priceMinor: 10_000 },
    [],
  );
  assert.equal(assessment.status, "quarantined");
  let writes = 0;
  const result = await writeAssessedEodhdRows(assessment, async () => {
    writes += 1;
    return { action: "inserted" };
  });
  assert.equal(writes, 0);
  assert.equal(result.written, 0);
});

await ok("a matching booked split permits the same raw-close discontinuity", () => {
  const assessment = assessEodhdSeries(
    [{ date: "2026-07-11", close: "20", priceMinor: 2_000 }],
    { date: "2026-07-10", priceMinor: 10_000 },
    ["2026-07-11"],
  );
  assert.equal(assessment.status, "ready");
});

await ok("an unmapped held security is reported and never enters the fetch queue", () => {
  const queue = buildEodhdQueue(
    [
      { id: "mapped", ticker: "AAPL", currency: "USD" },
      { id: "unmapped", ticker: "TEST", currency: "USD" },
    ],
    [{ securityId: "mapped", symbol: "AAPL.US" }],
    new Map(),
    20,
  );
  assert.deepEqual(queue.candidates.map((item) => item.ticker), ["AAPL"]);
  assert.deepEqual(queue.unmapped, ["TEST"]);
});

await ok("a ticker already priced today does not consume a daily API call", () => {
  const queue = buildEodhdQueue(
    [
      { id: "current", ticker: "AAPL", currency: "USD" },
      { id: "stale", ticker: "BMW", currency: "EUR" },
    ],
    [
      { securityId: "current", symbol: "AAPL.US" },
      { securityId: "stale", symbol: "BMW.XETRA" },
    ],
    new Map([
      ["current", { date: "2026-07-13", priceMinor: 1, source: "eodhd" }],
      ["stale", { date: "2026-07-10", priceMinor: 1, source: "eodhd" }],
    ]),
    20,
    "2026-07-13",
  );
  assert.deepEqual(queue.candidates.map((item) => item.ticker), ["BMW"]);
});

await ok("write-gate seam stops before API calls when a mandatory file is missing", async () => {
  let calls = 0;
  const plan: StooqBackfillPlan = {
    directory: "/fixture",
    generatedAt: "2026-07-13T00:00:00Z",
    hash: "missing-plan",
    items: [],
    unmapped: [],
  };
  const report = await verifyMandatoryPriceSeam(plan, {
    apiToken: "fixture",
    fetchSeries: async () => {
      calls += 1;
      return [];
    },
    eodhdSymbols: new Map(),
  });
  assert.equal(report.passed, false);
  assert.equal(report.mandatoryMissing.length, MANDATORY_BACKFILL_TICKERS.length);
  assert.equal(calls, 0);
});

await ok("raw-decimal deviations pass when all stored minor units match", async () => {
  const dates = ["2026-07-08", "2026-07-09", "2026-07-10"];
  const items: StooqBackfillPlan["items"] = MANDATORY_BACKFILL_TICKERS.map(
    (ticker, index) => ({
      securityId: `security-${index}`,
      ticker,
      currency: ticker === "NVDA" || ticker === "NFLX" ? "USD" : "EUR",
      symbol: `${ticker.toLowerCase()}.${ticker === "NVDA" || ticker === "NFLX" ? "us" : "de"}`,
      filePath: `/fixture/${ticker}.csv`,
      firstTradeDate: dates[0],
      status: "ready" as const,
      firstAvailableDate: dates[0],
      lastAvailableDate: dates[2],
      rows: dates.map((date, dateIndex) => ({
        date,
        close: dateIndex === 2 && index === 0 ? "10.005" : "10.01",
        factor: 1,
        rawClose: dateIndex === 2 && index === 0 ? "10.005" : "10.01",
        priceMinor: 1_001,
      })),
      samples: [],
      splitFactors: [],
      warnings: [],
      fileBytes: 1,
      fileHash: `hash-${index}`,
    }),
  );
  const plan: StooqBackfillPlan = {
    directory: "/fixture",
    generatedAt: "2026-07-13T00:00:00Z",
    hash: "complete-plan",
    items,
    unmapped: [],
  };
  const symbols = new Map(items.map((item) => [item.securityId, `${item.ticker}.TEST`]));
  const report = await verifyMandatoryPriceSeam(plan, {
    apiToken: "fixture",
    eodhdSymbols: symbols,
    fetchSeries: async () =>
      dates.map((date) => ({ date, close: "10.01", priceMinor: 1_001 })),
  });
  assert.equal(report.passed, true);
  assert.equal(report.callsUsed, MANDATORY_BACKFILL_TICKERS.length);
  assert.equal(report.minorMismatchCount, 0);
  assert.equal(
    report.checks.reduce((sum, check) => sum + check.exactDecimalMismatches.length, 0),
    1,
  );
});

console.log(`\nAll ${checks} price-sync pure checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
