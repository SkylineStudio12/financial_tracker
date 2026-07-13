# Price sync - Checkpoint A design

**Status:** Tier-3 Checkpoint A approved 2026-07-13, including the
quarantine-only, scheduling, and provisional-coverage clarifications. This
document records the approved design; implementation is reviewed separately at
Checkpoint B.

## Dependencies and verified facts

- The FX backfill is complete in `c3a6684`; price valuation may depend on paired
  EUR/USD rates from 2024-01-02 onward.
- Historical quantities are now reconstructed by `loadLotsAsOf`. A live
  `valueHoldings` check resolves NOW to `0.27750355` shares on 2025-12-17 and
  `1.38751775` shares on and after 2025-12-18. The raw-close design is therefore
  valid: quantities and prices change on the same split boundary.
- Stooq daily CSV closes are split-adjusted but, in the verified 2024+ window,
  are not dividend-adjusted. NOW proves the split adjustment; XOM matches EODHD
  raw closes across a dividend ex-date and BMW preserves its ex-date drop.
- EODHD free access serves raw XETRA closes for a rolling 12-month window.
  The pre-design spike's compared Stooq and EODHD overlap dates matched exactly.
- Backfill and forward sync are separate mechanisms: owner-downloaded Stooq
  CSVs provide history; EODHD supplies a rolling forward feed within 20 calls
  per day.

## 1. Provider symbol persistence

### Decision: mapping table

Add a `security_price_mappings` table rather than four nullable columns on
`securities`:

| Column | Meaning |
|---|---|
| `id` | UUID primary key |
| `security_id` | Foreign key to `securities.id` |
| `provider` | Enum: `stooq` or `eodhd` |
| `symbol` | Provider-qualified symbol |
| `created_at`, `updated_at` | Audit timestamps |

Constraints are unique `(security_id, provider)` and unique
`(provider, symbol)`. Provider is data, not inferred from the symbol suffix.
The table avoids provider-specific nullable columns on the security model and
allows another provider without another schema change. It still makes each
mapping explicit and reviewable.

The schema migration creates the table and enums. A separate idempotent
provisioning command resolves the existing security by exact ticker and
currency, then inserts these verified mappings. The migration itself must not
assume a particular live set of imported securities.

| Ticker | Currency | Stooq | EODHD |
|---|---|---|---|
| AAPL | USD | aapl.us | AAPL.US |
| ADBE | USD | adbe.us | ADBE.US |
| ALAB | USD | alab.us | ALAB.US |
| AMAT | USD | amat.us | AMAT.US |
| AMD | USD | amd.us | AMD.US |
| AMZN | USD | amzn.us | AMZN.US |
| ASML | USD | asml.us | ASML.US |
| BAC | USD | bac.us | BAC.US |
| BRO | USD | bro.us | BRO.US |
| CORT | USD | cort.us | CORT.US |
| CRDO | USD | crdo.us | CRDO.US |
| CRM | USD | crm.us | CRM.US |
| DHI | USD | dhi.us | DHI.US |
| DUOL | USD | duol.us | DUOL.US |
| EXE | USD | exe.us | EXE.US |
| GSK | USD | gsk.us | GSK.US |
| JPM | USD | jpm.us | JPM.US |
| MCO | USD | mco.us | MCO.US |
| MELI | USD | meli.us | MELI.US |
| META | USD | meta.us | META.US |
| MSFT | USD | msft.us | MSFT.US |
| NFLX | USD | nflx.us | NFLX.US |
| NOW | USD | now.us | NOW.US |
| NU | USD | nu.us | NU.US |
| NVDA | USD | nvda.us | NVDA.US |
| NVO | USD | nvo.us | NVO.US |
| NVR | USD | nvr.us | NVR.US |
| PINS | USD | pins.us | PINS.US |
| PLTR | USD | pltr.us | PLTR.US |
| RACE | USD | race.us | RACE.US |
| SNPS | USD | snps.us | SNPS.US |
| SPOT | USD | spot.us | SPOT.US |
| UBER | USD | uber.us | UBER.US |
| V | USD | v.us | V.US |
| VRT | USD | vrt.us | VRT.US |
| WMB | USD | wmb.us | WMB.US |
| XOM | USD | xom.us | XOM.US |
| BMW | EUR | bmw.de | BMW.XETRA |
| CEBT | EUR | cebt.de | CEBT.XETRA |
| INN1 | EUR | inn1.de | INN1.XETRA |
| LYP6 | EUR | lyp6.de | LYP6.XETRA |
| SPP1 | EUR | spp1.de | SPP1.XETRA |
| SPPE | EUR | sppe.de | SPPE.XETRA |
| SPPY | EUR | sppy.de | SPPY.XETRA |
| UIQI | EUR | uiqi.de | UIQI.XETRA |
| V50A | EUR | v50a.de | V50A.XETRA |
| XSX6 | EUR | xsx6.de | XSX6.XETRA |

That is 47 securities and 94 provider mappings. New securities without a
mapping are skipped and named in the result; neither importer guesses a venue
or fabricates a symbol.

## 2. Raw series and split un-adjustment

