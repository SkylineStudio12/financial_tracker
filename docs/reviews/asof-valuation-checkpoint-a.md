# As-of-date valuation - Checkpoint A design

**Status:** Tier-3 Checkpoint A design, pending owner review. This is a
read-path correction required before price sync can store immutable raw closes.
No implementation, migration, review-log row, or commit is included here.

## Problem and invariant

`valueHoldings({ date: D })` currently constrains prices and FX to `D`, but it
loads live lots with no date constraint. Stock-split booking permanently scales
the stored buy and consumption quantities, while preserving per-row before/after
adjustment records that valuation never reads. A pre-split NOW valuation would
therefore combine post-split shares with raw pre-split closes and overstate the
position by 5x.

The target invariant is:

> A valuation at date `D` uses the shares and consumed shares that existed at
> the end of `D`. A split is effective on its recorded calendar day. For
> `D = today`, every current-state result remains identical to the existing
> behavior.

The date model is calendar-day, not intraday. A split dated `2025-12-18` is
effective for a valuation on `2025-12-18`; only adjustments whose split day is
strictly later than `D` are reversed.

## 1. Current-state inventory

### Readers of lot and consumption quantities

| Reader | Current role | Required semantic | Change? |
|---|---|---|---|
| `loadLots` in `src/lib/investments/service.ts` | Canonical live lot/basis loader | As-of-today | **No.** Keep it as the current-state primitive. |
| `executeSell` | Authoritative FIFO availability and realized cost-basis calculation before a booking write | As-of-today | **No.** A sell must see the live, post-split position. |
| `previewSell` and `TradeForm` | Load-bearing UI preview: available quantity, FIFO lots, and estimated gain before booking | As-of-today | **No.** Preserve its current `loadLots` call. |
| `listHoldings` | Current holdings used to populate the sell picker | As-of-today | **No.** It reads the same live buy-minus-consumption state directly. |
| Revolut brokerage import final assertion | Compares the just-booked batch's current holdings with the import's expected current holdings | As-of-today | **No.** Preserve its `loadLots` call. |
| `valueHoldings` | Holdings table, dashboard investment cards, and the only service with a `date` parameter | As-of-date | **Yes.** It alone will call a new as-of read helper for `D < today`. |
| `planFifoConsumption` | Pure FIFO/basis calculation over supplied lot states | Caller-defined | **No.** It remains unchanged; current callers continue to supply live lots. |

The current dashboard and investments pages both calculate `today` and pass it
to `valueHoldings`; neither exposes a historical-date control. Historical
valuation is reachable only through the service API and tests today. That keeps
the UI behavior unchanged in this unit, while making the existing API truthful
for the price-backfill work and future historical views.

### Why the current implementation is not historical

- `valueHoldings` asks `loadLots(tx, accountId, securityId)` with no `D`.
- `loadLots` selects all live buys and all live lot consumptions; it joins a
  buy's transaction only to obtain FIFO ordering, not to filter by date.
- Split booking writes the audit rows and then updates `trades.quantity` and
  `lot_consumptions.quantity` in place.
- The adjustment tables are not read by valuation.

The existing valuation money test demonstrates the same gap: it books 2031
trades, asks for a 2026 valuation date, and still sees those future trades.
That test must be corrected as part of the implementation, not treated as a
valid historical fixture.

## 2. Consumption consistency

Split booking is consistent on the write side. For every existing live buy lot
it records `quantityBefore` and `quantityAfter`, then updates the buy quantity.
For every existing live lot consumption it performs the same sequence in
`stock_split_consumption_adjustments` before updating the consumption quantity.
Money basis fields are intentionally unchanged: a split changes units, never
foreign-currency or RON basis.

The live database has exactly three splits. Their current adjustment evidence
is:

| Ticker | Split day | Ratio | Lot quantity before -> after | Consumption adjustments |
|---|---|---:|---|---|
| NVDA | 2024-06-10 | 10:1 | 0.55198522 -> 5.51985220 | None |
| NFLX | 2025-11-17 | 10:1 | 0.41444286 -> 4.14442860; 0.47116127 -> 4.71161270; 0.22504892 -> 2.25048920 | None |
| NOW | 2025-12-18 | 5:1 | 0.27750355 -> 1.38751775 | None |

There are no live consumption-adjustment rows because no lot sold before any
of these three live splits. That does not weaken the design: the read helper
must reconstruct lots and consumptions symmetrically, and the existing
stock-split end-to-end fixture already creates the needed sell-then-split shape
(10 bought, 4 sold, then a 2:1 split: consumption 4 -> 8).

## 3. Design decision - invert after D

Choose **candidate (a), invert-after-D**. Add a narrowly scoped read helper,
for example `loadLotsAsOf(tx, accountId, securityId, date)`, and leave the
existing `loadLots` untouched for every current-state caller.

### Reconstruction algorithm

For a historical date `D < today`:

1. Load only live buy trades whose transaction date is `<= D`.
2. Load only live consumptions of those buys whose sell transaction date is
   `<= D`. A sale after `D` cannot consume shares in the historical result.
3. Start from the stored current quantities, then load the lot and consumption
   adjustment records for retained rows whose split calendar day is `> D`.
4. Process those adjustments newest-first. Set each affected lot or consumption
   quantity to its stored `quantityBefore`; do not divide by the ratio. Stored
   before/after values avoid rounding assumptions and compose correctly across
   multiple splits.
