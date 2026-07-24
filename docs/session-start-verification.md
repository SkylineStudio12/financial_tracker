# Session-start verification

This is the canonical, read-only session-start checklist. Run the commands
top to bottom before any write, migration, or commit. Do not reconstruct a
query from chat memory. Report the raw output for every command, then stop.

## Interpretation: two tiers

**ANCHORS** are integrity-critical. An unexpected change is a STOP finding.

**WORKING-ZONE** values are current session state. Report them, but do not
escalate ordinary movement: test rows and owner-entered rows are expected.

**CARVE-OUT:** a working-zone number that moved in a way the owner did not
cause, or any anchor moving unexpectedly, still warrants STOP. The tier label
travels with each command so interpretation cannot be separated from the
check itself.

## Step 0 — database target (ANCHOR — STOP if unexpected)

Run this first. The connection must resolve to the LIVE `financial_tracker`
database on localhost. If the database is `financial_tracker_test`, or any
other database/host, STOP and run nothing else.

```sql
SELECT current_database() AS database_name,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port;
```

Expected: `financial_tracker` / `::1` / `5432`.

## Section A — ANCHORS (STOP on unexpected change)

### A1 — Git state (ANCHOR)

```sh
git status -sb
git rev-list --left-right --count origin/main...HEAD
```

Expected at authoring: `main` synced with `origin/main`, `0 0`, and a clean
tree. The current HEAD is `8e3fd58`. Any unexpected branch, ahead/behind
count, or dirty state is a STOP finding.

### A2 — Migration head (ANCHOR)

This check has THREE distinct values. Do not conflate them:

- local journal `idx`: `17`;
- PostgreSQL serial `id`: `23` (the maximum current id);
- migration tag: `0017_flawless_the_initiative`.

The journal idx and PostgreSQL serial id are different, non-contiguous
identifiers by design. Seeing `17` and `23` together is not itself an error.

Local journal artifact:

```sh
cat drizzle/meta/_journal.json
```

Take the LAST entry in the `entries` array and confirm its `idx` and `tag`
fields. Expected fields include `idx: 17` and
`tag: '0017_flawless_the_initiative'`.

PostgreSQL journal artifact (schema-qualified):

```sql
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY id;
```

Report the full listing and identify its maximum serial `id`. An unexpected
latest migration, hash, or serial history is a STOP finding.

### A3 — Salary transactions and tax legs (ANCHOR)

Salary bookings are modeled as `transactions.kind = 'salary'` with current
revision rows in `salary_transaction_details`. Employee association uses the
existing salary description convention because that details table has no
employee foreign key. Tax legs are linked through `tax_accruals.posting_id`.

```sql
SELECT
  e.id AS employee_id,
  e.name AS employee_name,
  t.id AS transaction_id,
  t.date,
  t.description,
  t.current_revision,
  std.pay_month,
  p.id AS posting_id,
  a.name AS account_name,
  a.type AS account_type,
  p.amount,
  p.amount_ron,
  p.counterparty,
  ta.id AS tax_accrual_id,
  tr.rule_type AS tax_rule_type,
  ta.year AS accrual_year,
  ta.quarter AS accrual_quarter
FROM public.employees e
JOIN public.transactions t
  ON t.kind = 'salary'
 AND t.description LIKE 'Salary ' || e.name || ' %'
JOIN public.salary_transaction_details std
  ON std.transaction_id = t.id
 AND std.revision = t.current_revision
JOIN public.postings p
  ON p.transaction_id = t.id
 AND p.revision = t.current_revision
 AND p.deleted_at IS NULL
JOIN public.accounts a ON a.id = p.account_id
LEFT JOIN public.tax_accruals ta
  ON ta.posting_id = p.id
 AND ta.transaction_id = t.id
 AND ta.revision = t.current_revision
 AND ta.deleted_at IS NULL
LEFT JOIN public.tax_rules tr ON tr.id = ta.tax_rule_id
WHERE e.id = '677a0517-8153-4066-8636-e9ca9d358a31'
  AND t.deleted_at IS NULL
ORDER BY t.date, t.id, p.id;
```

Expected at authoring: three salary bookings for pay months `2026-05`,
`2026-06`, and `2026-07`; each has seven current postings and four tax legs.
The tax legs are payslip-transcribed, never recomputed, and currently have:

- `salary_cas`: `-112500`;
- `salary_cass`: `-45000`;
- `salary_income_tax`: `-23000`;
- `cam`: `-10100`.

Any unexpected change to these salary postings or tax legs is a STOP finding.

### A4 — Keeper Revolut batch (ANCHOR)

```sql
SELECT
  id,
  owner,
  source_file_name,
  parsed_row_count,
  staged_row_count,
  correction_pair_count,
  raw_text_hash,
  approved_at,
  booked_at,
  created_at
FROM public.revolut_import_batches
ORDER BY created_at, id;
```

Expected at authoring: one row, the keeper batch:

- id `62719433-b0da-4f6d-8276-57cf68c59410`;
- source `All stock transactions.csv`;
- counts `291 / 285 / 3` for parsed / staged / correction pairs;
- raw-text hash beginning `d83994230f65e38f7659abf2a179c471f24949adaaa0852e60ac7d2b92c812b0`.

A change to this batch is an anchor concern and requires STOP.

## Section B — WORKING-ZONE (report only; do not escalate ordinary movement)

These are informational readings, not test assertions. Baseline values below
were observed on `2026-07-24`; they are non-binding and move as the owner
enters data.

### B1 — Transaction counts (WORKING-ZONE)

```sql
SELECT 'transactions' AS relation,
       count(*) AS total,
       count(*) FILTER (WHERE deleted_at IS NULL) AS active,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted
FROM public.transactions;
```

Current informational reading: `323 / 302 / 21` (total / active /
soft-deleted). The transaction date column is `date`, not `occurred_at`.

### B2 — Category counts (WORKING-ZONE)

```sql
SELECT 'categories' AS relation,
       count(*) AS total,
       count(*) FILTER (WHERE deleted_at IS NULL) AS live,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted
FROM public.categories;
```

Current informational reading: `27 / 27 / 0` (total / live /
soft-deleted).

### B3 — Employee counts (WORKING-ZONE)

```sql
SELECT 'employees' AS relation,
       count(*) AS total,
       count(*) FILTER (WHERE deleted_at IS NULL) AS live,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted
FROM public.employees;
```

Current informational reading: `2 / 2 / 0` (total / live /
soft-deleted).

### B4 — Salary-profile count (WORKING-ZONE)

```sql
SELECT 'salary_profiles' AS relation, count(*) AS total
FROM public.employee_salary_profiles;
```

Current informational reading: `4` total profiles.

The chat-16 handover recorded `322 / 301 / 21` transactions. The verified
current value is `323 / 302 / 21`; the delta was the owner-entered July
HolyCode revenue booking, not a database anomaly (L-0024). Do not hardcode
these working-zone readings as expected values.

## Report and stop

Report each command's raw output. Mark each result `PASS`, `FAIL`, or
`SURPLUS` only as appropriate to its tier: anchors stop on unexpected change;
working-zone values are informational unless the carve-out applies. After
reporting, stop and await the next owner-authorized step.
