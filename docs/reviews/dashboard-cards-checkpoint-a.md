# Dashboard card backlog — empty states FIRST — Checkpoint A

**PROMPT-KEY:** 10-07F
**Status:** ACCEPTED 2026-07-17 (Checkpoint A) — rulings in review-log. Design doc only; no
code in this unit. Implementation tiers vary per card (display queries are
Tier 2; anything touching ledger/tax/db paths escalates per standards).

Standing rule, restated as the doc's first principle: **the full look is
earned after months of use, never faked day one.** Every card below is
designed empty-first — the empty and sparse states are the primary
deliverable, the dense state is the reward, and nothing ever renders a
zero-filled or sample-data chart to look finished.

---

## 1. Rules that bind every card

### 1.1 The three states, defined precisely

| State | Definition | Design obligation |
|---|---|---|
| **Empty** | Zero rows relevant to the card's question (for its scope + period) | Say *why* it's empty and *what makes it fill* — one sentence + one action link where an action exists. Never a greyed-out fake chart, never a chart of zeros |
| **Sparse** | Data exists but below the card's honesty threshold (defined per card, as an explicit named constant) | Show exactly what exists, labeled with how much history it represents ("2 months"). Charts appear only in forms that don't fabricate continuity |
| **Dense** | At/above threshold | The full card. Secondary deliverable by brief |

The sparse threshold is always a **named constant in the card's module** with
the rationale in a comment — tunable by the owner, never a magic number.

### 1.2 Empty-state grammar (shared anatomy)

```
╭──────────────────────────────────────────────╮
│ CARD TITLE                            micro  │
│                                              │
│              ⌾  (icon-feature, 24px)         │
│      One sentence: why empty, what fills it. │
│      [Action link →]         (when one exists)│
╰──────────────────────────────────────────────╯
```

- Icon: Lucide, `icon-feature` (24 px), stroke 1.5 absolute, `text-muted`.
- Sentence: `font-secondary`, `text-secondary`, centered, max ~40ch.
- Action: the app's existing link treatment; only when a real action fills
  the card (enter a transaction, run an import). No action for cards that
  fill by time passing — a "wait" card gets no fake button.
- The card keeps its **dense-state height** only if it sits in a grid row
  with a filled sibling (avoids a lurching layout as cards fill in over
  months); a full-width empty card may hug its content.

Rationale: the empty state is the *first* thing the owner sees on day one —
it is the card's pitch for why it deserves dashboard space. A card that
can't explain itself empty shouldn't ship.

### 1.3 Chart conventions (adopted from the dataviz method, parameterized by OUR tokens)

These bind cards 3–5 and any future chart card:

- **One axis, ever.** Two measures of different scale → two charts or an
  indexed base — never a dual y-axis.
- **Thin marks, recessive chrome.** Gridlines/axes are solid 1 px
  `border-hairline` — never dashed. Saturated fills only on small marks;
  values and labels always wear text tokens (`text-primary`/`text-secondary`
  /`text-muted`), never the mark's color.
- **2 px surface gaps** between adjacent fills (stacked segments, paired
  columns) instead of borders around marks.
- **Table-view twin.** Every chart's values are reachable without the chart:
  the adjacent ranked list (card 4), the value columns (card 3), or a
  table toggle (card 5). Tooltips enhance, never gate.
- **Hover layer by default**: per-mark tooltip on bars/segments; hit areas
  ≥ ~24 px including the gap. Tooltip = existing popover styling
  (`surface-raised`, `shadow-raised`, `radius-input`).
- **Status colors only where color MEANS money status.** The token
  foundation's own rule — `status-*-fill` neons are documented for "dots,
  small badges, and chart accents". Income/expense polarity qualifies;
  category identity and person identity do NOT (see the palette gap, Q8).
- **No fabricated continuity.** No trend line through fewer than 3 real
  points, no interpolation across missing months, no projections. Missing
  months render as visible absence (an empty slot on the axis), not as zero.
