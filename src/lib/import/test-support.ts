/**
 * Shared setup/teardown for the import integration tests (NOT a test itself,
 * NOT a server module). Builds a throwaway COMPANY entity with its own bank,
 * equity, and tax_liability accounts plus the company category set, so the
 * money-grade and regression tests exercise the real write path without
 * touching seeded data. Teardown removes everything it created.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, categories, entities, importBatches, transactions } from "@/db/schema";

export interface ImportTestEntity {
  entityId: string;
  bankAccountId: string;
  equityAccountId: string;
  taxLiabilityAccountId: string;
  /** Category id by "name|kind". */
  categoryId: (nameKind: string) => string;
}

export async function setupImportTestEntity(): Promise<ImportTestEntity> {
  const [entity] = await db
    .insert(entities)
    .values({ name: "TEST Import Co SRL", type: "company", baseCurrency: "RON" })
    .returning({ id: entities.id });

  const inserted = await db
    .insert(accounts)
    .values([
      { entityId: entity.id, name: "TEST ING RON", type: "bank", currency: "RON" },
      { entityId: entity.id, name: "TEST Equity", type: "equity", currency: "RON" },
      { entityId: entity.id, name: "TEST Tax", type: "tax_liability", currency: "RON" },
    ])
    .returning({ id: accounts.id, type: accounts.type });
  const acc = (type: string) => inserted.find((a) => a.type === type)!.id;

  const catRows = await db
    .insert(categories)
    .values([
      { entityId: entity.id, name: "Revenue", kind: "income" },
      { entityId: entity.id, name: "Services", kind: "expense" },
      { entityId: entity.id, name: "Software subscriptions", kind: "expense" },
      { entityId: entity.id, name: "Bank fees", kind: "expense" },
      { entityId: entity.id, name: "Taxes", kind: "expense" },
    ])
    .returning({ id: categories.id, name: categories.name, kind: categories.kind });
  const catByKey = new Map(catRows.map((c) => [`${c.name}|${c.kind}`, c.id]));

  return {
    entityId: entity.id,
    bankAccountId: acc("bank"),
    equityAccountId: acc("equity"),
    taxLiabilityAccountId: acc("tax_liability"),
    categoryId: (nameKind) => {
      const id = catByKey.get(nameKind);
      if (!id) throw new Error(`test category not found: ${nameKind}`);
      return id;
    },
  };
}

export async function teardownImportTestEntity(entityId: string): Promise<void> {
  // Order matters: import_rows.transaction_id FKs transactions with no
  // cascade, so drop batches (cascades rows) before transactions.
  const batchIds = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(eq(importBatches.entityId, entityId));
  for (const b of batchIds) {
    await db.delete(importBatches).where(eq(importBatches.id, b.id));
  }
  await db.delete(transactions).where(eq(transactions.entityId, entityId)); // cascades postings + accruals
  await db.delete(categories).where(eq(categories.entityId, entityId));
  await db.delete(accounts).where(eq(accounts.entityId, entityId));
  await db.delete(entities).where(eq(entities.id, entityId));
}

/** Expected classifier kind per fixture line number (Skyline Nr.6/30.06.2026). */
export const EXPECTED_KIND: Record<string, string> = {
  "1461": "card_purchase",
  "1462": "professional_services",
  "1463": "bank_fee",
  "1464": "professional_services",
  "1465": "owner_transfer",
  "1466": "professional_services",
  "1471": "subscription",
  "1473": "subscription",
  "1475": "state_payment",
  "1476": "bank_fee",
  "1478": "state_payment",
  "1479": "bank_fee",
  "1481": "card_purchase",
  "1482": "revenue",
  "1486": "subscription",
  "1489": "subscription",
  "1491": "bank_fee",
};
