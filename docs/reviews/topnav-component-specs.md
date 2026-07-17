# Top-nav component specs — subordinate to the pending nav-IA Checkpoint A

**PROMPT-KEY:** 10-10F
**Status:** ACCEPTED 2026-07-17 (Checkpoint A) — rulings in review-log. Design doc only; no code.
**Subordination:** the sidebar→top-nav IA reconciliation is a separate,
pending Checkpoint A. This doc rules on **components only** — anatomy,
tokens, states, keyboard — and is deliberately silent on which items exist,
their grouping, order, routes, responsive collapse strategy, and the bar's
own layout. Every spec below is parameterized so the IA unit can slot it
without rework; where a component *touches* an IA question, the question is
flagged to that unit, not answered here.

Inputs taken as GIVEN: token system (three-tier, semantic-only in
components), Geist, Lucide stroke 1.5 absolute, the five-profile config
(`src/lib/profiles.ts`), the "All entities" dashboard-only ruling (also
honored by 10-07F card 2), and the load-bearing-UI registry (the
review-inbox gate is entry 4; its nav placement change is to be recorded
there by the implementing unit).

---

## 0. Shared foundation — the base nav item

All of components 2–4 derive from one base item; the profile switcher (§1)
shares its state tokens but is a menu trigger, not a nav link.

### 0.1 Anatomy and tokens

```
 ┌────────────────────────┐
 │ ⌾  Label            n │   icon (optional) · label · trailing slot
 └────────────────────────┘
```

| Part | Token | Value | Rationale |
|---|---|---|---|
| Height | — | 36 px | `density-control-height` (compact); nav items are controls and match every other control row |
| Padding-x | `space-3` | 12 px | Smallest step that keeps long RO labels off the edges |
| Radius | `radius-badge` | 8 px | The existing menu-button radius (sidebar primitive uses `rounded-badge`); continuity of the wayfinding idiom across the move |
| Gap icon↔label | `space-2` | 8 px | |
| Label type | `font-secondary` (`type-14`) | 14 px regular | Horizontal space is the scarce resource in a top bar; 14 px is the compact-control scale already ruled for 10-06F, and it is what makes "Înregistrează ordin" fit beside four siblings |
| Icon | `icon-default` (16 px), stroke 1.5 absolute | shared `ICON_PROPS` | Icons are optional per item — the IA decides which items carry one; the spec renders correctly with and without |
| Trailing slot | — | badge (§3) or SOON chip (§4) | One slot, one occupant |

Labels **never truncate and never wrap** — the item hugs its content and
the *bar* decides what to do when the sum overflows (collapse strategy =
IA scope, flagged). RO is the width fixture per the standing rule; the
current longest live label is "Înregistrează ordin" (18 ch ≈ 115 px at
14 px + icon + padding ≈ 160 px worst item).

### 0.2 State table

| State | Background | Text/icon | Extras |
|---|---|---|---|
| Rest | transparent | `text-secondary` | |
| Hover | `surface-inactive` | `text-primary` | `transition-colors`, same as sidebar buttons today |
| Pressed | `surface-inactive` | `text-primary` | Color-only system; no transforms |
| **Active (current page)** | `surface-inactive` | `text-primary`, weight 500 | `aria-current="page"` |
| Focus-visible | per state | per state | exact L-0001 ring: `outline-none focus-visible:ring-3 focus-visible:ring-focus-ring` |
| Disabled | see §4 | see §4 | Only the Soon item has a disabled state; conditional items hide instead (§2) |

**Why active = `surface-inactive` fill, not `accent` black:** the app
already has two selection languages with distinct meanings. `accent`
answers *"which value did I choose"* (segmented control, 10-06F; locale
toggle) — an input state. `surface-inactive` + medium text answers *"where
am I"* — the wayfinding state the sidebar primitive has used since the
L-0003 remap (`data-active:bg-surface-inactive data-active:font-medium`).
The top-nav move must not merge the two: a black-filled current-page pill
would make the nav read as a segmented input and visually compete with any
real accent control in the bar (the switcher's avatar block, primary
buttons). Weight 500 is within the ruled Medium ceiling and is the same
emphasis the sidebar active state already carries.

### 0.3 Keyboard model — links, not a toolbar

Nav items are **plain links in tab order** inside a `<nav aria-label>`:
Tab/Shift+Tab moves between items; Enter activates. **No roving tabindex,
no arrow-key navigation across the bar.** Rationale: WAI-ARIA reserves the
composite-widget pattern (one stop + arrows) for toolbars/menubars of
*actions*; site navigation is a list of links, and screen-reader/keyboard
users expect link semantics — arrow-key hijacking on links breaks
virtual-cursor navigation. The profile switcher's *menu* (§1) is the one
composite widget, and arrows work inside it only.

