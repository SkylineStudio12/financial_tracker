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
    console.log(
      `Backfilled ${from}..${to}: ${result.bankingDays} banking days, ${result.upserted} rates upserted.`,
    );
  } else {
    const result = await syncLatestRates();
    console.log(`Synced latest BNR rates for ${result.date}: ${result.upserted} rates upserted.`);
  }
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    return pool.end();
  });
