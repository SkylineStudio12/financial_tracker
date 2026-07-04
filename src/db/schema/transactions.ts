import {
  date,
  index,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { currency, transactionKind } from "./enums";
import { id, moneyMinor, softDelete, timestamps } from "./helpers";
import { entities, accounts } from "./entities";
import { categories, tags } from "./categories";

export const transactions = pgTable(
  "transactions",
  {
    id,
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    date: date("date").notNull(),
    description: text("description").notNull(),
    kind: transactionKind("kind").notNull().default("standard"),
    notes: text("notes"),
    /** Stable reference from an external source (bank/broker import), for
     * future import deduplication. */
    externalRef: text("external_ref"),
    ...timestamps,
    ...softDelete,
  },
  (table) => [index("transactions_entity_id_date_idx").on(table.entityId, table.date)],
);

/**
 * Double-entry leg of a transaction.
 *
 * INVARIANT (application-enforced, not a DB constraint): the amount_ron of
 * all postings belonging to one transaction must sum to exactly zero. Writes
 * go through application logic that checks this before committing.
 *
 * amount is in the account's original currency; amount_ron is converted at
 * the transaction-date FX rate and stored at write time, so reports never
 * need to re-derive historical rates. Both are integer minor units.
 *
 * category is optional: transfer legs and tax accrual legs are never
 * categorized (see categories.ts).
 */
export const postings = pgTable(
  "postings",
  {
    id,
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    amount: moneyMinor("amount").notNull(),
    currency: currency("currency").notNull(),
    amountRon: moneyMinor("amount_ron").notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    counterparty: text("counterparty"),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index("postings_transaction_id_idx").on(table.transactionId),
    index("postings_account_id_idx").on(table.accountId),
    index("postings_category_id_idx").on(table.categoryId),
  ],
);

export const transactionTags = pgTable(
  "transaction_tags",
  {
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.transactionId, table.tagId] })],
);