Skip-link/landmark order is IA scope; the components only guarantee they
sit inside the `<nav>` landmark the IA provides.

---

## 1. Profile switcher

The identity anchor of the bar: trigger + menu. Reuses the existing
switcher's proven anatomy (accent avatar block, label + subtitle, chevron;
popover list with per-profile icon, subtitle, check) — restyled for a
horizontal bar, plus the ruled "All entities" entry and its special state.

### 1.1 Trigger

```
┌───────────────────────────────┐
│ ▣  Skyline Studio SRL      ⌄ │     ▣ = size-8 accent block w/ profile icon
│    SRL                        │     label font-secondary · subtitle font-caption
└───────────────────────────────┘
```

- Trigger is the **one place truncation is legal** in the bar: the label
  gets `truncate` with a min-width (~9rem) — "Skyline Studio SRL" may
  ellipsize on tight bars because the full name is always one click away
  in the menu, and the avatar block + subtitle keep identity readable.
  Nav-item labels (§0.1) never truncate; the asymmetry is deliberate: a
  nav label is the only carrier of its meaning, the trigger label has
  three redundant carriers.
- States: rest transparent; hover/open `surface-inactive`; focus ring per
  L-0001. Open state also flips the chevron (`ChevronsUpDown` stays —
  it's the established "switcher" glyph here, and it doesn't rotate).
- `aria-haspopup="menu"`, `aria-expanded`, existing
  `aria-label={switchProfile}`.

### 1.2 Menu

Existing popover list (`surface-raised`, `shadow-raised`, `radius-lg`,
`w-64`, `p-1`), extended:

```
│ ⌂  Household           Shared      │
│ ◉  Greg                Personal ✓  │
│ ▣  Skyline Studio SRL  SRL         │
│ ◉  Andra               Personal    │
│ ▣  DRMX Digital SRL    SRL         │
├────────────────────── hairline ────┤
│ ≣  All entities        Dashboard   │
│                        only        │
```

- The five profiles keep their ruled order. **"All entities" sits below a
  `border-hairline` separator** — the separator is the component-level
  encoding of the ruling: it is not a sixth peer profile, it is a
  different kind of thing. Icon: Lucide `Layers` (stacked planes = the
  consolidation metaphor; `icon-default`, stroke 1.5). Subtitle slot
  (the position profiles use for Shared/Personal/SRL) reads EN
  "Dashboard only" / RO "Doar panoul" — the constraint stated where the
  choice is made, before it is made.
- Selecting a profile navigates as today. Selecting "All entities"
  navigates to the consolidated dashboard view (**route is IA/10-07F
  scope** — this component emits the selection; it does not own the URL).
- Check mark (existing `CheckIcon`) marks the active entry, including
  All-entities when that view is active; `role="menuitemradio"` +
  `aria-checked` (the six entries are a single-select set, which is
  exactly what menuitemradio announces).

**Keyboard (the composite widget):** trigger Enter/Space/ArrowDown opens
and focuses the checked item (not the first — you land on where you are);
ArrowUp/Down move with wrap; Home/End jump; first-letter typeahead over
labels; Enter/Space selects and closes; Escape closes without selection
and returns focus to the trigger. Base UI popup + L-0004 config as today.

### 1.3 The "All entities is active" state (ruled state, spec'd here)

When the consolidated dashboard view is active, the ruling requires
non-dashboard nav items to communicate that they operate per-profile.
Two coordinated component states:

**(a) Trigger:** avatar block shows `Layers` on `accent`; label
"All entities"; **subtitle shows the underlying profile, not a flavor
word**: EN "via Household" / RO "prin Gospodărie" (the profile whose
context non-dashboard pages will open in — the consolidated view is a
lens over a real profile, never a context, and the trigger names the
context that still applies).

**(b) Non-dashboard nav items:** each renders a trailing **context chip**
in its trailing slot: the underlying profile's initial ("H") in a
`size-4` (16 px) `radius-badge` chip, `border-hairline` border,
`text-muted`, `font-micro`. Tooltip + `aria-description`: EN
"Opens in Household" / RO "Se deschide în Gospodărie". The items remain
fully enabled — they *work*, per-profile; the chip says *where*.

Rationale for chip-not-disabling and chip-not-banner: disabling would lie
(the pages function); dimming would imply lesser status; a page-level
banner is an IA/layout decision this doc can't own — the chip is the
component-scoped answer, and it degrades gracefully if the IA adds a
banner too (chip + banner are redundant, not conflicting; the IA unit
picks). The chip renders **only** in the All-entities state — zero cost
to the normal five-profile experience.