5. Preserve the stored basis and allocated-basis fields. Compute each open
   quantity from reconstructed lot quantity minus reconstructed consumption
   quantity, exactly as the live loader does.

The helper will derive a split day from the canonical ISO timestamp already
stored in `stock_splits.occurredAt`. The implementation must fail loudly on a
malformed legacy timestamp rather than silently applying the wrong side of a
split; all three live rows use canonical UTC ISO timestamps.

For `D = today`, `valueHoldings` will call the existing `loadLots` path rather
than the reconstruction helper. This makes the regression guarantee exact by
construction: today's valuation, holdings table, sell preview, cost-basis
calculation, import assertion, and booking behavior continue to use precisely
the live-state code they use now.

### Why not replay-to-D

Replay would duplicate FIFO, lot-consumption, basis-allocation, soft-delete,
and same-day ordering logic that the booking service already owns. It would
also need a new answer for split-versus-trade ordering inside one calendar day.
The existing adjustment rows are an auditable per-lot event log specifically
suited to inversion, so replay adds more surface and more ways to diverge
without adding information.

## 4. Required fixtures

All fixtures run against isolated test rows mirroring the verified live values;
they do not mutate the owner database.

### Split boundary fixtures

For every `stock_split_lot_adjustments` row in each of the three booked splits:

- The day before the split resolves to that row's `quantityBefore`.
- The split day and the day after resolve to `quantityAfter`.
- The aggregate across the affected lots matches the verified totals below.

| Ticker | Day before | Split day / after | Expected aggregate quantity |
|---|---|---|---|
| NVDA | 2024-06-09 | 2024-06-10 onward | 0.55198522 -> 5.51985220 |
| NFLX | 2025-11-16 | 2025-11-17 onward | 1.11065305 -> 11.10653050 |
| NOW | 2025-12-17 | 2025-12-18 onward | 0.27750355 -> 1.38751775 |

NOW additionally gates the price-series handoff. Applying the 5:1 un-adjustment
only to Stooq closes strictly before 2025-12-18 must produce these raw close
fixtures exactly:

| Date | Raw close after un-adjustment |
|---|---:|
| 2025-12-11 | 867.49 |
| 2025-12-12 | 865.06 |
| 2025-12-15 | 765.20 |
| 2025-12-16 | 781.12 |
| 2025-12-17 | 782.39 |

The owner CSV values are one fifth of these figures. The quantities above must
be pre-split on those dates; this unit supplies that half of the identity.

### Sell-history fixture

PLTR supplies the live, no-split date-filter fixture:

| Date | Event | Quantity |
|---|---|---:|
| 2024-01-10 | Buy | 11.75591016 |
| 2024-08-12 | Buy | 10.09149223 |
| 2025-01-02 | Sell, consuming both buys | 21.84740239 |
| 2026-06-30 | Later buy | 4.32375317 |

At `2024-09-01`, the as-of quantity must be
`11.75591016 + 10.09149223 = 21.84740239`. The later sale and later buy must
not leak into that result. A companion assertion on `2025-01-03` is zero,
confirming that the dated consumption is included once its sell date has
arrived.

### Consumption-with-split fixture

The isolated split test will also assert both sides of a consumption adjustment:
buy 10, sell 4, then split 2:1. Before the split the reconstructed lot and
consumption are 10 and 4; on/after the split they are 20 and 8. The remaining
position is 6 before and 12 after. This prevents a lot-only rollback from
silently drifting open quantity.

## 5. Verification plan

Before changing code, capture a read-only characterization from the live
database at the execution date:

1. Today's `valueHoldings` result for each investment profile, including each
   holding's quantity, basis, price date, value, and totals.
2. Current sell-preview availability, FIFO lot selection, and basis for each
   live held security using a non-booking preview input.
3. Current `loadLots` quantities and allocated basis for every live
   `(brokerage account, security)` pair, plus the Revolut import holdings
   assertion result.

After the change, rerun the same capture. For `D = today`, it must be byte-for-
byte equal in the compared fields. Any difference blocks Checkpoint B; it is a
regression in current-state semantics, not an acceptable consequence of adding
historical valuation.

Automated coverage added with the implementation will include:

1. The three live split boundary fixtures, asserting every individual
   adjustment row and their aggregate totals.
2. The NOW 2025-12-17 / 2025-12-18 quantity boundary exactly as above.
3. The PLTR dated buy/sell fixture and the synthetic sell-then-split
   consumption fixture.
4. A direct equality test proving the today path returns the same lot states
   as existing `loadLots`.
5. Existing valuation money, sell-preview parity, trade-write, stock-split,
   and Revolut booking suites, with any historical-date assertions corrected to
   match actual dates rather than future-dated setup trades.

## 6. Scope boundary

The adjustment records already contain the needed data:
`stock_split_lot_adjustments` stores before/after quantities per buy lot, and
`stock_split_consumption_adjustments` stores before/after quantities per
consumption. No schema change or migration is expected.

The implementation is limited to investment read logic and its tests:

- no ledger service, posting, transaction, tax, or split-booking write change;
- no change to the current `loadLots`, sell, preview, holdings-picker, or
  import-current-state semantics;
- no price snapshot, provider mapping, CSV import, or price-sync work.

Price sync remains gated on this unit, because raw pre-split closes are safe
only after historical share quantities are reconstructed correctly.

Per L-0019, the implementation commit will add durable review-log rows for
both Checkpoint A and Checkpoint B after the owner has approved this design.
