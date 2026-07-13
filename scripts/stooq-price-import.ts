/**
 * Owner-gated Stooq backfill.
 *
 * Dry-run (default):
 *   npm run prices:stooq -- --dir /absolute/path/to/Stooq
 *
 * Write exactly an approved dry-run plan:
 *   npm run prices:stooq -- --dir /absolute/path/to/Stooq --write --approved-plan <sha256>
 * Write mode also requires all 12 mandatory files and a live minor-unit seam pass.
 */
import "dotenv/config";
import { pool } from "@/db";
import { verifyMandatoryPriceSeam } from "@/lib/investments/price-seam";
import { applyStooqBackfillPlan, buildStooqBackfillPlan } from "@/lib/investments/stooq";

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function printPlan(plan: Awaited<ReturnType<typeof buildStooqBackfillPlan>>) {
  console.log(`Stooq backfill DRY-RUN: ${plan.directory}`);
  for (const item of plan.items) {
    if (item.status !== "ready") {
      console.log(
        `${item.ticker} ${item.symbol}: ${item.status.toUpperCase()} - ${item.reason} (${item.filePath})`,
      );
      continue;
    }
    console.log(
      `${item.ticker} ${item.symbol}: ${item.rows.length} rows, ${item.rows[0].date}..${item.rows.at(-1)!.date}; file ${item.firstAvailableDate}..${item.lastAvailableDate}, ${item.fileBytes} bytes`,
    );
    console.log(
      `  splits: ${item.splitFactors.length === 0 ? "none" : item.splitFactors.map((split) => `${split.date} x${split.ratio}`).join(", ")}`,
    );
    for (const sample of item.samples) {
      console.log(
        `  sample ${sample.date}: ${sample.sourceClose} x${sample.factor} = ${sample.rawClose} -> ${sample.priceMinor} minor`,
      );
    }
    for (const warning of item.warnings) console.log(`  WARNING: ${warning}`);
  }

  const ready = plan.items.filter((item) => item.status === "ready");
  const missing = plan.items.filter((item) => item.status === "missing");
  const errors = plan.items.filter((item) => item.status === "error");
  console.log(
    `Summary: ${ready.length} ready (${ready.reduce((sum, item) => sum + item.rows.length, 0)} rows), ${missing.length} missing, ${errors.length} errors.`,
  );
  console.log(`Missing: ${missing.length === 0 ? "none" : missing.map((item) => item.ticker).join(", ")}`);
  console.log(
    `Unmapped held securities: ${plan.unmapped.length === 0 ? "none" : plan.unmapped.map((item) => item.ticker).join(", ")}`,
  );
  console.log(`Plan hash: ${plan.hash}`);
  console.log("No price rows were written.");
}

async function main() {
  const directory = getArg("dir");
  if (!directory) throw new Error("--dir with an absolute Stooq folder is required");
  const plan = await buildStooqBackfillPlan(directory);
  const write = process.argv.includes("--write");
  if (!write) {
    printPlan(plan);
    return;
  }

  const approvedHash = getArg("approved-plan");
  if (!approvedHash) {
    throw new Error("Write mode requires --approved-plan with the owner-approved dry-run hash");
  }
  if (plan.hash !== approvedHash) {
    throw new Error(`Approved plan hash ${approvedHash} does not match current plan ${plan.hash}`);
  }
  const apiToken = process.env.EODHD_API_TOKEN;
  if (!apiToken) throw new Error("Write mode requires EODHD_API_TOKEN for the seam gate");
  const seam = await verifyMandatoryPriceSeam(plan, { apiToken });
  if (!seam.passed) {
    throw new Error(
      `Write gate failed: missing [${seam.mandatoryMissing.join(", ")}], minor-unit mismatches ${seam.minorMismatchCount}`,
    );
  }
  for (const check of seam.checks) {
    for (const mismatch of check.exactDecimalMismatches) {
      console.log(
        `Reported raw-decimal deviation ${check.ticker} ${mismatch.date}: Stooq ${mismatch.stooq}, EODHD ${mismatch.eodhd}`,
      );
    }
  }
  const results = await applyStooqBackfillPlan(plan, approvedHash, seam);
  for (const result of results) {
    console.log(`${result.ticker}: ${result.rows} rows ${JSON.stringify(result.actions)}`);
  }
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    return pool.end();
  });
