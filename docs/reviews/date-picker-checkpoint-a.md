# Date-picker pattern — Checkpoint A

**PROMPT-KEY:** 11-07F
**Status:** ACCEPTED with rulings 2026-07-18 — see docs/review-log.md. Design doc
only; no code in this unit. Implementation lands as a CC unit after rulings;
Tier 2 (UI behavior) — the pattern wraps the existing token-styled Calendar
and touches no ledger/service path.

---

## 1. Current state and what this unit designs

Eight `<input type="date">` fields carry every date the app accepts. Native
date inputs render **unstylable browser chrome** — the indicator glyph, the
segmented dd/mm/yyyy pseudo-elements, and the browser's own popup ignore the
token system entirely, and Chrome/Safari/Firefox each draw them differently.
Everything else about the fields is fine: they are controlled, ISO-valued,
and sit correctly in the form rhythm.

This unit designs the **date-picker pattern** that replaces them: the trigger
field, the popover, the typed-input contract, and the per-site migration
rules. It does **not** redesign the calendar grid —
`src/components/ui/calendar.tsx` (react-day-picker v10, token-styled,
locale-wired, in the gallery) is used as-is; the only touch this design asks
of it is a prop default (D9).

The 8 sites:

| # | Site | Behavior to preserve |
|---|---|---|
| 1 | `standard-form.tsx` | controlled `value`/`onChange`, no min/max |
| 2 | `transfer-form.tsx` | controlled |
| 3 | `opening-balance-form.tsx` | controlled; dates can be **years** in the past |
| 4 | `dividend-flow.tsx` | controlled + `invalidate()` derived-state reset on change |
| 5 | `salary-flow.tsx` | controlled + touched-tracking via `onFocus` + two-date derived logic (§7) |
| 6 | `trade-form.tsx` | controlled; past dates common |
| 7 | `price-snapshot-form.tsx` | controlled |
| 8 | `transactions/page.tsx` filter | **server component**, uncontrolled `from`/`to` in a GET form, explicit Apply submit (§8) |

All values are ISO `yyyy-MM-dd` strings end to end; no site sets min/max
today. The pattern keeps the **string-in, string-out contract**: consumers
never receive a `Date` object, so no call-site logic changes.

## 2. Pattern architecture — one engine, two skins

**D1.** One client component owns all behavior (typed parsing, popover,
commit contract); two visual skins consume it:

- **`DateField`** — form skin: `fieldClass`-compatible input + calendar
  trigger, used at sites 1–7.
- **`DateFilter`** — pill skin for the transactions filter (site 8): same
  popover and parsing engine, rendered inside the existing filter-pill
  anatomy with hidden GET inputs (§8).

Rationale: the filter pill cannot look like a form field (it lives in the
pill row, `text-caption`, `rounded-pill`), but forking the *behavior* would
mean two parsing/commit implementations drifting apart. Engine/skin split is
the smallest shape that prevents that.

Rejected: a single component with a `variant` prop spanning both looks — the
two skins differ in DOM shape (label-wrapped pill vs. labeled field), not
just classes; a variant prop would become two components in a trenchcoat.

## 3. D2 — Typed input **and** picker, not pick-only (brief Q1)

**Decision: the field is a real text input; the calendar is an accelerator.**
Typing is the primary path for distant dates, picking for near dates.

Rationale, driven by the sites:

- Opening balances (site 3) and backfilled trades (site 6) sit **years**
  back. Pick-only with month paging is ~1 click per month — absurd at 60
  months. Even with dropdown navigation (D8: month + year dropdowns), a
  distant date costs ~4 interactions (open, year, month, day). Typing
  `14.03.2019` costs one focus and ten keystrokes — and the fields are
  already keyboard-first inside dense entry forms.
- Pick-only also makes the popover **load-bearing for data entry**, which
  raises the stakes of every popover bug (L-0004 territory). A typed field
  keeps entry working even if the popover misbehaves.
- The native inputs being replaced accept typing today; pick-only would be a
  capability regression disguised as a restyle.

### 3.1 Format per locale

