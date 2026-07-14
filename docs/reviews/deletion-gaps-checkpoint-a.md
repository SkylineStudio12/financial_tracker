# Deletion gaps (full-reversal delete) - Checkpoint A design

**Status:** Tier-3 Checkpoint A approved 2026-07-14. No migration. Review-log
rows for Checkpoint A and B land at the implementation commit per L-0019.

## Problem and goal

The standing guard says: do NOT delete imported investment transactions
through the normal UI. Two gaps make deletion unsafe (follow-up items 1, 2):

1. Soft-delete does not clear `revolut_booked_rows` markers, so a deleted
   row's content hash stays reserved and blocks re-import forever.
2. Soft-delete does not handle stock-split adjustment records referencing a
   deleted buy, and splits themselves are unreachable by transaction delete,
   leaving permanently scaled quantities with no owner.

Goal: full-reversal deletion — delete a booked batch, re-import the same CSV,
and it books cleanly. This unit retires the standing rule by replacing it
with code-enforced behavior.

## 1. Current delete-path inventory

`softDeleteTransaction` (`src/lib/ledger/service.ts:381`) today, for an
investment transaction:

1. Snapshots the transaction into `audit_log`.
2. Trade-integrity block (Phase 4 Stage 2, in the single write path):
   - Deleting a BUY whose lot has live consumptions is **refused**
     (`ledger.consumedBuyCannotBeDeleted`, service.ts:407).
   - Deleting a SELL soft-deletes its `lot_consumptions`
     (service.ts:412) — lots restore automatically because remaining
     quantity is derived from live rows only.
   - Soft-deletes the `trades` rows.
3. Soft-deletes the `transactions` row and its `postings`, appends the audit
   row. The L-0011-scoped partial unique indexes mean soft-deleted rows
   free their keys.

### Every dependent record type a booked Revolut batch creates

| Record | Created by | Current delete handling |
|---|---|---|
| `transactions` + `postings` | `bookRow` → `createTransaction` | Soft-deleted ✓ |
| `trades` | trade bookings | Soft-deleted ✓ |
| `lot_consumptions` | sell bookings | Cascaded on sell delete ✓; guard on buy delete ✓ |
| `revolut_booked_rows` (global `content_hash` unique) | `approveRevolutBatch` (brokerage-service.ts:604) | **Ignored** — marker survives, row can never re-book |
| `revolut_import_rows` (status/`transactionId`/`stockSplitId`/`bookedAt`) | staging + booking | **Ignored** — row still says `booked`, links a dead transaction (same staleness family as the parked ING inbox gap) |
| `revolut_import_batches` (global `raw_text_hash` unique) | `createRevolutImportBatch` | **Ignored** — same CSV can never re-stage |
| `stock_splits` | split bookings | **Unreachable** — a split has no ledger transaction; no delete path exists at all |
| `stock_split_lot_adjustments` / `stock_split_consumption_adjustments` | split bookings (before/after audit per lot/consumption) | **Ignored** — and the in-place scaled `trades.quantity` / `lot_consumptions.quantity` values have no reversal owner |
| `securities` created at staging | staging | Out of scope — follow-up item 8 (abandoned-batch cleanup), unchanged here |
| `audit_log` rows | every write | Append-only, intentionally retained |
| Tax accruals | — | None exist for this batch (booked verification: zero accruals); no handling needed |

The Revolut path writes no `postings.externalRef`; its dedup is entirely
marker-based, so the L-0011 ref-freeing property does not help here — the
markers are hard rows with a global unique hash.

## 2. Full-reversal semantics

### Decision: reversal is per-BATCH; single-transaction delete of an imported investment transaction is refused in code

- **Whole-batch reversal** (`deleteBookedRevolutBatch`, new, in
  `brokerage-service.ts`) is the supported operation and the only one that
  achieves the goal (re-import needs the batch hash and every marker freed
  together).
- **Single-transaction delete**: `softDeleteTransaction` gains one check in
  the trade-integrity block: if a live `revolut_booked_rows` marker
  references the transaction, refuse with a new code
  (`ledger.importedInvestmentTransactionRequiresBatchDelete`). This follows
  the existing precedent exactly — trade EDIT is already refused outright
  (`assertNotTradeTransaction`, service.ts:324) with delete-and-re-enter as
  the correction path; here single DELETE is refused with batch-reversal as
  the correction path. Manual (non-imported) trades keep today's delete
  semantics unchanged.
- Rationale for refusing rather than cascading per-row: a per-row marker
  clear would strand a `pending` row inside a `booked` batch with no re-book
  path, forcing the parked "pending vs booked-then-deleted" inbox policy
  decision now. Refusal avoids inventing that policy, keeps the inbox
  truthful, and loses no capability the goal needs.