### Ledger-driven rule

Stooq's split-adjusted close must be converted back to immutable raw close.
For a price date `D`, load all live `stock_splits` for that security. For every
split whose calendar date is strictly after `D`, multiply the Stooq close by
that split's `numerator / denominator` ratio. Multiple later splits compound.
The split date itself is not multiplied because both the booked quantity and
the provider close are post-split on that date.

All arithmetic is exact decimal/integer-ratio arithmetic. Ratios are applied
before the final currency conversion; the result is rounded once to two minor
digits using positive half-up rounding. JavaScript binary floating point is not
used for monetary conversion.

### Required NOW fixture

The owner's `now_us_d.csv` contains Stooq's split-adjusted closes. Applying the
booked 5:1 split strictly before 2025-12-18 reproduces EODHD raw closes exactly:

| Date | Stooq close | Factor | Reconstructed raw close |
|---|---:|---:|---:|
| 2025-12-11 | 173.498 | 5 | 867.49 |
| 2025-12-12 | 173.012 | 5 | 865.06 |
| 2025-12-15 | 153.040 | 5 | 765.20 |
| 2025-12-16 | 156.224 | 5 | 781.12 |
| 2025-12-17 | 156.478 | 5 | 782.39 |

### Holdings-at-date proof

`valueHoldings` passes its requested date into `loadLotsAsOf`. That reader:

1. Includes buys and sell consumptions only when their transaction date is on
   or before the requested date.
2. Reverses lot and consumption adjustments only for splits after that date,
   using the stored before quantities.
3. Returns the current reader unchanged for today's date.

The live boundary check passes: NOW is `0.27750355` on 2025-12-17 and
`1.38751775` from 2025-12-18. Thus a pre-split raw close is multiplied by the
pre-split quantity, while split-date raw close is multiplied by the post-split
quantity. There is no x5 or /5 historical valuation inversion.

## 3. Stooq backfill import

### Input and window

The command accepts a required absolute `--dir` outside the repository; the
owner's current folder is `/Users/grig/Downloads/Stooq`. A Stooq symbol maps to
the deterministic filename `<symbol-with-dot-as-underscore>_d.csv`, for example
`bmw.de` becomes `bmw_de_d.csv`.

Each file must have exactly the structural fields
`Date,Open,High,Low,Close,Volume`, dot-decimal prices, valid ISO dates, and no
duplicate dates. Rows are sorted by date after parsing. A malformed row rejects
that ticker rather than partially importing it.

For each mapped security, the import window begins at its earliest live trade
date. Earlier CSV rows are ignored. Later rows are un-adjusted using section 2,
converted to integer minor units, and written only through
`upsertPriceSnapshot`. A caller-owned database transaction may group one
ticker's rows atomically, but it must reuse that shared upsert policy rather
than introduce another writer.

### Mandatory dry-run gate

Dry-run is the default and performs no writes. For every ticker it reports:

- resolved security, Stooq symbol, and expected file;
- rows inside the security's window and first/last included date;
- every applied split factor and its effective pre-split range;
- three samples: first, a middle or split-adjacent row, and last, showing source
  close, factor, reconstructed close, and minor units;
- missing, empty, malformed, duplicate-date, stale, or suspiciously truncated
  files.

It also prints totals and a complete missing-ticker list. Greg must explicitly
approve that report before the write mode is run. The write command consumes
the same parsed plan produced by dry-run, not a separately re-derived set.

## 4. Snapshot provenance and overwrite policy

Add a non-null `source` enum to `price_snapshots` with values `manual`, `stooq`,
and `eodhd`. The migration initially marks every existing snapshot `manual`,
preserving the strongest ownership for rows whose earlier source was not
recorded.

The shared `upsertPriceSnapshot` receives source and an explicit force option.
Conflict policy for the existing unique `(security_id, date)` key is:

| Existing | Incoming | Default result |
|---|---|---|
| manual | stooq/eodhd | preserve manual; report skipped |
| manual | manual | overwrite with manual |
| stooq/eodhd | manual | overwrite with manual |
| stooq | eodhd | overwrite with EODHD raw close |
| eodhd | stooq | preserve EODHD; report skipped |
| same automated source | same source | idempotent upsert |

An explicit force flag may replace a manual row, but automated jobs never set
it. Manual input always may correct any row. The current last-write-wins
alternative is rejected because a routine job could silently erase a reviewed
manual correction, and a backfill rerun could replace newer EODHD provenance.

This unit therefore needs one migration covering the mapping table, provider
and source enums, and snapshot provenance column.

## 5. Rolling EODHD sync

The forward source requests EODHD raw `close`, never `adjusted_close`, and uses
the provider-returned market date. It does not stamp the cron execution date.

The existing single daily sync entry point continues to run FX and then price
sync, but it is manual/localhost-only today: no scheduler invokes it. Vercel
cron remains a Phase 7 deployment task. Once deployed, schedule it after the US
close, proposed `02:30 UTC`; XETRA has already closed. The EODHD phase has a hard 20-call daily budget and selects mapped
securities by oldest latest snapshot first. With 47 securities, a complete
healthy rotation takes `ceil(47 / 20) = 3` runs, approximately 2.4 days of
capacity. That freshness estimate applies only after daily scheduling exists;
manual execution makes no freshness promise. The rotation fits the existing
latest-on-or-before valuation and seven-day stale marker.

