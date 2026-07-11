import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyRevolutType,
  convertForeignMinorToRon,
  parseRevolutCsv,
  RevolutParseError,
} from "./parse";
import { countRevolutTypes, pairDividendTaxCorrections, simulateRevolut } from "./simulate";

const fixturePath = join(process.cwd(), "fixtures", "revolut", "All_stock_transactions.csv");
const fixture = readFileSync(fixturePath, "utf8");
const rows = parseRevolutCsv(fixture);

let checks = 0;
function ok(name: string, check: () => void) {
  check();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

ok("291 rows and the hand-tallied Type counts match exactly", () => {
  assert.equal(rows.length, 291);
  assert.deepEqual(countRevolutTypes(rows), {
    "BUY - MARKET": 72,
    "SELL - MARKET": 1,
    "CASH TOP-UP": 45,
    "CASH WITHDRAWAL": 2,
    "CUSTODY FEE": 2,
    DIVIDEND: 160,
    "DIVIDEND TAX (CORRECTION)": 6,
    "STOCK SPLIT": 3,
  });
});

ok("classification is a Type mapping, independent of ticker heuristics", () => {
  assert.equal(classifyRevolutType("CASH TOP-UP"), "cash_top_up");
  assert.equal(classifyRevolutType("DIVIDEND TAX (CORRECTION)"), "dividend_tax_correction");
  assert.equal(classifyRevolutType("STOCK SPLIT"), "stock_split");
});

ok("millisecond and microsecond UTC timestamps are both preserved", () => {
  assert.ok(rows.some((row) => /\.\d{3}Z$/.test(row.timestamp)));
  assert.ok(rows.some((row) => /\.\d{6}Z$/.test(row.timestamp)));
});

ok("inverse FX conversion fixtures round half up to the ban", () => {
  assert.equal(convertForeignMinorToRon(515_633, "0.2211"), 2_332_126);
  assert.equal(convertForeignMinorToRon(45_497, "0.2016"), 225_680);
  assert.equal(convertForeignMinorToRon(250_000, "0.1913"), 1_306_848);
  assert.equal(convertForeignMinorToRon(-45_497, "0.2016"), -225_680);
});

const simulation = simulateRevolut(rows);

ok("all three stock splits derive the approved integer ratios", () => {
  assert.deepEqual(
    simulation.splitChecks.map(({ timestamp, ticker, heldBefore, delta, ratio, passed }) => ({
      date: timestamp.slice(0, 10),
      ticker,
      heldBefore,
      delta,
      ratio,
      passed,
    })),
    [
      { date: "2024-06-10", ticker: "NVDA", heldBefore: "0.55198522", delta: "4.96786698", ratio: 10, passed: true },
      { date: "2025-11-17", ticker: "NFLX", heldBefore: "1.11065305", delta: "9.99587745", ratio: 10, passed: true },
      { date: "2025-12-18", ticker: "NOW", heldBefore: "0.27750355", delta: "1.1100142", ratio: 5, passed: true },
    ],
  );
});

ok("PLTR sell consumes exactly the two approved lots and fully closes", () => {
  const sell = simulation.sells.find((row) => row.timestamp.startsWith("2025-01-02"));
  assert.ok(sell);
  assert.equal(sell.ticker, "PLTR");
  assert.equal(sell.quantity, "21.84740239");
  assert.deepEqual(sell.consumptions.map((slice) => slice.quantity), ["11.75591016", "10.09149223"]);
  assert.equal(sell.remainingPosition, "0");
});

ok("PLTR position reopens after the full liquidation", () => {
  const reopened = rows.find(
    (row) => row.ticker === "PLTR" && row.kind === "buy" && row.timestamp.startsWith("2026-06-30"),
  );
  assert.equal(reopened?.quantityText, "4.32375317");
  assert.equal(simulation.holdings.PLTR, "4.32375317");
});

ok("three correction pairs net to zero within 60 seconds", () => {
  assert.deepEqual(
    simulation.corrections.pairs.map(({ ticker, amountMinor }) => ({ ticker, amountMinor })),
    [
      { ticker: "AMAT", amountMinor: 3 },
      { ticker: "XOM", amountMinor: 9 },
      { ticker: "MSFT", amountMinor: 18 },
    ],
  );
  assert.equal(simulation.corrections.unpaired.length, 0);
});

ok("a correction without its twin is surfaced as an anomaly", () => {
  const firstPair = simulation.corrections.pairs[0];
  const withoutTwin = rows.filter((row) => row.lineNo !== firstPair.secondLineNo);
  const pairing = pairDividendTaxCorrections(withoutTwin);
  assert.equal(pairing.pairs.length, 2);
  assert.equal(pairing.unpaired.length, 1);
  assert.equal(pairing.unpaired[0].lineNo, firstPair.firstLineNo);
});

ok("content and semantic identities are stored on every parsed row", () => {
  assert.ok(rows.every((row) => /^[0-9a-f]{64}$/.test(row.contentHash)));
  assert.ok(rows.every((row) => row.semanticKey.length > 0));
});

ok("duplicate content hashes inside one batch fail loudly", () => {
  const lines = fixture.trimEnd().split("\n");
  const duplicated = `${lines.join("\n")}\n${lines.at(-1)}\n`;
  assert.throws(
    () => parseRevolutCsv(duplicated),
    (error: unknown) =>
      error instanceof RevolutParseError && /Duplicate content hash within batch/.test(error.message),
  );
});

console.log(`\nAll ${checks} Revolut parser/simulation checks passed.`);
