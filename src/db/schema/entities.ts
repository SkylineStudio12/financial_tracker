import { boolean, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { accountType, currency, entityType } from "./enums";
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
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (table) => [index("accounts_entity_id_idx").on(table.entityId)],
);
