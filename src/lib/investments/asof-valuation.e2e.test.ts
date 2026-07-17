import "dotenv/config";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  stockSplitConsumptionAdjustments,
  stockSplitLotAdjustments,
} from "@/db/schema";
import { LedgerValidationError } from "@/lib/ledger";
import { requireTestDatabase } from "@/lib/test-database-sentinel";
import {
  executeStockSplit,
  executeTrade,
  formatQuantity,
  loadLots,
  loadLotsAsOf,
} from "./service";
import { setupTradeTestEntity, teardownTradeTestEntity, type TradeTestEnv } from "./test-support";
import { valueHoldings } from "./valuation";

let checks = 0;
function ok(name: string) {
  checks += 1;
  console.log(`  ✓ ${name}`);
}

async function withThrowawayEntity(run: (env: TradeTestEnv) => Promise<void>) {
  const env = await setupTradeTestEntity();
  try {
    await run(env);
  } finally {
    await teardownTradeTestEntity(env);
  }
}

async function bookBuy(env: TradeTestEnv, date: string, quantity: string) {
  return executeTrade({
    kind: "buy",
    accountId: env.cashAccountId,
    positionAccountId: env.positionAccountId,
    securityId: env.securityId,
    date,
    quantity,
    priceMinor: 100,
    totalMinor: 10_000,
    totalRonMinor: 46_000,
  });
}

async function quantityAt(env: TradeTestEnv, date: string): Promise<string | null> {
  const result = await valueHoldings({ entityId: env.entityId, date });
  return result.holdings.find((holding) => holding.securityId === env.securityId)?.quantity ?? null;
}

async function lotQuantitiesAt(env: TradeTestEnv, date: string) {
  const lots = await db.transaction((tx) =>
    loadLotsAsOf(tx, env.cashAccountId, env.securityId, date),
  );
  return lots.map((lot) => formatQuantity(lot.quantity));
}

interface SplitFixture {
  ticker: string;
  buyDates: string[];
  beforeQuantities: string[];
  afterQuantities: string[];
  aggregateBefore: string;
  aggregateAfter: string;
  splitTimestamp: string;
  dayBefore: string;
  splitDay: string;
  dayAfter: string;
  ratio: number;
  deltaQuantity: string;
}

const SPLIT_FIXTURES: SplitFixture[] = [
  {
    ticker: "NVDA",
    buyDates: ["2024-01-10"],
    beforeQuantities: ["0.55198522"],
    afterQuantities: ["5.51985220"],
    aggregateBefore: "0.55198522",
    aggregateAfter: "5.51985220",
    splitTimestamp: "2024-06-10T12:51:34.235141Z",
    dayBefore: "2024-06-09",
    splitDay: "2024-06-10",
    dayAfter: "2024-06-11",
    ratio: 10,
    deltaQuantity: "4.96786698",
  },
  {
    ticker: "NFLX",
    buyDates: ["2024-01-10", "2024-02-10", "2024-03-10"],
    beforeQuantities: ["0.41444286", "0.47116127", "0.22504892"],
    afterQuantities: ["4.14442860", "4.71161270", "2.25048920"],
    aggregateBefore: "1.11065305",
    aggregateAfter: "11.10653050",
    splitTimestamp: "2025-11-17T08:06:38.578397Z",
    dayBefore: "2025-11-16",
    splitDay: "2025-11-17",
    dayAfter: "2025-11-18",
    ratio: 10,
    deltaQuantity: "9.99587745",
  },
  {
    ticker: "NOW",
    buyDates: ["2025-01-10"],
    beforeQuantities: ["0.27750355"],
    afterQuantities: ["1.38751775"],
    aggregateBefore: "0.27750355",
    aggregateAfter: "1.38751775",
    splitTimestamp: "2025-12-18T09:16:28.623665Z",
    dayBefore: "2025-12-17",
    splitDay: "2025-12-18",
    dayAfter: "2025-12-19",
    ratio: 5,
    deltaQuantity: "1.11001420",
  },
];

