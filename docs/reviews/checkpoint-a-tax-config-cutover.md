# Checkpoint A — tax_rules → tax_config cutover (Option B)

Status: RULED (owner, 2026-07-25). All five rulings decided; this
document is now the implementation contract. Grounded in Terra diagnosis
19-05T (live `financial_tracker`, read-only) — not memory.

## RATIFIED RULINGS (summary)
- R1: 1a — half-open `[from, to)` canonical. Supersession sets old
  `valid_to` = new `valid_from`. Document the convention.
- R2: 2a — full cutover, micro moves too (no partial two-table split).
- R3: 3a — CASS as bracket-set (four bands), status `estimate`.
- R3.1: BOOK PROVISIONAL CASS NOW — July dividend gets both a confirmed
  16% dividend-tax leg AND a provisional CASS estimate leg (flagged
  estimate), trued-up in Phase 5. See "3.1 consequence" note below.
- R4: seed status/source per the Ruling 4 table; income_tax_rate =
  `estimate` (base calc + personal deduction still open with accountant);
  CAS/CASS/CAM = `confirmed` from payslip.
- R5: sequencing U1–U6 accepted; tax_rules dropped LATER (not in cutover).

## 3.1 consequence — implementation must handle (READ)
Booking provisional CASS now means the dividend transaction carries TWO
tax legs of DIFFERENT certainty:
  - dividend_tax: 16% of 55,000 = 8,800 — CONFIRMED, withheld at source.
  - cass_dividend: provisional band estimate — at 55,000 YTD → 4,860 —
    ESTIMATE, NOT withheld now, filed via Declaraţia Unică by 25 May.
Requirements this places on U6 (dividend flow):
  1. The CASS leg must be VISIBLY flagged estimate in the ledger/detail
     UI, distinct from the confirmed 16% leg. Do not let a provisional
     figure read as final.
  2. CASS is ANNUAL and band-dependent on the YTD dividend TOTAL. The
     55,000 estimate (band 3 → 4,860) changes if further 2026 dividends
     push the annual total into band 4 (>97,200 → 9,720). The booking
     computes the band from dividends-YTD AT BOOKING TIME; the Phase-5
     reconciliation is the true-up. Note this dependency on the leg.
  3. Because CASS is not withheld at distribution, its ledger treatment
     differs from the 16% (which is a real outgoing liability now). The
     CASS estimate is an accrued personal liability, not a company
     withholding. Model the two legs on the correct sides — do NOT copy
     the 16% leg's posting shape for CASS. Verify against the accountant
     source doc before booking.

Status: DESIGN RULINGS, pre-implementation. No code. Rulings become the
contract the implementation units are built against.

## Why this cutover, restated
`tax_config` is the well-designed tax table: temporal, GiST
overlap-exclusion, `status` enum (confirmed/estimate), required nonblank
`source`. It is EMPTY and unread. The live app computes all rate-based
tax from `tax_rules`, which has no overlap constraint, no status, and
confirmation only as freetext in `notes` (all 7 rows say PLACEHOLDER).
Option B makes `tax_config` the source of truth. Chosen over the lighter
Option Y because the incoming confirmed dividend values — especially
CASS — cannot be represented faithfully in the current `tax_rules`
shape (see Ruling 3). Doing it once well beats patching the weaker table.

## What 19-05T changed about the plan (read before ruling)
The naive "seed 7 rows, repoint everything" is WRONG for three reasons:

1. **Narrow blast radius, not wide.** Salary tax legs are
   payslip-TRANSCRIBED, not computed from rate rules. `loadSalaryRuleIds`
   attaches the 4 salary rules only as PROVENANCE; it never reads their
   rates (19-05T Q7). So salary math CANNOT drift in the cutover. The
   only computations that read rates are:
     - MICRO (live, working: SKY0151 → 255.40 on 25,539.84 = 1%)
     - DIVIDEND (code exists, never run — no live dividend yet)
   Everything else touching `tax_rules` is provenance joins + the viewer,
   which repoint mechanically with no numeric risk.

2. **Coverage gap.** `tax_config` has NO parameter for
   `micro_revenue_tax`, and no rate-shaped slot for `cass_dividend`
   (its `cass_investment_brackets` is a different bracket-set shape).
   A full cutover must extend `tax_config` to cover these BEFORE
   repointing micro/dividend, or those computations break.

3. **Silent boundary divergence.** `tax_rules` `valid_to` is INCLUSIVE
   (`>= date`); `tax_config` is EXCLUSIVE (`> date`). Invisible today
   (all `valid_to` NULL) but bites the first time a rule is superseded.
   Must be standardized deliberately (Ruling 1).

## Parity is the success criterion
The cutover succeeds ONLY if every currently-computed tax figure is
identical after. Baseline to preserve (19-05T Q7):
  - Micro: `Math.round(revenueRonMinor * rateBps / 10_000)`; live rate
    100 bps. SKY0151 → -25,540; June HolyCode → -26,214.
  - Salary legs: CAS -112500 / CASS -45000 / income_tax -23000 /
    CAM -10100 — payslip-transcribed, MUST be untouched, not a cutover
    read.
  - Dividend: none booked yet; first computation uses confirmed values.

