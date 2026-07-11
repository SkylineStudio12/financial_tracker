/** Throwaway household-shaped entity for trade-path tests: brokerage cash +
 * position accounts (USD), a RON equity account, the four investment
 * categories, and one security. Torn down by entity id. */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  auditLog,
  categories,
  entities,
  lotConsumptions,
  stockSplitConsumptionAdjustments,
  stockSplitLotAdjustments,
  stockSplits,
  postings,
  securities,
  trades,
  transactions,
} from "@/db/schema";

export interface TradeTestEnv {
  entityId: string;
  cashAccountId: string;
  positionAccountId: string;
  equityAccountId: string;
  securityId: string;
  categoryId: (name: string) => string;
}

export async function setupTradeTestEntity(): Promise<TradeTestEnv> {
  const [entity] = await db
    .insert(entities)
    .values({ name: "TRADE E2E (throwaway)", type: "household" })
    .returning();
  const [cash, position, equity] = await db
    .insert(accounts)
    .values([
      { entityId: entity.id, name: "Test brokerage", type: "brokerage", currency: "USD" },
      { entityId: entity.id, name: "Test positions", type: "position", currency: "USD" },
      { entityId: entity.id, name: "Test equity", type: "equity", currency: "RON" },
    ])
    .returning();
  const categoryRows = await db
    .insert(categories)
    .values(
      (
        [
          ["Investment gains", "income"],
          ["Investment losses", "expense"],
          ["Dividends", "income"],
          ["Brokerage fees", "expense"],
        ] as const
      ).map(([name, kind]) => ({ entityId: entity.id, name, kind })),
    )
    .returning();
  const [security] = await db
    .insert(securities)
    .values({ ticker: `TST${Date.now() % 1_000_000}`, name: "Test security", currency: "USD" })
    .returning();
  const byName = new Map(categoryRows.map((c) => [c.name, c.id]));
  return {
    entityId: entity.id,
    cashAccountId: cash.id,
    positionAccountId: position.id,
    equityAccountId: equity.id,
    securityId: security.id,
    categoryId: (name) => byName.get(name)!,
  };
}

export async function teardownTradeTestEntity(env: TradeTestEnv): Promise<void> {
  const txIds = (
    await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.entityId, env.entityId))
  ).map((t) => t.id);
  if (txIds.length > 0) {
    const tradeIds = (
      await db.select({ id: trades.id }).from(trades).where(inArray(trades.transactionId, txIds))
    ).map((t) => t.id);
    if (tradeIds.length > 0) {
      const splitIds = (
        await db
          .select({ id: stockSplits.id })
          .from(stockSplits)
          .where(inArray(stockSplits.accountId, [env.cashAccountId]))
      ).map((row) => row.id);
      if (splitIds.length > 0) {
        await db
          .delete(stockSplitConsumptionAdjustments)
          .where(inArray(stockSplitConsumptionAdjustments.splitId, splitIds));
        await db
          .delete(stockSplitLotAdjustments)
          .where(inArray(stockSplitLotAdjustments.splitId, splitIds));
        await db.delete(stockSplits).where(inArray(stockSplits.id, splitIds));
      }
      await db.delete(lotConsumptions).where(inArray(lotConsumptions.sellTradeId, tradeIds));
      await db.delete(trades).where(inArray(trades.id, tradeIds));
    }
    await db.delete(postings).where(inArray(postings.transactionId, txIds));
    await db
      .delete(auditLog)
      .where(and(eq(auditLog.tableName, "transactions"), inArray(auditLog.rowId, txIds)));
    await db.delete(transactions).where(inArray(transactions.id, txIds));
  }
  await db.delete(securities).where(eq(securities.id, env.securityId));
  await db.delete(categories).where(eq(categories.entityId, env.entityId));
  await db.delete(accounts).where(eq(accounts.entityId, env.entityId));
  await db.delete(entities).where(eq(entities.id, env.entityId));
}
