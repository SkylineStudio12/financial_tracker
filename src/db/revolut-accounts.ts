import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./index";
import { accounts, entities } from "./schema";
import { ENTITY_IDS } from "@/lib/profiles";

export const GREG_REVOLUT_ACCOUNTS = [
  { name: "Revolut brokerage cash USD", type: "brokerage", currency: "USD" },
  { name: "Revolut brokerage cash EUR", type: "brokerage", currency: "EUR" },
  { name: "Greg — Revolut positions USD", type: "position", currency: "USD" },
  { name: "Greg — Revolut positions EUR", type: "position", currency: "EUR" },
  { name: "Transfers to Revolut", type: "clearing", currency: "RON" },
] as const;

/** Run only after the migration adding account_type=clearing has committed. */
export async function provisionGregRevolutAccounts(): Promise<number> {
  const [household] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.id, ENTITY_IDS.household), isNull(entities.deletedAt)));
  if (!household) throw new Error(`Household entity ${ENTITY_IDS.household} not found`);
  const existing = await db
    .select({ name: accounts.name })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, household.id),
        eq(accounts.owner, "greg"),
        inArray(
          accounts.name,
          GREG_REVOLUT_ACCOUNTS.map((account) => account.name),
        ),
        isNull(accounts.deletedAt),
      ),
    );
  const names = new Set(existing.map((account) => account.name));
  const missing = GREG_REVOLUT_ACCOUNTS.filter((account) => !names.has(account.name));
  if (missing.length > 0) {
    await db.insert(accounts).values(
      missing.map((account) => ({
        entityId: household.id,
        owner: "greg" as const,
        ...account,
      })),
    );
  }
  return missing.length;
}
