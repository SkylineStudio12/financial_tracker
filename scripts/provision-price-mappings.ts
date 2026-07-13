import "dotenv/config";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import { securities, securityPriceMappings } from "@/db/schema";
import { providerMappings, VERIFIED_PRICE_MAPPINGS } from "@/lib/investments/price-mappings";

async function main() {
  const tickers = VERIFIED_PRICE_MAPPINGS.map((mapping) => mapping.ticker);
  const rows = await db
    .select({ id: securities.id, ticker: securities.ticker, currency: securities.currency })
    .from(securities)
    .where(inArray(securities.ticker, tickers));
  const byTicker = new Map(rows.map((row) => [row.ticker, row]));

  const problems: string[] = [];
  for (const mapping of VERIFIED_PRICE_MAPPINGS) {
    const security = byTicker.get(mapping.ticker);
    if (!security) {
      problems.push(`${mapping.ticker}: security not found`);
    } else if (security.currency !== mapping.currency) {
      problems.push(
        `${mapping.ticker}: expected ${mapping.currency}, stored ${security.currency}`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(`Price mappings not provisioned:\n${problems.join("\n")}`);
  }

  await db.transaction(async (tx) => {
    for (const mapping of providerMappings()) {
      const security = byTicker.get(mapping.ticker)!;
      await tx
        .insert(securityPriceMappings)
        .values({
          securityId: security.id,
          provider: mapping.provider,
          symbol: mapping.symbol,
        })
        .onConflictDoUpdate({
          target: [securityPriceMappings.securityId, securityPriceMappings.provider],
          set: { symbol: mapping.symbol, updatedAt: new Date() },
        });
    }
  });

  const activeMapped = await db
    .select({ id: securityPriceMappings.id })
    .from(securityPriceMappings)
    .innerJoin(securities, eq(securityPriceMappings.securityId, securities.id))
    .where(and(inArray(securities.id, rows.map((row) => row.id)), isNull(securities.deletedAt)));
  console.log(
    `Provisioned ${providerMappings().length} mappings for ${VERIFIED_PRICE_MAPPINGS.length} securities (${activeMapped.length} active mapping rows total).`,
  );
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    return pool.end();
  });
