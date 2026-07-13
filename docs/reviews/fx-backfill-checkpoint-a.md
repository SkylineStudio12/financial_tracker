# FX backfill — Checkpoint A design

**Status:** Tier-3 Checkpoint A approved by the owner on 2026-07-13. The
implementation and database backfill remain subject to Checkpoint B review
before commit.

## Baseline

- The earliest holding trade is dated 2024-01-10.
- The requested backfill starts at 2024-01-02, providing a buffer before that
  trade. BNR's first published banking day in the range is 2024-01-03.
- The current `fx_rates` data starts at 2025-01-03, has a 153-day gap between
  2025-12-31 and 2026-06-02, and currently stops at 2026-07-07.
- `src/lib/investments/valuation.ts` hard-codes `FX_FLOOR` as 2025-01-03, so
  valuation rejects dates that a completed backfill would support.

## 1. Source mechanism

### Existing BNR sources

`src/lib/fx/bnr.ts` already uses BNR's official XML feeds:

- Latest published rates: `https://www.bnr.ro/nbrfxrates.xml`
- Historical year: `https://www.bnr.ro/files/xml/years/nbrfxrates{YEAR}.xml`
  (for example,
  `https://www.bnr.ro/files/xml/years/nbrfxrates2024.xml`)

Both feeds use the same XML shape: `DataSet/Body/Cube`, where each `Cube` has a
`date="YYYY-MM-DD"` attribute and contains `Rate` elements with a `currency`
attribute, optional `multiplier`, and decimal text value. The values are RON per
unit of foreign currency. The existing parser keeps EUR and USD and normalizes
rates that declare a multiplier.

The yearly feed covers the required history, so this unit does not need another
provider, parser, or write path. A read-only source check on 2026-07-12 found:

| Feed | Published days | First | Last |
|---|---:|---|---|
| 2024 | 252 | 2024-01-03 | 2024-12-31 |
| 2025 | 248 | 2025-01-03 | 2025-12-31 |
| 2026 | 129 | 2026-01-05 | 2026-07-10 |

The latest feed also reported 2026-07-10. These are banking-day observations;
weekends and BNR holidays are intentionally absent.

### Historical fetch and write

`src/lib/fx/sync.ts` already provides `backfillRange(from, to)`. It fetches each
required yearly XML document, filters the parsed observations to the inclusive
range, and passes all days to `upsertDailyRates`. That function inserts into
`fx_rates` and resolves conflicts on the existing unique key
`(fx_rates.date, fx_rates.currency)` by updating the rate.

The implementation will retain that one path. It will strengthen the historical
operation with an all-years preflight validation before calling the existing
upsert. When the range includes the current year, it will also fetch BNR's
latest-day XML and require its date and EUR/USD values to match the same day in
the yearly XML; if the yearly file has not yet added that day, the validated
latest observation is appended. A fetch, source disagreement, or validation
failure must occur before any database write.

The intended operator command remains the existing range command:

```sh
npm run fx:sync -- --from 2024-01-02 --to <execution-date>
```

`<execution-date>` means the actual local date when the approved backfill runs,
not a date hard-coded in source.

## 2. Scope

The approved implementation would:

1. Fetch BNR EUR and USD rates from 2024-01-02 through the execution date,
   inclusive, using the yearly feeds and the latest available current-year data.
2. Validate the complete fetched set before writing.
3. Upsert both currencies through the existing `upsertDailyRates` function and
   existing `(date, currency)` conflict target.
4. Fill the 2026 hole, add the missing 2024 history, and bring the series through
   BNR's latest published banking day.
5. Make valuation's supported floor reflect the completed paired data.

Out of scope:

- No schema or migration change.
- No new FX write path and no direct ad hoc database insert.
- No synthetic weekend or holiday rows.
- No ledger, posting, zero-sum, tax, soft-delete, account, trade, or seed change.
- No price backfill; that is the next unit.

## 3. FX floor policy

### Options

**Keep a constant and update it during this backfill.** This is simple and
deterministic in code, but it can silently become stale whenever database
coverage changes. Worse, the constant can claim support for dates that the
actual table no longer supports.

**Derive the floor from stored paired coverage.** Query the earliest date on
which both required currencies, EUR and USD, exist, and use that date when a
valuation operation begins. This keeps the declared boundary aligned with the
data that valuation will actually read.

### Recommendation

Derive the floor from the actual earliest fully paired EUR/USD date in
`fx_rates`, through one shared query helper used by valuation. In this
application's request-based runtime, this should be resolved when valuation
begins rather than captured once in a module-level startup constant.

After the proposed backfill the expected floor is 2024-01-03, BNR's first
published day in the requested range. The range starts on 2024-01-02, but that
date has no BNR observation and therefore must not be advertised as the floor.

The derived policy can move forward if old rows are removed. That is preferable
to a stale constant: it fails closed by narrowing the supported period instead
of pretending absent data exists. To prevent unnoticed drift, the backfill's
post-write checks will assert the expected 2024-01-03 paired boundary and report
the derived floor explicitly.

