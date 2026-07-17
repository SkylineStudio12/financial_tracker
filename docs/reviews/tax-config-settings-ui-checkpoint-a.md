# Tax-config settings UI (Unit B) — Checkpoint A

**PROMPT-KEY:** 10-08F
**Status:** ACCEPTED 2026-07-17 (Checkpoint A) — rulings in review-log. Design doc only; no
code in this unit. **Tier 3 at implementation** — every write action lands in
`src/lib/tax/` and touches the temporal invariants; the gate runs but the
owner reviews the diff regardless.

Data model is GIVEN (Unit A, approved 2026-07-15) and is not redesigned here:
half-open `[valid_from, valid_to)` windows at day granularity, integer basis
points and bigint minor units, normalized CASS bracket children, GiST +
deferred-trigger invariants server-side, no soft delete — superseding closes
a window and inserts a successor.

---

## 1. Current state and the day-one reality

- `tax_config` schema is live (migration 0008) but **live `tax_config` is
  empty** — the seed is a separate, owner-approved operation that has not run
  on live (L-0022's exact context). The empty state (§8) is therefore not an
  edge case; it is what the owner sees first. It gets designed first.
- The management UI (`/p/[profile]/manage`, `management-client.tsx`) is the
  established settings idiom: server page → client component, `Table` rows,
  `Dialog` for create/edit, `AlertDialog` for destructive confirms, typed
  errors surfaced via `useTranslatedError`, shared `ICON_PROPS`. This unit
  extends that idiom rather than inventing a second settings language.
- A `Tabs` primitive exists in `src/components/ui/tabs.tsx` (reconcile per
  L-0002/L-0003 at implementation if not already reconciled).
- Unit A's boundary stands: the resolver/calculators read `tax_config`; the
  legacy `tax_rules` path is explicitly legacy. **This UI manages `tax_config`
  only** — it never reads or writes `tax_rules` (out of scope, restated in
  §11).

## 2. Placement and navigation

**Route:** `/p/[profile]/manage/tax`, linked from a "Tax parameters" card/row
on the existing manage page. Available on **all profiles**.

Rationale:

- Tax parameters are **Romanian law, not entity data** — the same rows serve
  Skyline's salary estimates, DRMX's dividend estimates, and the household's
  investment-CASS estimates. Scoping the page to SRL profiles would imply the
  config *belongs* to a company; it doesn't. The page states this in its
  intro line.
- A subpage, not an inline manage-page section: eight parameter series ×
  temporal history × three write flows is a screen, not a card. The manage
  page stays a hub.
- The profile prefix in the URL is navigation chrome only (the sidebar is
  profile-scoped); the page renders identical data on every profile. **J1**
  flags the alternative (a profile-independent `/settings/tax` route) if the
  owner prefers the honesty of an unscoped URL over sidebar consistency.

**Page-level disclaimer** (always visible, `font-caption`, `text-muted`,
under the title):

> EN: "These parameters feed estimates and cross-checks only. Salary figures
> are transcribed from payslips — the app never computes payroll."
> RO: "Acești parametri alimentează doar estimări și verificări. Cifrele de
> salariu sunt transcrise de pe fluturași — aplicația nu calculează
> niciodată salarizarea."

This is the brief's copy rule made structural: it sits on the page shell, so
no tab can be read without it. Individual flows repeat it only where a write
could be misread as recomputation (§5.3).

## 3. Information architecture — tabs per tax type, timeline per parameter

### 3.1 Tab structure

Four tabs over the eight parameters (grouping by *tax type*, per brief — not
one tab per parameter, which would make eight near-empty tabs):

| Tab | Parameters | Notes |
|---|---|---|
| **Salary** | `cas_employee_rate`, `cass_employee_rate`, `cam_employer_rate`, `income_tax_rate`, `personal_deduction` | The transcription disclaimer is repeated in this tab's header |
| **Dividend** | `dividend_tax_rate` | |
| **Investment CASS** | `cass_investment_brackets` | Bracket-set presentation, §7 |
| **General** | `minimum_wage` | Feeds thresholds elsewhere; kept apart so it isn't misread as a salary rate |

Tabs use the existing `Tabs` primitive (real tabs — panel-switching content,
the semantics are correct here just as they were for 10-06F). Tab selection
persists in `?tab=` searchParams so a link can point at "the dividend rate"
during an accountant conversation.

### 3.2 Per-parameter block

Each parameter renders one block inside its tab: header row (label +
current-value summary + "New period" button) over a **period timeline** —
a table of validity periods, newest first:

```
CAS — PENSION CONTRIBUTION (EMPLOYEE)            [ + New period ]
current value 25%   ·   from 1 Jan 2026

│ PERIOD                    VALUE    STATUS      SOURCE            │
│ from 1 Jan 2026           25%      CONFIRMED   accountant letter │  ← current
│                                                2026-07           │
╰──────────────────────────────────────────────────────────────────╯
```

With history and a scheduled future row (illustrative):

```
│ from 1 Jan 2027           26%      ESTIMATE    news article …    │  UPCOMING
│ 1 May 2026 – 31 Dec 2026  25%      CONFIRMED   accountant …      │  CURRENT
│ 1 Jan 2026 – 30 Apr 2026  24,75%   CONFIRMED   accountant …      │
```

- **Row chips:** `UPCOMING` (valid_from > today) and `CURRENT` (window covers
  today) as micro badges; history rows get no chip. Current row's value also
  appears in the block header — the one number most visits are for.
- **ESTIMATE badge:** exactly the existing marker (micro uppercase,
  `bg-surface-inactive`, `text-status-warning-text`) — same treatment the
  dashboard already uses; the status column is this badge or `CONFIRMED` in
  plain `text-muted` (confirmed is the unremarkable state; estimate is the
  one that must pop).
- **Source** is always visible, truncated to one line with full text on
  hover/expand — provenance is a first-class column, not metadata buried in
  a detail view, because the whole table's trustworthiness *is* its sources.
- Values: `font-amount-sm`, tabular. History rows in `text-secondary`;
  current row in `text-primary`.

### 3.3 Date display convention — human-inclusive over storage-half-open

Storage is `[valid_from, valid_to)`. Humans read **inclusive** ranges. The UI
always renders `valid_to` as `valid_to − 1 day` ("1 Jan 2026 – 30 Apr 2026"
for a row closed at `2026-05-01`) and the open row as "from 1 Jan 2026".
Locale date formatting via next-intl (RO: "1 ian. 2026").

Rationale: the half-open convention is the *correct storage model* (Unit A's
boundary-day argument) and the *wrong display model* — no Romanian law is
announced as "valid until the day before May 1". The conversion happens in
one display helper with a unit test pinning both directions, so the
convention lives in exactly one place.

### 3.4 Value display and input

- **Rates:** stored bps, displayed as percent with locale decimal comma
  ("2,25%" for 225 bps). Input: a percent text field parsed to integer bps
  (two decimal digits max — bps represent all legal rates exactly, per
  Unit A); parsing is string→integer arithmetic, never float. Reject a third
  decimal digit at the field (`tax.configValueInvalid` server-side is the
  backstop).
- **Amounts:** stored bani, displayed/entered as RON using the existing
  `minorToInput`/`parseAmountToMinor` helpers (same as the salary profile
  form — one money-input idiom in the app).

## 4. Write flows — a deliberate friction ladder

Three write operations, with **escalating friction matched to how dangerous
each one is**. The design principle: the common, safe action is one click
away; the rare, dangerous action is behind a decision fork that first tries
to talk you out of it.

| # | Operation | Frequency | Danger | Friction |
|---|---|---|---|---|
| 1 | Add new validity period | ~yearly per parameter | Low (append; history untouched) | Primary button + dialog |
| 2 | Confirm an estimate | Occasional | Low (status/source only, value unchanged) | Quick action + light dialog |
| 3 | Correct history | Rare | **High** (rewrites what the app believed) | Hidden entry point → decision fork → typed confirmation |

There is **no delete anywhere** — the model has no soft delete and
superseding is the mechanism (Unit A). The UI simply has no delete
affordance; this is stated in the page's help text so its absence reads as
design, not omission.

### 4.1 Flow 1 — Add new validity period

Per-parameter `[ + New period ]` button → Dialog:

```
╭──────────────────────────────────────────────╮
│ New period — CAS                             │
│                                              │
│ Value (%)          [ 26        ]             │
│ Applies from       [ 2027-01-01 ]  (date)    │
│ Status             (•) Estimate ( ) Confirmed│
│ Source             [________________________]│
│                                              │
│ ── Preview ────────────────────────────────  │
│ 25% · 1 May 2026 – 31 Dec 2026   (closes)    │
│ 26% · from 1 Jan 2027            (new)       │
│                                              │
│                    [ Cancel ]  [ Add period ]│
╰──────────────────────────────────────────────╯
```

Decisions:

- **There is no end-date field — anywhere in this UI.** `valid_to` is never
  typed; it is always derived by the server from the successor's
  `valid_from`. This is the single strongest overlap/gap affordance (§6):
  the user *cannot express* an overlap or a gap, because the only date they
  ever enter is "when does the new value start".
- **"Applies from"**, not "year": the brief's reframe made literal. Default
  suggestion: January 1 of next year (the common case) — but any future or
  past date after the latest row's `valid_from` is legal (Romanian law
  changes mid-year on arbitrary dates; recording a change late is normal).
  The field is a plain date input, constrained to
  `> latest valid_from` client-side; the unique `(parameter, valid_from)`
  and window constraints remain the server truth.
