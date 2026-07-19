import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { accountOwner, accountType, currency, entityType } from "./enums";
import { id, softDelete, timestamps } from "./helpers";

/** A bookkeeping unit: the household or one of the companies (SRL). */
export const entities = pgTable("entities", {
  id,
  name: text("name").notNull(),
  type: entityType("type").notNull(),
  baseCurrency: currency("base_currency").notNull().default("RON"),
  ...timestamps,
  ...softDelete,
});

export const accounts = pgTable(
  "accounts",
  {
    id,
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    currency: currency("currency").notNull(),
    /**
     * Household-only view filter (greg/andra — no joint accounts exist);
     * NULL on company accounts and the structural equity account.
     */
    owner: accountOwner("owner"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("accounts_entity_id_idx").on(table.entityId),
    uniqueIndex("accounts_entity_lower_name_live_uidx")
      .on(table.entityId, sql`lower(${table.name})`)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);
