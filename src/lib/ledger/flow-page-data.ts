import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, entities } from "@/db/schema";
import type { AccountOption } from "@/components/forms/option-types";
import { listEmployeeOptions, type EmployeeOption } from "@/lib/management/service";

/** Guard + options for the guided flow pages. */
export async function getFlowPageData(entityId: string): Promise<{
  isCompany: boolean;
  personalAccounts: AccountOption[];
  employees: EmployeeOption[];
}> {
  const [entity] = await db
    .select({ type: entities.type })
    .from(entities)
    .where(and(eq(entities.id, entityId), isNull(entities.deletedAt)));
  if (!entity || entity.type !== "company") {
    return { isCompany: false, personalAccounts: [], employees: [] };
  }

  const [household] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.type, "household"), isNull(entities.deletedAt)))
    .orderBy(asc(entities.createdAt));
  const personalAccounts = household
    ? await db
        .select({
          id: accounts.id,
          name: accounts.name,
          currency: accounts.currency,
          type: accounts.type,
        })
        .from(accounts)
        .where(
          and(
            eq(accounts.entityId, household.id),
            inArray(accounts.type, ["bank", "cash"]),
            eq(accounts.isActive, true),
            isNull(accounts.deletedAt),
          ),
        )
        .orderBy(accounts.name)
    : [];
  const employees = await listEmployeeOptions(entityId);
  return { isCompany: true, personalAccounts, employees };
}
