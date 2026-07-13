/** Read-only mandatory Stooq/EODHD overlap verification (12 API calls max). */
import "dotenv/config";
import { pool } from "@/db";
import { verifyMandatoryPriceSeam } from "@/lib/investments/price-seam";
import { buildStooqBackfillPlan } from "@/lib/investments/stooq";

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const directory = getArg("dir");
  const apiToken = process.env.EODHD_API_TOKEN;
  if (!directory) throw new Error("--dir is required");
  if (!apiToken) throw new Error("EODHD_API_TOKEN is not configured");

  const plan = await buildStooqBackfillPlan(directory);
  const report = await verifyMandatoryPriceSeam(plan, { apiToken });
  for (const check of report.checks) {
    console.log(
      `${check.ticker}: ${check.overlapDates.length}/3 overlap dates, ${check.exactDecimalMismatches.length} reported exact-decimal deviations, ${check.minorUnitMismatches.length} minor-unit mismatches`,
    );
    for (const mismatch of check.exactDecimalMismatches) {
      console.log(
        `  ${mismatch.date}: Stooq ${mismatch.stooq}, EODHD ${mismatch.eodhd}`,
      );
    }
    if (check.error) console.log(`  ERROR: ${check.error}`);
  }
  console.log(`Calls used: ${report.callsUsed}/20`);
  console.log(
    `Mandatory files unavailable: ${report.mandatoryMissing.length === 0 ? "none" : report.mandatoryMissing.join(", ")}`,
  );
  console.log(`Stored-minor-unit seam: ${report.passed ? "PASS" : "FAIL"}`);
  if (!report.passed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
