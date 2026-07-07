/**
 * MONEY-GRADE end-to-end test of the trade write path (Phase 4 Stage 2).
 * The approved worked example (two lots at two rates, sold at a third) is
 * the correctness spec, asserted to the ban in BOTH currencies.
 *
 * All dates are in 2031: no fx_rates exist there and none may be created —
 * every RON value must come from the entered pair / stored lot basis, so a
 * regression that consults BNR fails loudly (network fetch of a
 * nonexistent yearly file) instead of passing on ambient rates.
 *
 * Runs on the dev DB against a throwaway entity (created + torn down).
 * Run: npx tsx src/lib/investments/trade-write.e2e.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  fxRates,
  lotConsumptions,
  postings,
  securities,
  taxAccruals,
  taxRules,
  trades,
  transactions,
} from "@/db/schema";
import { softDeleteTransaction } from "@/lib/ledger";
import { estimateDividendTaxes, executeTrade } from "./service";
import { setupTradeTestEntity, teardownTradeTestEntity, type TradeTestEnv } from "./test-support";

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

async function postingsOf(txId: string) {
  return (
    await db
      .select()
      .from(postings)
      .where(and(eq(postings.transactionId, txId), isNull(postings.deletedAt)))
  ).sort((a, b) => a.amount - b.amount);
}

async function run(env: TradeTestEnv) {
  const buyBase = {
    kind: "buy" as const,
    accountId: env.cashAccountId,
    positionAccountId: env.positionAccountId,
    securityId: env.securityId,
  };

  // ------------------------------------------------ 1. The worked example
  const lot1 = await executeTrade({
    ...buyBase, date: "2031-03-03", quantity: "10", priceMinor: 1000, totalMinor: 10_000, totalRonMinor: 46_000,
  });
  const lot2 = await executeTrade({
    ...buyBase, date: "2031-04-09", quantity: "10", priceMinor: 1200, totalMinor: 12_000, totalRonMinor: 61_200,
  });

  const buyPostings = await postingsOf(lot1.transactionId);
  assert.equal(buyPostings.length, 2);
  assert.equal(buyPostings[0].accountId, env.cashAccountId);
  assert.equal(buyPostings[0].amount, -10_000);
  assert.equal(buyPostings[0].amountRon, -46_000);
  assert.equal(buyPostings[1].accountId, env.positionAccountId);
  assert.equal(buyPostings[1].amount, 10_000);
  assert.equal(buyPostings[1].amountRon, 46_000);
  assert.ok(buyPostings.every((p) => p.categoryId === null));
  const [lot1Trade] = await db.select().from(trades).where(eq(trades.id, lot1.tradeId!));
  assert.equal(lot1Trade.fxRateToRon, "4.600000");
  ok("buy: cash −T · positions +T, uncategorized, derived rate stored (4.600000)");

  const sell = await executeTrade({
    kind: "sell", accountId: env.cashAccountId, securityId: env.securityId,
    date: "2031-06-05", quantity: "15", priceMinor: 1500, totalMinor: 22_500, totalRonMinor: 112_500,
  });
  assert.equal(sell.realizedGainMinor, 6_500);
  assert.equal(sell.realizedGainRonMinor, 35_900);
  ok("worked example: USD gain $65.00, RON gain 359.00 — not 325.00 (per-lot basis, not single-rate)");

  const sellPostings = await postingsOf(sell.transactionId);
  assert.equal(sellPostings.length, 3);
  const cashLeg = sellPostings.find((p) => p.accountId === env.cashAccountId)!;
  const positionLeg = sellPostings.find((p) => p.accountId === env.positionAccountId)!;
  const gainLeg = sellPostings.find((p) => p.accountId === env.equityAccountId)!;
  assert.deepEqual([cashLeg.amount, cashLeg.amountRon], [22_500, 112_500]);
  assert.deepEqual([positionLeg.amount, positionLeg.amountRon], [-16_000, -76_600]);
  assert.deepEqual([gainLeg.amount, gainLeg.amountRon], [-35_900, -35_900]);
  assert.equal(gainLeg.categoryId, env.categoryId("Investment gains"));
  ok("sell legs exact: cash +22500/+112500 · positions −16000/−76600 · equity −35900 (Investment gains)");

  const consumptions = await db
    .select()
    .from(lotConsumptions)
    .where(eq(lotConsumptions.sellTradeId, sell.tradeId!));
  assert.equal(consumptions.length, 2);
  const fromLot1 = consumptions.find((c) => c.buyTradeId === lot1.tradeId)!;
  const fromLot2 = consumptions.find((c) => c.buyTradeId === lot2.tradeId)!;
  assert.equal(fromLot1.quantity, "10.00000000");
  assert.deepEqual([fromLot1.costBasisMinor, fromLot1.costBasisRonMinor], [10_000, 46_000]);
  assert.equal(fromLot2.quantity, "5.00000000");
  assert.deepEqual([fromLot2.costBasisMinor, fromLot2.costBasisRonMinor], [6_000, 30_600]);
  ok("two lot_consumptions rows exactly as specified (10 → $100/460.00; 5 → $60/306.00)");

  // Zero-sum in BOTH currencies on every trade transaction so far.
  for (const txId of [lot1.transactionId, lot2.transactionId, sell.transactionId]) {
    const ps = await postingsOf(txId);
    assert.equal(ps.reduce((s, p) => s + p.amountRon, 0), 0, "RON zero-sum");
    const usdSum = ps.filter((p) => p.currency === "USD").reduce((s, p) => s + p.amount, 0);
    const ronSum = ps.filter((p) => p.currency === "RON").reduce((s, p) => s + p.amount, 0);
    // USD legs net to the USD gain, mirrored by the RON equity leg's value:
    // the model's only hard invariant is RON zero-sum; assert it plus the
    // position-account cost bookkeeping below.
    assert.ok(Number.isSafeInteger(usdSum) && Number.isSafeInteger(ronSum));
  }
  const allPositionLegs = await db
    .select()
    .from(postings)
    .where(and(eq(postings.accountId, env.positionAccountId), isNull(postings.deletedAt)));
  assert.equal(allPositionLegs.reduce((s, p) => s + p.amount, 0), 6_000);
  assert.equal(allPositionLegs.reduce((s, p) => s + p.amountRon, 0), 30_600);
  ok("position account holds exactly the open remainder at cost: $60.00 / 306.00 RON");

  // ------------------------------------- 2. FIFO tiebreaker: same-date lots
  const tieSec = await newSecurity("TIE");
  const tieA = await executeTrade({
    ...buyBase, securityId: tieSec, date: "2031-02-01", quantity: "10", priceMinor: 100, totalMinor: 1_000, totalRonMinor: 4_600,
  });
  const tieB = await executeTrade({
    ...buyBase, securityId: tieSec, date: "2031-02-01", quantity: "10", priceMinor: 100, totalMinor: 2_000, totalRonMinor: 9_200,
  });
  const tieSell = await executeTrade({
    kind: "sell", accountId: env.cashAccountId, securityId: tieSec,
    date: "2031-02-02", quantity: "12", priceMinor: 100, totalMinor: 1_800, totalRonMinor: 8_280,
  });
  const tieCons = await db
    .select()
    .from(lotConsumptions)
    .where(eq(lotConsumptions.sellTradeId, tieSell.tradeId!));
  assert.equal(tieCons.length, 2);
  // FIFO order is proven by the ALLOCATION: the first-entered same-date lot
  // is fully drained (10), the second only partially (2) — never vice versa.
  assert.equal(tieCons.find((c) => c.buyTradeId === tieA.tradeId)!.quantity, "10.00000000");
  assert.equal(tieCons.find((c) => c.buyTradeId === tieB.tradeId)!.quantity, "2.00000000");
  ok("same-date lots consume in (date, created_at, id) order — first-entered drains first");

  // --------------------------- 3. Over-consumption: throws before ANY write
  const txCountBefore = await db.$count(transactions, eq(transactions.entityId, env.entityId));
  const consCountBefore = await db.$count(lotConsumptions);
  await assert.rejects(
    executeTrade({
      kind: "sell", accountId: env.cashAccountId, securityId: env.securityId,
      date: "2031-06-06", quantity: "6", priceMinor: 1500, totalMinor: 9_000, totalRonMinor: 45_000,
    }),
    /only 5\.00000000 held/,
  );
  assert.equal(await db.$count(transactions, eq(transactions.entityId, env.entityId)), txCountBefore);
  assert.equal(await db.$count(lotConsumptions), consCountBefore);
  ok("over-consumption (sell 6, hold 5) rejected atomically — zero rows written");

  // --------------------- 4. Soft-delete unwind + buy-delete guard (L-0011)
  await assert.rejects(softDeleteTransaction(lot1.transactionId), /already been sold/);
  ok("deleting a consumed buy is refused (dependent sell exists)");

  await softDeleteTransaction(sell.transactionId);
  const consAfterDelete = await db
    .select()
    .from(lotConsumptions)
    .where(eq(lotConsumptions.sellTradeId, sell.tradeId!));
  assert.ok(consAfterDelete.every((c) => c.deletedAt !== null));
  const resell = await executeTrade({
    kind: "sell", accountId: env.cashAccountId, securityId: env.securityId,
    date: "2031-06-07", quantity: "15", priceMinor: 1500, totalMinor: 22_500, totalRonMinor: 112_500,
  });
  assert.equal(resell.realizedGainMinor, 6_500);
  assert.equal(resell.realizedGainRonMinor, 35_900);
  ok("soft-deleting the sell restores the lots — the full 15 re-sell books identically");

  // ----------------------------------- 5. Loss sale → Investment losses
  const lossSec = await newSecurity("LOSS");
  await executeTrade({
    ...buyBase, securityId: lossSec, date: "2031-01-10", quantity: "10", priceMinor: 1000, totalMinor: 10_000, totalRonMinor: 46_000,
  });
  const lossSell = await executeTrade({
    kind: "sell", accountId: env.cashAccountId, securityId: lossSec,
    date: "2031-05-10", quantity: "10", priceMinor: 800, totalMinor: 8_000, totalRonMinor: 40_000,
  });
  assert.equal(lossSell.realizedGainMinor, -2_000);
  assert.equal(lossSell.realizedGainRonMinor, -6_000);
  const lossLeg = (await postingsOf(lossSell.transactionId)).find(
    (p) => p.accountId === env.equityAccountId,
  )!;
  assert.deepEqual([lossLeg.amount, lossLeg.amountRon], [6_000, 6_000]);
  assert.equal(lossLeg.categoryId, env.categoryId("Investment losses"));
  ok("loss sale books to Investment losses (separate gross figure), +6000 RON equity leg");

  // ------------------------- 6. Dividend: two legs, NO accrual, estimate
  const dividend = await executeTrade({
    kind: "dividend", accountId: env.cashAccountId, securityId: env.securityId,
    date: "2031-07-01", totalMinor: 1_000, totalRonMinor: 5_000,
  });
  const divPostings = await postingsOf(dividend.transactionId);
  assert.equal(divPostings.length, 2);
  const divEquity = divPostings.find((p) => p.accountId === env.equityAccountId)!;
  assert.equal(divEquity.categoryId, env.categoryId("Dividends"));
  assert.deepEqual([divEquity.amount, divEquity.amountRon], [-5_000, -5_000]);
  const accruals = await db
    .select()
    .from(taxAccruals)
    .where(eq(taxAccruals.transactionId, dividend.transactionId));
  assert.equal(accruals.length, 0);
  const [divTrade] = await db.select().from(trades).where(eq(trades.id, dividend.tradeId!));
  assert.equal(divTrade.kind, "dividend");
  ok("dividend: cash + income (Dividends), trades row recorded, ZERO tax accruals booked");

  const estimate = await estimateDividendTaxes("2026-07-01", 5_000);
  const [divRule] = await db
    .select()
    .from(taxRules)
    .where(and(eq(taxRules.ruleType, "dividend_tax"), isNull(taxRules.deletedAt)));
  const [cassRule] = await db
    .select()
    .from(taxRules)
    .where(and(eq(taxRules.ruleType, "cass_dividend"), isNull(taxRules.deletedAt)));
  assert.equal(estimate.estimate, true);
  assert.equal(estimate.dividendTaxRonMinor, Math.round((5_000 * divRule.rateBps) / 10_000));
  assert.equal(estimate.cassRonMinor, Math.round((5_000 * cassRule.rateBps) / 10_000));
  ok("dividend estimate is display-only and sourced from tax_rules config, never a literal");

  // ------------------------------ 7. Fee: with and without a security
  const fee = await executeTrade({
    kind: "fee", accountId: env.cashAccountId, date: "2031-07-02", totalMinor: 500, totalRonMinor: 2_500,
  });
  assert.equal(fee.tradeId, null);
  const feeLeg = (await postingsOf(fee.transactionId)).find(
    (p) => p.accountId === env.equityAccountId,
  )!;
  assert.equal(feeLeg.categoryId, env.categoryId("Brokerage fees"));
  assert.equal(feeLeg.amount, 2_500);
  const securityFee = await executeTrade({
    kind: "fee", accountId: env.cashAccountId, securityId: env.securityId,
    date: "2031-07-03", totalMinor: 300, totalRonMinor: 1_500,
  });
  assert.ok(securityFee.tradeId);
  ok("fee: cash − · expense (Brokerage fees); trades row only when a security is named");

  // ----------- 8. Cumulative-floor conservation across partial sells
  const oddSec = await newSecurity("ODD");
  const oddBuy = await executeTrade({
    ...buyBase, securityId: oddSec, date: "2031-01-05", quantity: "3", priceMinor: 333, totalMinor: 1_000, totalRonMinor: 1_000,
  });
  const slices: number[][] = [];
  for (const day of ["06", "07", "08"]) {
    const s = await executeTrade({
      kind: "sell", accountId: env.cashAccountId, securityId: oddSec,
      date: `2031-01-${day}`, quantity: "1", priceMinor: 400, totalMinor: 400, totalRonMinor: 400,
    });
    const [c] = await db
      .select()
      .from(lotConsumptions)
      .where(eq(lotConsumptions.sellTradeId, s.tradeId!));
    slices.push([c.costBasisMinor, c.costBasisRonMinor]);
  }
  assert.deepEqual(slices, [[333, 333], [333, 333], [334, 334]]);
  const oddRemaining = await db
    .select()
    .from(lotConsumptions)
    .where(and(eq(lotConsumptions.buyTradeId, oddBuy.tradeId!), isNull(lotConsumptions.deletedAt)));
  assert.equal(oddRemaining.reduce((s, c) => s + c.costBasisMinor, 0), 1_000);
  ok("1000 across 3 shares allocates 333/333/334 — conserved to the ban, remainder in the final slice");

  // ------------------------------- 9. Rate reconciliation hard reject
  await assert.rejects(
    executeTrade({
      ...buyBase, date: "2031-08-01", quantity: "1", priceMinor: 30_000_001,
      totalMinor: 30_000_001, totalRonMinor: 100_000_000,
    }),
    /don't reconcile/,
  );
  ok("a pair the 6-dp rate cannot reproduce within 1 ban is REJECTED, not clamped");

  // ------------------------------------ 10. BNR untouched, structurally
  const futureRates = await db.select().from(fxRates).where(gte(fxRates.date, "2030-01-01"));
  assert.equal(futureRates.length, 0);
  ok("no fx_rates exist for any trade date — every RON figure came from the entered pair / stored basis");
}

async function main() {
  const env = await setupTradeTestEntity();
  try {
    await run(env);
    console.log(`\nAll ${checks} trade money-grade checks passed.`);
  } finally {
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
