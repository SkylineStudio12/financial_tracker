import { sql } from "drizzle-orm";
import type { LedgerTx } from "./service";

/**
 * Shared transaction-scoped advisory lock for every operation that mutates
 * import ownership across a whole batch: Revolut batch approval, full batch
 * reversal, single-row restore, and single-row purge.
 *
 * LOCK ORDER (documented so these paths serialize instead of interleaving):
 *   1. `pg_advisory_xact_lock(IMPORT_OWNERSHIP_LOCK)` — taken FIRST, before any
 *      row lock, by approve / reversal / restore / purge. Only one of these
 *      runs at a time, so a reversal can never release/skip a row while a
 *      concurrent restore or purge flips that same row's state.
 *   2. `SELECT ... FOR UPDATE` on the affected transaction/batch rows.
 *
 * Row-level CRUD edit and soft-delete do not take this lock; they serialize
 * against reversal through the FOR UPDATE that reversal now holds on every
 * batch-owned transaction (see `deleteBookedRevolutBatch`).
 *
 * The integer is arbitrary but fixed; it must be identical across every caller
 * for the lock to be shared.
 */
export const IMPORT_OWNERSHIP_LOCK = 734920260711;

/** Acquire the shared import-ownership advisory lock for the current tx. */
export async function acquireImportOwnershipLock(tx: LedgerTx): Promise<void> {
  // Embed the key as a literal (not a bound param) so it matches the original
  // inline call byte-for-byte and avoids bigint/int param-type ambiguity.
  await tx.execute(sql.raw(`select pg_advisory_xact_lock(${IMPORT_OWNERSHIP_LOCK})`));
}