The app's own convention (`format.ts` `formatDate`) already answers the
format question: **EN displays ISO `yyyy-MM-dd`; RO displays `dd.MM.yyyy`.**
The field displays and parses the same shapes:

| Locale | Display/canonical typing format | Also accepted on parse |
|---|---|---|
| EN | `yyyy-MM-dd` | `yyyy-M-d` (unpadded) |
| RO | `dd.MM.yyyy` | `d.M.yyyy` (unpadded), ISO `yyyy-MM-dd` (paste-through) |

Parsing is **lenient, not masked**. No input mask: masks fight paste, IME,
and unpadded entry, and they are exactly the kind of hand-rolled complexity
this repo avoids. `date-fns` (already a dependency) `parse` + a strict
round-trip check (format the parsed date back and compare) rejects
`31.02.2026`-class inputs.

### 3.2 Commit-on-valid contract

The consumer-facing `onChange(iso: string)` fires **only** when the text
parses to a valid date (fires with `""` when the field is cleared — the
filter needs empty as a first-class value). While the text is partial or
invalid, the consumer keeps its last committed value.

Invalid state (evaluated on **blur**, not per keystroke — no yelling while
the user is mid-typing):

- The field **keeps the user's text** (never silently rewrites or reverts —
  the user must see what was wrong).
- `aria-invalid` on the input; the `InputGroup` primitive already styles
  this (`border-status-negative-text` + negative ring) — no new tokens.
- A caption line in `errorClass` below the field, `aria-describedby`-linked:
  `forms.dateInvalid` (§10).
- On valid blur, the text **normalizes** to the canonical padded format
  (`5.3.2026` → `05.03.2026`).

Locale toggle mid-session re-renders committed values in the new locale's
format (derived from the ISO state, not from the text), matching how every
other formatted surface behaves.

## 4. D3 — Trigger anatomy (brief Q2)

Closed state, form skin:

```
╭─────────────────────────────────────╮
│ Data                                │  labelClass (unchanged)
│ ╭─────────────────────────────╮     │
│ │ 05.03.2026              ▦  │     │  input + calendar trigger
│ ╰─────────────────────────────╯     │
╰─────────────────────────────────────╯
   empty:  zz.ll.aaaa (muted)   ▦
```

Built on the **`InputGroup` primitive** (already imported for Combobox):
input + `inline-end` addon holding an `InputGroupButton` with the calendar
glyph. It already carries the focus-within ring, `aria-invalid` styling, and
disabled treatment — the pattern inherits L-0001 compliance instead of
re-implementing it.

