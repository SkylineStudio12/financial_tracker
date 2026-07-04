/**
 * One-off, idempotent: adds the income categories that the phase-1 seed
 * lacked — "Revenue" per company (needed by company revenue entry, which
 * requires a category on the income equity leg) and "Other income" for the
 * household. Safe to re-run.
 *
 *   npx tsx scripts/add-income-categories.ts
 */
import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import { categories, entities } from "@/db/schema";

async function ensureCategory(entityId: string, name: string) {
  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.entityId, entityId),
        eq(categories.name, name),
        eq(categories.kind, "income"),
        isNull(categories.deletedAt),
      ),
    );
  if (existing) return false;
  await db.insert(categories).values({ entityId, name, kind: "income" });
  return true;
}

async function main() {
  const entityRows = await db.select().from(entities).where(isNull(entities.deletedAt));
  let created = 0;
  for (const entity of entityRows) {
    const name = entity.type === "company" ? "Revenue" : "Other income";
    if (await ensureCategory(entity.id, name)) {
      created++;
      console.log(`Created income category "${name}" for ${entity.name}`);
    }
  }
  console.log(created === 0 ? "Nothing to do — categories already exist." : `${created} categories created.`);
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    return pool.end();
  });
