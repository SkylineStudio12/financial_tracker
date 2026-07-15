/**
 * TRADE EDIT GUARD (Phase 4 Stage 3, L-0012): editing any transaction with a
 * live trades row is refused — postings, trade row, and lot consumptions are
 * one structure; the correction path is delete-and-re-enter.
 * Run: npx tsx src/lib/investments/trade-edit-guard.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { transactions } from "@/db/schema";
import {
  createTransaction,
  LedgerValidationError,
  softDeleteTransaction,
  updateTransaction,
} from "@/lib/ledger";
import { executeTrade } from "./service";
import { setupTradeTestEntity, teardownTradeTestEntity } from "./test-support";

let checks = 0;
function ok(name: string) {
  checks += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  const env = await setupTradeTestEntity();
  try {
    const buy = await executeTrade({
      kind: "buy",
      accountId: env.cashAccountId,
      positionAccountId: env.positionAccountId,
      securityId: env.securityId,
      date: "2031-02-01",
      quantity: "10",
      priceMinor: 1000,
      totalMinor: 10_000,
      totalRonMinor: 46_000,
    });

    // 1. A form-shaped edit of the trade transaction is refused with the
    // delete-and-re-enter message, and nothing changes.
    await assert.rejects(
      updateTransaction(buy.transactionId, {
        entityId: env.entityId,
        date: "2031-02-02",
        description: "edited from the generic form",
        kind: "standard",
        postings: [
          { accountId: env.cashAccountId, amount: -1000, amountRon: -4600 },
          {
            accountId: env.equityAccountId,
            amount: 4600,
            amountRon: 4600,
            categoryId: env.categoryId("Brokerage fees"),
          },
        ],
      }),
      (e) => e instanceof LedgerValidationError && e.code === "ledger.investmentCrudUnavailable",
    );
    const [unchanged] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, buy.transactionId));
    assert.ok(unchanged.description.startsWith("Buy 10 TST"));
    assert.equal(unchanged.date, "2031-02-01");
    ok("editing a trade transaction is refused; the transaction is untouched");

    // 2. Non-trade transactions still edit normally (the guard is scoped).
    const plainId = await createTransaction({
      entityId: env.entityId,
      date: "2031-02-03",
      description: "plain expense",
      kind: "standard",
      postings: [
        { accountId: env.cashAccountId, amount: -500, amountRon: -2500 },
        {
          accountId: env.equityAccountId,
          amount: 2500,
          amountRon: 2500,
          categoryId: env.categoryId("Brokerage fees"),
        },
      ],
    });
    await updateTransaction(plainId, {
      entityId: env.entityId,
      date: "2031-02-04",
      description: "plain expense, edited",
      kind: "standard",
      postings: [
        { accountId: env.cashAccountId, amount: -600, amountRon: -3000 },
        {
          accountId: env.equityAccountId,
          amount: 3000,
          amountRon: 3000,
          categoryId: env.categoryId("Brokerage fees"),
        },
      ],
    });
    const [edited] = await db.select().from(transactions).where(eq(transactions.id, plainId));
    assert.equal(edited.description, "plain expense, edited");
    ok("non-trade transactions still edit normally");

    // 3. The correction path stays open: delete the trade, re-enter it.
    await softDeleteTransaction(buy.transactionId);
    const rebooked = await executeTrade({
      kind: "buy",
      accountId: env.cashAccountId,
      positionAccountId: env.positionAccountId,
      securityId: env.securityId,
      date: "2031-02-01",
      quantity: "10",
      priceMinor: 1000,
      totalMinor: 10_000,
      totalRonMinor: 46_000,
    });
    assert.ok(rebooked.tradeId);
    ok("delete-and-re-enter (the pointed-at correction path) works");
  } finally {
    await teardownTradeTestEntity(env);
  }
  console.log(`\nAll ${checks} trade edit-guard checks passed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
