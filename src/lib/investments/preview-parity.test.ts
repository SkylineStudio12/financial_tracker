/**
 * PREVIEW/BOOKING PARITY (Phase 4 Stage 3): previewSell must show EXACTLY
 * what executeTrade then books — same lots, same slices, same gains in both
 * currencies. The preview reuses the booking path's own loadLots +
 * planFifoConsumption, so this test pins that no parallel math ever creeps
 * in (the likeliest divergence point if a path is refactored).
 *
 * Covers the approved worked example AND a multi-lot partial sell WITH prior
 * consumption — where cumulative-floor allocation does real work.
 * Run: npx tsx src/lib/investments/preview-parity.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "@/db";
import { lotConsumptions, securities } from "@/db/schema";
import { executeTrade, previewSell } from "./service";
import { setupTradeTestEntity, teardownTradeTestEntity, type TradeTestEnv } from "./test-support";

let checks = 0;
function ok(name: string) {
  checks += 1;
  console.log(`  ✓ ${name}`);
}

async function bookedSlices(sellTradeId: string) {
  const rows = await db
    .select()
    .from(lotConsumptions)
    .where(eq(lotConsumptions.sellTradeId, sellTradeId));
  return rows
    .map((r) => ({
      quantity: r.quantity,
      costBasisMinor: r.costBasisMinor,
      costBasisRonMinor: r.costBasisRonMinor,
    }))
    .sort((a, b) => a.costBasisMinor - b.costBasisMinor);
}

const sortedPreviewSlices = (lots: { consuming: string; costBasisMinor: number; costBasisRonMinor: number }[]) =>
  lots
    .map((l) => ({
      quantity: l.consuming,
      costBasisMinor: l.costBasisMinor,
      costBasisRonMinor: l.costBasisRonMinor,
    }))
    .sort((a, b) => a.costBasisMinor - b.costBasisMinor);

async function run(env: TradeTestEnv) {
  const buyBase = {
    kind: "buy" as const,
    accountId: env.cashAccountId,
    positionAccountId: env.positionAccountId,
    securityId: env.securityId,
  };

  // ------------------------------------ 1. Worked-example parity
  await executeTrade({ ...buyBase, date: "2031-03-03", quantity: "10", priceMinor: 1000, totalMinor: 10_000, totalRonMinor: 46_000 });
  await executeTrade({ ...buyBase, date: "2031-04-09", quantity: "10", priceMinor: 1200, totalMinor: 12_000, totalRonMinor: 61_200 });

  const preview = await previewSell({
    accountId: env.cashAccountId,
    securityId: env.securityId,
    quantity: "15",
    totalMinor: 22_500,
    totalRonMinor: 112_500,
  });
  assert.ok(preview.ok);
  assert.equal(preview.heldQuantity, "20.00000000");
  assert.equal(preview.lots.length, 2);
  assert.deepEqual([preview.basisMinor, preview.basisRonMinor], [16_000, 76_600]);
  assert.deepEqual([preview.gainMinor, preview.gainRonMinor], [6_500, 35_900]);
  assert.equal(preview.gainCategoryName, "Investment gains");
  assert.deepEqual(preview.lots.map((l) => l.buyDate), ["2031-03-03", "2031-04-09"]);
  ok("preview of the worked example: exact basis, gains, category, FIFO lot order");

  const sell = await executeTrade({
    kind: "sell", accountId: env.cashAccountId, securityId: env.securityId,
    date: "2031-06-05", quantity: "15", priceMinor: 1500, totalMinor: 22_500, totalRonMinor: 112_500,
  });
  assert.deepEqual(
    [sell.realizedGainMinor, sell.realizedGainRonMinor],
    [preview.gainMinor, preview.gainRonMinor],
  );
  assert.deepEqual(await bookedSlices(sell.tradeId!), sortedPreviewSlices(preview.lots));
  ok("booking the previewed sell writes EXACTLY the previewed slices and gains");

  // ------- 2. Multi-lot partial sell WITH prior consumption (the crux)
  const [oddSec] = await db
    .insert(securities)
    .values({ ticker: `PAR${Date.now() % 100_000}`, name: "Parity odd lots", currency: "USD" })
    .returning();
  const oddBase = { ...buyBase, securityId: oddSec.id };
  await executeTrade({ ...oddBase, date: "2031-01-05", quantity: "3", priceMinor: 333, totalMinor: 1_000, totalRonMinor: 1_000 });
  await executeTrade({ ...oddBase, date: "2031-01-06", quantity: "3", priceMinor: 667, totalMinor: 2_000, totalRonMinor: 2_000 });
  // Prior consumption: sell 1 share first (consumes lot 1 partially: 333).
  await executeTrade({
    kind: "sell", accountId: env.cashAccountId, securityId: oddSec.id,
    date: "2031-01-07", quantity: "1", priceMinor: 400, totalMinor: 400, totalRonMinor: 400,
  });

  // Now sell 4: lot 1's remaining 2 (cumulative-floor: 1000 − 333 = 667) +
  // lot 2's 2 of 3 (⌊2000×2/3⌋ = 1333).
  const oddPreview = await previewSell({
    accountId: env.cashAccountId,
    securityId: oddSec.id,
    quantity: "4",
    totalMinor: 1_600,
    totalRonMinor: 1_600,
  });
  assert.ok(oddPreview.ok);
  assert.equal(oddPreview.heldQuantity, "5.00000000");
  assert.deepEqual(sortedPreviewSlices(oddPreview.lots), [
    { quantity: "2.00000000", costBasisMinor: 667, costBasisRonMinor: 667 },
    { quantity: "2.00000000", costBasisMinor: 1_333, costBasisRonMinor: 1_333 },
  ]);
  assert.deepEqual([oddPreview.basisMinor, oddPreview.gainMinor], [2_000, -400]);
  assert.equal(oddPreview.gainCategoryName, "Investment losses");
  ok("multi-lot partial preview with PRIOR consumption: cumulative-floor slices 667 + 1333");

  const oddSell = await executeTrade({
    kind: "sell", accountId: env.cashAccountId, securityId: oddSec.id,
    date: "2031-01-08", quantity: "4", priceMinor: 400, totalMinor: 1_600, totalRonMinor: 1_600,
  });
  assert.deepEqual(await bookedSlices(oddSell.tradeId!), sortedPreviewSlices(oddPreview.lots));
  assert.deepEqual(
    [oddSell.realizedGainMinor, oddSell.realizedGainRonMinor],
    [oddPreview.gainMinor, oddPreview.gainRonMinor],
  );
  ok("booking the multi-lot partial sell matches the preview slice-for-slice");

  // ------------------------------------------- 3. The two edge shapes
  const short = await previewSell({
    accountId: env.cashAccountId,
    securityId: oddSec.id,
    quantity: "100",
  });
  assert.ok(!short.ok);
  assert.equal(short.heldQuantity, "1.00000000");
  assert.equal(short.requestedQuantity, "100.00000000");
  ok("over-consumption previews as { ok: false } with held vs requested — before any submit");

  const noTotals = await previewSell({
    accountId: env.cashAccountId,
    securityId: oddSec.id,
    quantity: "1",
  });
  assert.ok(noTotals.ok);
  assert.equal(noTotals.gainMinor, null);
  assert.equal(noTotals.gainCategoryName, null);
  assert.ok(noTotals.basisMinor > 0);
  ok("preview without totals still shows lots + basis; gain waits for the amounts");

  return oddSec.id;
}

async function main() {
  const env = await setupTradeTestEntity();
  let oddSecId: string | null = null;
  try {
    oddSecId = await run(env);
    console.log(`\nAll ${checks} preview-parity checks passed.`);
  } finally {
    // Trades reference securities — the entity teardown removes the trades,
    // so the extra security can only be deleted after it.
    await teardownTradeTestEntity(env);
    if (oddSecId) await db.delete(securities).where(inArray(securities.id, [oddSecId]));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
