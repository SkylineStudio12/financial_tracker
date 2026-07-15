# CRUD-1: non-investment transaction edit, delete, trash, and restore - Checkpoint A

**Status:** Tier-3 Checkpoint A proposed 2026-07-15. No implementation or
review-log row exists yet. Per L-0019, Checkpoint A and B rows land with the
implementation commit only after both owner approvals.

## Goal and boundary

Give the owner direct row-level edit and delete controls for every transaction
that has no investment lot topology. The arithmetic guard remains mandatory;
batch membership and import provenance inform the owner but do not block an
otherwise valid non-investment operation.

The capability boundary is structural, not the `transactions.kind` label:

- A transaction with any `trades` row, live or deleted, is investment-owned and
  unavailable in CRUD-1. This includes buys and sells and preserves their lot,
  consumption, and split relationships for CRUD-2.
- A transaction without a `trades` row is CRUD-1 eligible, including imported
  standard rows, transfers, custody fees, salaries, dividends, and opening
  balances. A Revolut row whose header kind is `trade` but which is only a
  custody fee remains eligible because it has no lot topology.
- Stock splits have no transaction row and do not appear in this UI.

This distinction matches the current live population: 233 live transactions
have trade rows; the 63 non-investment rows are 13 ING standard rows, 47
Revolut cash transfers, 2 Revolut custody fees, and 1 opening balance. This is
an inventory fact, not a hard-coded allowlist.

Server actions repeat the capability check inside the locked write transaction.
Disabled UI is explanatory only and is never the integrity boundary.

## 1. Current-state dependency inventory

`softDeleteTransaction` currently:

1. snapshots the transaction header, all postings, and tag ids;
2. protects investment buys and cascades investment sell consumptions;
3. marks the transaction and every posting deleted; and
4. appends one `audit_log` delete row.

It does not currently:

- mark `tax_accruals` deleted (the table has no `deleted_at`);
- reconcile ING `import_rows.status`, `transaction_id`, or `booked_at`;
- reconcile Revolut import-row lifecycle state;
- distinguish the latest posting set after more than one edit;
- restore or permanently delete a transaction; or
- preserve ING row-level duplicate ownership independently of a live posting.

`updateTransaction` currently keeps the transaction id but hard-deletes its
postings and tags before inserting replacements. Cascading removes old tax
accruals. It blocks a form edit that would lose an imported posting's
`external_ref`, and it blocks all trade edits. CRUD-1 replaces that
hard-replacement behavior for eligible rows with the revision mechanism below.

The existing full Revolut reversal owns batch-level teardown. CRUD-1 does not
weaken its lot/split guards and does not turn single-row CRUD into a batch
reversal.

## 2. Identity and revision decision

### Decision: keep the same transaction id and append posting revisions

The transaction UUID remains the stable UI route, import-row link, and audit
identity for its whole lifetime. Editing increments a stored revision number;
it never changes an existing posting's monetary fields.

Schema additions:

- `transactions.current_revision integer not null default 1`, constrained to
  be positive;
- `postings.revision integer not null default 1`, indexed with
  `(transaction_id, revision)`;
- `tax_accruals.revision integer not null default 1` plus `deleted_at`; and
- audit actions `restore` and `purge` in addition to the existing actions.

The migration backfills revision 1 for every existing transaction, posting,
and accrual. Existing deleted rows remain deleted. The current transaction
header remains the current human-readable state; prior headers, tags, and
posting ids remain in the append-only audit snapshots.

Why this wins over a superseding transaction UUID:

- list/detail URLs and source import links stay stable;
- a restore can reactivate the exact posting and accrual ids rather than
  reconstructing historical FX or tax values;
- old posting values remain auditable instead of being hard-replaced; and
- no route-resolution layer or lineage table is needed merely to find the
  current version.

### Single booking path

`createTransaction` remains the only function that inserts posting rows. It
gains an internal, discriminated replacement mode used only by the ledger
service: existing transaction id, expected revision, and caller-owned DB
transaction. Validation accepts the same transaction handle, so row locking,
validation, reversal, and replacement are atomic.

`editTransaction` performs this sequence in one DB transaction:

1. lock the transaction `FOR UPDATE`, verify `expectedRevision`, require it to
   be live, and assert no trade row exists;
2. snapshot only the current revision, including postings, tags, accruals, and
   import provenance;
3. validate and prepare the replacement through `createTransaction`'s shared
   path, including integer minor units, FX resolution, and exact RON zero-sum;
