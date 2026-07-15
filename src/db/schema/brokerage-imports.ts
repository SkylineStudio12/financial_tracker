import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accountOwner, currency, importRowStatus } from "./enums";
import { id, timestamps } from "./helpers";
import { entities } from "./entities";
import { stockSplits } from "./investments";
import { transactions } from "./transactions";

export const revolutImportBatches = pgTable(
  "revolut_import_batches",
  {
    id,
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    owner: accountOwner("owner").notNull(),
    sourceFileName: text("source_file_name").notNull(),
    rawTextHash: text("raw_text_hash").notNull(),
    parsedRowCount: integer("parsed_row_count").notNull(),
    stagedRowCount: integer("staged_row_count").notNull(),
    correctionPairCount: integer("correction_pair_count").notNull(),
    verification: jsonb("verification").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("revolut_import_batches_raw_text_hash_idx").on(table.rawTextHash)],
);

export const revolutImportRows = pgTable(
  "revolut_import_rows",
  {
    id,
    batchId: uuid("batch_id")
      .notNull()
      .references(() => revolutImportBatches.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    occurredAt: text("occurred_at").notNull(),
    type: text("type").notNull(),
    kind: text("kind").notNull(),
    ticker: text("ticker"),
    currency: currency("currency").notNull(),
    contentHash: text("content_hash").notNull(),
    semanticKey: text("semantic_key").notNull(),
    payload: jsonb("payload").notNull(),
    suspectedDuplicate: boolean("suspected_duplicate").notNull().default(false),
    status: importRowStatus("status").notNull().default("pending"),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    stockSplitId: uuid("stock_split_id").references(() => stockSplits.id),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    modifiedAfterImport: boolean("modified_after_import").notNull().default(false),
    modifiedAt: timestamp("modified_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("revolut_import_rows_batch_line_uidx").on(table.batchId, table.lineNo),
    index("revolut_import_rows_batch_id_idx").on(table.batchId),
    index("revolut_import_rows_content_hash_idx").on(table.contentHash),
    index("revolut_import_rows_semantic_key_idx").on(table.semanticKey),
  ],
);

/** Global row-level idempotence marker. The advisory lock in the approval
 * service serializes competing batches; this unique hash remains the final
 * database backstop. Splits have no ledger transaction, hence two nullable
 * result links with an exactly-one rule enforced by the service. */
export const revolutBookedRows = pgTable(
  "revolut_booked_rows",
  {
    id,
    contentHash: text("content_hash").notNull(),
    semanticKey: text("semantic_key").notNull(),
    sourceRowId: uuid("source_row_id")
      .notNull()
      .references(() => revolutImportRows.id),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    stockSplitId: uuid("stock_split_id").references(() => stockSplits.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("revolut_booked_rows_content_hash_uidx").on(table.contentHash),
    index("revolut_booked_rows_semantic_key_idx").on(table.semanticKey),
  ],
);