async function verifySplitFixture(fixture: SplitFixture) {
  await withThrowawayEntity(async (env) => {
    for (const [index, quantity] of fixture.beforeQuantities.entries()) {
      await bookBuy(env, fixture.buyDates[index], quantity);
    }
    const split = await executeStockSplit({
      accountId: env.cashAccountId,
      securityId: env.securityId,
      occurredAt: fixture.splitTimestamp,
      ratio: fixture.ratio,
      deltaQuantity: fixture.deltaQuantity,
    });

    const adjustments = await db
      .select({
        before: stockSplitLotAdjustments.quantityBefore,
        after: stockSplitLotAdjustments.quantityAfter,
      })
      .from(stockSplitLotAdjustments)
      .where(eq(stockSplitLotAdjustments.splitId, split.splitId));
    const normalized = adjustments.sort((a, b) => a.before.localeCompare(b.before));
    const expected = fixture.beforeQuantities
      .map((before, index) => ({ before, after: fixture.afterQuantities[index] }))
      .sort((a, b) => a.before.localeCompare(b.before));
    assert.deepEqual(normalized, expected);

    assert.deepEqual(await lotQuantitiesAt(env, fixture.dayBefore), fixture.beforeQuantities);
    assert.deepEqual(await lotQuantitiesAt(env, fixture.splitDay), fixture.afterQuantities);
    assert.deepEqual(await lotQuantitiesAt(env, fixture.dayAfter), fixture.afterQuantities);
    assert.equal(await quantityAt(env, fixture.dayBefore), fixture.aggregateBefore);
    assert.equal(await quantityAt(env, fixture.splitDay), fixture.aggregateAfter);
    assert.equal(await quantityAt(env, fixture.dayAfter), fixture.aggregateAfter);

    const today = new Date().toISOString().slice(0, 10);
    const liveLots = await db.transaction((tx) =>
      loadLots(tx, env.cashAccountId, env.securityId),
    );
    const todayLots = await db.transaction((tx) =>
      loadLotsAsOf(tx, env.cashAccountId, env.securityId, today),
    );
    assert.deepEqual(todayLots, liveLots);
    ok(`${fixture.ticker} split boundary and today-state parity`);
  });
}

async function verifyConsumptionRollback() {
  await withThrowawayEntity(async (env) => {
    await bookBuy(env, "2024-01-10", "10");
    await executeTrade({
      kind: "sell",
      accountId: env.cashAccountId,
      securityId: env.securityId,
      date: "2024-02-01",
      quantity: "4",
      priceMinor: 200,
      totalMinor: 8_000,
      totalRonMinor: 36_800,
    });
    const split = await executeStockSplit({
      accountId: env.cashAccountId,
      securityId: env.securityId,
      occurredAt: "2024-03-01T12:00:00.000000Z",
      ratio: 2,
      deltaQuantity: "6",
    });

    const [consumptionAdjustment] = await db
      .select({
        before: stockSplitConsumptionAdjustments.quantityBefore,
        after: stockSplitConsumptionAdjustments.quantityAfter,
      })
      .from(stockSplitConsumptionAdjustments)
      .where(eq(stockSplitConsumptionAdjustments.splitId, split.splitId));
    assert.deepEqual(consumptionAdjustment, {
      before: "4.00000000",
      after: "8.00000000",
    });

    const [before] = await db.transaction((tx) =>
      loadLotsAsOf(tx, env.cashAccountId, env.securityId, "2024-02-29"),
    );
    const [after] = await db.transaction((tx) =>
      loadLotsAsOf(tx, env.cashAccountId, env.securityId, "2024-03-01"),
    );
    assert.deepEqual(
      [formatQuantity(before.quantity), formatQuantity(before.consumedQuantity)],
      ["10.00000000", "4.00000000"],
    );
    assert.deepEqual(
      [formatQuantity(after.quantity), formatQuantity(after.consumedQuantity)],
      ["20.00000000", "8.00000000"],
    );
    assert.equal(await quantityAt(env, "2024-02-29"), "6.00000000");
    assert.equal(await quantityAt(env, "2024-03-01"), "12.00000000");
    ok("lot and consumption quantities roll back together");
  });
}

async function verifyDatedSellsAndBounds() {
  await withThrowawayEntity(async (env) => {
    await bookBuy(env, "2024-01-10", "11.75591016");
    await bookBuy(env, "2024-08-12", "10.09149223");
    await executeTrade({
      kind: "sell",
      accountId: env.cashAccountId,
      securityId: env.securityId,
      date: "2025-01-02",
      quantity: "21.84740239",
      priceMinor: 200,
      totalMinor: 20_000,
      totalRonMinor: 92_000,
    });
    await bookBuy(env, "2026-06-30", "4.32375317");

    assert.equal(await quantityAt(env, "2024-09-01"), "21.84740239");
    assert.equal(await quantityAt(env, "2025-01-03"), null);

    const beforeFirstTrade = await valueHoldings({
      entityId: env.entityId,
      date: "2024-01-09",
    });
    assert.deepEqual(beforeFirstTrade.holdings, []);
    assert.deepEqual(beforeFirstTrade.totals, {
      basisRonMinor: 0,
      valuedBasisRonMinor: 0,
      valueRonMinor: 0,
      unrealizedRonMinor: 0,
      unpricedCount: 0,
    });

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await assert.rejects(
      valueHoldings({ entityId: env.entityId, date: tomorrow }),
      (error) =>
        error instanceof LedgerValidationError &&
        error.code === "investments.valuationDateOutOfRange" &&
        error.params?.date === tomorrow,
    );
    ok("dated sells, pre-first-trade emptiness, and future-date rejection");
  });
}

async function main() {
  if (!(await requireTestDatabase(pool, "as-of valuation"))) return;
  for (const fixture of SPLIT_FIXTURES) await verifySplitFixture(fixture);
  await verifyConsumptionRollback();
  await verifyDatedSellsAndBounds();
  console.log(`\nAll ${checks} as-of valuation fixture groups passed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
