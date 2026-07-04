import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditAction } from "./enums";
import { id, timestamps } from "./helpers";

/**
 * Append-only audit trail, populated by application logic in later phases.
 * previous_values holds a JSON snapshot of the row before the change
 * (null for inserts). Never soft-deleted, never updated.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id,
    tableName: text("table_name").notNull(),
    rowId: uuid("row_id").notNull(),
    action: auditAction("action").notNull(),
    previousValues: jsonb("previous_values"),
    ...timestamps,
  },
  (table) => [index("audit_log_table_name_row_id_idx").on(table.tableName, table.rowId)],
);