- `tabular-nums` per the project token system on all aligned numbers (the
  dataviz guidance prefers proportional digits on lone hero figures; the
  project's `font-amount-*` roles are GIVEN and win — noted, not fought).

### 1.4 One filter row, not per-card filters

Period and scope controls live in **one control row at the top of the
dashboard**, never inside a card. Cards state (in their header micro-label)
which scope they render when they *don't* follow the row — the tax panel is
quarter-structured by nature and card 5 owns a rolling window; everything
else obeys the row. Controls reuse the 10-06F segmented-control language for
visual consistency (same track/segment tokens) — one selection idiom
everywhere.

- **Period**: month stepper `‹ July 2026 ›` (default: current month) —
  scopes cards 3 and 4.
- **Scope** (household dashboard only): the card-2 toggle, §4.

### 1.5 Explicitly out of scope

Budgeting/spending-limit bars and savings-goal cards are **not wanted**
(owner ruling in the parked plan) and are not designed here. Investment
cards exist (Phase 4) and are untouched.

---

## 2. Dashboard composition per profile

| Profile | Cards, in order |
|---|---|
| **Household** (shared) | Control row (period + scope) → balances/net-cash (existing, restyled to card grammar eventually — not this unit) → **3 Who paid what** → **4 Category breakdown** → **5 Income vs expense** → investments (existing) |
| **Greg / Andra** (personal) | Period row → balances (existing) → 4 and 5 scoped to that owner's accounts → investments |
| **Skyline / DRMX** (SRL) | **1 Quarterly tax panel** (top — it is the profile's reason to exist) → balances → 5 scoped to the company (pending Q6) |

Rationale for order: the household dashboard leads with the card that
replaces a real ritual (card 3); SRL dashboards lead with the differentiator
(card 1). The parked-plan warning — don't let a single-user layout bury the
entity structure — is answered by making the entity-specific card the
headline of each entity's own dashboard.

---

## 3. Card 1 — Quarterly tax panel (per company)

**Job:** answer, at a glance, "what does this SRL owe the state for the
current quarter, is any of it an estimate, and what's the history?" Ranked
high in the parked plan as a key differentiator. A v1 already exists on the
company dashboard (two plain tables); this design supersedes its
presentation, not its data path (`getTaxAccrualGroups` — untouched, Tier-3).

**Data:** `tax_accruals` (year, quarter, rule) joined to postings — exists
and proven. **Not exposed by the schema** (questions, do not assume): due
dates (Q1), payment/settlement attribution per quarter (Q2).

### EMPTY state (primary) — company with nothing accrued this quarter

```
╭──────────────────────────────────────────────────────╮
│ TAX — Q3 2026                                        │
│                                                      │
│                     ⚖ (Scale, 24px, muted)           │
│   Nothing accrued for Q3 yet. Micro-revenue tax      │
│   accrues automatically when company income is       │
│   booked; salary taxes accrue with each salary.      │
│                                                      │
│   PREVIOUS QUARTERS                       micro      │
│   Q2 2026                        1 906,00 RON        │
╰──────────────────────────────────────────────────────╯
```

Two deliberate choices:

1. **The empty copy teaches the accrual model.** "Accrues automatically" is
   the app's core domain rule (micro tax on company income — standing
   domain semantics); day one, this card is documentation. No action link:
   nothing the owner *should* do fills it — booking income fills it as a
   side effect, and inviting "add income" from a tax card would be noise.
2. **History stays visible under an empty current quarter.** A new quarter
   starts empty every three months forever — that must not blank the whole
   card. Empty scopes to the *current-quarter block only*.

Day-zero empty (no accruals ever, fresh company): the PREVIOUS QUARTERS
block is absent entirely — not rendered as an empty list.

### SPARSE state — one or two rule rows, first quarter of use

Sparse threshold: fewer than 2 quarters of history. The current-quarter
block is already honest at any row count (it's a list, not a chart); sparse
only suppresses summary flourishes:

```
╭──────────────────────────────────────────────────────╮
│ TAX — Q3 2026                                        │
│   owed so far          1 906,00 RON   (number-lg)    │
│   ────────────────────────────────────────────       │
│   Micro-revenue tax               505,00 RON         │
│   CASS on dividends  [ESTIMATE] 1 401,00 RON         │
│                                                      │
│   First quarter tracked — history builds from here.  │
╰──────────────────────────────────────────────────────╯
```

- The quarter total is the card's stat figure — `font-number-lg`,
  `text-primary`, tabular. Owed amounts render as plain `text-primary`, NOT
  `status-negative-text`: owing accrued tax is the *normal operating state*
  of a company, not an alarm. Red is reserved for genuinely negative money
  meanings (domain rule: color by meaning). **J1 flags this for the owner.**
- ESTIMATE badge: exactly the existing marker (`bg-surface-inactive` +
  `text-status-warning-text`, micro uppercase) — the domain rule that
  estimated figures carry the marker is already implemented; the design
  keeps it verbatim. If any rule row is an estimate, the quarter total also
  carries the badge (an estimate anywhere poisons the sum's certainty).
- The one-line "first quarter tracked" caption (`font-caption`,
  `text-muted`) is the sparse marker — it replaces, never fakes, a history
  list.

### DENSE state (secondary)

Sparse layout + the previous-quarters list (newest first, each row: period
label, ESTIMATE-if-any, total; the existing per-period aggregation logic).
Row click → (future) quarter detail; not designed here. If Q1/Q2 resolve
(due dates, payments), each quarter row gains a right-aligned settled/owed
treatment — **designed only after the data questions are answered**; the
card's geometry reserves no space for it and needs none (rows are lists,
they extend).

Annual rows (`quarter = null`, e.g. CASS on dividends) render under their
year with the existing `periodAnnual` label — the current code already
handles this; keep it.

---

## 4. Card 2 — Per-entity vs consolidated toggle (household dashboard)

**Ruling honored:** consolidation is a **dashboard-only view, not a
navigable context**. The toggle changes what the household dashboard's money
sections aggregate; it does not create a sixth profile, does not persist
into other pages, and no URL outside the dashboard route carries it.

**Form:** a two-segment control in the dashboard control row (10-06F visual
language): `[ Consolidated | By entity ]`. Default: **Consolidated** — the
household dashboard's existing net-cash view is already cross-entity, so
consolidated-by-default matches current behavior. State lives in a dashboard
`searchParams` key (`?view=entities`) so a view is shareable/bookmarkable
yet evaporates on navigation — the least stateful mechanism that survives a
refresh. Rationale: local component state would reset on every visit and
`router.refresh()`; a cookie or store would leak toward "context", which
the ruling forbids.

**What it scopes:** the balances/net-cash section and cards 4–5 (pending
Q6/Q7 elimination semantics). Card 3 is inherently within-household
(owner-based) and ignores it; card 1 is inherently per-company and lives on
SRL dashboards.

**Consolidated** (default): today's net-cash card — total cash across
entities, accrued tax deducted, one net figure. Extended per this design
only in styling, not semantics.

**By entity**: the same figures broken out, one row-group per entity
(Household, Skyline, DRMX) — each showing cash, accrued tax (companies), and
net. Presentation is grouped rows in one card, NOT three cards: the point of
the view is comparison down a column.

```
│ NET CASH — BY ENTITY                                 │
│   Household            12 345,00                     │
│   Skyline Studio SRL    8 000,00   tax −1 906,00     │
│   DRMX Digital SRL      3 200,00   tax     0,00      │
│   ───────────────────────────────────────────        │
│   Combined            21 639,00 RON                  │
```

**Empty/sparse:** the toggle is a control, always rendered. Entities with
zero balances show real zeros (a zero is data, not absence). The genuinely
empty case (no accounts at all) is the balances section's existing empty
handling, not this card's.

**Inter-entity honesty (Q7):** the consolidated income/expense and category
views must not double-count inter-entity movements (net salary leaving an
SRL and arriving in the household is a transfer within the consolidated
boundary, not income + expense). The *cash* consolidation shown above is
safe (balances sum regardless); the *flow* consolidation is designed but
**gated on Q7's answer** — until then, the toggle scopes balances only, and
cards 4–5 state "Household entity" in their header micro-label in both
toggle positions. This is the honest sparse state of the toggle itself.

---

## 5. Card 3 — "Who paid what this period" (Greg vs Andra)

**Job:** replace the monthly Google-Sheet reconciliation ritual. The ritual,
per the parked plan: each person covers their lanes (Greg = house/car/
restaurants, Andra = groceries/household), and they reconcile monthly to
decide next quarter's investing. The card must answer: *how much did each of
us pay this month, and on what?*

**Data:** fully exposed by the schema — expense postings on Household
accounts, `accounts.owner` (greg/andra, no joint accounts, so attribution is
exact and complete), `postings.categoryId`, period from `transactions.date`.
Needs a new display query (Tier 2), no schema change. Attribution model:
**payer = owner of the paying account** — exactly what "who paid" means, and
the same semantics the Sheet ritual uses. Kind scoping: `standard` expense
postings only; transfers are neutral by domain rule and excluded; company
entities excluded (this is a household card).

**Form (dataviz reasoning):** the job is magnitude comparison of exactly two
items → **two horizontal bars, one hue** (`accent`), direct-labeled, with
amounts as text. Explicitly rejected: a two-slice donut (anti-pattern: the
number is the chart), and per-person *colors* (person identity would demand
a categorical palette the token system doesn't have — Q8 — and
black-vs-grey would imply rank between spouses; one hue + labels carries
identity perfectly at n=2).

### EMPTY state (primary) — no expenses this period

```
╭──────────────────────────────────────────────────────╮
│ WHO PAID WHAT — JULY 2026                            │
│                                                      │
│                 ⇄ (UsersRound, 24px, muted)          │
│     No household spending recorded for July yet.     │
│     Entries and imports both land here.              │
│                   [New transaction →]                │
╰──────────────────────────────────────────────────────╯
```

Action link opens the New Transaction modal (10-06F) — a real action that
fills the card. The header keeps the period so "empty" is visibly scoped to
the month, not the app.

### SPARSE state — data exists, but only for this/few periods

Sparse threshold: the period has < `MIN_RECONCILIATION_ROWS` (proposed: 5)
expense postings, OR this is the first tracked month. The bars render from
the first leu — two bars can't lie — but the per-lane breakdown needs
volume:

```
╭──────────────────────────────────────────────────────╮
│ WHO PAID WHAT — JULY 2026                            │
│   Greg    ████████████████        1 240,50 RON       │
│   Andra   ████████                  610,00 RON       │
│                                                      │
│   3 entries so far this month.                       │
╰──────────────────────────────────────────────────────╯
```

The caption states the actual count — the card admits its own thinness
rather than padding it.

### DENSE state (secondary)

Bars + per-person top-lane lists (each person's top 3–5 categories by spend,
`font-secondary`, amounts tabular right-aligned) + the period total. A
"difference" line (`Greg paid 630,50 RON more`) in `text-secondary` — the
figure the reconciliation conversation actually starts from. Neutral
phrasing, `status-neutral-text` semantics: a difference between spouses'
lanes is not good/bad, so it never wears green/red (domain rule: color by
meaning). Hover on a bar → tooltip with that person's total + share.
Table twin: the amounts and lane lists ARE text — no separate table needed.

**Not designed in:** any settle-up/owed-between-spouses math. The ritual is
"look at the split, decide investing" — the card informs the conversation;
it does not adjudicate it. Adding "Andra owes Greg X" would invent a
50/50-split policy nobody stated (J2 flags whether the owner wants a
configurable split policy later).

---

## 6. Card 4 — Category breakdown (ranked list first, donut earned)

**Job:** where did the money go this period, by category. Real
post-imports (Phase 3 landed the first real batch already).

**Data:** postings.categoryId + two-level category hierarchy
(group → leaf, `categoryKind` income/expense). Exposed. Uncategorized
postings exist by construction (categoryId nullable) → the card MUST show
an explicit "Uncategorized" bucket — hiding it would misstate the total.
Question Q5: donut level — group or leaf (recommendation: groups in the
donut, leaves in the list; groups are ≤ 7 by design intent).

**Form — the empty-first insight of this card:** the **ranked list is the
card**; the donut is a dense-state garnish. The dataviz method is blunt
about donuts (part-to-whole at a glance only, ≤ 6 segments, never for
comparing close values) — and a sparse month of 4 transactions produces
exactly the close-value donut that misleads. So:

- **Empty** → grammar card.
- **Sparse** → ranked list ONLY. No donut.
- **Dense** → list + donut, donut capped at 5 segments + "Other".

### EMPTY state (primary)

```
╭──────────────────────────────────────────────────────╮
│ SPENDING BY CATEGORY — JULY 2026                     │
│                                                      │
│               ◔ (ChartPie, 24px, muted)              │
│    Nothing categorized for July yet. Imported        │
│    rows pick up categories in the review inbox;      │
│    manual entries carry their own.                   │
│                    [Go to imports →]                 │
╰──────────────────────────────────────────────────────╯
```

### SPARSE state — ranked list only

Sparse threshold: fewer than `MIN_DONUT_CATEGORIES` (proposed: 4) distinct
categories with nonzero spend, OR fewer than `MIN_DONUT_ROWS` (proposed: 15)
categorized postings in the period.

```
╭──────────────────────────────────────────────────────╮
│ SPENDING BY CATEGORY — JULY 2026                     │
│   Groceries        ████████████       812,40   41%   │
│   Restaurants      ██████             423,00   21%   │
│   Household        ████               298,10   15%   │
│   Uncategorized    ███                255,00   13%   │
│   ...                                                │
╰──────────────────────────────────────────────────────╯
```

Ranked horizontal bars, ONE hue (`accent`) — magnitude, not identity
(value-ramp-on-nominal and per-category hues both rejected; the latter is
Q8's missing palette). Amounts `font-amount-sm` tabular; share in
`text-muted`. Uncategorized always visible when nonzero, `text-muted` label,
last in visual weight but ranked honestly by size.

### DENSE state (secondary)

List (as above) + donut beside it (side-by-side ≥ `sm`, stacked below):

- Thin ring (not a filled pie) — ring thickness ~16 px; matches the
  hairline-and-air aesthetic; center holds the period total
  (`font-number-lg`).
- ≤ 5 segments + "Other" (fold the tail); segments ordered by size from
  12 o'clock; 2 px `surface` gaps between segments.
- **Segment fills, within the frozen token system:** alternating
  `status-neutral-fill` / `surface-inactive`, hovered-or-focused segment
  lifts to `accent`, its list row highlights in sync. Identity is carried
  by order-correspondence with the list + hover linking — NOT by hue.
  This is deliberately quiet and it is the honest ceiling of the current
  token system: **a categorical chart palette does not exist and this
  design invents nothing** (Q8 asks for that token-tier decision; the
  card's layout is palette-ready — segments recolor, nothing moves).
- The list is the table twin; the donut adds gestalt only.

Income view: the card defaults to expenses (`categoryKind = expense`);
an income variant is the same design filtered to income — whether it's a
second card or a header switch is deferred until income category volume
exists (post more imports), noted as J3.

---

## 7. Card 5 — Income vs expense over time

**Job:** the most motivating chart — "are we netting positive month over
month?" The brief names the honest sparse state as the hard part; this
section is mostly that.

**Data:** monthly sums of income vs expense postings (category.kind) on the
scoped entity/owner; excludes transfers, trades, opening balances by kind.
Exposed by schema; needs a new aggregation query (Tier 2). Company scoping
inherits the parked P&L question (gross-vs-net salary cost — Q6): until
ruled, this card ships on household/personal dashboards only.

**Form:** paired monthly columns — income and expense side by side per
month, 2 px gap within a pair, wider gap between months. Polarity is the
one place the status neons are *semantically correct* as chart fills (the
token doc's own "chart accents" role): income columns
`status-positive-fill`, expense columns `status-negative-fill`, both thin
(≤ 12 px — small marks, not blocks). Net-per-month appears as text in the
tooltip and the table twin, not as a third mark (two marks per month is the
legibility ceiling at this width; a net line would also tempt interpolation
across missing months). Axis: one y-axis, RON; x-axis month labels
`font-caption`; hairline gridlines at round RON steps. Rolling window:
trailing 12 months (dense), independent of the period stepper (a time-series
card owns its window; stated in its header).

### EMPTY state (primary) — no flow history at all

```
╭──────────────────────────────────────────────────────╮
│ INCOME VS EXPENSE                                    │
│                                                      │
│              ▁▄▂ (ChartColumn, 24px, muted)          │
│   This chart earns itself month by month — it        │
│   starts drawing after your first full month of      │
│   tracked activity. Nothing to do but live.          │
╰──────────────────────────────────────────────────────╯
```

No action link — this is the card that fills by time passing (§1.2). The
copy says so plainly. This is the standing rule made visible: the card
*names* the earning process instead of faking maturity.

### SPARSE state — 1–2 months (the hard part)

Sparse threshold: fewer than `MIN_TREND_MONTHS` (proposed: 3) months
containing any activity.

```
╭──────────────────────────────────────────────────────╮
│ INCOME VS EXPENSE — 2 MONTHS TRACKED                 │
│                                                      │
│      ▉▂            ▉▄                                 │
│      Jun           Jul                                │
│   in  5 000,00  in  5 000,00                          │
│   out 3 210,00  out 4 105,50                          │
╰──────────────────────────────────────────────────────╯
```

Decisions that make this honest:

1. **The header states the coverage** ("2 months tracked") — the card
   declares its own evidentiary weight.
2. **Only real months render.** No 12-slot axis with 10 empty slots
   pretending to be a year of zeros; the axis spans exactly the tracked
   range. A zero-activity month *inside* the range renders as a labeled
   empty slot (absence made visible), because skipping it would fake
   continuity.
3. **Direct-labeled values under each month** while n ≤ 2 — at two data
   points the numbers ARE the story and fit comfortably; the chart is
   almost a stat-tile pair, which is what two months of data honestly is.
   (Selective labeling returns at dense: endpoint + extremes only.)
4. **No trend line, no net line, no delta-vs-last-month** at n < 3 — one
   delta between two months is an anecdote; the existing balance summary
   card already carries the single "vs last month" delta, and duplicating
   it here dressed as a trend would overstate it.
5. **A partial current month is marked**: the in-progress month's column
   pair renders at full color with a `text-muted` "(so far)" suffix on its
   label — not projected, not faded (faded = fake uncertainty; the booked
   amounts are real, only the month is incomplete).

### DENSE state (secondary)

Trailing 12 months of column pairs; hover tooltip per month (income,
expense, net — net wears `status-positive-text`/`status-negative-text` by
sign, the semantic money colors doing their real job); selective direct
labels (latest month + extremes). Table twin: a "table" toggle in the card
corner swaps the plot for month rows (month, in, out, net) — same data,
WCAG-clean. Nothing else appears: no cumulative overlay, no averages, no
projections (forecasting is Phase 6 and will be its own surface).

---

## 8. Data & schema questions (listed, NOT assumed)

Per the brief: flagged as questions for the owner/schema, with what the
design does meanwhile.

| # | Question | Card | Until answered |
|---|---|---|---|
| **Q1** | Tax **due dates**: the schema has no due-date concept (declaration/payment deadlines like "25th of the month after quarter end" are domain knowledge, possibly `tax_config` material). Should the tax panel show deadlines, and from where? | 1 | Panel shows accrued amounts only, no dates |
| **Q2** | Tax **payment attribution**: payments to `tax_liability` accounts reduce balances, but nothing links a payment to a (year, quarter, rule). Is per-quarter "paid vs owed" derivable (e.g. per-rule liability account balances), or does it need a settlement link? | 1 | Panel shows accruals only; no paid/outstanding split |
| **Q3** | "This period" = **calendar month** — confirm that matches the ritual (vs. salary-to-salary or custom cycle) | 3, 4 | Calendar month assumed for the design, flagged |
| **Q4** | Who-paid scope: household `standard` expenses only, payer = paying account's owner, transfers excluded — confirm this matches what the Sheet actually reconciled (e.g. were any company-paid personal items in it?) | 3 | Designed as stated |
| **Q5** | Donut level: **group** categories in the donut, leaf categories in the list — confirm the two-level intent holds (are groups guaranteed ≤ ~7?) | 4 | Designed group-level |
| **Q6** | Company income/expense semantics inherit the parked **P&L question** (salary at gross+CAM vs net-as-transfer). Card 5 on SRL dashboards waits on that ruling | 5 | Card 5 ships household/personal only |
| **Q7** | Consolidated **flow** view: elimination rules for inter-entity movements (salary, owner transfers) so consolidated income/expense doesn't double-count. Needs a ruling on what "consolidated income" means before cards 4–5 join the toggle | 2 | Toggle scopes balances/net-cash only |
| **Q8** | **Categorical chart palette is a token-system gap.** Category identity (card 4) and any future >2-series chart need categorical hues; the semantic tier has none, and components may not touch primitives. This is a `design-tokens.md` + `globals.css` unit (frozen paths — owner-authorized only). Acceptance criteria when it runs: hues assigned in fixed order, validated for the lightness band, chroma floor, adjacent-pair CVD ΔE ≥ 12, and AA contrast against `surface` — computed, not eyeballed | 4 (+ future) | Card 4 ships with the neutral+accent treatment, which remains a legitimate permanent look |

---

## 9. Verification plan (for the implementation units)

Each card is its own unit with the standard objective gate; card-specific:

1. **Empty-state truth**: seed-fresh DB renders every card's empty state —
   no zero-charts, no NaN, no empty `<table>` skeletons; copy present in EN
   and RO (catalog keys, parity gated per L-0013 cache-cleared tsc).
2. **Threshold constants**: each sparse threshold is a named exported
   constant with a comment; a fixture on each side of the boundary proves
   the state switch (donut absent at 3 categories, present at 4, etc.).
3. **Honesty checks (card 5)**: fixture with a gap month → gap renders as
   labeled absence; 2-month fixture → no trend line in DOM; partial month
   carries the "(so far)" marker.
4. **Attribution (card 3)**: fixture with expenses from both owners' accounts
   + a transfer between them → transfer excluded, split exact; totals match
   a hand-computed control.
5. **Aggregation reconciliation**: card 4 list total + uncategorized =
   period expense total from card 5's month — the two cards must never
   disagree on the same month (single source query or a test pinning both).
6. **Tax panel regression**: existing `getTaxAccrualGroups` untouched
   (Tier-3 path — any change escalates); ESTIMATE badge renders for
   `cass_dividend`; annual (`quarter = null`) rows label correctly.
7. **Toggle ruling**: `?view=entities` affects the dashboard only; no other
   route reads it; navigation away and back resets to default — proving
   "view, not context".
8. Standard: G1–G4 greps (chart fills must resolve to semantic tokens —
   G1/G4 will catch any smuggled hex), focus treatment on the toggle/table
   toggles (L-0001), compiled-CSS focus verification (L-0006), browser
   console clean on all five profiles.

---

## 10. Scope, judgment flags, lessons

**This unit:** this design doc only. Implementation is per-card units,
sequenced by data readiness: 1 (restyle of live data) → 3 (query exists in
parts, ritual value highest) → 4 → 5 → 2's flow extension (post Q7).

**Judgment flags (owner decides):**

- **J1** — accrued tax renders `text-primary`, not red (owing accrued tax is
  normal operation; red = alarm). Owner may prefer the liability signal.
- **J2** — card 3 deliberately omits settle-up math (no "Andra owes Greg X");
  flag if a split policy should exist someday.
- **J3** — card 4 income variant: second card vs. header switch — deferred
  until income category volume exists.
- **J4** — card 5's empty-state copy has personality ("Nothing to do but
  live."). Flagged in case the owner wants it drier.
- **J5** — the balances/net-cash sections keep their current table styling
  this unit; migrating them to the shared card grammar is a separate
  restyle unit if wanted.

**Proposed lessons:** none — the empty-first rule already lives in the
parked plan; this doc applies it. If the owner wants it promoted from
parked-plan prose to a ratified lesson (it is a process rule that has now
bound a second unit), a draft would read: *"Every data-driven card ships
its empty and sparse states as the primary design; dense is earned. No
zero-filled or sample-data charts, ever."* — proposed only, awaiting
ratification per ledger rules.