4. mark the old revision's postings and accruals deleted with one timestamp;
5. increment `current_revision`, replace the header and current tags, and have
   `createTransaction` insert the new posting/accrual revision;
6. mark linked import provenance `modified_after_import = true`; and
7. append an `audit_log` update containing the complete prior active revision.

All steps roll back together. Posting amounts, RON mirrors, account ids,
categories, and accrual links are never updated in place.

Date edits are therefore new bookings, not cosmetic header edits. Standard
rows re-resolve transaction-date FX and micro-tax planning. Salary and dividend
rows run their originating date-driven flow planner. CRUD-1 does not duplicate
or cache those calculations, so any as-of-date configuration used by the
originating path is resolved for the new date.

## 3. Import provenance and hash lifecycle

The existing schemas conflate two different facts: where a row came from, and
whether that source identity is still reserved against duplicate import. CRUD-1
separates them so a soft-deleted posting does not accidentally free its import
identity.

### Durable row provenance and ownership

Add `transaction_import_links` with:

- `transaction_id`, provider (`ing` or `revolut`), source batch UUID and source
  row UUID;
- source display label and original booking timestamp;
- canonical row identity: ING `(bank_account_id, resolved_external_ref)` or
  Revolut `content_hash`;
- lifecycle `active | trashed | released`;
- `modified_after_import`, `modified_at`, and release reason/time; and
- a partial unique index on the provider-specific canonical identity while the
  link is not released.

The link is the durable duplicate-ownership backstop. It survives posting soft
deletion and edit, so an imported posting no longer has to stay live merely to
reserve its identity. Existing `postings.external_ref` and
`revolut_booked_rows` remain useful source fields, but import booking must also
consult and create the durable link in the same transaction.

Only the row that actually booked owns a link. Import rows classified as
duplicates may point at an existing transaction but do not acquire a second
claim.

Both import-row tables gain `modified_after_import` and `modified_at`. The
`import_row_status` enum gains `trashed` and `purged`:

- edit: status remains `booked`, transaction link remains, and modified is set;
- soft-delete: status becomes `trashed`, transaction link and original
  `booked_at` remain for provenance, and the ownership claim remains active;
- restore: status returns to `booked`; and
- permanent delete: status becomes `purged`, `transaction_id` is cleared, and
  row ownership is released.

### Source-file hash claim

The raw statement/file hash is batch-level, so freeing it safely for one
permanently deleted row requires row-level claims to protect all surviving
rows. Add `import_source_claims`, unique on `(provider, raw_text_hash)`, and
backfill one active claim for every existing ING and Revolut batch.

The batch tables keep their raw hash as non-unique provenance; their current
unique raw-hash indexes move to `import_source_claims`. Import creation checks
the claim table. This gives the exact owner-ratified lifecycle:

- edit or soft-delete: row claim and source claim remain; exact or
  differently-extracted duplicate import is still blocked at source or row
  identity;
- permanent delete: release the row claim and its source claim; importing the
  same source can stage again, while every non-purged row is still rejected as
  a duplicate by its durable row claim; and
- full batch reversal: release all row claims and the source claim as part of
  its existing atomic teardown.

Releasing a source claim after one row is purged intentionally permits the
whole source file to be submitted again. It does not duplicate the other rows:
their row claims remain the correctness backstop. The old batch and hash remain
queryable as provenance.

### Interaction with full Revolut reversal

`deleteBookedRevolutBatch` is extended to recognize two valid row states:
booked/live and CRUD-trashed/deleted. It skips the already-deleted ledger row,
reverses every still-live row in booking-reverse order, then releases all
claims and performs its existing marker/staging teardown. Investment topology
guards remain unchanged.

The durable link is retained as `released` audit provenance when its staging
row disappears. A later trash restore can still identify the source, but if a
re-import has since reclaimed that row identity the restore confirmation must
report the collision. The collision policy below still lets the owner proceed,
with the restored row explicitly marked `released` rather than pretending it
owns duplicate protection.

## 4. Delete, restore, and purge mechanics

### Soft-delete

`softDeleteTransaction` becomes the guarded operation for eligible rows:

1. lock the row and assert no trade record exists;
2. snapshot the current revision and import links;
3. verify its live postings sum to exactly zero in stored RON minor units;
4. set the same `deleted_at` on the transaction, current-revision postings,
   and current-revision tax accruals;
5. set linked import rows and durable links to `trashed`, retaining all hash
   claims; and
6. append the delete audit record.

Every leg disappears together. No reversing posting is synthesized, and no
one-sided state can commit. Batch membership changes confirmation copy only.