The Dashboard nav item itself carries no chip (it IS the consolidated
surface in this state) and takes the active treatment.

## 2. Conditional-visibility nav item

Covers today's SRL-only entries (salary/dividend — `companyFlows` flag)
and any future capability-gated item (`investments` flag already gates a
group the same way).

**Spec: hidden, not disabled — rendered `null`, no reserved space.** The
condition stays **config-driven** (`Profile` capability flags), never
route-string matching — same source of truth as today's sidebar.

Rationale (same argument ruled into 10-06F §4, restated once here as the
nav-wide rule): a personal profile will *never* have salary entry;
permanently-disabled chrome is dead UI that asks a question with no
actionable answer. Hidden items also keep the bar's width budget honest —
five profiles with different item sets is the design, not an edge case.

Behavioral requirements:

- Appearing/disappearing happens only on profile switch — a full context
  change where the whole bar re-renders; **no enter/exit animation**
  (a nav item sliding in reads as an event; it isn't one — it's a
  different profile's furniture).
- The active-route edge case: if the current URL belongs to an item the
  next profile doesn't have (standing on `/flows/dividend`, switch to
  Greg), the item simply isn't in the bar — the page-level redirect/404
  behavior is routing scope (exists today), not this component's.
- Distinction from §4 is a design invariant worth stating: **conditional =
  "not for this profile" → hidden; Soon = "not built yet, coming for
  everyone" → visible + flagged.** The two must never swap treatments: a
  hidden Soon item would erase the roadmap's presence; a visible-disabled
  SRL item on a personal profile would be a permanent dead end.

## 3. Review-inbox nav item with count badge

The nav face of load-bearing registry entry 4 (the import review gate).
The count's job is **completeness**: unreviewed rows exist. The
implementing unit records the placement change in the registry entry, per
brief.

### 3.1 Badge anatomy

Inline in the trailing slot (after the label, `space-2` gap) — not
corner-overlapped on the icon; corner dots are for icon-only chrome, and
this item has a label in the bar. If the IA later collapses items to
icon-only, the badge moves to the icon's top-right corner unchanged in
style (spec'd now so the collapse needs no new decision).

| Property | Value |
|---|---|
| Shape | `radius-pill`, height 16 px, min-width 16 px, padding-x `space-1` |
| Fill / text | `accent` / `accent-foreground` |
| Type | `font-micro` metrics (11 px), tabular-nums |

**Why `accent`, not a status neon:** pending review is a *to-do*, not an
alarm — red would cry wolf on every import (and the token doc reserves
status fills for money meaning). Black-on-white 21:1 pill is unmissable at
16 px without claiming urgency. It is also the only accent element inside
a nav item, which is exactly the point — it must pop against the
`surface-inactive` states, and it does (§0.2 uses no accent).

### 3.2 The three states

| State | Renders | Rationale |
|---|---|---|
| **Zero** | **No badge at all** | A "0" badge is noise that trains the eye to ignore the badge; per the registry's honesty grammar, a *present* badge must always mean "action exists". Absence of the badge IS the zero state |
| **n (1–99)** | `3`, `27` … | Exact count; tabular digits keep 2-digit widths stable |
| **Overflow (>99)** | `99+` | Three glyphs, locale-invariant (RO uses the same numeral+plus); beyond two digits the number stops informing ("126 pending" and "312 pending" mean the same thing: go triage) and width stops being predictable |

Accessibility: the count lives in the item's accessible name —
`aria-label` EN "Review inbox — 3 pending" / RO "Inbox de verificare — 3
în așteptare" (exact catalog keys at implementation; pluralization via
ICU). The badge element itself is `aria-hidden` (no double announcement).
Zero state's name is the bare label. The overflow state's name uses the
real count ("126 pending"), not "99+" — the cap is visual, not semantic.

Count source/refresh semantics (server-rendered, when it revalidates) are
implementation scope; the component contract is: the badge never renders
a stale-known-zero as nonzero or vice versa within one render.

## 4. "Soon"-flagged disabled nav item

For IA-planned, not-yet-built pages. Visible to everyone, actionable by
no one.

### 4.1 Anatomy

```
│ ⌾  Rapoarte  [CURÂND] │    label text-muted · chip micro uppercase
```

- Label: **`text-muted` — deliberately NOT `text-disabled`.** The token
  doc rules `text-disabled` "decorative-level contrast, never for
  information," and a nav label the owner must *read* to learn what's
  coming is information. The disabled meaning is carried by the chip and
  the missing interactivity, not by sub-AA ink — which also keeps the
  state CVD-safe (never color-alone).
