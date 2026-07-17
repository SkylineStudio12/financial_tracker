# New Transaction modal — segmented type control — Checkpoint A

**PROMPT-KEY:** 10-06F
**Status:** ACCEPTED 2026-07-17 (Checkpoint A) — rulings in review-log. Design doc only; no
code in this unit. Tier 2 (UI behavior) at implementation; the rider badge
reads connection metadata but writes nothing.

---

## 1. Current state

`src/components/new-transaction-dialog.tsx` renders the type switch as a
`flex flex-wrap gap-2` row of `Button`s — `variant="default"` (black) for the
selected type, `variant="secondary"` for the rest. Problems this unit
addresses:

1. **Reads as actions, not as a selector.** Three free-floating buttons look
   like three things to *do*; nothing groups them or says "exactly one of
   these is active."
2. **No group semantics.** Screen readers see unrelated buttons; there is no
   `tablist`/`radiogroup`, no roving focus, no arrow-key navigation — each
   button is its own tab stop.
3. **Wrap behavior is accidental.** `flex-wrap` produces a ragged second row
   at narrow widths with no design intent behind it.
4. **The selected state and the primary action share a style.** The black
   selected type-button is visually identical to the black Save button below
   it — two different meanings, one look, inches apart.

Existing behavior that this unit must preserve (selection UX only, no flow
logic):

- Types: `standard` | `transfer` | `salary` (salary gated by
  `salaryAvailable` = `flowData.isCompany`, i.e. SRL profiles only).
- Dividend entry exists as `DividendFlow` on its own page
  (`/p/[profile]/flows/dividend`), not in the modal (see §10, open point O1).
- `initialType` (`?entry=salary` deep link) opens the dialog with salary
  pre-selected.
- Switching type unmounts the current form; the dirty guard currently
  intercepts only Escape/outside-press *closes*, not type switches (§6,
  judgment J2).
- Dialog title swaps to `salaryTitle` when salary is selected (§7, J3).

## 2. Component semantics — tabs pattern, manual activation

**Decision:** the control is a WAI-ARIA **tabs** pattern (`tablist` /
`tab[aria-selected]` / `tabpanel`), implemented on the Base UI Tabs primitive
already in the stack, restyled to segmented-control appearance.

**Rationale.** Three candidate semantics:

| Pattern | Fit | Verdict |
|---|---|---|
| Independent buttons (current) | No group, no roving focus | replaced |
| `radiogroup` | Right "pick one" semantics, but radios announce as form inputs and the *panel* relationship (each choice swaps the form below) is not expressed | rejected |
| `tablist`/`tabpanel` | Expresses both "exactly one selected" *and* "this selection controls the panel below"; Base UI Tabs supplies roving tabindex, arrow keys, `aria-controls` wiring for free | **chosen** |

**Activation is manual** (arrow keys move focus; Enter/Space selects), not
selection-follows-focus. Rationale: activating a segment **unmounts the
current form and discards typed input**. With automatic activation, a user
arrowing across the control would destroy a half-entered transaction — the
exact case WAI-ARIA reserves manual activation for (expensive/destructive
panel switches). If the Base UI Tabs version in the repo cannot disable
activate-on-focus, the fallback is the same visual on a `radiogroup` with
manual activation hand-rolled — the visual spec in §3 is identical either way.

Reconciliation per L-0002/L-0003 applies if any new primitive is imported:
semantic tokens only, no `dark:`, no `data-closed:*`, `globals.css`
checksummed.

## 3. Visual specification

### 3.1 Anatomy and geometry

```
╭──────────────────────────────────────────────────────────╮  track
│ ╭──────────────────╮ ┌──────────┐ ┌─────────┐ ┌─────────┐│
│ │ Cheltuială/Venit │ │ Transfer │ │ Salariu │ │ Dividend││  segments
│ ╰──────────────────╯ └──────────┘ └─────────┘ └─────────┘│
╰──────────────────────────────────────────────────────────╯
   ▲ selected: accent bg      ▲ unselected: transparent
```