- **Live preview** shows the atomic result — the current open row closing
  (with its new inclusive end date) and the new row opening. The preview is
  the half-open model translated to consequences *before* submit; nobody
  should learn what "applies from" means from an error.
- **Status defaults to Estimate.** A new value typed from a news article or
  a draft ordinance is an estimate until the accountant letter lands;
  defaulting to Confirmed would invite accidental over-claiming. Confirmed
  must be chosen deliberately.
- **Source is required** (schema: non-blank) — the field states what it's
  for: "Where does this value come from? (letter, ordinance, news…)".
- Errors: server's typed codes (`tax.configWindowInvalid`, coverage,
  value-shape) surface via `useTranslatedError` on the relevant field; the
  UI previews the invariant but never reimplements it as its own truth.

### 4.2 Flow 2 — Confirm an estimate

Estimate rows (any position — current, upcoming, or historical) carry a
quiet `Confirm…` action. Dialog: shows the row read-only, asks only for the
**new source** (the confirmation's provenance — required), flips status to
Confirmed. Value is NOT editable in this flow — if the confirmed value
differs from the estimate, that is a *correction* (flow 3, if historical) or
a normal edit of an upcoming row (below).

Rationale: this is the expected lifecycle (estimate → accountant confirms)
and must be low-friction, but it must not become a side door for value
edits — hence the read-only value.

**Upcoming rows are freely editable.** A row whose `valid_from` is in the
future has never influenced anything — no estimate has been displayed from
it for a past date, nothing resolved against it. Editing or deleting a
mistake in an *upcoming* row is safe, so it gets a normal edit dialog
(value, date, status, source) and a plain delete-with-confirm (the one
exception to "no delete": a period that never started isn't history — it's
a draft. Server-side this is a real DELETE of a row whose
`valid_from > today`, revalidating the series; **J2** flags this exception
explicitly for owner veto).

### 4.3 Flow 3 — Correct history (the gated path)

**Entry point is deliberately quiet:** historical and current rows show no
edit icon. The timeline footer carries one `text-muted` link: "Correct a
historical value…". Rationale: an edit icon on every row advertises "this
is editable data"; history is *record*, and the affordance's absence is the
first layer of friction.

**Step 1 — the decision fork** (dialog):

> "What kind of change is this?"
>
> **(a) The law changed on some date** — the stored value was right until
> then. → routes to Flow 1 (add new period) with the dialog explaining:
> "history stays as it was; a new period records the change."
>
> **(b) The stored value was never right** — a transcription or data-entry
> error. → proceeds to step 2.

This fork is the core of the friction design: the most common "I need to
edit history" impulse is actually "a rate changed", and the fork *converts*
it into the safe append operation. Only a genuine transcription error
proceeds — and the person has now explicitly asserted, in the UI, that the
value was never legally true.

**Step 2 — the correction dialog** (only reachable via (b)):

- Row shown with **old value → new value** side by side; period and
  parameter restated.
- **Consequence statement**, verbatim rule from the brief made visible:
  > EN: "Correcting this value changes what estimates and cross-checks
  > display. It never changes booked ledger amounts — salary figures are
  > transcribed from payslips, not computed."
  > RO: "Corectarea acestei valori schimbă ce afișează estimările și
  > verificările. Nu modifică niciodată sumele înregistrate în registru —
  > cifrele de salariu sunt transcrise de pe fluturași, nu calculate."
- **Mandatory correction note** (textarea): appended to the row's `source`
  as `"; corrected <date>: <note>"` — provenance grows, it is never
  replaced. The original source string survives verbatim (L-0018's spirit:
  provenance labels travel).
- **Typed confirmation for confirmed rows:** if the row being corrected has
  `status = confirmed`, the dialog requires typing the parameter's short
  label (e.g. `CAS`) to enable the submit button. An estimate row skips the
  typing (correcting an estimate is expected life; overwriting
  accountant-confirmed history is the act that deserves a speed bump).
  Submit button uses the destructive treatment.
- Scope of editability: **value, status, source only.** Window boundaries
  (`valid_from`/`valid_to`) are NOT editable in this flow — a wrong boundary
  is a two-row operation with its own hazards, split out below.

**Boundary move (sub-scope, separable):** "the change actually happened on
March 1, not May 1" moves one boundary shared by two adjacent rows. If
included, it is a distinct gated operation reached from the same fork
(option (c): "the change date is wrong"), showing both affected rows'
before/after ranges in preview and submitting atomically (the deferred
constraints exist precisely to allow this). Recommendation: **defer to a
follow-up unit** — day-one, a wrong boundary can be handled by the
correction note while rare; shipping flows 1–3 first keeps this unit
reviewable. **J3** asks the owner to rule it in or out of Unit B.

## 5. What each state looks like (control states)

All interactive elements are existing primitives (`Button`, `Input`,
`RadioGroup`, `Dialog`, `AlertDialog`, `Tabs`) and inherit their token-based
hover/focus/disabled states, including the L-0001 focus ring. No new
primitive is introduced; no state needs bespoke design beyond:

- Timeline rows are **not** clickable rows (no row-level navigation exists);
  only explicit actions are interactive. Rationale: in a table where most
  rows are deliberately inert records, a hover treatment on the whole row
  would promise interaction the design refuses.
- The disabled submit in flow 3 (before typed confirmation matches) uses the
  primitive's disabled state; the enabling condition is stated inline under
  the field, not left to discovery.

## 6. Overlap/gap prevention — the affordance summary

Server-side validation is GIVEN (GiST exclusion, deferred continuity
trigger, pure validators). The UI's job is to make invalid states
**inexpressible or visible-before-submit**, in this order:

1. **No `valid_to` input exists anywhere** (§4.1) — the only user-entered
   date is a period's start; ends are always derived. Overlaps and gaps
   cannot be typed.
2. **Append-only date constraint** in flow 1 (`> latest valid_from`,
   client-side) with the reason shown inline if violated ("periods are added
   after the latest existing period; to fix history, use Correct…").
3. **Live preview** of the two-row atomic result before submit (§4.1) — the
   closure of the open row is shown, not implied.
4. **The timeline itself** renders contiguity: consecutive inclusive ranges
   visibly chain ("… – 30 Apr 2026" / "1 May 2026 – …"). A reader can audit
   the invariant by eye, which is the UI's honesty check on itself.
5. **Server codes as the backstop**, surfaced through `useTranslatedError`
   with field-level placement — never raw constraint prose (Unit A's error
   codes are already catalog-complete).

## 7. Investment-CASS bracket tab

The `cass_investment_brackets` parameter versions a **set**, so its timeline
rows expand to a bracket table (the period row is the parent; the four
children render beneath when expanded; current period expanded by default):

```
│ from 1 Jan 2026                    CONFIRMED   accountant …      │ CURRENT
│   ANNUAL INCOME             BASE          CASS DUE               │
│   under 24 300              0             0                      │
│   24 300 – under 48 600     24 300        2 430                  │
│   48 600 – under 97 200     48 600        4 860                  │
│   97 200 and above          97 200        9 720                  │
```

- Amounts in RON (from bani), tabular; bounds displayed inclusive-lower /
  exclusive-upper phrased as "under X" — matching how the law states them.
- **New period (flow 1) for brackets:** the dialog's value section is a
  bracket grid. Same no-derivable-input principle scaled down: each
  bracket's **lower bound is derived from the previous bracket's upper
  bound** (rendered read-only); the user types only upper bounds, bases, and
  CASS amounts; the final upper bound is fixed "∞". Bracket count defaults
  to the current set's four; add/remove bracket rows is allowed (future law
  may change the count — the child schema already permits it).
- **No minimum-wage arithmetic is shown.** The 2026 bounds happen to be
  6/12/24 × minimum wage, but the stored facts are amounts, deliberately
  (Unit A: bounds and bases may diverge under future legislation). The UI
  displays stored amounts only; deriving or hinting the multiple would imply
  a formula the schema deliberately does not encode.
- Corrections to a historical bracket set go through the same flow-3 gate;
  the correction dialog shows the full old grid → new grid.

## 8. Empty states

### 8.1 Parameter with no periods (the brief's named case)

```
CASS — INVESTMENT BRACKETS                       [ + Add first period ]
╭──────────────────────────────────────────────────────────────────╮
│                    ⚖ (icon-feature, muted)                       │
│   No validity period configured. Estimates that need this        │
│   parameter will report missing coverage until one exists —      │
│   nothing falls back to a guess.                                 │
╰──────────────────────────────────────────────────────────────────╯
```

The copy states the system's actual behavior (`tax.configCoverageMissing`,
no fallback — Unit A's contract) as a *feature*: absence is honest, not
broken. The CTA opens flow 1's dialog unchanged except: the preview shows
only the new row (nothing closes), and the inline note reads "coverage
starts at this date; earlier dates will report missing coverage."

### 8.2 Whole-table empty (live's actual day one)

Every parameter block shows §8.1. Additionally the page header carries one
banner-level line: "No tax parameters configured yet. The confirmed 2026
values exist as a seed — populating a live database is a separate,
owner-approved operation." — a pointer, not a button. **Deliberately no
"run seed" action in the UI**: Unit A ruled seed-into-live is never a hidden
side effect; a settings-page button would recreate exactly that hazard
(L-0021/L-0022 family). **J4** flags this if the owner wants a guided path.

## 9. Language plan — EN/RO, provisional Romanian terms

New catalog namespace `taxSettings.*` plus `enums.taxConfigParameter.*`
labels. Proposed labels, with **provisional markers where accountant
confirmation is pending** (per brief; provenance discipline per L-0018 —
provisional status is recorded here, not silently dropped):

| Parameter | EN | RO | RO term status |
|---|---|---|---|
| `cas_employee_rate` | CAS — pension contribution (employee) | CAS — contribuția la pensii (angajat) | confirmed usage (payslip) |
| `cass_employee_rate` | CASS — health contribution (employee) | CASS — contribuția la sănătate (angajat) | confirmed usage (payslip) |
| `cam_employer_rate` | CAM — employer labor contribution | CAM — contribuția asiguratorie pentru muncă | confirmed usage (payslip) |
| `income_tax_rate` | Salary income tax | Impozit pe venitul din salarii | **PROVISIONAL** — exact statutory phrasing to confirm |
| `dividend_tax_rate` | Dividend tax | Impozit pe dividende | confirmed usage |
| `minimum_wage` | Gross minimum wage | Salariul minim brut pe economie | **PROVISIONAL** — "pe economie" vs "garantat în plată" |
| `personal_deduction` | Personal deduction | Deducere personală | confirmed usage (payslip) |
| `cass_investment_brackets` | CASS on investment income — annual brackets | CASS pentru venituri din investiții — plafoane anuale | **PROVISIONAL** — "plafoane" vs "tranșe" |

Provisional terms ship as written (best current knowledge) — the UI does
NOT display a provisional marker to the user (term uncertainty is a
process fact, not product information); this table is the tracked list for
the next accountant contact, joining Unit A's §7 open question on dividend
rounding. Copy rules throughout: "transcribed, never computed" phrasing per
§2; RO copy avoids any verb implying calculation of payroll ("calculează")
in salary contexts, using "estimare"/"verificare" instead.

## 10. Verification plan (for the implementation unit)

Standard objective gate (cache-cleared tsc per L-0013, eslint, G1–G4, scope
guard — `src/lib/tax/` in the diff is authorized by this unit's brief but
still escalates as Tier 3), plus:

1. **Inexpressibility checks:** the DOM contains no `valid_to` input in any
   dialog; flow-1 date input rejects `≤ latest valid_from` with the inline
   message; preview renders closure before submit.
2. **Half-open display helper:** unit tests pin storage→display
   (`2026-05-01` exclusive → "30 Apr 2026" inclusive) and the reverse for
   both locales.
3. **Friction ladder:** flow 3 unreachable except through the fork's option
   (b); typed confirmation gates confirmed-row corrections (submit disabled
   until match); estimate rows skip typing; correction note always appended
   to source with original preserved verbatim (fixture asserts the
   concatenation).
4. **Upcoming-row exception (if J2 approved):** editing/deleting a future
   row revalidates series continuity; deleting the only future row restores
   the prior open-ended row's null `valid_to` — fixture proves the pair
   operation.
5. **Bracket grid derivation:** lower bounds render read-only and always
   equal predecessor upper; server rejection of a synthetic bad set surfaces
   on the right row.
6. **Empty states:** empty test DB (pre-seed) renders §8.2 exactly; a single
   parameter emptied renders §8.1; no "run seed" affordance exists in DOM.
7. **Copy rule:** grep-level check that RO salary-context strings in the new
   namespace avoid "calculează"; EN avoids "computes payroll" phrasing —
   plus owner eye pass (judgment, not grep, is the real gate here).
8. **Catalog parity** EN/RO for all new keys; isolated-DB write tests for
   all three flows through the real server actions (test runner separation
   rules per Unit A §6); browser console clean; focus rings verified in
   compiled CSS (L-0006).

## 11. Scope, judgment flags, lessons

**In scope at implementation:** the `/manage/tax` page + client component,
tabs and timelines, flows 1–3 (flow 3 without boundary move unless J3 rules
it in), server actions + list/read service in `src/lib/tax/` (Tier 3),
catalog additions, isolated tests, this doc + A/B review-log rows.

**Out of scope:** `tax_rules` (legacy boundary stands), the seed and any
live-data population (§8.2), the calculators themselves, personal-deduction
formula/grid, annual CASS aggregation, dashboard tax panel (10-07F's unit),
any change to `tax_config` schema or its constraints.

**Judgment flags (owner decides):**

- **J1** — placement: `/p/[profile]/manage/tax` on all profiles (chosen) vs
  a profile-independent `/settings/tax` route.
- **J2** — the upcoming-row exception: free edit + real delete for rows
  whose `valid_from` is in the future (never influenced anything) — the
  UI's only delete. Veto makes upcoming rows correctable only via flow 3.
- **J3** — boundary-move operation: in Unit B or deferred to a follow-up
  (recommended: defer).
- **J4** — whole-table empty state deliberately has no "run seed" button
  (chosen); flag if a guided populate path is wanted despite the
  L-0021/L-0022 lineage.
- **J5** — typed confirmation (parameter short label) for confirmed-row
  corrections: deliberate speed bump in a single-owner app — owner may find
  it theatrical; it is one prop to remove.

**Proposed lessons:** none — the design applies existing rules (L-0013,
L-0018 provenance-travels, L-0021/22 no-hidden-population, Unit A's
invariants); it does not amend them.
