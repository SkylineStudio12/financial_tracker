/**
 * MONEY-GRADE valuation suite (Phase 4 Stage 4). Trades precede the VALUATION
 * date, a real 2026 banking-day range date, so resolveRonRate resolves OFFLINE from the
 * locally-synced fx_rates — the expected RON figures are computed in the
 * test from the SAME resolved rate, so assertions are exact and
 * rate-agnostic.
 * Run: npx tsx src/lib/investments/valuation.money.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { db, pool } from "@/db";
import { priceSnapshots, securities } from "@/db/schema";
import { convertMinorToRon, getEarliestPairedRateDate, resolveRonRate } from "@/lib/fx";
import { LedgerValidationError } from "@/lib/ledger";
import { executeTrade } from "./service";
import { valueAtPrice } from "./trade-rules";
import { valueHoldings } from "./valuation";
import { setupTradeTestEntity, teardownTradeTestEntity, type TradeTestEnv } from "./test-support";

const VAL_DATE = "2026-06-15";

let checks = 0;
function ok(name: string) {
  checks += 1;
  console.log(`  ✓ ${name}`);
}

const extraSecurities: string[] = [];
async function newSecurity(ticker: string) {
  const [s] = await db
    .insert(securities)
    .values({ ticker: `${ticker}${Date.now() % 100_000}`, name: ticker, currency: "USD" })
    .returning();
  extraSecurities.push(s.id);
  return s.id;
}

async function run(env: TradeTestEnv) {
  const buyBase = {
    kind: "buy" as const,
    accountId: env.cashAccountId,
    positionAccountId: env.positionAccountId,
    securityId: env.securityId,
  };
  const rate = (await resolveRonRate(VAL_DATE, "USD")).rate;

  // Worked-example remainder: lots 10@$100(460 RON) + 10@$120(612 RON),
  // sell 15 → open 5 shares, basis $60.00 / 306.00 RON.
  await executeTrade({ ...buyBase, date: "2025-03-03", quantity: "10", priceMinor: 1000, totalMinor: 10_000, totalRonMinor: 46_000 });
  await executeTrade({ ...buyBase, date: "2025-04-09", quantity: "10", priceMinor: 1200, totalMinor: 12_000, totalRonMinor: 61_200 });
  await executeTrade({
    kind: "sell", accountId: env.cashAccountId, securityId: env.securityId,
    date: "2025-06-05", quantity: "15", priceMinor: 1500, totalMinor: 22_500, totalRonMinor: 112_500,
  });
  await db.insert(priceSnapshots).values({ securityId: env.securityId, date: VAL_DATE, price: 1_600 });

  // Fractional holding on a second security: 1.5 shares, price 333 →
  // value 499.5 rounds HALF-UP to 500 (single final rounding).
  const fracSec = await newSecurity("FRC");
  await executeTrade({
    ...buyBase, securityId: fracSec, date: "2025-02-01", quantity: "1.5", priceMinor: 300, totalMinor: 450, totalRonMinor: 2_070,
  });
  await db.insert(priceSnapshots).values({ securityId: fracSec, date: VAL_DATE, price: 333 });

  // Stale-priced holding: only snapshot is 10 days before the valuation date.
  const staleSec = await newSecurity("STL");
  await executeTrade({
    ...buyBase, securityId: staleSec, date: "2025-02-02", quantity: "2", priceMinor: 500, totalMinor: 1_000, totalRonMinor: 4_600,
  });
  await db.insert(priceSnapshots).values({ securityId: staleSec, date: "2026-06-05", price: 700 });

  // Unpriced holding: no snapshot at all.
  const nakedSec = await newSecurity("NKD");
  await executeTrade({
    ...buyBase, securityId: nakedSec, date: "2025-02-03", quantity: "3", priceMinor: 200, totalMinor: 600, totalRonMinor: 2_760,
  });

  const result = await valueHoldings({ entityId: env.entityId, date: VAL_DATE });
  assert.equal(result.holdings.length, 4);
  const byId = new Map(result.holdings.map((h) => [h.securityId, h]));

  // ------------------------- 1. Worked-example holding, exact both currencies
  const main = byId.get(env.securityId)!;
  assert.equal(main.quantity, "5.00000000");
  assert.deepEqual([main.basisMinor, main.basisRonMinor], [6_000, 30_600]);
  assert.deepEqual(main.price, { priceMinor: 1_600, priceDate: VAL_DATE, stale: false });
  assert.equal(main.valueMinor, 8_000); // 5 × $16.00
  const expectedMainRon = convertMinorToRon(8_000, rate);
  assert.equal(main.valueRonMinor, expectedMainRon);
  assert.equal(main.unrealizedMinor, 2_000); // $80 − $60
  assert.equal(main.unrealizedRonMinor, expectedMainRon - 30_600);
  ok("worked-example remainder valued exactly: $80.00 at the resolved rate, unrealized +$20.00 / RON delta");

  // -------------------------------- 2. Fractional rounding: single half-up
  const frac = byId.get(fracSec)!;
  assert.equal(frac.valueMinor, 500); // 333 × 1.5 = 499.5 → 500
  assert.equal(valueAtPrice(333, 150_000_000n), 500);
  assert.equal(frac.valueRonMinor, convertMinorToRon(500, rate));
  ok("price × fractional quantity rounds half-up ONCE at the end (499.5 → 500)");

  // ------------------------------------------- 3. Stale price is flagged
  const stale = byId.get(staleSec)!;
  assert.ok(stale.price);
  assert.equal(stale.price!.priceDate, "2026-06-05");
  assert.equal(stale.price!.stale, true); // 10 days > 7-day tolerance
  assert.equal(stale.valueMinor, valueAtPrice(700, 200_000_000n));
  ok("a 10-day-old price still values the holding but carries the stale flag + its real date");

  // -------------------------- 4. Unpriced holding excluded, never zeroed
  const naked = byId.get(nakedSec)!;
  assert.equal(naked.price, null);
  assert.equal(naked.valueMinor, null);
  assert.equal(naked.unrealizedRonMinor, null);
  assert.equal(result.totals.unpricedCount, 1);
  assert.equal(
    result.totals.basisRonMinor - result.totals.valuedBasisRonMinor,
    naked.basisRonMinor,
  );
  ok("no snapshot → not valued (null, not zero); totals exclude it and count it");

  // ----------------------------------------- 5. Totals conserve exactly
  const priced = result.holdings.filter((h) => h.valueRonMinor !== null);
  assert.equal(
    result.totals.valueRonMinor,
    priced.reduce((s, h) => s + h.valueRonMinor!, 0),
  );
  assert.equal(
    result.totals.unrealizedRonMinor,
    result.totals.valueRonMinor - result.totals.valuedBasisRonMinor,
  );
  ok("totals equal the sum of priced holdings to the ban; unrealized = value − valued basis");

  // ------------------------------------------ 6. Date range: hard reject
  const fxFloor = await getEarliestPairedRateDate();
  assert.equal(fxFloor, "2024-01-03");
  const beforeFxFloor = new Date(`${fxFloor}T00:00:00Z`);
  beforeFxFloor.setUTCDate(beforeFxFloor.getUTCDate() - 1);
  const unsupportedDate = beforeFxFloor.toISOString().slice(0, 10);
  await assert.rejects(
    valueHoldings({ entityId: env.entityId, date: unsupportedDate }),
    (e) =>
      e instanceof LedgerValidationError &&
      e.code === "investments.valuationDateOutOfRange" &&
      e.params?.date === unsupportedDate &&
      e.params?.floor === fxFloor,
  );
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await assert.rejects(
    valueHoldings({ entityId: env.entityId, date: tomorrow }),
    (e) =>
      e instanceof LedgerValidationError &&
      e.code === "investments.valuationDateOutOfRange" &&
      e.params?.date === tomorrow,
  );
  ok("valuation dates before the FX floor or in the future are rejected loudly");
}

async function main() {
  const env = await setupTradeTestEntity();
  try {
    await run(env);
    console.log(`\nAll ${checks} valuation money-grade checks passed.`);
  } finally {
    const secIds = [env.securityId, ...extraSecurities];
    await db.delete(priceSnapshots).where(inArray(priceSnapshots.securityId, secIds));
    await teardownTradeTestEntity(env);
    if (extraSecurities.length > 0) {
      await db.delete(securities).where(inArray(securities.id, extraSecurities));
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
