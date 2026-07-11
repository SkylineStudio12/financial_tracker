import "dotenv/config";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { lotConsumptions, stockSplits, trades } from "@/db/schema";
import { executeStockSplit, executeTrade, loadLots } from "./service";
import { setupTradeTestEntity, teardownTradeTestEntity } from "./test-support";

async function run() {
  const env = await setupTradeTestEntity();
  try {
    const buy = await executeTrade({
      kind: "buy",
      accountId: env.cashAccountId,
      positionAccountId: env.positionAccountId,
      securityId: env.securityId,
      date: "2031-01-01",
      quantity: "10",
      priceMinor: 100,
      totalMinor: 1_000,
      totalRonMinor: 4_600,
    });
    const firstSell = await executeTrade({
      kind: "sell",
      accountId: env.cashAccountId,
      securityId: env.securityId,
      date: "2031-02-01",
      quantity: "4",
      priceMinor: 200,
      totalMinor: 800,
      totalRonMinor: 3_680,
    });
    const [beforeConsumption] = await db
      .select()
      .from(lotConsumptions)
      .where(eq(lotConsumptions.sellTradeId, firstSell.tradeId!));
    assert.equal(beforeConsumption.quantity, "4.00000000");
    assert.equal(beforeConsumption.costBasisMinor, 400);
    assert.equal(beforeConsumption.costBasisRonMinor, 1_840);

    const split = await executeStockSplit({
      accountId: env.cashAccountId,
      securityId: env.securityId,
      occurredAt: "2031-03-01T12:00:00.000000Z",
      ratio: 2,
      deltaQuantity: "6",
    });
    const [splitRow] = await db.select().from(stockSplits).where(eq(stockSplits.id, split.splitId));
    assert.equal(splitRow.ratio, 2);
    const [buyAfter] = await db.select().from(trades).where(eq(trades.id, buy.tradeId!));
    const [consumptionAfter] = await db
      .select()
      .from(lotConsumptions)
      .where(eq(lotConsumptions.id, beforeConsumption.id));
    assert.equal(buyAfter.quantity, "20.00000000");
    assert.equal(buyAfter.total, 1_000, "foreign basis unchanged");
    assert.equal(consumptionAfter.quantity, "8.00000000");
    assert.equal(consumptionAfter.costBasisMinor, 400, "allocated foreign basis unchanged");
    assert.equal(consumptionAfter.costBasisRonMinor, 1_840, "allocated RON basis unchanged");

    const [lot] = await db.transaction((tx) => loadLots(tx, env.cashAccountId, env.securityId));
    assert.equal(lot.quantity, 2_000_000_000n);
    assert.equal(lot.consumedQuantity, 800_000_000n);
    assert.equal(lot.totalMinor, 1_000n);
    assert.equal(lot.allocatedMinor, 400n);

    const secondSell = await executeTrade({
      kind: "sell",
      accountId: env.cashAccountId,
      securityId: env.securityId,
      date: "2031-04-01",
      quantity: "6",
      priceMinor: 200,
      totalMinor: 1_200,
      totalRonMinor: 5_520,
    });
    assert.equal(secondSell.realizedGainMinor, 900, "half the remaining shares consume half the remaining basis");
    assert.equal(secondSell.realizedGainRonMinor, 4_140);
    console.log("Stock split scales lots/consumptions pro rata and preserves foreign + RON basis.");
  } finally {
    await teardownTradeTestEntity(env);
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
