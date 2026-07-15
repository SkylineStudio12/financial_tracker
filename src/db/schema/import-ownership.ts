import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { importLinkLifecycle, importProvider } from "./enums";
import { id, timestamps } from "./helpers";
import { transactions } from "./transactions";

/** Active ownership of an imported source file's exact text hash. Released
 * claims stay as provenance; only unreleased claims prevent re-import. */
export const importSourceClaims = pgTable(
  "import_source_claims",
  {
    id,
    provider: importProvider("provider").notNull(),
    rawTextHash: text("raw_text_hash").notNull(),
    sourceBatchId: uuid("source_batch_id").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("import_source_claims_active_hash_uidx")
      .on(table.provider, table.rawTextHash)
      .where(sql`${table.releasedAt} is null`),
    index("import_source_claims_batch_idx").on(table.provider, table.sourceBatchId),
  ],
);

/** Durable row-level import identity. This survives edit and soft-delete, so
 * duplicate ownership does not depend on a posting remaining live. */
export const transactionImportLinks = pgTable(
  "transaction_import_links",
  {
    id,
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    provider: importProvider("provider").notNull(),
    sourceBatchId: uuid("source_batch_id").notNull(),
    sourceRowId: uuid("source_row_id").notNull(),
    sourceLabel: text("source_label").notNull(),
    rowIdentity: text("row_identity").notNull(),
    rawTextHash: text("raw_text_hash").notNull(),
    lifecycle: importLinkLifecycle("lifecycle").notNull().default("active"),
    modifiedAfterImport: timestamp("modified_after_import", { withTimezone: true }),
    originalBookedAt: timestamp("original_booked_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("transaction_import_links_source_row_uidx").on(
      table.provider,
      table.sourceRowId,
    ),
    uniqueIndex("transaction_import_links_active_identity_uidx")
      .on(table.provider, table.rowIdentity)
      .where(sql`${table.releasedAt} is null`),
    index("transaction_import_links_transaction_idx").on(table.transactionId),
    index("transaction_import_links_batch_idx").on(table.provider, table.sourceBatchId),
  ],
);
