# Import-inbox page — Checkpoint A

**PROMPT-KEY:** 11-08F
**Status:** ACCEPTED with rulings 2026-07-18 — see docs/review-log.md. Design doc only; no code in
this unit. At implementation the unit touches `src/lib/import/*` (service,
actions) and likely one schema delta (§6.3) — **Tier 3 by path definition**
(ledger-adjacent service/actions, db, drizzle); every migration is its own
gated step.

**Brief-premise correction, up front (L-0018 honesty):** the brief describes
`src/components/import/import-inbox.tsx` as "serving the Revolut flow."
It does not — it serves the **ING statement flow** (it imports `ImportKind`
from `@/lib/import/ing/classify` and drives the per-row book/skip gate).
The Revolut brokerage flow has its own component (`revolut-inbox.tsx`) with
a **different, separately approved gate** (verification evidence → grouped
exclusions → one whole-batch approval), pinned as load-bearing registry
entry 4. "Supersede the baseline" therefore means: this design succeeds the
**ING statement inbox's presentation**; it must **preserve** the per-row
gate and tightly-scoped bulk action that entry 4 protects, and it does
**not** redesign the Revolut whole-batch gate (out of scope, own approved
model). The registry entry is updated in the implementing unit's diff.

---

## 0. Decision table (owner ratifies; rationale in the numbered sections)

| # | Decision | Ruling proposed |
|---|---|---|
| D1 | Inbox scope | Per-profile, entity-scoped — no global inbox; nav face is the ratified Imports item + badge (nav-ia D9) (§2, answers brief Q1) |
| D2 | Page states | Empty state is the hero: import entry form + quiet "nothing awaiting review" line; pending batches list only when nonzero; closed batches under a collapsed disclosure (§3) |
| D3 | Batch header | Identity line (statement № · account · period), count strip (pending/booked/skipped/duplicate), and a reconciliation line (opening + rows = printed closing) rendered only when the source carries balances (§4) |
| D4 | Row anatomy | Three-zone row: identity (line №, date, counterparty) · evidence (amount, FX, balance-after, badges, classifier reason) · resolution (category, actions) (§5) |
| D5 | Suggested vs confirmed category | Suggestion = pre-filled select in a dashed-border container + `Sparkles` icon + caption "Suggested"; container turns solid the moment the reviewer touches it; booked = plain text, no icon (§5.3) |
| D6 | Row lifecycle in view | Resolved rows grey **in place** until the batch closes; sticky progress line "N of M reviewed"; batch leaves the pending list at zero pending (§6.1, answers brief Q2) |
| D7 | Skip-with-reason | Preset reasons + optional free note; reason stored on the row and shown in the greyed row's status caption; "remember this skip" is the rules engine's job — the dialog reserves the affordance slot, ships nothing now (§6.3, answers brief Q3) |
| D8 | Bulk action | Keep "Confirm all high-confidence" (scoped), do NOT add "confirm all remaining"; **new exclusion needed**: `owner_transfer` rows must leave the bulk scope — today the salary payout row is bulk-bookable, which breaks the skip discipline (§7) |
| D9 | Duplicate presentation | Duplicate rows stay in the list, neutral badge "Already imported" + link to the existing transaction; never bookable, never hidden; counted in the header strip (§8) |
| D10 | FX display | Original amount + currency, the bank's **printed rate verbatim** (never reformatted), settlement amount — one evidence line on the row (§5.2) |
| D11 | Future match-to-existing | The resolution zone is a verb cluster + a full-width expandable panel; "Match to existing…" becomes a third resolution verb opening a candidate panel in the same slot — layout reserves the shape, builds nothing (§9, answers brief Q4) |
| D12 | Lidl/receipt tolerance | Nothing in D1–D11 assumes a bank statement: a receipt batch is a batch with no balances (D3 line absent), no bank refs, and one row per receipt — the anatomy tolerates it without redesign (§2.3) |

Owner-ruling Q-items are gathered in §12.

## 1. Current state — what exists, what this unit supersedes

**Exists and stays:** the entire import *pipeline* — parse
(`ing/parse.ts`, header-arithmetic validation), classify
(`ing/classify.ts`: 8 kinds, high/low confidence, coded reasons), identity
(`ing/identity.ts`: long bank ref, else synthetic
`ING:{iban}:{statementNumber}:{lineNo}`; L-0010), staging schema
(`import_batches` / `import_rows` with `overlapSuspect`, status enum
`pending|booked|skipped|duplicate|trashed|purged`), and booking through the
single ledger write service. None of that is redesigned here.

