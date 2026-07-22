# Session-start verification

This is the canonical session-start checklist. Run it read-only, before any
write, migration, or commit. Report the expected and observed values in a
table, mark each row `PASS`, `FAIL`, or `SURPLUS`, and stop after reporting.

## Step 0 — database target (L-0025; first)

Print the connected database name and connection target before running any
other query. The expected target is the live `financial_tracker` database on
localhost. If the target is `financial_tracker_test`, or any other database,
stop immediately and report; run nothing else.

## Git state

Report:

- `HEAD` and `origin/main`; expected `HEAD == origin/main`.
- `git status --porcelain`; expected clean.
- zero unpushed commits.
- `git worktree list`; expected exactly one worktree, the main tree.

Any mismatch is a surfaced finding, not an invitation to repair state during
the session-start pass.

## Transaction counts

Read the established triple:

- total transactions;
- live transactions (`deleted_at IS NULL`);
- soft-deleted transactions (`deleted_at IS NOT NULL`).

The transaction date column is `date`, not `occurred_at`. This corrects the
14-01T wording so future passes do not have to guess the schema. Compare the
observed triple with the expected baseline and list any surplus rows by id,
`date`, and description. Do not resolve an unexpected delta in this pass.

## Migration head — dual reporting

Confirm the migration head and report both journal artifacts:

- `drizzle/meta/_journal.json` `idx`, which is contiguous;
- PostgreSQL `__drizzle_migrations.id`, which is a serial identifier and may
  be non-contiguous or gappy from historical re-runs. Gaps are documented
  history, not a defect.

## Categories and icons

Report category total, live, and soft-deleted counts. Also report the count
of live category rows whose `icon` is non-NULL. The expected live set has
non-NULL icons, while soft-deleted rows remain untouched by the backfill.

## July salary spot check

Confirm transaction
`625cff91-3c9c-4a6e-9c78-57ebef136110` exists, is live, has pay month
`2026-07`, and has transaction date `2026-08-10`.

## Employee and salary-profile counts

Expected counts are one employee and one salary profile.

## Report and stop

Use one table with expected, observed, and verdict columns. Verdicts are
`PASS`, `FAIL`, or `SURPLUS`. After reporting, stop and wait for the next
owner-authorized step.

### End-purge note

The 14-02M category-icons unit predates the EN-values-only i18n policy.
`manage.icon*` and `errors.manage.categoryIconInvalid` are already
RO-authored. The end-purge EN==RO identity grep should pass over these keys;
no corrective action is needed.
