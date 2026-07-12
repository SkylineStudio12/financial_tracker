# Agent handover — cold-start pointers

Updated 2026-07-12 at main `b1fdc29`. This file is deliberately a pointer map,
not a second copy of tracked guidance.

## Start here

Read in this order:

1. `AGENTS.md` — working rules, review ownership, Tier-3 escalation, and commit gates.
2. `docs/lessons.md` — ratified lessons ledger; current head: **L-0019**.
3. `docs/review-standards.md` — objective gates, G1–G4, judgment flags, and report format.
4. `docs/review-log.md` — durable Tier-3 checkpoint evidence.
5. `docs/load-bearing-ui.md` — UI whose placement or prominence carries meaning.
6. `docs/parked-plan.md` — deferred decisions and phase scope. This is the tracked
   parked-plan file; there is no `finance-tracker-parked-plan.md` in the repo.

Do not restate those sources here. When they disagree with chat recollection, the
tracked source and current repo state win.

## Current state

Part 2, Revolut brokerage history import, is complete:

- `5762e2a` — parser and verification fixtures
- `dd40454` — external-data verification lessons
- `1806015` — atomic booking pipeline
- `b1fdc29` — review inbox

The real batch `62719433-b0da-4f6d-8276-57cf68c59410` booked on 2026-07-12:
285 rows became 282 transactions plus 3 splits, with 0 duplicates and 0
exclusions, in chronological order inside one transaction. In-transaction
assertions passed: cash 135.64 USD and 64.46 EUR (matched to live Revolut on
2026-07-11), 47 holdings, RON zero-sum on all 282 transactions, and zero tax
accruals. Total cost basis is 125,917.74 RON. Dashboard and holdings intentionally
show honest unpriced states until market prices exist.

The live, seeded Greg account model is:

- Revolut brokerage cash USD / EUR — `brokerage`
- Greg — Revolut positions USD / EUR — `position`
- Transfers to Revolut — `clearing`, RON, owner Greg

`clearing` was added by migration `0006`; live provisioning is idempotent via
`npm run db:provision-revolut`. The ledger write service was not modified: it
already supports mixed-currency legs and enforces zero-sum on RON mirrors. The
investment service now accepts a caller-owned transaction and otherwise keeps
the manual default: `outerTx ? write(outerTx) : db.transaction(write)`. Manual
trade behavior is covered by 34 default-mode test calls.

i18n extraction chunks 3a–3f are complete; 3f landed at `37a81a5`. Romanian
editorial terminology and force review remain gated by the accountant answers
described below, not by unfinished extraction.

## Temporary standing guard

> **Do NOT delete imported investment transactions through the normal UI.** The
> delete path does not clear `revolut_booked_rows` markers and does not handle
> stock-split adjustment records. Deleting leaves inconsistent state and blocks
> re-import.

This is a temporary manual guard around a real correctness hole. Follow-up items
1 and 2 close it; until both land, the guard remains load-bearing.

## Follow-up queue

1. **Close guard:** make normal soft-delete reconcile booked-row markers
   (`revolut_booked_rows` and inbox state). L-0012 family.
2. **Close guard:** define and implement deletion behavior for stock-split
   adjustments referencing a soft-deleted buy. L-0012 family.
3. Serialize row exclusions against batch approval; today two sessions can race.
4. Make a failed optimistic exclusion preserve other successful local exclusions.
5. Show row timestamps in the review inbox so booking chronology is visible.
6. Collapse row groups by default; 285 expanded rows is an audit dump on mobile.
7. Fix migration 0006's stale comment claiming accounts are provisioned in `0007`;
   provisioning now lives in `npm run db:provision-revolut`.
8. Decide cleanup for ticker-only securities left by an abandoned staged batch.

No manual stock-split UI exists. The split service is test-covered and currently
has only the Revolut importer as a production caller; that is acceptable until a
manual split form is wanted.

## Eligible and externally gated

- Price API selection is now eligible: 47 real tickers with cost basis exist.
  Use `docs/parked-plan.md` for scope before choosing a provider.
- `intrebari-contabil.md` is in flight outside this repo. Its answers gate real
  tax rates, the Romanian editorial pass, and any BNR-vs-broker-rate valuation
  follow-up. Tax numbers remain config-sourced placeholders until confirmed.

## Model tiering (provisional)

Default is Sol at current effort. Use Sol high/max for destructive, money, tax,
delete-set, re-import, and correctness-critical work; Sol medium for substantive
build/review; Terra only for well-specified low-ambiguity work; Luna for rote
state checks and command reporting. Tier up when uncertain. Never tier data
operations down to save tokens; Ultra is reserved for genuinely hard,
long-horizon work.

---

*Maintenance: update this pointer map only by owner-confirmed commit. Do not copy
tracked rules into it; update the source of truth instead.*