---

# RULINGS

## Ruling 1 — `valid_to` boundary semantics
The two resolvers disagree on the end-date boundary.
  - `tax_rules`: `valid_to >= date` (inclusive end)
  - `tax_config`: `valid_to > date`, i.e. half-open `[from, to)` (exclusive end)

Today all `valid_to` are NULL so nothing diverges. It matters the first
time you close 2026 and open 2027: a transaction dated exactly on the
handover date resolves differently under each rule.

Options:
  (1a) Standardize on `tax_config`'s half-open `[from, to)` — the
       industry-standard temporal convention, and what the GiST
       constraint already enforces. To supersede 2026 with 2027, set
       2026 `valid_to = 2027-01-01` and 2027 `valid_from = 2027-01-01`;
       a 2027-01-01 transaction resolves to 2027. Clean, no gap, no
       overlap.
  (1b) Change `tax_config`'s resolver to inclusive to match `tax_rules`.
       Fights the GiST constraint (which is half-open) and is
       non-standard. Not recommended.

RECOMMENDATION: 1a. Adopt half-open `[from, to)` as the canonical
convention. Document it. All future rule supersession sets the old row's
`valid_to` = the new row's `valid_from`. Since all live rows are
open-ended (`valid_to` NULL), seeding introduces no boundary today; the
convention governs the next rate change.

OWNER RULING: __________

## Ruling 2 — micro_revenue_tax: cutover or leave?
`tax_config` has no `micro_revenue_tax` parameter. Micro is LIVE and
correct today via `tax_rules` (100 bps).

Options:
  (2a) Add a `micro_revenue_tax_rate` parameter to `tax_config`, seed it
       (100 bps, confirmed — accountant confirmed 1% micro this session),
       repoint `micro-tax.ts` to `resolveTaxConfig`. Full cutover; micro
       gains status/source/temporal correctness. Requires enum
       extension + a parity check that SKY0151 still yields -25,540.
  (2b) Leave micro reading `tax_rules` for now; cut over only dividend.
       Partial cutover. Lower risk, but leaves the app split across two
       tax tables — the exact fragmentation B was meant to end. Defers
       rather than resolves.

RECOMMENDATION: 2a. A partial cutover reintroduces the two-table split
we're paying to remove. Micro is the lowest-risk computation to move
(single rate, deterministic, has a hard parity baseline). Move it now
under the parity gate. The accountant confirmed 1% micro this session,
so it seeds as `confirmed`, not `estimate`.

OWNER RULING: __________

## Ruling 3 — CASS on dividends: representation (the hard one)
The confirmed CASS structure (accountant, 2026) is FIXED RON AMOUNTS by
ANNUAL-TOTAL band, against the 4,050 minimum wage:
  - < 24,300 RON        → 0
  - 24,300–48,600       → 2,430 (fixed)
  - 48,600–97,200       → 4,860 (fixed)
  - > 97,200            → 9,720 (fixed, cap)

The current `cass_dividend` rule stores 1000 bps — a PERCENTAGE. This is
structurally incapable of holding the real rule: CASS-on-dividends is not
a percent of the dividend, it's a fixed amount determined by which annual
band the person's TOTAL dividends fall into. The existing 1000 bps is
meaningless and any computation using it is wrong.

`tax_config` already has a `cass_investment_brackets` bracket-set shape
(19-05T Q9) — a banded structure, which is the RIGHT shape for this.

Also critical (from the accountant + dividend source doc): CASS is
ANNUAL, assessed on the full-year dividend TOTAL. A single import/booking
CANNOT finalize it. Per the parked plan, per-dividend CASS is an ESTIMATE;
the real figure is a Phase-5 annual reconciliation.