## 4. Verification plan

Verification follows L-0015: prove direction and coverage with fixtures and
structural checks, not only a green command.

### Pre-write source validation

- Collect every BNR `Cube` in the requested range before opening the upsert.
- Require exactly one EUR and one USD observation for every included BNR date.
- Reject duplicate currencies, one-sided dates, malformed decimals, and
  non-positive values.
- Require the first published date to be 2024-01-03 and the latest fetched date
  to match BNR's latest published date at execution time.

### Post-write database validation

- **Perfect pairing:** group rows by date across the full range and require one
  EUR plus one USD row on every represented date. One-sided date count must be
  zero.
- **Gap bound:** order dates per currency and require no adjacent observations
  more than seven calendar days apart. EUR and USD must produce the same date
  sequence. This permits ordinary weekends and BNR holidays while catching the
  current 153-day hole.
- **Boundary/currentness:** require the earliest paired date to be 2024-01-03
  and the last paired date to equal the latest date published by BNR. Also
  require the last observation to be no more than seven calendar days before
  the execution date.
- **Exact fixtures:** compare these stored values exactly with the corresponding
  BNR XML decimals:

| Date | EUR (RON per EUR) | USD (RON per USD) |
|---|---:|---:|
| 2024-01-10 | 4.9724 | 4.5418 |
| 2025-07-10 | 5.0774 | 4.3275 |
| 2026-07-10 | 5.2337 | 4.5791 |

  The database's `numeric(18,6)` representation may add trailing zeroes; exact
  comparison means equal decimal value after canonical decimal normalization,
  never a floating-point tolerance.
- **Row-count sanity:** derive the expected banking-day count from the fetched
  BNR Cubes, then require exactly two rows per published date in the database
  range. For the source state observed on 2026-07-12, that is 629 published days
  and 1,258 EUR/USD rows. The implementation must derive this value at execution
  time because the current-year feed advances.
- **Overwrite delta:** before the upsert, capture every existing
  `(date, currency, rate)` row in the target range. After the upsert, compare
  those same keys and report how many existing rate values changed, listing each
  date, currency, previous rate, and replacement rate when the count is nonzero.
  The expected count is zero. Any nonzero count halts the unit for owner review
  before Checkpoint B because it indicates that BNR's yearly and latest feeds
  disagree for a rate already stored locally.
- **Idempotence:** run the same range a second time and prove that row count,
  dates, currencies, and rate values are unchanged. The existing conflict update
  may refresh `updated_at`; semantic data must remain unchanged and no duplicate
  row may appear.

The verification report will include compact findings for each assertion and
the three fixture comparisons rather than raw table dumps.

## 5. Risk register

| Risk | Design control |
|---|---|
| Rate direction is inverted | BNR XML values are stored as RON per one unit of foreign currency, matching `rateToRon`. The three fixtures above span 2024, 2025, and 2026 and must match exactly before approval. Values around 5 RON/EUR and 4–5 RON/USD also make an accidental reciprocal visible. |
| A BNR holiday is mistaken for missing data | Use BNR's published `Cube` dates as the expected business-day calendar; do not synthesize rows. The separate maximum-seven-calendar-day check catches material internal holes without treating normal weekends as errors. |
| One currency is absent on a published date | Validate exact EUR/USD pairing in the complete in-memory source set before writing, then repeat the pairing assertion against stored rows after the upsert. |
| A yearly fetch fails after earlier years have written | Preserve the current collect-first behavior: all yearly fetches and preflight checks complete before the single shared upsert is called. |
| A yearly or latest feed revises a previously stored rate | Capture target-range values before the upsert and compare them afterward. Report all deltas and halt before Checkpoint B unless the changed-row count is zero. |
| A rerun creates duplicates or changes meaning | Retain the unique `(date, currency)` constraint and existing conflict update. Verify semantic idempotence with a second identical run. |
| A hard-coded valuation boundary becomes stale again | Replace `FX_FLOOR` with the shared earliest-paired-date query and assert the expected boundary after backfill. |
| Currentness is mistaken for calendar-date coverage | Compare the stored last date to BNR's latest published date, not blindly to today; separately enforce that it is at most seven calendar days old. |
| Existing resolver fallback masks a large hole | Treat the explicit coverage and gap checks as required completion criteria for this unit. A successful point lookup alone is not evidence that the series is complete. |

## Planned implementation boundary

The likely implementation surface is limited to the existing FX source/sync
module, its command and tests, the valuation floor read, and focused tests for
coverage and floor behavior. The exact diff remains subject to repository-guided
implementation after Checkpoint A approval.

Per L-0019, `docs/review-log.md` is deliberately unchanged at this checkpoint.
The approved Checkpoint A row will be added durably in the same future commit as
the implementation; Checkpoint B will still require owner review before that
commit.