| Part | Token | Value | Rationale |
|---|---|---|---|
| Track background | `surface-inactive` | `neutral-100` | The token's stated role is "inactive fills" — the track *is* the inactive field the selection sits in |
| Track radius | `radius-input` | 12 px | It is a form control inside an entry form; controls use `radius-input` |
| Track padding (inset) | `space-1` | 4 px | Two birds: (a) outer 12 = inner 8 + inset 4 → **concentric radii with every value on-scale** (no improvised 10 px); (b) the 3 px focus ring fits inside the 4 px inset without clipping against the track edge |
| Track height | `density-control-height` | 36 px (modal is `density-compact`) | Matches every input in the same form — the control reads as a peer of the fields below it |
| Segment radius | `radius-badge` (`radius-sm`) | 8 px | Concentric with the track (above) |
| Segment height | derived | 28 px (36 − 2×4) | — |
| Segment padding-x | `space-3` | 12 px | Smallest on-scale step that keeps the long RO label clear of the segment edge |
| Segment gap | `space-05` | 2 px | Segments read as one control, not a button row; 2 px keeps hover targets from touching |
| Label type | `font-secondary` | `type-14` regular | Compact-density form scale; also the width budget that lets 4 RO segments fit (§5). Flagged vs. 16 px buttons in J4 |
| Width model | CSS grid, equal columns | see §5 | Segmented controls are equal-width by convention — stable geometry when selection moves |

**No per-segment icons.** Lucide icons stay in this unit only on the rider
badge (§8). Rationale: with four segments and the 18-character Romanian
`Cheltuială / Venit`, the icon (14 px + gap) is exactly the width budget that
forces premature wrapping; and the icons carry no information the label
doesn't — decorative weight in a money-entry surface. Rejected, not deferred:
if icons are ever wanted, that is a new owner decision against §5's math.

**No sliding-thumb animation.** Selection is a color swap
(`transition-colors`, same as `Button`). A sliding thumb needs measured
positions and motion values the token system doesn't define, and this repo
already runs Base UI with animations disabled (L-0004 territory). Color-only
is consistent and cheap.

**Rejected alternative — iOS-style white thumb:** selected segment as
`surface` white raised off the grey track. It needs a small elevation shadow;
the only shadow token is `shadow-raised` (dialog-scale, 24 px blur) and the
foundation doc explicitly forbids inventing primitives. A flat white thumb
without shadow is nearly invisible against `neutral-100`. The accent
treatment below needs nothing new.

### 3.2 Selected segment — `accent`, matching the system's selection language

