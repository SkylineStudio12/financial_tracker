import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRevolutCsv, REVOLUT_TYPES } from "./parse";
import { buildRevolutVerification } from "./report";

function formatMinor(minor: number, currency: string): string {
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  return `${sign}${Math.floor(absolute / 100).toLocaleString("en-US")}.${String(absolute % 100).padStart(2, "0")} ${currency}`;
}

const fixturePath = join(process.cwd(), "fixtures", "revolut", "All_stock_transactions.csv");
const rows = parseRevolutCsv(readFileSync(fixturePath, "utf8"));
const report = buildRevolutVerification(rows);

console.log("Revolut brokerage verification");
console.log(`Rows: ${report.parsedRows}/291 ${report.parsedRows === 291 ? "PASS" : "FAIL"}`);
for (const type of REVOLUT_TYPES) {
  const check = report.counts[type];
  console.log(`  ${type}: ${check.actual}/${check.expected} ${check.passed ? "PASS" : "FAIL"}`);
}
console.log("Buy residuals (total minus rounded quantity × price, minor units):");
for (const group of report.buyResiduals) {
  console.log(
    `  ${group.group}: n=${group.count}, min=${group.minMinor}, p50=${group.p50Minor}, p95=${group.p95Minor}, max=${group.maxMinor}, mean=${group.meanMinor}`,
  );
}
console.log(
  `End cash: ${formatMinor(report.endState.cashMinor.USD, "USD")}; ${formatMinor(report.endState.cashMinor.EUR, "EUR")}`,
);
console.log(`End holdings: ${Object.keys(report.endState.holdings).length} tickers`);
for (const [ticker, quantity] of Object.entries(report.endState.holdings)) console.log(`  ${ticker}: ${quantity}`);
for (const split of report.splitChecks) {
  console.log(`Split ${split.ticker} ${split.timestamp.slice(0, 10)}: ratio ${split.ratio ?? "non-integer"} ${split.passed ? "PASS" : "FAIL"}`);
}
console.log(`Correction pairs: ${report.correctionPairs.length}; unpaired: ${report.unpairedCorrections.length}`);
console.log("\nJSON");
console.log(JSON.stringify(report, null, 2));