### Restore

`restoreTransaction` runs in the ledger service and reverses the tombstone; it
is not a second transaction-construction path:

1. lock the deleted transaction and require a non-investment current revision;
2. load exactly that revision's posting and accrual rows;
3. verify at least two postings, exact stored-RON zero-sum, complete accrual
   links, and expected import-link topology;
4. clear `deleted_at` from the transaction, those same posting rows, and those
   same accrual rows;
5. return linked import rows/links to `booked`/`active` when their claims are
   still held; and
6. append a `restore` audit row.

Restore does not fetch today's FX rate or recalculate today's tax. That would
destroy equality. It reactivates the exact values already validated and stored
when the revision was booked.

Restore equality is defined as equality of the before-delete and after-restore
semantic snapshots:

- transaction id, revision, header, notes, and tags;
- every posting id and every stored field, especially `amount`, `currency`,
  and `amount_ron`;
- every accrual id, posting link, rule, year, and quarter;
- import source, source-row link, modified flag, and ownership state; and
- all affected account balances at stored-minor-unit level.

Expected audit rows and lifecycle timestamps are excluded from equality.

### Restore collision policy

Recommendation: detect and inform, then allow restore. The confirmation reports
a likely manual duplicate using a narrow fingerprint (entity, date, accounts,
stored amounts, and description), but the service does not refuse merely
because that fingerprint exists. The owner's explicit action wins.

Import-created duplicates are normally impossible because soft-delete retains
the row and source claims. If a full batch reversal or prior purge released the
claim and re-import has taken it, restore still proceeds after the explicit
warning but the old link remains `released`; it must not steal ownership from
the newer import.

### Permanent delete

`purgeTransaction` accepts only an already-soft-deleted, non-investment row and
is exposed only from Trash. In one transaction it snapshots and audits `purge`,
marks any source staging row `purged`, clears its transaction link, releases row
and source claims, then hard-deletes the transaction and cascading postings,
tags, and accruals. There is no other transaction hard-delete entry point and
no automatic purge.

## 5. Edit-form coverage

The existing `NewTransactionDialog` becomes a reusable create/edit shell. In
edit mode the transaction kind/type switch is fixed to the stored shape and the
title and primary action change to Edit/Save changes.

Prefill adapters cover every known non-investment structure:

- one real account leg plus equity/category legs: `StandardForm`, including
  imported ING rows and custody fees while preserving their stored header kind;
- two uncategorized real legs: `TransferForm`, including Revolut cash top-ups
  and withdrawals;
- salary and dividend: their existing guided flow components gain edit initial
  values and call the same flow planners, so tax legs are recomputed rather than
  exposed as hand-editable bookkeeping lines; and
- opening balance: a compact opening-balance adapter exposes account, date,
  description, and amount while keeping the equity counter-leg structural.

The server reconstructs provenance fields; it never trusts hidden
`external_ref`, source-row ids, or modified flags from the browser. Account,
date, amount, category, and description edits are ordinary replacement inputs.

An unknown non-investment posting shape is a typed server error and a test
failure, not a silently missing affordance. The implementation fixture set
covers every `transaction_kind` plus a custody-fee header with no trade row.

## 6. UI interaction decision for owner review

Options considered:

1. Inline Pencil and Trash icons in every row. Most discoverable, but consumes
   a fixed action column.
2. Kebab menu only. Compact, but hides the two primary owner actions.
3. Inline edit plus kebab delete. Saves width but gives unequal prominence to
   actions the owner described equally.

**Recommendation: option 1.** Add a fixed-width rightmost action column with
two icon buttons using Lucide `Pencil` and `Trash2`, familiar tooltips, focus
rings from the shared button primitive, and stable dimensions. Clicking an
action stops the row-link navigation. The action column remains visible at the
right edge of the horizontally scrolling table.

Investment rows show the same controls disabled, with the short reason
"Investment trades are edited separately" in both locales. They are not
silently absent. The detail page uses the same capability result and controls.

Delete uses one short `AlertDialog`: what will be removed and, for imported
rows, "From import batch {batch}. The source remains duplicate-protected."
There is one confirm click. No `window.confirm` remains.

Add a Trash icon/link with deleted count beside New transaction. The route
`/p/[profile]/transactions/trash` lists description, date, amount, entity,
source/batch when present, and deletion time. Each row has Restore and Delete
permanently. Permanent delete uses a deliberately stronger confirmation that
states both consequences: unrecoverable ledger deletion and import-hash
release. Trash has no purge timer.

