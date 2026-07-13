/** Shared-dev-DB test: every fixture is enclosed in a forced rollback. */
import "dotenv/config";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { priceSnapshots, securities, securityPriceMappings } from "@/db/schema";
import { upsertPriceSnapshot } from "./prices";

const ROLLBACK = Symbol("price-sync-test-rollback");
let checks = 0;
function ok(name: string) {
  checks += 1;
  console.log(`  ✓ ${name}`);
}

async function run() {
  try {
    await db.transaction(async (tx) => {
      const ticker = `P${Date.now().toString().slice(-8)}`;
      const [security] = await tx
        .insert(securities)
        .values({ ticker, name: "Price policy fixture", currency: "USD" })
        .returning({ id: securities.id });

      assert.equal(
        (await upsertPriceSnapshot(
          { securityId: security.id, date: "2026-07-01", priceMinor: 1_000, source: "stooq" },
          tx,
        )).action,
        "inserted",
      );
      assert.equal(
        (await upsertPriceSnapshot(
          { securityId: security.id, date: "2026-07-01", priceMinor: 1_100, source: "eodhd" },
          tx,
        )).action,
        "updated",
      );
      assert.equal(
        (await upsertPriceSnapshot(
          { securityId: security.id, date: "2026-07-01", priceMinor: 900, source: "stooq" },
          tx,
        )).action,
        "preserved_eodhd",
      );
      ok("EODHD supersedes Stooq; Stooq cannot replace EODHD");

      assert.equal(
        (await upsertPriceSnapshot(
          { securityId: security.id, date: "2026-07-01", priceMinor: 1_200, source: "manual" },
          tx,
        )).action,
        "updated",
      );
      assert.equal(
        (await upsertPriceSnapshot(
          { securityId: security.id, date: "2026-07-01", priceMinor: 1_300, source: "eodhd" },
          tx,
        )).action,
        "preserved_manual",
      );
      const [manual] = await tx
        .select({ price: priceSnapshots.price, source: priceSnapshots.source, updatedAt: priceSnapshots.updatedAt })
        .from(priceSnapshots)
        .where(eq(priceSnapshots.securityId, security.id));
      assert.deepEqual({ price: manual.price, source: manual.source }, { price: 1_200, source: "manual" });
      ok("manual wins over both automated sources");

      assert.equal(
        (await upsertPriceSnapshot(
          { securityId: security.id, date: "2026-07-01", priceMinor: 1_200, source: "manual" },
          tx,
        )).action,
        "unchanged",
      );
      const [unchanged] = await tx
        .select({ updatedAt: priceSnapshots.updatedAt })
        .from(priceSnapshots)
        .where(eq(priceSnapshots.securityId, security.id));
      assert.equal(unchanged.updatedAt.getTime(), manual.updatedAt.getTime());
      ok("an identical rerun is semantically and temporally idempotent");

      assert.equal(
        (await upsertPriceSnapshot(
          { securityId: security.id, date: "2026-07-02", priceMinor: 1_400, source: "stooq" },
          tx,
        )).action,
        "inserted",
      );
      assert.equal(
        (await upsertPriceSnapshot(
          { securityId: security.id, date: "2026-07-02", priceMinor: 1_400, source: "stooq" },
          tx,
        )).action,
        "unchanged",
      );
      ok("a repeated Stooq backfill row is unchanged");

      const mapping = await tx
        .select({ id: securityPriceMappings.id })
        .from(securityPriceMappings)
        .where(eq(securityPriceMappings.securityId, security.id));
      assert.equal(mapping.length, 0);
      const snapshots = await tx
        .select({ date: priceSnapshots.date })
        .from(priceSnapshots)
        .where(eq(priceSnapshots.securityId, security.id));
      assert.deepEqual(snapshots.map((row) => row.date).sort(), ["2026-07-01", "2026-07-02"]);
      ok("an unmapped security receives no automated mapping or extra price rows");

      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

run()
  .then(() => console.log(`\nAll ${checks} price-sync database checks passed; fixture rolled back.`))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
