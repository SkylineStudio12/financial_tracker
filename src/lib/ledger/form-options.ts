import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, tags } from "@/db/schema";
import type { AccountOwner } from "@/lib/profiles";
import type { FormOptions } from "@/components/forms/option-types";

/** Accounts, categories, and tag names the entry forms need. */
export async function getFormOptions(
  entityId: string,
  owner?: AccountOwner,
): Promise<FormOptions> {
  const accountRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      currency: accounts.currency,
      type: accounts.type,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, entityId),
        eq(accounts.isActive, true),
        isNull(accounts.deletedAt),
        // Entry forms in a personal profile offer only that person's accounts.
        ...(owner ? [eq(accounts.owner, owner)] : []),
      ),
    )
    .orderBy(accounts.name);

  const categoryRows = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(
      and(
        sql`${categories.entityId} is null or ${categories.entityId} = ${entityId}`,
        isNull(categories.deletedAt),
      ),
    )
    .orderBy(categories.name);

  const tagRows = await db
    .select({ name: tags.name })
    .from(tags)
    .where(isNull(tags.deletedAt))
    .orderBy(tags.name);

  return {
    accounts: accountRows,
    categories: categoryRows,
    tagNames: tagRows.map((t) => t.name),
  };
}