| Part | Token / value | Rationale |
|---|---|---|
| Group height | `h-[var(--density-control-height)]` | Overrides InputGroup's `h-8` so the field is a pixel-exact peer of `fieldClass` siblings — **no rhythm break** in any of the seven forms |
| Group border/radius | `border-border-input`, `rounded-input` | Match `fieldClass` (InputGroup's default hairline border is overridden — the existing forms use the stronger input border) |
| Input text | `text-secondary text-text-primary`, `--font-sans` | Dates are not a money surface; the field matches its **text** siblings, not the `moneyFieldClass` amount fields (grid digits are a separate call — D4) |
| Placeholder (empty state) | `placeholder:text-text-muted`, `forms.datePlaceholder` (§10) | The empty state is the format hint — it teaches the typing contract before first use (L-0027 spirit: designed first, not defaulted) |
| Trigger icon | Lucide `Calendar`, 16 px (`icon-default`), `absoluteStrokeWidth` stroke 1.5, `text-text-muted` | Per icon rules; muted so the affordance doesn't compete with the value |
| Trigger button | ghost, `size-6`, `rounded-badge`, L-0001 ring classes | Its own tab stop and accessible name (`forms.openCalendar`); hover lifts to `text-text-primary` |
| Focus | ring on the **group** via InputGroup's `focus-within` wiring | One ring around the whole control, same 3 px `focus-ring` as every field |

Empty state is first-class: no value → placeholder format hint; opening the
picker shows the **current month with today outlined** (existing `today`
treatment) and **nothing selected**. No defaulting-to-today inside the
pattern — sites that want today as the initial value already set it in their
own state (they do), and the filter must be able to stay genuinely empty.

## 5. D4 — Day-grid digits: Geist tabular (`--font-numeric`) (brief Q3)

**Recommendation: the day numbers, the year in the caption, and week numbers
render in `font-numeric`; month and weekday names stay in `--font-sans`.**

This is **not** the money rule — a calendar is not a money surface, so
nothing forces it. The reasoning is the mechanism behind the money rule
rather than the rule itself:

- The grid is 7 columns × up to 6 rows of 1–2-digit numbers whose only
  layout job is **columnar alignment**. Proportional Urbanist digits (a
  narrow `1` vs. a wide `0`) make centered numbers wobble optically column
  to column — `11` vs `28` differ in width, so their optical centers drift.
  Tabular Geist digits give every cell the same digit-box; columns read as
  rails.
- Precedent in-system: `font-numeric` is defined as "Geist + `tabular-nums`"
  for *aligned numbers*, and the grid is the most aligned number surface in
  the app that isn't money.
- Counter-argument, stated honestly: Urbanist everywhere is more uniform
  with UI chrome, and day cells are individually centered so the wobble is
  subtle at 28 px cells. If the owner's eye test says the mixed faces look
  patchworked, sans is a defensible ruling.

Per the standing instruction from the 11-05C brief (carried forward): the
implementation unit renders the grid **both ways side by side** and puts the
comparison in its Checkpoint B report — this D is the recommendation, the
owner rules on the evidence (Q6).

## 6. D5 — Popover behavior (brief Q4)

Built on the existing Base UI `Popover` primitive (`popover.tsx`), which
already imports `base-ui-config` (L-0004: animations disabled) and portals
through a collision-aware Positioner.

| Aspect | Spec |
|---|---|
| Placement | `side="bottom" align="start"` against the **group** (field + trigger), `sideOffset` 4; Base UI flips to top automatically when the viewport clips — no custom logic |
| Panel | `PopoverContent` with `w-auto p-2` override (the default `w-72` fights the calendar's `w-fit`); calendar at `--cell-size` 28 px ≈ 230 px wide |
| Open | click/Enter/Space on the trigger button; **Alt+ArrowDown** from inside the text input (combobox convention). Focus alone never opens it — tabbing through a form must not spray popovers |
| Initial focus | committed date's day if set, else today (react-day-picker `autoFocus` — effect-driven per L-0005, not attribute autofocus) |
| In-grid keyboard | react-day-picker built-ins: arrows move by day/week, PageUp/PageDown by month, Home/End to week edges |
| Select (single) | commits ISO value → **closes** → focus returns to the trigger (Base UI default return-focus) |
| Select (range — filter only) | first pick sets `from` and stays open; second pick sets `to` and closes; picking earlier than `from` restarts the range (react-day-picker default) |
| Dismiss | Escape or outside-press closes with **no commit change** (the typed field still holds whatever was committed); Escape returns focus to the trigger |
| After-close side effects | none needed at sites 1–7 (pure state); if any site ever refreshes on close it goes in `onOpenChangeComplete` (L-0004) |
| Mobile / narrow | **same popover at every width.** The panel (~230 px) fits a 375 px viewport with margin; Base UI repositions on collision. A `Drawer`/`Sheet` swap at narrow widths was considered and **rejected**: it forks the keyboard path and dismiss semantics into a second component for zero capability gain — the popover is not cramped |

Interaction-test note for implementation: synthetic pointer events against
Base UI need `pointerType: "mouse"` (L-0008).

## 7. D6 — Salary-flow contract: touched = any engagement (brief Q5)

The salary flow's two-date model: `payMonth` (fiscal anchor) derives a
default `paymentDate` (10th of the following month) **until the user touches
`paymentDate`**; symmetrically, editing `paymentDate` back-derives `payMonth`
until `payMonth` is touched. Touched-tracking today rides `onFocus` on the
native inputs.

The pattern preserves this by widening the trigger set to every way a user
can engage the new control. `DateField` exposes the exact hooks the flow
needs — **no flow logic moves into the pattern**:

| User action | Event the pattern fires | Salary flow marks |
|---|---|---|
| Focus the text input | `onFocus` (native, unchanged — the input is a real input) | `paymentDateTouched = true` |
| Open the picker (click/keyboard) | `onOpenChange(true)` | `paymentDateTouched = true` |
| Commit via typing or picking | `onChange(iso)` | touched + existing `setPayMonth` back-derivation + `invalidate()` — verbatim from today's handler |

Why `onOpenChange` must also mark touched: with the native input, *looking
at* the field meant focusing it. With the pattern, a mouse user can open the
picker via the trigger button; if only input-focus marked touched, a
subsequent `payMonth` edit would overwrite a payment date the user had just
deliberately inspected/picked. Open-intent is the new focus-intent.

Programmatic writes stay outside the touched path, exactly as today:
"Repeat last salary" and employee prefill call `setPaymentDate(...)` +
`paymentDateTouched.current = true` at the state level; derived
`setPaymentDate` from `payMonth` edits does **not** pass through the
component's user-event callbacks (controlled value prop), so no feedback
loop. Site 4 (dividend) is the degenerate case: only `onChange` →
`invalidate()`.

The adjacent `payMonth` field is `type="month"` — **not one of the 8 sites**
and stays native in this unit (Q3 flags the follow-up). The two controls
already share `fieldClass` height, so the pair keeps its rhythm.

## 8. D7 — Transactions filter: one **range** pill, client island with hidden GET inputs (brief Q6)

### Island shape

The page stays a server component. `DateFilter` is a small client island
inside the existing `<form method="get">`:

```
<form method="get">                       ← server, unchanged
  <DateFilter from={filters.from} to={filters.to}   ← client island
             labels/formats via next-intl />
      renders: pill trigger + popover(Calendar mode="range")
             + <input type="hidden" name="from" value={iso} />
             + <input type="hidden" name="to"   value={iso} />
  …other pills (server, unchanged)…
  Apply / Reset (unchanged)
</form>
```

Hidden inputs keep **GET-param compatibility absolute**: the URL contract
(`?from=2026-03-01&to=2026-03-31`), the server-side parsing, bookmarked
URLs, and the Apply/Reset buttons are untouched. Empty value ⇒ the hidden
input renders with `value=""` and is either omitted or ignored exactly as an
empty native input is today. Submission stays on the explicit **Apply**
button — picking a date does *not* auto-submit (matches every other pill;
the user composes filters, then applies).

### Range, not two singles

**Recommendation: one pill, Calendar `mode="range"`.** From/to is one
mental object — "the period" — and range mode shows it as one sweep with
the existing `range_start`/`range_middle`/`range_end` styling the Calendar
already ships. Two popovers for one concept is two opens, two closes, and
no visual of the span.

Open-ended ranges (only `from`, or only `to`) are legitimate filter states
today and remain first-class:

- Pill label renders the honest state: `Perioadă: 01.03.2026 –` /
  `– 31.03.2026` / `01.03.2026 – 31.03.2026`; empty state shows just the
  label in muted text like every inactive pill.
- In the popover, a partial range is simply a range with one end
  (react-day-picker supports `{ from, to: undefined }`).
- A **clear** action in the popover footer (`common.clear`, §10) empties
  both ends — parity with the native inputs' clear affordance, and the only
  way to empty a picked range without Reset-ing every filter.

Pill skin: the existing `pill(active)` classes verbatim — active when either
end is set; the popover trigger is the pill's control area (`pillControl`
typography), calendar glyph at 14 px (`icon-inline`, stroke 1.5) to fit the
`text-caption` pill scale. Typed input is **omitted in the pill skin** —
there is no room in a pill for two masked text fields, the popover is one
click away, and filter dates are near-term (this month, last quarter), which
is picking's home turf. The typing path stays a form-skin capability.

This is the one behavior-visible divergence between skins and is flagged for
ruling (Q4), with the alternative (two single pills, typed) specced as: two
`DateField`-behavior pills `filterFrom`/`filterTo` exactly as today.

### Sequencing

`transactions/page.tsx` currently carries ~43 uncommitted lines from the
in-flight management unit. Site 8 **must not be edited until that unit
commits** (L-0007 one-concern-per-commit, L-0023 double-write risk).
Migration order: sites 1–7 first, site 8 as its own follow-on commit (Q5).

## 9. D8 — Distant-date navigation: dropdown caption + typing (brief Q7)

`captionLayout="dropdown"` — month and year dropdowns in the caption. The
existing Calendar component **already styles** the dropdown caption
(`dropdowns`/`dropdown_root`/`dropdown` classNames are in the file); this is
a prop, not a redesign. Cost of a distant date by mouse: open → year → month
→ day = 4 interactions, flat regardless of distance. Combined with D2's
typing path (the true fast lane), this is the cheapest adequate answer.

Rejected: long-press paging (no react-day-picker support without custom
timers — hand-rolled complexity for a worse interaction) and a "year jump"
input inside the popover (duplicates the typed field that already exists
outside it).

Dropdown range: react-day-picker derives the year list from
`startMonth`/`endMonth`. Proposed: **January 2000 → December of (current
year + 1)** — comfortably covers opening balances and forward-dated entries
without a 200-year scroll. These props bound the *dropdown list only*, not
what can be typed; typing outside the range still commits (no site has
min/max semantics today, and the pattern must not invent a constraint).
Exact bounds are an owner call (Q2).

**D9 — week start.** The Calendar wrapper gets `weekStartsOn={1}` as its
default (overridable prop). Today RO gets Monday from the date-fns `ro`
locale but **EN falls to `enUS` = Sunday start**, violating the standing
"week starts Monday" rule. One-line prop default in `calendar.tsx`; the grid
itself is untouched.

**D10 — timezone-safe conversion.** The pattern converts ISO string ↔ `Date`
by **parts** (`new Date(y, m-1, d)` local midnight out, `getFullYear/Month/
Date` back), never via `new Date("yyyy-MM-dd")` (UTC-midnight parse — shifts
a day west of UTC) and never via `toISOString()` (shifts a day east). All
consumer state stays ISO strings (§1); `Date` objects live only inside the
component boundary. Implementation adds a unit test for both conversion
directions.

## 10. Strings (next-intl, both locales)

| Key | EN | RO | Used by |
|---|---|---|---|
| `forms.datePlaceholder` | `yyyy-mm-dd` | `zz.ll.aaaa` | D2 empty state (format hint; RO letters per Romanian zi/lună/an convention — Q1) |
| `forms.dateInvalid` | `Invalid date` | `Dată invalidă` | D2 blur-invalid caption |
| `forms.openCalendar` | `Open calendar` | `Deschide calendarul` | trigger button accessible name |
| `transactions.filterPeriod` | `Period` | `Perioadă` | D7 range pill label (replaces `filterFrom`+`filterTo` if Q4 rules for range; both old keys stay while site 8 is deferred) |
| `common.clear` | `Clear` | `Șterge` | D7 popover footer (key reused if it already exists — verify at implementation, no duplicate) |

Month/weekday names come from the locale machinery already wired in
`calendar.tsx` (next-intl `useLocale` → date-fns `ro` / built-in `enUS`) —
no catalog entries needed for them.

## 11. Migration table (implementation checklist)

| Site | Skin | Notes |
|---|---|---|
| 1 standard-form | `DateField` | drop-in: `value={date}` `onChange={setDate}` |
| 2 transfer-form | `DateField` | drop-in |
| 3 opening-balance-form | `DateField` | distant dates — the D2+D8 showcase |
| 4 dividend-flow | `DateField` | `onChange` also calls `invalidate()` |
| 5 salary-flow | `DateField` | §7 contract: `onFocus` + `onOpenChange` → touched; `onChange` runs existing derivation verbatim |
| 6 trade-form | `DateField` | drop-in |
| 7 price-snapshot-form | `DateField` | drop-in |
| 8 transactions filter | `DateFilter` | **deferred behind the in-flight unit's commit** (Q5); GET contract unchanged |

Native `<input type="date">` count after migration: **zero** (grep gate in
§12). The `type="month"` input in salary-flow remains, by scope (Q3).

## 12. Verification plan (for the implementation unit)

Objective gate per `review-standards.md` (cache-cleared tsc per L-0013,
eslint, G1–G4 greps, scope guard), plus:

1. **Digit comparison** (D4/Q6): day grid rendered in `font-numeric` and
   `--font-sans` side by side; screenshot or measured advance comparison in
   the Checkpoint B report; owner rules.
2. **Parse table test**: every format in §3.1 (padded, unpadded, ISO
   paste-through, `31.02` rejection, empty→`""` commit) per locale.
3. **TZ round-trip test** (D10): ISO→Date→ISO identity for month edges,
   in a simulated non-UTC zone.
4. **Salary touched matrix** (D6): (a) edit payMonth before touching
   paymentDate → default follows; (b) open the picker (no commit), then edit
   payMonth → paymentDate **holds**; (c) type a paymentDate → payMonth
   back-derives once; (d) Repeat-last-salary then payMonth edit → holds.
   Existing salary e2e tests stay green.
5. **Filter GET contract** (site 8, when unblocked): pick range → hidden
   inputs carry ISO → Apply produces today's exact URL shape; open-ended
   both directions; Clear empties; Reset link unaffected; bookmarked URL
   round-trips into the pill label.
6. **Keyboard walkthrough** (L-0008 `pointerType: "mouse"` where pointer
   events are scripted): Tab → input → trigger; Alt+ArrowDown opens; grid
   arrows/PageUp/PageDown; Enter commits and closes; Escape returns focus
   without commit. Focus-ring selectors verified in served CSS (L-0006);
   live focus check stated as remaining with the owner.
7. **Rhythm check**: form screenshots before/after — field heights and
   baselines identical (`--density-control-height` respected) in compact
   density, RO locale (sizing fixture, longer strings).
8. **Grep gates**: zero `type="date"` outside excluded paths; no raw hex;
   no `dark:`; no new dependencies in `package.json` diff; `globals.css`
   checksum unchanged (L-0002).
9. **Week start** (D9): EN locale renders Monday-first; RO unchanged.

## 13. Scope

**In scope at implementation:** the two pattern components, `weekStartsOn`
default in `calendar.tsx`, sites 1–7 migration, catalog keys (§10), gallery
entry for the date-picker pattern, tests above. Site 8 in a follow-on commit
(Q5).

**Explicitly out of scope:** the calendar grid's visual design (done, prior
unit); `type="month"` (Q3); min/max constraint semantics (no site has them —
the pattern passes `disabled`/`startMonth`/`endMonth` through but wires none);
management paths (`src/lib/management/`, `src/components/management/` —
untouched); money formatting; any new dependency.

## Open questions for owner ruling

- **Q1 — RO placeholder copy:** `zz.ll.aaaa` (Romanian day/month/year
  letters, recommended) vs. `dd.mm.aaaa` (format-string literalism).
- **Q2 — Year-dropdown bounds:** 2000 → current+1 proposed; the owner knows
  the true earliest opening-balance year.
- **Q3 — `type="month"` follow-up:** salary `payMonth` keeps native browser
  chrome after this unit. Accept the inconsistency short-term, or queue a
  month-picker unit (the Calendar's dropdown caption is most of it)?
- **Q4 — Filter: range pill (recommended, D7) vs. two single pills.** Rules
  the `filterPeriod` key and whether `filterFrom`/`filterTo` retire.
- **Q5 — Site-8 sequencing:** confirmed deferred behind the in-flight
  management unit's commit; needs an explicit go signal later (L-0029 —
  gated on a keyed brief, not an informal "go").
- **Q6 — Grid digit font:** D4 recommends `font-numeric`; ruling lands at
  Checkpoint B on the side-by-side evidence.

**Proposed lessons:** none — L-0001/2/3/4/5/6/8/13/23/27/29 are applied,
not amended.