- Chip (trailing slot): `font-micro` uppercase, EN `SOON` / RO `CURÂND`,
  `bg-surface-inactive`, `text-text-muted`, `radius-badge`, padding
  `space-05`×`space-2`. Same family as the ESTIMATE badge but neutral ink
  — it flags status, not warning.
- Icon (if the item has one): `text-muted`, same as label.

### 4.2 Behavior and states

- **Not a link and not focusable**: rendered as a `<span>` (list-item
  content), no `href`, no `tabIndex`. A focus stop that does nothing
  violates focus-means-action and adds a keyboard tax on every bar
  traversal. `aria-disabled` is unnecessary on a non-interactive element;
  the chip text is part of the accessible text and announces the state.
- **No hover state, `cursor-default`** — the absence of the hover lift
  (§0.2) is itself a signal the element differs from its neighbors.
- Never `aria-current`; never the active treatment (an unbuilt page can't
  be the current page — if a route ships, the item flips to a normal §0
  item in the same change, and the chip's *removal* is part of that
  unit's diff, not a leftover).
- **J1 (flagged, not chosen):** an alternative makes the Soon item a real
  link to `/roadmap` (the page exists and explains what's coming). It
  costs the "disabled" honesty (clicking "Reports" and landing on a
  roadmap is a mild bait-and-switch) but gains discoverability. Spec'd
  default: non-interactive; one-line change if the owner prefers the
  link.

RO/EN: chip strings are fixed-width-ish (SOON 4 / CURÂND 6 glyphs at
11 px — both fit one chip height without wrap); label tolerance follows
§0.1 (no truncation; RO fixture).

---

## 5. Verification sketch (for the implementing unit, alongside the IA)

1. **State parity in compiled CSS** (L-0006): rest/hover/active/focus
   selectors for the base item; the L-0001 ring on trigger, items, and
   menu entries; live check stays with the owner.
2. **Switcher keyboard walkthrough** (L-0008 pointer init where needed):
   open lands focus on the checked entry; wrap, Home/End, typeahead,
   Escape-returns-focus; `menuitemradio`/`aria-checked` in DOM.
3. **All-entities state:** trigger subtitle names the underlying profile;
   every non-dashboard item shows the context chip + tooltip; Dashboard
   item shows none; chips absent in all five normal profiles.
4. **Conditional items:** DOM contains no salary/dividend items on
   household/personal profiles (hidden, not disabled/`display:none`);
   present on SRLs; flags read from `PROFILES` config only (grep-level:
   no slug string-matching in the component).
5. **Badge states:** fixtures at 0 / 1 / 99 / 100 pending render
   nothing / `1` / `99` / `99+`; accessible name carries the true count
   at 100; badge `aria-hidden`; zero renders no empty pill element.
6. **Soon item:** not in tab order; no `href`; chip present in both
   locales; no hover background in compiled CSS.
7. **RO width fixture:** the bar rendered in RO with the longest live
   label set — no truncation, no wrap of any nav label; only the trigger
   label may ellipsize.
8. Standard gate: G1–G4 (no smuggled colors — the badge and chips must
   resolve to semantic tokens), cache-cleared tsc, eslint, console clean,
   registry entry 4 updated with the placement change in the same unit.

## 6. Scope, flags, lessons

**This unit:** this spec doc only. Implementation belongs to the nav-IA
unit (or its follow-ups), which slots these components into its ruled
structure.

**Deliberately not ruled here (IA scope):** which items exist and their
order/grouping; the bar's height, layout, and responsive collapse
strategy; the All-entities route and any page-level banner on the
consolidated dashboard; landmark/skip-link order; what happens to the
locale toggle and user block.

**Judgment flags:**

- **J1** — Soon item: non-interactive (chosen) vs link-to-roadmap.
- **J2** — active-state language: `surface-inactive` wayfinding fill
  (chosen, continuity with the sidebar idiom) vs `accent` black pill —
  a one-token decision if the owner wants the mock's look to win over
  the two-languages argument.
- **J3** — All-entities context chip (chosen) vs relying solely on a
  dashboard banner (IA-owned); both can coexist.
- **J4** — badge cap at 99+ (chosen) vs 9+ (a one-digit badge is
  visually quieter; 9+ loses real information at typical import sizes —
  a single statement is ~17 rows).

**Proposed lessons:** none — the spec applies L-0001/3/4/6/8, the
token-role rules, and the hidden-vs-disabled and zero-badge grammars
already established in this chat's units; it amends nothing.