## 7. Typed errors and i18n

Proposed new code-only errors, registered exhaustively in `AppErrorCode` and
both `errors.*` catalogs:

- `ledger.investmentCrudUnavailable`
- `ledger.transactionAlreadyDeleted`
- `ledger.transactionNotDeleted`
- `ledger.transactionRevisionConflict`
- `ledger.transactionRestoreTopologyChanged`
- `ledger.transactionImportOwnershipChanged`
- `ledger.transactionPurgeRequiresTrash`
- `ledger.transactionShapeUnsupported`

UI capability reasons are a typed union mapped exhaustively to catalog keys.
No raw error code or English service prose reaches the client. Catalog parity
and the code/catalog completeness guard are proven with cache-cleared tsc per
L-0013.

## 8. Verification plan

All write tests run only through a new isolated runner on `TEST_DATABASE_URL`.
The runner reuses the established identity and `_test` suffix sentinels and
asserts zero fixture residue at teardown. It never reads or writes assertions
against global live data.

Required fixtures:

1. **Manual expense delete:** snapshot balances and full semantic state;
   delete; assert transaction/postings/accruals share a tombstone, zero live
   legs, balanced account deltas, one audit row, and absence from live queries.
2. **Batch-owned row delete:** run once for ING and once for a non-trade
   Revolut row; assert status `trashed`, source/row claims retained, batch id
   reported, and exact plus differently-extracted duplicate import blocked.
3. **Edit dimensions:** amount, date, category, and account in separate cases;
   assert old revision tombstoned, new revision active, same transaction id,
   revision increment, exact zero-sum, and update audit. Date fixtures use two
   known FX dates and two known tax windows and require the newly resolved
   stored values.
4. **Guided forms:** salary and dividend edit through their planners; old
   accruals tombstoned and replacement accruals point only to replacement
   postings. Opening-balance and custody-fee adapters retain their intended
   transaction kind.
5. **Imported edit:** same source link, claim, and transaction id; staging row
   remains booked and is visibly `modified_after_import`; account edits do not
   lose duplicate protection.
6. **Restore equality:** compare the complete semantic snapshot before delete
   to after restore. Exact equality is required at stored minor units,
   including posting/accrual ids and import lifecycle state.
7. **Restore collision:** create a manual duplicate while the original is in
   Trash; warning is reported and explicit restore succeeds. A released import
   claim is not stolen from a newer import.
8. **Permanent delete:** require trash first; append purge audit; hard-delete
   only the target; release source and row claims; exact source re-import books
   the purged row while all surviving source rows remain duplicates.
9. **Investment boundary:** buy, sell, and previously deleted trade fixtures
   return the typed unavailable reason from query and action; no state changes.
10. **Concurrency:** two edits at the same expected revision yield one success
    and one `transactionRevisionConflict`; edit versus delete also leaves one
    complete state, never mixed posting revisions.
11. **Full-reversal compatibility:** a Revolut batch containing one already
    trashed non-trade row still reverses atomically; all claims are released,
    no marker/staging orphan remains, and investment reversal fixtures remain
    green.

Checkpoint B also runs the full service battery, catalog parity, cache-cleared
`tsc --noEmit`, changed-file eslint, G1-G4, route/browser checks, and `next
build`.

## 9. Migration and scope

One migration is expected for revisions, soft-deletable accruals, durable
import/source claims, import lifecycle/modified fields, and audit actions.
Backfill must be deterministic:

- all existing ledger rows become revision 1;
- live booked source rows become active links/claims;
- source rows pointing at already-deleted transactions become `trashed` with
  their claims retained (this includes the known deleted ING owner-transfer);
- duplicate/pending/skipped source rows do not acquire ownership; and
- migration verification rejects duplicate active claims before committing.

Implementation scope includes the named ledger service/actions, transaction
queries and UI, both import services where ownership is booked or released,
schema/migration, catalogs, isolated tests/runner, this design doc, and review
log rows at commit time.

Out of scope:

- editing, restoring, or purging a transaction with any trade row (CRUD-2);
- stock-split CRUD;
- changing investment lot, consumption, or split math;
- changing FX resolution, tax formulas/config values, seed data, or live data;
- automatically merging likely duplicates; and
- automatic Trash purge.

Invariants touched at implementation: integer minor units, exact RON zero-sum,
single posting-insert path through `createTransaction`, tax-accrual links,
soft-delete semantics, import row/source ownership, append-only audit, and
full-batch reversal compatibility.
