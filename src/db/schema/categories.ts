import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { categoryKind } from "./enums";
import { id, softDelete, timestamps } from "./helpers";
import { entities } from "./entities";

/**
 * Two-level category hierarchy: a category with parent_id = null is a group,
 * one with parent_id set is a leaf. Depth > 2 is forbidden — enforced in
 * application logic, not by the database.
 *
 * entity_id = null means the category is shared across all entities.
 *
 * Categorization rule: transfers and tax accrual postings are NEVER
 * categorized. Categories apply only to real income/expense postings.
 */
export const categories = pgTable(
  "categories",
  {
    id,
    entityId: uuid("entity_id").references(() => entities.id),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
    name: text("name").notNull(),
    icon: text("icon"),
    kind: categoryKind("kind").notNull(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("categories_parent_id_idx").on(table.parentId),
    uniqueIndex("categories_entity_lower_name_kind_live_uidx")
      .on(table.entityId, sql`lower(${table.name})`, table.kind)
      .where(sql`${table.deletedAt} IS NULL AND ${table.entityId} IS NOT NULL`),
  ],
);

/** Flat labels, attached to transactions via transaction_tags. */
export const tags = pgTable(
  "tags",
  {
    id,
    name: text("name").notNull(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [uniqueIndex("tags_name_unique").on(table.name)],
);
