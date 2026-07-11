import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRevolutCsv, REVOLUT_TYPES, type RevolutType } from "./parse";
import { countRevolutTypes, simulateRevolut } from "./simulate";

const EXPECTED_COUNTS: Record<RevolutType, number> = {
  "BUY - MARKET": 72,
  "SELL - MARKET": 1,
  "CASH TOP-UP": 45,
  "CASH WITHDRAWAL": 2,
  "CUSTODY FEE": 2,
  DIVIDEND: 160,
  "DIVIDEND TAX (CORRECTION)": 6,
  "STOCK SPLIT": 3,
};

function formatMinor(minor: number, currency: string): string {
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  return `${sign}${Math.floor(absolute / 100).toLocaleString("en-US")}.${String(absolute % 100).padStart(2, "0")} ${currency}`;
}

const fixturePath = join(process.cwd(), "fixtures", "revolut", "All_stock_transactions.csv");
const rows = parseRevolutCsv(readFileSync(fixturePath, "utf8"));
const actualCounts = countRevolutTypes(rows);
const simulation = simulateRevolut(rows);
const countChecks = Object.fromEntries(
  REVOLUT_TYPES.map((type) => [
    type,
    { expected: EXPECTED_COUNTS[type], actual: actualCounts[type], passed: actualCounts[type] === EXPECTED_COUNTS[type] },
  ]),
);

const report = {
  source: "fixtures/revolut/All_stock_transactions.csv",
  parsedRows: rows.length,
  counts: countChecks,
  buyResiduals: simulation.buyResiduals,
  endState: {
    cashMinor: simulation.cashMinor,
    holdings: simulation.holdings,
  },
  splitChecks: simulation.splitChecks,
  correctionPairs: simulation.corrections.pairs,
  unpairedCorrections: simulation.corrections.unpaired.map((row) => ({
    lineNo: row.lineNo,
    timestamp: row.timestamp,
    ticker: row.ticker,
    amountMinor: row.totalMinor,
    currency: row.currency,
  })),
};

console.log("Revolut brokerage verification");
console.log(`Rows: ${rows.length}/291 ${rows.length === 291 ? "PASS" : "FAIL"}`);
for (const type of REVOLUT_TYPES) {
  const check = countChecks[type];
  console.log(`  ${type}: ${check.actual}/${check.expected} ${check.passed ? "PASS" : "FAIL"}`);
}
console.log("Buy residuals (total minus rounded quantity × price, minor units):");
for (const group of simulation.buyResiduals) {
  console.log(
    `  ${group.group}: n=${group.count}, min=${group.minMinor}, p50=${group.p50Minor}, p95=${group.p95Minor}, max=${group.maxMinor}, mean=${group.meanMinor}`,
  );
}
console.log(
  `End cash: ${formatMinor(simulation.cashMinor.USD, "USD")}; ${formatMinor(simulation.cashMinor.EUR, "EUR")}`,
);
console.log(`End holdings: ${Object.keys(simulation.holdings).length} tickers`);
for (const [ticker, quantity] of Object.entries(simulation.holdings)) console.log(`  ${ticker}: ${quantity}`);
for (const split of simulation.splitChecks) {
  console.log(`Split ${split.ticker} ${split.timestamp.slice(0, 10)}: ratio ${split.ratio ?? "non-integer"} ${split.passed ? "PASS" : "FAIL"}`);
}
console.log(`Correction pairs: ${simulation.corrections.pairs.length}; unpaired: ${simulation.corrections.unpaired.length}`);
console.log("\nJSON");
console.log(JSON.stringify(report, null, 2));
