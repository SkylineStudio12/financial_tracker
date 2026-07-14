import "dotenv/config";
import assert from "node:assert/strict";
import { db, pool } from "@/db";
import { fxRates } from "@/db/schema";

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL;
  assert.ok(raw, "DATABASE_URL is required");
  const databaseName = decodeURIComponent(new URL(raw).pathname.slice(1));
  assert.match(databaseName, /_test$/, "test FX fixtures refuse a database without an _test suffix");

  const rows: { date: string; currency: "EUR" | "USD"; rateToRon: string }[] = [];
  const cursor = new Date("2024-01-03T00:00:00Z");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  while (cursor <= today) {
    const date = cursor.toISOString().slice(0, 10);
    rows.push(
      { date, currency: "EUR", rateToRon: "5.000000" },
      { date, currency: "USD", rateToRon: "4.600000" },
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  await db.insert(fxRates).values(rows).onConflictDoNothing();
  console.log(`Test FX fixtures ready (${rows.length} paired rows).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