**Exists and is superseded in presentation:** the `/p/[profile]/imports`
page (paste form + flat batch list) and `import-inbox.tsx` (single-column
row stack, badge cluster, inline select + Book/Skip). What the current
presentation lacks, and this design adds: an honest empty state (today the
page renders an empty-list caption under a form with no hierarchy), batch
header context (counts exist only as one caption; no reconciliation, no
printed balances), FX visibility (parsed and stored in `payload`, never
rendered), skip *reasons* (skip is a bare status flip), duplicate rows that
explain themselves (today a one-word status), and any progress affordance
for a 40-row sitting.

**Exists, different gate, untouched:** `revolut-inbox.tsx` (registry
entry 4's second half). Greg's profile keeps it; §2 places both under one
page shell without merging their gates.

## 2. Placement and multi-entity (D1 — brief Q1)

**Recommendation: per-profile inboxes. No global inbox.**

- **Already half-ruled:** nav-ia D9 (ratified) put one Imports item per
  profile with a badge counting *that profile's* pending rows across both
  inbox types. A global inbox would need a new nav face, re-litigating a
  ratified ruling for no user: the two humans each review their own
  entity's statements.
- **The context model is profile-first everywhere else** (transactions,
  manage, dashboard all scope to the profile's entity). A global list
  would carry per-row entity switching — exactly the hidden-context shape
  nav-ia D7 rejected for All-entities.
- **Booking is entity-bound anyway:** a batch carries `entityId` +
  `bankAccountId`; category options, tax accrual rules, and the write
  service all resolve per entity. A cross-entity list could *show* rows
  but every action would still be entity-local — a global inbox is a
  read-only veneer pretending to be a workspace.

### 2.1 Who sees what

| Profile | Inbox content | Mechanism |
|---|---|---|
| Skyline, DRMX | ING statement batches for the company entity | existing `companyFlows` |
| Greg | Revolut brokerage batches (own gate) | existing `owner === "greg"` — nav-ia flagged promoting this to an `imports` capability flag; this unit inherits that flag when it lands |
| Household, Andra | no Imports item today | receipt OCR (parked) would enter here as a household-entity source; the page shell is source-agnostic (§2.3) |

### 2.2 Route shape

Unchanged: `/p/[profile]/imports` (page = entry form + batch lists),
`/p/[profile]/imports/[batchId]` (batch review). The badge count and the
page's pending list must derive from the same query — one number, two
renders, no drift.

### 2.3 Source-agnosticism (D12)

The anatomy binds to the staging schema, not to ING: a batch is (source
tag, target account, optional period, optional printed balances, rows); a
row is (identity, date, direction, amount, optional counterparty, optional
FX, classification, resolution state). ING fills everything; Revolut CSV
fills no printed balances (its gate differs anyway); a receipt batch would
fill no bank refs and no balances — D3's reconciliation line and D4's
evidence badges simply don't render where the source carries nothing.
Absence renders as absence (registry entry 2's rule), so the third source
costs new *parsers*, not a new page.

## 3. Page states (D2)

### 3.1 Empty — the primary state (L-0027)

Most days there is nothing to review. The page's hero is therefore the
**import entry form** (paste form for statement profiles, upload for
Greg), followed by one quiet line where the pending list would be:

```
Import statement                                    ← form, unchanged
┌─────────────────────────────────────────────┐
│ [paste area / account select / submit]      │
└─────────────────────────────────────────────┘

  ⬡ Inbox            (Lucide Inbox, icon-feature 24, text-muted)
  Nothing awaiting review.
  Booked and skipped batches are kept below.     text-secondary/text-muted
  Closed batches (6) ▸                            collapsed disclosure
```

- **No "Pending (0)" header, no empty table scaffold** — a zero-count
  section header is noise; the sentence is the state.
- The nav badge renders nothing at zero (nav-ia's zero-badge rule) — page
  and badge agree by construction (§2.2 single query).

### 3.2 Pending batches (list on the page)

When nonzero, a "Needs review" section lists pending batches as rows
(statement № · account · period · `pending/total` counts, counts in
`font-numeric` where they are figures) linking to the batch page. Ordered
oldest-first — statements should be reviewed in sequence because running
balances chain across periods.

### 3.3 Closed batches

Batches at zero pending move under the collapsed **"Closed batches (N)"**
disclosure (same grammar as 10-09F's deleted-rows disclosure): visible,
countable, out of the way. A closed batch's page stays reachable — it is
the audit view of what was booked/skipped/duplicate, including rows later
flagged `modifiedAfterImport`.

## 4. Batch review page — header and progress (D3)

```
Nr.6 / 30.06.2026 · ING curent Skyline · 01–30.06.2026        ← identity
Pending 5 · Booked 9 · Skipped 1 · Duplicates 2               ← count strip
Opening 12 345,67 + rows −3 210,45 = Closing 9 135,22 ✓       ← reconciliation
────────────────────────────────────────────────────────────
▶ 12 of 17 reviewed                    [ Confirm all high-confidence ]
```

- **Identity line:** statement number as printed, target account name,
  period. `text-card-title` for the number, `text-secondary` for the rest.
- **Count strip:** the four statuses with counts, `font-numeric` numerals,
  `text-caption`; statuses at zero are omitted (absence, not "0").
- **Reconciliation line:** opening balance + signed row sum = printed
  closing balance, all `font-numeric`. The parser already validates this
  arithmetic at import (a failed parse never creates a batch), so the line
  is **evidence display, not a live check** — it shows the reviewer that
  the batch is arithmetically whole before they trust its rows. Renders
  only when the source carries printed balances (D12). Check mark
  `text-status-positive-text`; if a future source carries balances that
  don't reconcile, the batch shouldn't exist — there is no "✗ state" to
  design, and inventing one would imply we book from broken parses.
- **Progress line:** "12 of 17 reviewed" (`font-numeric` numerals),
  sticky with the action bar while scrolling a long batch — the answer to
  "how much is left" must not require scrolling to the bottom.

## 5. Row anatomy (D4)

Three zones, one bordered row (`border-hairline` separators, unchanged):

```
#3   14.06.2026   ANTHROPIC                             −141,25 RON
     description text · Bank ref ▣                    24,90 EUR × 5.6728
     [subscription] [high] ⚠overlap?                 balance 8 993,97
     Reason: known recurring merchant
     ┌╌ Suggested ✧ ╌╌╌╌╌╌╌╌╌╌┐
     │ Software · Expense   ⌄ │   [ Confirm ]  [ Edit ]  [ Skip… ]
     └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

### 5.1 Identity zone (top line, left)

Line № (`text-caption text-muted`), book date, counterparty name
(`text-secondary text-text-primary`, truncating). Counterparty IBAN and
full raw description live in the row's expandable detail (§5.5) — the scan
line stays scannable; the evidence stays one click away, not absent.

### 5.2 Evidence zone (right + badge line)

- **Amount:** signed, `font-numeric tabular-nums`; credits
  `text-status-positive-text` with `+`, debits `text-text-primary` with
  `−` (existing convention, kept).
- **FX line (D10),** only on FX rows: `24,90 EUR × 5.6728` — original
  amount + currency and the bank's **printed rate rendered verbatim as the
  stored string** (schema comment + L-0015: precision varies row to row;
  the app prefers this rate over BNR; nothing may reformat it). The
  settlement amount is the main amount figure above it — printing it twice
  adds nothing. `text-caption`, amounts `font-numeric`.
- **Balance-after:** `text-caption text-muted`, `font-numeric` — the
  running balance is how a human cross-checks a row against the paper
  statement; it costs one caption and saves a PDF round-trip.
- **Badges:** kind (secondary), confidence (`outline` high /
  `destructive` low — kept), ref badge (bank ref vs synthetic key, kept),
  overlap-suspect (destructive, kept — it gates bulk booking and demands
  individual confirmation; entry 4 pins this on the row).
- **Classifier reason:** the existing coded-reason caption stays — it is
  the "why am I seeing this suggestion" text and the future rules engine
  reuses the slot (§5.4).

### 5.3 Suggested vs confirmed categorization (D5)

A suggestion is not a decision, so it must not *look* like one:

- **Suggested:** the category select is pre-filled but wrapped in a
  **dashed-border container** (`border-dashed border-border-input`) with a
  leading Lucide `Sparkles` (`icon-inline` 14, `text-muted`) and caption
  label EN "Suggested" / RO "Sugerat". Dashed = provisional is already the
  house grammar (dividend ESTIMATE panel, registry entry 3).
- **Touched:** the moment the reviewer opens or changes the select, the
  container goes solid (`border-input`) and the Sparkles/label drop — the
  choice is now theirs, even if the value is the same.
- **Confirmed (booked):** plain text category name, no control, no icon.
- The distinction is structural (border style + icon + label), not
  color-only — it survives grayscale and both locales.

### 5.4 Skip-suggested rows (rules engine, forward slot)

When the rules engine ships, a rule can pre-suggest **skip** (the salary
row's monthly fate). That renders in the same suggestion grammar: dashed
container around the *resolution verbs* with `Sparkles` + EN "Skip
suggested — {reason}" / RO "Omitere sugerată — {reason}", and the `Skip`
button becomes the visually primary verb on that row. A skip suggestion is
still not a decision: the row books normally if the reviewer chooses
Confirm. Nothing ships now; the slot is the same one D5 defines.

### 5.5 Expandable detail

A row expands (chevron, full-row width) to show: counterparty IBAN,
description, every `rawLines` line verbatim, references
(bank/internal/instant), and the resolved external ref. This is also the
panel slot the edit form and the future match panel reuse (§9) — one
expansion surface, several resolutions.

## 6. Row actions and lifecycle (D6, D7)

Three verbs today: **Confirm** (book with the shown category), **Edit**
(adjust, then confirm), **Skip…** (with reason). Buttons size to the RO
width-setters (§10).

### 6.1 Resolved rows grey in place (D6 — brief Q2)

**Recommendation: rows stay in place until the batch closes.**

- **Position stability is the 40-row argument, not against it:** removing
  rows makes the list lurch under the reviewer's eyes mid-sitting; the
  next unreviewed row keeps changing screen position. Greyed-in-place
  keeps the statement's printed order — which is also the running-balance
  order, the order the paper statement has, and the order duplicates make
  sense in.
- **The reconciliation line (§4) only means something over ALL rows** —
  a list that hides booked rows can no longer be eyeballed against the
  printed closing balance.
- Resolved row treatment: content drops to `text-muted`, controls
  disappear, one status caption takes their place — EN "Booked ✓" (link:
  view transaction) / "Skipped — {reason}" / "Already imported" (link).
  The row remains expandable (§5.5) — resolving a row must not destroy
  its evidence.
- **Progress, not disappearance, shows advancement:** the sticky "N of M
  reviewed" line (§4). When pending hits zero the batch moves to Closed
  (§3.3) — the *batch* leaves the list, rows never leave the batch.
- Rejected alternative (rows vanish on resolve): satisfying, but it makes
  mis-clicks invisible (a wrongly-booked row is gone from view exactly
  when the reviewer could still catch it) and orphans the reconciliation.

### 6.2 Edit-then-confirm

Edit expands the row (§5.5 panel) with the bookable fields: category
(full select), booking note. **Not editable:** amount, date, direction,
counterparty — those are statement facts; disagreeing with them means the
parse is wrong (fail loudly, L-0012 spirit), not that the reviewer should
massage them. The panel's confirm button books; cancel collapses with
nothing written. This keeps "edit" a refinement of the proposal, never a
manual-entry side door around the parser.

### 6.3 Skip-with-reason (D7 — brief Q3)

**Recommendation: presets + optional note, both stored.**

Skip opens a small dialog (existing `AlertDialog` idiom is too heavy — a
popover form matches the weight): radio presets + optional free-text note,
one Skip button.

| Preset (code) | EN | RO |
|---|---|---|
| `ownedBySalary` | Owned by the salary booking | Aparține înregistrării de salariu |
| `handledElsewhere` | Already booked another way | Înregistrat deja pe altă cale |
| `notLedgerEvent` | Not a ledger event | Nu este un eveniment contabil |
| `other` | Other (add a note) | Alt motiv (adăugați o notă) |

- **Why presets:** the dominant skip is the same one every month (salary
  discipline — first-class, per the brief); a preset makes it one click
  and makes skip reasons *aggregatable* (the rules engine can learn from
  coded reasons; it cannot learn from prose).
- **Why free text too:** a reason the presets don't cover must not force
  a lying preset. `other` requires the note; presets allow one.
- **Rememberable skip rules: the rules engine's job.** A "always skip
  this counterparty+amount" toggle in this dialog would create a second,
  invisible rules store ahead of the engine that owns rules. The dialog
  *reserves* the affordance (a disabled-slot design note, not a rendered
  control): when the engine ships, a "Suggest a rule from this skip"
  checkbox slots under the note field and hands the pattern to the
  engine's own review surface. Nothing auto-applies retroactively.
- **Schema delta at implementation (Tier 3, own gated step):**
  `import_rows` gains `skip_reason_code` (text, nullable) +
  `skip_reason_note` (text, nullable). No index; display + future-rules
  input only. Q2 in §12 asks whether a reason is mandatory on every skip.
- Un-skip: a skipped row shows one "Reopen" text button while its batch
  is open (skip is a review decision, not a ledger write — it must be as
  reversible as it is cheap; reopening clears reason fields). Booked rows
  have no "un-book" here — that is the ledger's trash flow.

## 7. Batch actions (D8 — brief Q4 of the anatomy list)

**"Confirm all remaining" must not exist.** The skip discipline is the
argument: every ING batch is *expected* to contain at least one row
(salary) whose correct fate is skip, so "confirm the rest" is a button
whose correct use requires having already done the careful part — at
which point it saves nothing and invites booking the one row it was
supposed to spare.

**Keep the existing scoped bulk action** ("Confirm all high-confidence"),
which books only: high-confidence, non-overlap-suspect rows whose category
requirement is satisfied by a suggestion. This is registry entry 4's
pinned "tightly-scoped high-confidence bulk action" — kept, with:

**Finding — the current scope has a hole the salary discipline falls
into.** `owner_transfer` classifies **high** confidence (`ownerNameMatch`)
and requires no category, so today's bulk action **books the salary payout
row** (counterparty = the employee-owner's name). The monthly discipline
says that row must be skipped because the salary flow owns the movement.
Proposed closure, in force until the rules engine can pre-suggest skips:
**exclude `owner_transfer` from the bulk scope** (it stays bookable
per-row). Rationale: owner transfers are exactly the rows where *which
flow owns the movement* is a judgment call; high classifier confidence
about the *kind* is not confidence about the *fate*. Cost: one extra
per-row click on genuine owner drawings — cheap against a double-booked
salary. This is a behavior change to `bookHighConfidenceRows` (Tier 3
path) and gets its own review item (§11.5).

Bulk result reporting stays as-is (booked / duplicates / left counts) and
gains "excluded: N owner transfers" so the narrowed scope is visible, not
silent (no-silent-caps rule).

**§12 Q2 reconciliation:** the later auto-skip ruling supersedes the original
wording that excluded `owner_transfer` rows remain pending. Shipped behavior
is to auto-skip an otherwise bulk-eligible owner-transfer row with the system
skip code and a NULL note; it does not remain pending.

## 8. Duplicates on re-import (D9)

Re-pasting a statement (or an overlapping successor) surfaces already-seen
rows as `duplicate` — set at batch creation via the external-ref check, or
at booking when the partial unique index refuses. Presentation:

- The row renders **in place, in order**, greyed (§6.1 grammar), badge
  `status-neutral` EN "Already imported" / RO "Deja importat", plus a
  link to the existing transaction (`transactionId` is stored for exactly
  this). Never bookable, never hidden — the reviewer must *see* that the
  overlap was caught, or dedup reads as rows silently vanishing.
- The count strip (§4) carries "Duplicates N"; an all-duplicate re-paste
  yields a batch that is born closed (zero pending) and lands directly in
  the Closed disclosure with its counts — the friendly whole-statement
  case is already handled earlier by the raw-text-hash guard, which stays
  a convenience check only (schema comment; never the dedup guarantee).
- Refless rows (L-0010) on overlapping periods are NOT marked duplicate —
  they are `overlapSuspect` pending rows demanding individual human
  confirmation. The two states must not visually merge: duplicate =
  "caught, resolved, here's the transaction"; overlap-suspect =
  "unresolvable by key, decide yourself." Neutral grey vs destructive
  badge keeps them apart.

## 9. Forward-looking: match-to-existing (D11 — brief Q4)

Design shape only, no build commitment. The future receipt flow wants a
parsed receipt to **enrich** an existing booked transaction (same total,
one bank movement, per-category split added) instead of creating one.

Where it lives so the layout never fights it:

- **A third resolution verb.** The row's action cluster (§5) is a flat
  verb row — Confirm · Edit · Skip… — and "Match…" joins it as a verb,
  not a mode. Verbs are per-source-configurable (a receipt row shows
  Match as primary; a statement row may not show it at all).
- **The §5.5 expansion panel is the resolution surface.** Match expands
  the row into a candidate list (existing transactions filtered by
  amount/date window), each candidate a selectable row with its category
  split preview; confirming writes the enrichment through the ledger
  service (split postings), never a parallel path.
- **Lifecycle already fits:** a matched row is a resolved row — greyed in
  place with "Matched → transaction" caption; the status enum grows
  `matched` alongside `booked` (its `transactionId` points at the
  enriched transaction, same as duplicate rows point at theirs).
- What this costs today: nothing rendered — only the two structural
  commitments already made for other reasons: actions are a verb cluster
  (not a single Book button), and the expansion panel is the one place
  resolutions happen. Both are load-bearing for edit and skip anyway.

## 10. RO/EN label tolerance

Namespace `imports.*` (existing), new keys; RO is the width fixture
(10-06F rule). Money never appears in these strings — figures render as
separate `font-numeric` spans, so catalog strings stay number-free.

| Key | EN | RO |
|---|---|---|
| `emptyTitle` | Nothing awaiting review | Nimic de verificat |
| `emptyBody` | Booked and skipped batches are kept below. | Loturile înregistrate și omise rămân mai jos. |
| `needsReview` | Needs review | De verificat |
| `closedBatches` | Closed batches ({count}) | Loturi închise ({count}) |
| `progress` | {done} of {total} reviewed | {done} din {total} verificate |
| `reconciliation` | Opening {open} + rows {delta} = closing {close} | Sold inițial {open} + rulaj {delta} = sold final {close} |
| `suggested` | Suggested | Sugerat |
| `skipSuggested` | Skip suggested — {reason} | Omitere sugerată — {reason} |
| `confirm` | Confirm | Confirmă |
| `edit` | Edit | Modifică |
| `skipEllipsis` | Skip… | Omite… |
| `reopen` | Reopen | Redeschide |
| `bookedStatus` | Booked | Înregistrat |
| `skippedStatus` | Skipped — {reason} | Omis — {reason} |
| `alreadyImported` | Already imported | Deja importat |
| `viewTransaction` | View transaction | Vezi tranzacția |
| `balanceAfter` | balance {amount} | sold {amount} |
| `excludedOwnerTransfers` | excluded: {count} owner transfers | excluse: {count} transferuri către asociat |
| *(skip presets)* | *(see §6.3 table)* | *(see §6.3 table)* |

Width-setters: "Omitere sugerată", "Înregistrat", "Transferuri către
asociat". Verb buttons size to RO. Gender agreement checked per noun
("lot" neuter — "închis"; "tranzacție" feminine). Existing keys
(`kind.*`, `confidence.*`, `reason.*`, `status.*`, bulk summary keys)
are reused, not duplicated; retired presentation keys are removed in the
implementing unit (catalog parity + cache-cleared tsc, L-0013).

## 11. Verification plan (implementation unit)

Standard objective gate (cache-cleared tsc, eslint, G1–G4 token/money
greps, scope guard, checklist), plus:

1. **Empty state:** zero pending batches renders form-as-hero + empty
   grammar; no zero-count section headers; nav badge absent; page count
   and badge count derive from one query (grep-level).
2. **Suggestion distinction:** suggested category renders dashed + icon +
   label; touching the select drops all three (DOM assertion); booked row
   renders plain text. Skip-suggested slot NOT rendered (engine absent).
3. **Skip flow:** each preset stores its code; `other` requires the note;
   reason renders in the greyed row caption in both locales; Reopen
   clears reason fields and returns the row to pending; skip writes
   nothing to ledger tables (isolated-runner assertion).
4. **Grey-in-place:** booking/skipping row K does not change the DOM
   order or count of rows; progress line increments; batch at zero
   pending moves to Closed disclosure; closed batch page stays reachable.
5. **Bulk scope:** fixture batch containing an `owner_transfer` high row,
   an overlap suspect, a low-confidence row, and a category-less unknown —
   bulk books none of the excluded rows, reports the owner-transfer exclusion
   count, and auto-skips the salary-shaped owner-transfer row with the system
   code; other ineligible rows remain pending after bulk.
6. **Duplicates:** re-import fixture shows duplicate rows greyed with
   link to the existing transaction; refless overlap rows show suspect
   badge and remain individually bookable; the two states differ in DOM,
   not just color.
7. **FX verbatim:** printed rate string renders byte-identical to the
   stored `printedRate` for rates of differing precision ("5.42",
   "5.4216"); all money figures in the row pass the `font-numeric` grep.
8. **Reconciliation line:** renders for ING fixture with correct signed
   arithmetic; absent entirely for a balance-less source fixture.
9. **Registry + catalog:** load-bearing entry 4 updated in the same diff
   (per-row gate + narrowed bulk scope wording); EN/RO parity; compiled
   CSS focus-ring check (L-0006) for verbs, select, disclosure, expansion
   toggle; L-0004 popover/dialog close semantics on the skip popover.

## 12. Scope, questions, judgment flags

**In scope at implementation:** the imports page restyle (empty state,
batch lists, disclosure), the batch review page (header, progress, row
anatomy, expansion, resolution verbs), skip-reason schema delta + service
+ popover, bulk-scope narrowing, duplicate presentation, catalog changes,
registry entry-4 update, fixtures per §11, this doc + review-log rows.

**Out of scope:** the Revolut whole-batch gate (`revolut-inbox.tsx` — own
approved model, untouched beyond sharing the page shell); the rules
engine (slots reserved, nothing built); match-to-existing (§9 shape
only); receipt OCR; any parser change; the nav Imports item (nav-ia
ships it); ledger trash/edit flows (L-0012 interactions already ruled).

**Questions (owner rules):**

- **Q1** — Bulk-scope narrowing (D8): exclude `owner_transfer` from
  "Confirm all high-confidence" until the rules engine ships? A yes
  changes `bookHighConfidenceRows` (Tier 3). Recommended: yes.
- **Q2** — Skip reason: mandatory on every skip (recommended — a bare
  skip today is exactly the unexplained state the brief promotes to
  first-class), or optional with presets offered?
- **Q3** — Should the skip popover's future "suggest a rule" slot be
  mentioned in the UI now as disabled copy, or appear only when the
  engine ships (recommended: only then — disabled vaporware chrome
  violates the Soon/omit dividing rule from nav-ia §1.2)?
- **Q4** — Closed-batch retention: keep every closed batch forever under
  the disclosure (recommended — staging rows are the audit trail linking
  statements to bookings), or add a purge affordance later as its own
  unit?
- **Q5** — `matched` status enum value (§9): reserve it in the enum at
  the next migration touching it, or add only when the feature builds
  (recommended: only when it builds — L-0014's whole-class rule cuts both
  ways; dead enum values are unverifiable).

**Judgment flags (owner decides):**

- **J1** — grey-in-place (chosen) vs resolved-rows-vanish with an undo
  toast (§6.1 states the rejection rationale).
- **J2** — reconciliation line as evidence display with no failure state
  (chosen) vs rendering a live recheck (§4 — a batch from a failed parse
  cannot exist, so the failure state would be unreachable theater).
- **J3** — skip presets owned by this unit's fixed list (chosen) vs
  waiting for the rules engine to define reason taxonomy (§6.3 — the
  salary discipline needs its preset now; the engine can adopt the codes).
- **J4** — statement facts locked in edit (chosen) vs allowing date/
  amount overrides at review (§6.2 — overrides would make the inbox a
  manual-entry side door and break external-ref semantics).

**Proposed lessons:** none — the unit applies L-0010 (refless identity),
L-0012 (dependent-structure mutations), L-0015 (verbatim external rates),
L-0027 (empty-first), and registry entry 4; it amends none of them. If
the owner ratifies D8, the §7 finding is recorded in the review log, not
the ledger (it is a scope decision, not a process gotcha).

---

STOP — awaiting owner rulings on D1–D12, Q1–Q5, J1–J4.