Each call requests the missed range still available in EODHD's rolling
12-month free window, then writes every returned raw close through
`upsertPriceSnapshot` with source `eodhd`. Re-running the same dates is
idempotent. Per-ticker failures do not abort successful tickers: each failure
is named with its provider response and remains stale-priority for the next
cycle. Unmapped securities are reported separately and remain honestly
unpriced.

The daily route must fail closed without its existing sync authorization and
without `EODHD_API_TOKEN`. No credential value is logged.

## 6. Verification plan (L-0015)

1. **Historical quantity boundary:** retain the NOW check above and the three
   split fixtures (NVDA, NFLX, NOW), proving day-before quantities are before
   values and split-date quantities are after values.
2. **NOW raw reconstruction:** assert all five 2025-12-11 through 2025-12-17
   values in section 2 exactly, before minor-unit conversion.
3. **Provider seam:** for every ticker whose Stooq and EODHD windows overlap,
   compare at least three dates after un-adjustment. Owner amendment at
   Checkpoint B: seam equality is evaluated after positive half-up conversion
   to stored minor units. Raw-decimal deviations remain reported but do not
   fail when both providers store the same amount. The expanded available-file
   seam therefore passes 45/45 at stored precision, with the two raw deviations
   retained in the report.
   **Write gate:** write mode cannot run until all ten XETRA mappings (BMW,
   CEBT, INN1, LYP6, SPP1, SPPE, SPPY, UIQI, V50A, XSX6) plus NVDA and NFLX
   have files, pass the full dry-run, and pass at least three stored-minor-unit
   seam dates each. These checks are bound to the owner-approved plan hash and
   execute before any price write transaction opens.
4. **Currency:** XETRA rows write EUR minor units and US rows write USD minor
   units. Three fixtures per exchange check parsing and rounding.
5. **Manual ownership:** automated writers cannot replace a manual fixture;
   manual input can replace each automated source; force behavior is explicit.
6. **Unpriced honesty:** a deliberately unmapped security is skipped, reported,
   and remains unpriced.
7. **Idempotence:** a second backfill run produces no semantic row, value, or
   provenance changes and reports zero effective changes.
8. **Partial failure:** one malformed CSV and one failed EODHD response leave
   their tickers unchanged while other ticker transactions complete.

## 7. Risk register

| Risk | Control |
|---|---|
| Stooq ETF coverage gaps | Treat per ticker, not as a batch-wide failure. `CEBT.DE` beginning on 2024-03-11 and the named `INN1.DE`, `LYP6.DE`, `SPP1.DE`, `SPPE.DE`, `SPPY.DE`, `UIQI.DE`, `V50A.DE`, and `XSX6.DE` coverage risks remain hypotheses until the dry-run inspects the real files. A file beginning after the first trade leaves that early window honestly unpriced. |
| Future split not yet booked by Revolut import | A new split can create a valuation discontinuity until its ledger adjustment exists. Detection compares a new close with the preceding close for common split ratios (2, 3, 4, 5, 10) when no nearby split record exists. A suspicion quarantines and reports the ticker before opening a write transaction: zero price rows are written, and the price unit never creates, infers, or auto-applies a split record. |
| Stooq CSV format drift | Require the known header and structural parser; reject and report the entire ticker on unexpected fields or malformed rows. |
| Decimal-to-minor-unit error | Use exact decimal arithmetic, apply all split ratios first, and round positive values half-up exactly once to two digits; fixture currencies currently both have two minor digits. |
| EODHD free-tier or retention policy changes | Enforce a local 20-call ceiling, surface provider refusals verbatim, and preserve existing prices; no fallback source is guessed. |
| Partial or truncated download | Report file size, row count, first/last date, missing expected window, and age in dry-run. No file writes until the owner approves the exact ranges. |
| Duplicate or renamed provider symbol | Database uniqueness rejects duplicate mappings; unresolved/renamed symbols fail visibly and require an owner-reviewed mapping update. |
| Partial batch failure | Stooq commits at most one ticker atomically; EODHD records per-ticker outcomes. Successful tickers remain valid and failed ones are retried by stale priority. |

## Scope boundary and implementation gate

This unit changes price reads/writes and provider mapping only:

- one migration for `security_price_mappings` and `price_snapshots.source`;
- explicit provisioning of the 47 verified mappings;
- Stooq dry-run/import tooling and split un-adjustment;
- EODHD rolling source integrated into the existing daily sync;
- focused parser, policy, seam, and failure tests.

It does not change ledger transactions, postings, tax accruals, soft-delete,
trade booking, split booking, or transaction actions. Price rows continue to
flow only through `upsertPriceSnapshot`.

Per L-0019, the Checkpoint A and Checkpoint B review-log rows will be added in
the future implementation commit, not in this design-doc unit. Implementation
must not begin until the owner explicitly approves this Checkpoint A design.
