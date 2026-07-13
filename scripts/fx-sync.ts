/**
 * Manual FX sync trigger (no scheduler in this phase).
 *
 *   npm run fx:sync                                     sync latest banking day
 *   npm run fx:sync -- --from 2026-01-01 --to 2026-06-30   backfill a range
 */
import "dotenv/config";
import { pool } from "@/db";
import { backfillRange, syncLatestRates } from "@/lib/fx";

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function main() {
  const from = getArg("from");
  const to = getArg("to");

  if (from || to) {
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      throw new Error("Backfill needs both --from and --to as YYYY-MM-DD");
    }
    const result = await backfillRange(from, to);
    console.log(`Backfilled ${from}..${to}:`);
    console.log(
      `  coverage ${result.firstDate}..${result.lastDate}: ${result.bankingDays} banking days, ${result.storedRows} paired rows`,
    );
    console.log(
      `  writes: ${result.inserted} inserted, ${result.existing} existing, ${result.upserted} upserted`,
    );
    console.log(
      `  structure: ${result.oneSidedDates} one-sided dates, maximum gap ${result.maxGapDays} days`,
    );
    console.log(`  overwrite delta: ${result.overwriteDeltaCount} changed rates`);
    for (const delta of result.overwriteDeltas) {
      console.log(`    ${delta.date} ${delta.currency}: ${delta.before} -> ${delta.after}`);
    }
    console.log(`  fixtures: ${result.fixtures.length} exact matches`);
    for (const fixture of result.fixtures) {
      console.log(
        `    ${fixture.date} ${fixture.currency}: expected ${fixture.expected}, stored ${fixture.actual}`,
      );
    }
  } else {
    const result = await syncLatestRates();
    console.log(
      `Synced latest BNR rates for ${result.date}: ${result.upserted} rates upserted, ${result.overwriteDeltaCount} overwrite deltas.`,
    );
  }
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    return pool.end();
  });