Options for representation:
  (3a) Model the four bands in `tax_config`'s bracket-set shape
       (thresholds in minor RON: 2,430,000 / 4,860,000 / 9,720,000;
       fixed amounts 0 / 243,000 / 486,000 / 972,000 minor). Store as
       `estimate` (annual figure can't be confirmed per-distribution).
       At booking, compute the PROVISIONAL band from dividends-YTD and
       flag estimate. Correct structure; honest about provisional nature.
  (3b) Store only the current-year single applicable amount as a flat
       value (e.g. just 4,860 for now). Simpler but wrong — hides the
       banded rule, breaks the moment annual total crosses a band, and
       re-lands us needing 3a later. Rejected.

RECOMMENDATION: 3a. This is the strongest single argument FOR Option B
over Y: the confirmed CASS rule literally cannot live in the old bps
field, but fits `tax_config`'s bracket-set shape. Model the bands
properly, mark `estimate`, and leave FINAL CASS to Phase-5 annual
reconciliation. The per-booking figure is a flagged provisional estimate
based on YTD dividend total, never presented as final.

Sub-question 3.1: for THIS July 55,000 dividend, at 55,000 YTD the
provisional band is 48,600–97,200 → 4,860 estimate. Confirm that a
provisional estimate is acceptable to BOOK now (flagged estimate), with
true-up in Phase 5 — OR whether the dividend books with 16% tax only
(8,800, confirmed) and CASS is deferred entirely to the annual return.
(The accountant files CASS via Declaraţia Unică by 25 May next year, so
CASS is NOT withheld at distribution the way the 16% is — this argues
for booking 16% now and handling CASS as an annual accrual, not a
per-dividend leg.)

OWNER RULING (3a vs 3b): 3a — RULED.
OWNER RULING (3.1): BOOK PROVISIONAL CASS NOW (flagged estimate) — RULED.

## Ruling 4 — dividend_tax value + status/source for all seeded rows
Confirmed this session: dividend tax 16% (1600 bps), withheld at source,
remitted by 25th of month after distribution. Matches the existing 1600
bps `tax_rules` value — so no numeric change, only status/provenance.

`tax_config` requires nonblank `source` and a `status` on every row.
`tax_rules` has neither; confirmation lived only in freetext notes.
Owner must supply status + source per seeded parameter:

  | parameter              | rate/shape         | proposed status | proposed source |
  |------------------------|--------------------|-----------------|-----------------|
  | cas_employee_rate      | 2500 bps           | confirmed       | payslip Skyline 2026-05 |
  | cass_employee_rate     | 1000 bps           | confirmed       | payslip Skyline 2026-05 |
  | cam_employer_rate      | 225 bps            | confirmed       | payslip Skyline 2026-05 (4500×2.25%=101) |
  | income_tax_rate        | 1000 bps           | estimate?       | NOT cleanly confirmed — see note |
  | dividend_tax_rate      | 1600 bps           | confirmed       | accountant 2026-07-25 |
  | micro_revenue_tax_rate | 100 bps            | confirmed       | accountant 2026-07-25 |
  | cass_dividend (bands)  | bracket-set (R3)   | estimate        | accountant 2026-07-25 |

Note on income_tax_rate: the parked plan lists the 2026 personal
deduction and the income-tax base calc as STILL OPEN for the accountant.
Salary income tax is payslip-transcribed so this rate isn't used in
salary computation — but it should NOT be seeded `confirmed` if the base
calculation isn't confirmed. Recommend `estimate` until the accountant
confirms the personal-deduction + base method, OR seed the rate but mark
its status honestly.

RECOMMENDATION: seed status/source as the table above, with
income_tax_rate as `estimate` pending the outstanding accountant items.
CAS/CASS/CAM as `confirmed` from the payslip (they match verbatim).

OWNER RULING (per-row status/source, esp. income_tax_rate): __________

## Ruling 5 — cutover sequencing (unit plan)
Proposed STOP-gated units, in order:
  U1. Migration: extend `tax_config` param enum for micro + confirm the
      CASS bracket-set shape holds the four bands. (Schema only, no live
      data.) STOP.
  U2. Seed `tax_config` (OWNER enters live data — agents read-only
      against live). Rows per Rulings 1–4. GiST constraint proves no
      overlap on insert. STOP.
  U3. Repoint the two COMPUTING paths — micro-tax.ts and the dividend
      flow — to `resolveTaxConfig`. Leave provenance joins + viewer for
      U5. STOP.
  U4. PARITY GATE (Terra, read-only): re-run micro on SKY0151 + June
      HolyCode; assert -25,540 / -26,214 unchanged. Confirm dividend
      preview computes 16% correctly against the seeded value. NO
      numeric drift permitted. STOP — this gate decides success.
  U5. Repoint provenance joins (queries.ts, edit-drafts.ts, dashboard.ts)
      + the management viewer (listActiveTaxRules) to tax_config; add the
      real confirmed/estimate badge. Mechanical, no numeric risk. STOP.
  U6. Dividend flow: book the July 55,000 dividend per Ruling 3.1.
      Separate, after cutover is proven.

Old `tax_rules`: do NOT drop in this cutover. Leave it in place, unread,
until U4 proves parity and U5 repoints the joins. Drop (or soft-retire)
only as a later cleanup once nothing references it. Reversibility.

OWNER RULING (sequencing ok? drop tax_rules later vs now): __________

## Verification gates (standing, all units)
cache-cleared tsc (i18n key completeness), ESLint, next build, isolated
test suite, G1–G4 greps. U2 + U6 involve live data → owner performs, no
agent live writes. U4 is the numeric gate; nothing proceeds to U5 if
micro drifts by even 1 minor unit.

## Open dependencies
- income_tax base calc + 2026 personal deduction: still open with
  accountant (parked plan). Affects Ruling 4 status only; not blocking
  since salary is transcribed.
- Second personal-CSV fixture: unrelated to this cutover; belongs to the
  parser unit. Kept separate.
