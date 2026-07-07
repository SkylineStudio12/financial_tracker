import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { importRowStatus } from "./enums";
import { id, moneyMinor, timestamps } from "./helpers";
import { accounts, entities } from "./entities";
import { categories } from "./categories";
import { transactions } from "./transactions";

/**
 * STAGING tables for bank-statement imports — the review inbox. The ledger
 * stays pure: these tables hold parsed/classified PROPOSALS only, never
 * postings. Booking a row goes through the ledger service (createTransaction)
 * like every other write; nothing here is a second write path.
 *
 * No soft delete: staging data is derived from the statement text and can be
 * recreated by re-importing; deleting a batch cascades its rows.
 */
export const importBatches = pgTable(
  "import_batches",
  {
    id,
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    /** The ledger account the statement belongs to (the bank leg of every
     * booked row). */
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => accounts.id),
    /** Import format tag, e.g. "ing_pdf_text". */
    source: text("source").notNull(),
    /** Statement identity as printed, whitespace-normalized ("Nr.6/30.06.2026"). */
    statementNumber: text("statement_number").notNull(),
    /** The statement's own IBAN (not the counterparty's). */
    statementIban: text("statement_iban").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    openingBalanceMinor: moneyMinor("opening_balance_minor").notNull(),
    closingBalanceMinor: moneyMinor("closing_balance_minor").notNull(),
    /**
     * SHA-256 of the pasted statement text — an exact-re-paste CONVENIENCE
     * guard only (friendly "already imported" instead of 17 duplicate rows).
     * It is NOT the dedup guarantee: the same statement extracted slightly
     * differently hashes differently and sails past this. The load-bearing
     * dedup control is the row-level partial unique index
     * postings_account_external_ref_uidx — never lean on this hash for
     * correctness.
     */
    rawTextHash: text("raw_text_hash").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("import_batches_raw_text_hash_uidx").on(table.rawTextHash),
    index("import_batches_account_period_idx").on(
      table.bankAccountId,
      table.periodStart,
      table.periodEnd,
    ),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    id,
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    /** Statement line number — display + per-batch position; the synthetic
     * refless key embeds it, but identity lives in resolvedExternalRef. */
    lineNo: text("line_no").notNull(),
    /**
     * The row's import identity, resolved at batch creation: the ING long
     * bank reference where printed, else the synthetic statement-scoped key
     * ING:{iban}:{statementNumber}:{lineNo}. Written to the bank posting's
     * external_ref at booking, where the partial unique index enforces
     * once-per-account.
     */
    resolvedExternalRef: text("resolved_external_ref").notNull(),
    /** Stage-3 classifier output (ImportKind); text because the taxonomy is
     * classifier-owned and may grow. */
    kind: text("kind").notNull(),
    confidence: text("confidence").notNull(),
    reason: text("reason").notNull(),
    /** Full ClassifiedRow (parsed row + identity inventory + FX), verbatim. */
    payload: jsonb("payload").notNull(),
    suggestedCategoryId: uuid("suggested_category_id").references(() => categories.id),
    /**
     * Amendment-1(b) overlap control: TRUE when this row is REFLESS and the
     * batch period overlaps an earlier batch on the same account — the
     * synthetic key cannot dedup across differently-numbered statements, so
     * these exact rows demand individual human confirmation and are excluded
     * from confirm-all.
     */
    overlapSuspect: boolean("overlap_suspect").notNull().default(false),
    status: importRowStatus("status").notNull().default("pending"),
    /** Set when booked (the ledger transaction) or duplicate (the existing one). */
    transactionId: uuid("transaction_id").references(() => transactions.id),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("import_rows_batch_line_no_uidx").on(table.batchId, table.lineNo),
    index("import_rows_batch_id_idx").on(table.batchId),
  ],
);