### What batch reversal does, in order, inside ONE `db.transaction`

Taking the same advisory lock the approval service uses (serialize against a
concurrent booking):

1. **Eligibility guard.** Refuse unless `batch.bookedAt` is set. Refuse if
   any batch buy has live consumptions from OUTSIDE the batch (a later
   manual sell or another batch's sell consumed it) — same integrity rule as
   the single consumed-buy guard, lifted to batch scope. Refuse if any batch
   split adjusted trades outside the batch that a reversal inside this batch
   cannot see (symmetric cross-batch check).
2. **Reverse ledger bookings, newest-first** (descending `timestampMicros`
   booking order — the exact inverse of the chronological order
   `approveRevolutBatch` booked in):
   - sell → soft-delete via the existing path (cascades its consumptions);
   - split → **invert from stored records**: set each referenced
     `trades.quantity` to the adjustment's `quantityBefore`, set each
     referenced `lot_consumptions.quantity` to its `quantityBefore`, then
     delete the adjustment rows. This is the SAME record-reading convention
     `loadLotsAsOf` established (service.ts:327): restore stored
     before-values, never divide by the ratio — stored values avoid rounding
     assumptions and compose across multiple splits. The MAINTENANCE pairing
     note on `loadLots`/`loadLotsAsOf` extends to this reversal: three
     readers of one convention now, so the doc comment gains the third name.
   - buy / dividend / fee / cash-transfer → soft-delete via the existing
     path. Newest-first order guarantees every buy is unconsumed by the time
     its turn comes (its sells and splits were reversed first), so the
     existing consumed-buy guard never fires spuriously.
3. **Tear down staging, FK-safe order:** delete `revolut_booked_rows`
   (references import rows and splits) → delete the batch
   (`revolut_import_rows` cascade via FK) → delete `stock_splits` rows
   (their adjustment rows already deleted in step 2; the FK from import rows
   to splits is gone with the rows). Freeing the batch row frees
   `raw_text_hash`; freeing the markers frees every `content_hash`.
4. **Audit.** One `audit_log` row per reversed transaction already lands via
   `softDeleteTransaction`; the batch reversal appends a batch-level audit
   row recording batch id, hash, and counts.

Ledger history stays soft-deleted (auditable); staging records are hard
rows by design (they were hard-created, carry no soft-delete columns, and
their FK cascade `rows → batch` already encodes hard teardown).

## 3. Re-import proof

Success criterion as an executable fixture (new e2e test, isolated per §
"Test isolation"):

1. Stage and book a synthetic CSV fixture shaped like the real export,
   containing at minimum: two buys; a sell consuming buy #1 (consumption);
   a split AFTER a buy (lot adjustment, NOW shape); a buy → sell → split
   sequence (consumption adjustment — the shape the live DB lacks); a
   dividend, a fee, and a cash top-up row (breadth across `bookRow` kinds).
2. Snapshot state A: holdings via `loadLots`, cost basis, marker count and
   hashes, import-row statuses, batch verification block.
3. `deleteBookedRevolutBatch`.
4. Assert clean state: zero `revolut_booked_rows` for those hashes; zero
   `stock_split_*_adjustments`; zero `stock_splits`; zero live trades,
   consumptions, transactions, postings from the batch; batch and rows gone;
   `raw_text_hash` re-stageable.
5. Re-import the SAME CSV text: `createRevolutImportBatch` must accept it
   (no hash collision), staging must show zero suspected duplicates, and
   `approveRevolutBatch` must book with zero `duplicate` statuses.
6. Snapshot state B and assert A = B on holdings, per-lot quantities and
   basis, marker count, and import-row statuses — re-import idempotence.

## 4. Guard interaction — what retires the standing rule

The rule existed because deletion silently corrupted (split quantities) and
silently blocked re-import (markers). After this unit:

- The corrupting path is **closed by code**, not by documentation: single
  deletes of marker-referenced transactions are refused with a
  user-readable error, and the batch operation reverses completely or not at
  all (single transaction, guards first).
- The handover's "Temporary standing guard" section is removed in the same
  implementation commit (with the owner's confirmation), retiring follow-up
  items 1 and 2.

Residual restrictions that REMAIN by design:

1. Single-transaction delete of an imported investment transaction stays
   refused (directs to batch deletion).
2. Batch deletion UI (on the batch page, `/p/[profile]/imports/[batchId]`)
   requires an explicit confirmation that lists what will be reversed —
   transaction count, split count with tickers, marker count — with the
   split line called out prominently (the owner asked for a confirmation
   step on split-referenced deletes; this makes it unmissable rather than a
   separate dialog).
3. Cross-batch/manual consumption of a batch's buys refuses the whole
   reversal (state the blocking sells in the error).

## 5. Verification plan (L-0012 / L-0015 family)

New automated coverage (all in the isolated test environment):

1. **Marker clearing:** after batch delete, zero `revolut_booked_rows` exist
   for the batch's hashes and zero orphan markers exist globally
   (`sourceRowId` always resolves).
2. **Split reversal:** lot and consumption quantities equal the stored
   `quantityBefore` values (asserted against the fixture's known numbers —
   per L-0015, the test pins stored-value restoration, never ratio
   arithmetic); adjustment and `stock_splits` rows gone; the NOW-shape
   ticker fully reversed and then re-imported to identical post-split state.
3. **Sell-then-delete ordering:** a batch containing buy → sell reverses
   newest-first with no negative or orphan quantities at any intermediate
   step (asserted via the final state plus the refusal tests below).
4. **Refusal tests:** single delete of a marker-referenced transaction
   refuses with the new code; batch reversal refuses when an outside sell
   consumed a batch buy; both leave state untouched.
5. **Re-import idempotence:** §3 fixture end to end — state A = state B.
6. **Characterization / regression:** a second throwaway entity's booked
   state (manual trades, one manual split via `executeStockSplit`) is
   byte-identical before and after an unrelated batch reversal; the existing
   trade-write, stock-split, as-of valuation, preview-parity, and booking
   suites stay green.
7. **Isolation proof:** the live dev DB is untouched by construction (the
   suite refuses to start against it — below); additionally the suite
   asserts zero residual rows in every touched table at teardown, the same
   throwaway-residue-zero discipline the as-of unit used.

## 6. Test isolation (precondition; partially retires follow-up item 9)

These tests book, COMMIT, delete, and re-book. The existing two isolation
styles both fail here:

- **Throwaway entity on the live DB** (as-of unit style,
  `src/lib/investments/test-support.ts`): does not isolate the GLOBAL unique
  indexes — `revolut_booked_rows.content_hash` and
  `revolut_import_batches.raw_text_hash` collide with the real booked batch
  `62719433…` regardless of entity.
- **Forced-rollback outer transaction** (booking e2e style,
  `booking.e2e.test.ts` ROLLBACK pattern): cannot span book → delete →
  re-import, because `approveRevolutBatch`, `softDeleteTransaction`, and the
  reversal each open their own `db.transaction` on the module-level pool;
  there is no shared outer scope to roll back, and the flow REQUIRES commits
  between steps.

**Mechanism: a separate test database.** `src/db/index.ts` reads
`DATABASE_URL` once at import, so the unit adds a test-runner entry
(`npm run test:reversal` or similar) that:

1. Requires `TEST_DATABASE_URL` to be set, refuses if unset, and refuses if
   it equals `DATABASE_URL` — the suite can never start against the live dev
   DB.
2. Launches the test process with `DATABASE_URL=$TEST_DATABASE_URL`.
3. The suite itself re-asserts the sentinel at startup (database name must
   match an explicit `_test` suffix convention) — belt and suspenders, per
   the owner's "never the live DATABASE_URL" requirement.
4. Applies drizzle migrations to the test DB, provisions the Revolut
   accounts via the existing idempotent provisioning, runs, and asserts
   zero-residue teardown (§5.7).

This gives future write-path suites (including the currently-collision-
blocked booking e2e) a home, which is why it only PARTIALLY retires
follow-up item 9: migrating the existing suites onto it is separate work,
not this unit.

## 7. Scope boundary

This unit changes:

- `softDeleteTransaction`: adds ONE refusal check (marker-referenced
  transactions) inside the existing trade-integrity block — Tier-3 named
  file, no other behavioral change;
- `brokerage-service.ts`: adds `deleteBookedRevolutBatch` (+ its action and
  the batch-page confirmation UI);
- new error codes registered in both `errors.*` catalogs per the 3f
  codes-at-edge convention and L-0014 (whole class stays code-only);
- the new isolated test suite + runner entry;
- `docs/agent-handover.md`: standing-guard section removed at implementation
  (owner-confirmed).

It does NOT touch: the booking write path (`bookRow`, `createTransaction`),
ledger zero-sum or RON mirroring, tax, price snapshots/sync/providers,
`loadLots`/`loadLotsAsOf` read logic (the reversal only follows their stored
before-value convention), the ING import path or its parked inbox policy,
and the securities cleanup question (follow-up item 8).

**Migration: none.** Reversal consumes the existing adjustment records and
existing FK topology; no schema change, no enum change (refusing single
deletes avoids a new import-row status).

Open items this design deliberately leaves parked: the ING inbox
delete-staleness policy (unchanged scope), and migrating existing e2e suites
onto the test database (follow-up item 9 remainder).