The selected segment fills `accent` (black) with `accent-foreground` text —
exactly the token pair `design-tokens.md` §2.4 assigns to "primary
interactive/**selected**: buttons, active nav, **selection**". This is the
same language the current buttons already used; the design keeps the meaning
and fixes the packaging. On the confusion with the Save button (§1 item 4):
inside the inset grey track at 28 px height and 14 px type, the black segment
no longer resembles the free-standing 36 px black Save button — the track
context does the disambiguation.

### 3.3 State table

| State | Background | Text | Border/ring | Notes |
|---|---|---|---|---|
| Unselected, rest | transparent | `text-secondary` | none | Recedes into track |
| Unselected, hover | transparent | `text-primary` | none | Same treatment as `ghost` button — color lift only, no bg swatch (a hover fill on `neutral-100` has no on-scale value that reads) |
| Unselected, pressed | transparent | `text-primary` | none | Color-only system; the selection change itself is the feedback |
| **Selected**, rest | `accent` | `accent-foreground` | none | §3.2 |
| Selected, hover | `accent-hover` | `accent-foreground` | none | Same lift as default button; clicking is a no-op but the control shouldn't play dead |
| Focused (any) | per above | per above | `focus-visible:ring-3 ring-focus-ring` | L-0001: exact ring classes, on the *segment*, fits in the 4 px inset. One ring visible at a time (roving tabindex) |
| Disabled segment | — | — | — | **Not designed.** Unavailable types are hidden, not disabled (§4) |

Contrast: every pair above is already measured in `design-tokens.md`
(`accent-foreground` on `accent` 21:1; `text-secondary` 6.06:1 on white and
therefore > 4.5 on `neutral-100`, which is lighter than the white-vs-canvas
delta already accounted for). No new measurements needed.

## 4. SRL vs non-SRL states

Availability stays exactly as computed today (`salaryAvailable`; dividend the
same way if/when wired — O1). Unavailable types are **hidden, not disabled**:
a personal profile will *never* have salary/dividend entry, and a permanently
disabled segment is dead UI that begs a question ("why can't I?") with no
answer the user can act on. This also preserves current behavior (salary
button is conditionally rendered today).

**Non-SRL (personal profile) — 2 segments:**

```
EN  ╭──────────────────────────────────────────╮
    │ ╭──────────────────╮ ┌─────────────────┐ │
    │ │ Expense / Income │ │    Transfer     │ │
    │ ╰──────────────────╯ └─────────────────┘ │
    ╰──────────────────────────────────────────╯
```

**SRL (company profile) — 4 segments:**

```
RO  ╭──────────────────────────────────────────────────────────────╮
    │ ╭──────────────────╮ ┌──────────┐ ┌─────────┐ ┌────────────┐ │
    │ │ Cheltuială/Venit │ │ Transfer │ │ Salariu │ │  Dividend  │ │
    │ ╰──────────────────╯ └──────────┘ └─────────┘ └────────────┘ │
    ╰──────────────────────────────────────────────────────────────╯
```

The control is count-agnostic (2–4 segments, same spec). Segment *order* is
fixed: standard, transfer, salary, dividend — everyday types first, SRL flows
appended, so muscle memory built on a personal profile transfers to the SRL
context unchanged.

Deep links: `?entry=salary` selects the salary segment as today; the
mechanism extends to `entry=dividend` if O1 lands. A deep link to a type the
profile doesn't have keeps falling back to `standard` (current behavior via
`salaryAvailable` guard — verify at implementation).

## 5. Label length tolerance (RO/EN)

Current catalog values (`messages/{en,ro}.json`, `forms.*`):

| Key | EN | RO | Longest |
|---|---|---|---|
| `typeStandard` | Expense / Income (16 ch) | Cheltuială / Venit (18 ch) | RO |
| `typeTransfer` | Transfer (8) | Transfer (8) | tie |
| `typeSalary` | Salary (6) | Salariu (7) | RO |
| `typeDividend` (new — O1) | Dividend (8) | Dividend (8) | tie |

Rules:

1. **No truncation, no ellipsis, no `whitespace-nowrap` clipping — ever.**
   The label is the only information the segment carries.
2. **The RO catalog is the sizing fixture.** Every width check in §9 runs in
   Romanian; EN then fits by construction.
3. Budget check at the widest modal: `sm:max-w-xl` ≈ 576 px minus dialog
   padding ≈ 530 px of track. Four equal columns ≈ 130 px each; the worst
   label (`Cheltuială / Venit`, 18 ch at 14 px Geist ≈ 110 px) + 2×12 px
   padding ≈ 134 px. It fits at 14 px **without icons** — this is the
   measured basis for §3.1's type-size and no-icon decisions. At 16 px text
   (~126 px label) it does not fit four-up; that is why "just use the button
   size" was rejected rather than preferred.
4. If a future catalog edit pushes a label past its column, the control
   **wraps** (§6) rather than clips — degradation is the safety net, not a
   layout the owner must hand-tune per locale.

## 6. Narrow-width degradation

The dialog spans most of the viewport below `sm`; the worst honest case is a
375 px phone viewport → ≈ 310 px of track for four segments (≈ 74 px each) —
the standard label cannot fit. Strategy, in order:

1. **One row while it fits.** Grid `repeat(auto-fit, minmax(9rem, 1fr))` —
   the 9 rem (144 px) floor is the §5 worst-segment width rounded up to a
   defensible constant; it is a component-level measurement, not a new token
   (same class of value as the dialog's existing `sm:max-w-xl`).
2. **Wrap to a 2×2 grid** when the container can't give every segment its
   floor (SRL, ≲ 600 px of track → in practice any sub-`sm` viewport):

```
    ╭──────────────────────────────────────╮
    │ ╭──────────────────╮ ┌─────────────┐ │
    │ │ Cheltuială/Venit │ │  Transfer   │ │
    │ ╰──────────────────╯ └─────────────┘ │
    │ ┌──────────────────┐ ┌─────────────┐ │
    │ │     Salariu      │ │  Dividend   │ │
    │ └──────────────────┘ └─────────────┘ │
    ╰──────────────────────────────────────╯
```

   Row gap `space-05` (2 px), same as the column gap; the track grows to
   2 × 28 + 3 × 4 = 68 px tall. Non-SRL (2 segments) essentially never wraps
   (2 × 144 = 288 px < any real dialog width).
3. **Never**: horizontal scroll (hidden affordance inside a modal), icon-only
   collapse (no icons exist to fall back to — deliberate, §3.1), or a
   `<select>` swap (a second component to build, test, and keep in parity for
   a state that the 2×2 grid already handles legibly).

Wrapped, the control is honestly a "choice grid" rather than a strip — same
semantics, same tokens, same keyboard order (DOM order, left-to-right then
top-to-bottom). This is accepted, and it is a *designed* fallback replacing
today's accidental `flex-wrap` rag.

Implementation note: the breakpoint should be a **container query** on the
dialog body (Tailwind v4 supports `@container` natively), not a viewport
breakpoint — the dialog's width, not the screen's, is what constrains the
track.

## 7. Keyboard and focus specification

Tab order within the dialog: close (X) → **type control (one tab stop)** →
first form field → … → Save/Cancel.

| Key | Behavior |
|---|---|
| `Tab` / `Shift+Tab` | Enters/leaves the control as a single stop; focus lands on the **selected** segment (roving tabindex) |
| `→` / `←` | Move focus to next/previous segment, wrapping at the ends. **Focus only — no activation** (§2). Both locales are LTR; no RTL mapping needed |
| `↓` / `↑` | Same as `→`/`←` (useful in the wrapped 2×2 state; Base UI tablist orientation permitting, otherwise omitted — not load-bearing) |
| `Home` / `End` | First / last segment |
| `Enter` / `Space` | Activate the focused segment: swap the form panel, move `aria-selected` |
| `Escape` | Untouched — dialog close path, including the existing dirty-guard interception |

Focus visibility: the exact L-0001 ring classes on the segment. Per L-0006,
implementation verifies the compiled selector exists in served CSS and states
that the live focus check remains for the owner.

After activation, focus **stays on the activated segment** (it does not jump
into the new form). The existing L-0005 note stands for the form side:
if first-field autofocus is ever wanted on type switch, it must be an
effect-driven focus, and it would fight the "focus stays on the control"
rule — current behavior (no autofocus on switch) is kept.

**J2 (judgment, owner decides):** switching type while the form is dirty
currently discards input *silently* (the guard only covers dialog close).
Manual activation makes accidental switches rare, but a deliberate click on
another segment still destroys typed data. Recommendation: route dirty type
switches through the existing `confirmDiscard` AlertDialog (select-on-confirm,
stay-on-cancel). This touches the dialog's guard wiring only — no flow logic —
but it is a behavior change beyond pure restyling, so it ships only if the
owner opts in.

## 8. Rider — dev-only database badge

Origin: L-0025 (twice in two days, owner UI actions landed on the test DB
because the dev server carried a `DATABASE_URL` override). The badge makes
the connected database readable at the moment it matters most: when a write
is about to happen.

### Placement

In the **dialog header row, right-aligned** — same flex row as the title,
before the close button:

```
╭────────────────────────────────────────────────────────╮
│  New transaction              ⛁ DB: FINTRACKER_TEST  ✕ │
│                                                        │
│  ╭──────────────────╮ ┌──────────┐ ┌─────────┐ ┌─────┐ │
│  │ Expense / Income │ │ Transfer │ │ Salary  │ │ Div…│ │
│  ...                                                   │
```

Rationale: "unmissable" is a property of *when*, not of *size* — the eye is
already at the dialog header when entry starts, and every entry through this
modal passes it. A global-chrome placement (sidebar footer) was considered
and deliberately **not** chosen for this unit: it serves screens this unit
doesn't own, and this modal is where both L-0025 incidents' writes happened.
The badge is a self-contained component, so promoting it to the app shell
later is a one-line follow-up unit if the owner wants it everywhere
(flagged as J5).

### Styling

| Property | Token | Rationale |
|---|---|---|
| Type | `font-micro` (`type-11`, uppercase, +0.06 em) | The system's designated "uppercase metadata" role — machine metadata, not content |
| Icon | Lucide `Database`, `icon-inline` (14 px), `absoluteStrokeWidth`, stroke 1.5 | Per icon rules; glyph makes the badge scannable before it's read |
| Radius | `radius-badge` (8 px) | Badge role token |
| Padding | `space-05` y × `space-2` x | Smallest on-scale badge inset |
| Fill — **live DB** | `status-negative-fill` (`red-neon`) with `accent` (black) text/icon | "You are pointing dev tooling at the real books." Black on red-neon is 7.18:1 — AA-passing pairing already documented in the token foundation |
| Fill — any other DB | `surface-inactive` bg, `text-muted` text, `border-hairline` border | Named but quiet: in dev, the test DB is the *expected* state; the badge informs without shouting |

The asymmetry is deliberate and is the design's answer to L-0025: the
failure mode was *misattribution*, so the badge always **names** the database
(the name, not just a color, is the information — color-blind-safe by
construction), and reserves alarm-coloring for the one state where a mistake
is irreversible in the real ledger. Note the L-0025 incidents were "thought
live, was test" — the quiet badge still fixes those, because the fix is the
*name being visible*, not the color. **J6:** if the owner prefers the inverse
weighting (loud on non-live), it's a two-token swap.

### Gating and data

- Rendered **only when `process.env.NODE_ENV === "development"`**, evaluated
  server-side; the component returns `null` otherwise and prod bundles carry
  no connection metadata. §9 verifies absence in `next build` output.
- Displays the database name (and host, if not localhost) parsed from the
  effective `DATABASE_URL` **on the server at render time** — the same
  process that will execute the write actions, so it cannot disagree with
  where writes land. Credentials are never rendered; name/host only.
- "Live" detection: equality against the known live database name (a single
  constant in the badge module — dev tooling, not config surface).
- Copy is intentionally **untranslated** (`DB:` prefix + literal name): it is
  dev-only chrome, not product copy, and catalog-izing it would put tooling
  strings in the owner-facing catalogs. Flagged (J7) since it deviates from
  the "all UI text through next-intl" habit.

## 9. Verification plan (for the implementation unit)

Objective gate per `review-standards.md` §2 (tsc cache-cleared per L-0013,
eslint, G1–G4, scope guard, checklist), plus unit-specific checks:

1. **States in compiled CSS** (L-0006): selected/hover/focus selectors exist
   in served CSS; live focus check explicitly left to the owner.
2. **Keyboard walkthrough** (scripted, `pointerType: "mouse"` per L-0008
   where pointer events are needed): Tab lands on selected segment; arrows
   move focus without swapping the panel; Enter/Space swaps; Home/End work;
   focus ring never clips against the track.
3. **RO sizing fixture** (§5): four-segment SRL control at `sm:max-w-xl` in
   Romanian — no wrap, no clip; then at 375 px container — wraps to 2×2, both
   rows 28 px segments, nothing truncated.
4. **SRL/non-SRL render**: personal profile shows exactly 2 segments; company
   shows salary (and dividend iff O1 approved); hidden ≠ disabled (no dead
   segments in DOM).
5. **Deep link**: `?entry=salary` opens with salary segment selected +
   `aria-selected="true"`; close still strips only the `entry` param.
6. **Dirty-switch behavior**: whichever way J2 is decided, a test proves it
   (silent-discard preserved, or confirm-intercept works and Cancel keeps
   both form state and prior selection).
7. **Badge**: dev server shows the badge with the actual connected DB name
   under a deliberate `DATABASE_URL` override (the L-0025 scenario replayed);
   `next build` + prod start renders no badge and ships no DB string
   (grep the built output).
8. **No regression**: save-then-close still refreshes via
   `onOpenChangeComplete` (L-0004); discard guard on Escape/outside-press
   unchanged; `globals.css` checksum unchanged (no token edits in this unit —
   any needed value is already on-scale, by construction of §3).
9. Catalog parity for new keys (§10) in EN and RO, cache-cleared tsc.

## 10. Scope, open points, judgment flags

**In scope at implementation:** the type-selection control inside
`new-transaction-dialog.tsx` (and its reuse in the row-edit dialog if the
same switch renders there — verify at implementation), the badge component +
header placement, new catalog keys, tests above.

**Expected catalog additions:** `forms.typeGroupLabel` (accessible name for
the tablist, EN "Transaction type" / RO "Tipul tranzacției");
`forms.typeDividend` iff O1; nothing else — existing `type*` keys are reused
verbatim.

**Explicitly out of scope:** any form/flow logic, write paths, ledger
service, salary/dividend math (all Tier-3 — untouched); new tokens or
`globals.css` edits; the transactions-page filter pills; a global badge
mount (J5).

**Open point O1 — dividend in the modal.** The brief's SRL state includes
Dividend; today `DividendFlow` mounts on its own page, not in the dialog.
The control is designed for it (4-segment state, order, deep-link, label),
but *wiring the flow into the dialog* is a flow-integration decision the
owner must make separately — the salary unit did exactly this migration, so
the pattern exists. If O1 is deferred, everything here ships as a 3-segment
SRL control with no other change.

**Judgment flags (owner decides):**

- **J1 — Design intent:** does the accent-filled segment inside the inset
  track read as "selected" rather than "another button" to the owner's eye?
  The token system's stated selection language says yes; the eye test is the
  owner's.
- **J2 — Dirty type-switch guard** (§7): silent discard (today) vs. reuse of
  the discard confirm. Recommended: confirm.
- **J3 — Dialog title:** recommend the title stays **"New transaction"** for
  every type — the selected segment now announces the type, and the swapping
  title (`salaryTitle`) duplicates it while making the header jump. The
  `salaryTitle`/`dividendTitle` keys remain in use on edit dialogs and pages.
- **J4 — Segment type size:** 14 px (`font-secondary`) chosen on width math
  (§5); the owner may prefer 16 px for parity with buttons at the cost of
  guaranteed wrapping in RO at 4 segments.
- **J5 — Badge reach:** header-of-this-modal (chosen) vs. also mounting in
  global chrome later.
- **J6 — Badge color weighting:** loud-on-live (chosen) vs. loud-on-non-live.
- **J7 — Badge copy untranslated** (§8).

**Proposed lessons:** none — nothing here contradicts or extends the ledger;
L-0001/2/3/4/5/6/8/13/25 are applied, not amended.
