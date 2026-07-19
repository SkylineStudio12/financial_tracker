# Category icons — Checkpoint A

**PROMPT-KEY:** 12-03F
**Status:** ACCEPTED 2026-07-19 with rulings — see review-log.
**Tier at implementation:** Tier 2 (UI behavior: `CategoryLabel`, the /manage
picker, display queries). The `icon` column + backfill migration is a
**separate gated Tier-3 unit** (db/drizzle) and is only *specified* here.
**Delivered from worktree** `humanizer-skills-update-03c4a5` per the amended
12-03F delivery instruction; owner copies to the main tree.

Settled context (not reopened here): Lucide only, stroke 1.5; icons attach to
categories, persisted as the Lucide icon **name** in a nullable string column;
category-less rows get fixed type-derived icons; rendering mounts in the
shared `CategoryLabel` component; the shipped archived treatment (muted +
`Archive` + tooltip) composes with the new icon; the picker lives in /manage.

---

## 1. Current state

**`CategoryLabel`** ([category-label.tsx](../../src/components/category-label.tsx))
renders `name` plus, when `deleted`, the archived treatment: the whole span
`text-text-muted`, a trailing `Archive` glyph, `title` tooltip, and an
`aria-label` combining name + tooltip. `AccountLabel` shares the same
`HistoricalLabel` internals.

**Mount sites today** (every category label in the product goes through it):

| Surface | Site |
|---|---|
| Transactions list, category cell | `transactions/page.tsx:262` |
| Transactions list, category filter pill (deleted-category state only) | `transactions/page.tsx:161` |
| Transaction detail, per-posting category cell | `transactions/[transactionId]/page.tsx:115` |

Category-less rows in the list render a bare `"—"`
(`transactions/page.tsx:268`); split rows render `t("split", {count})`.
`row.kind` is already selected by the list query, so the type-derived icon
needs **no new data**. Uncategorized legs in the detail postings table also
render `"—"`.

**Icon tokens** (`globals.css` 248–252, `design-tokens.md` §2.8):
`--icon-stroke: 1.5`, `--icon-size-inline: 14px`, `--icon-size-default: 16px`,
`--icon-size-ui: 20px`, `--icon-size-feature: 24px`. The shipped
`DevDatabaseBadge` sizes its inline glyph with `size-3.5` (14 px).

**O-1 — latent defect found in the mount point (hypothesis, verify at
implementation).** `category-label.tsx:6` sizes the Archive marker with
`size-[var(--icon-inline)]`, but no stylesheet defines `--icon-inline` — the
token is named `--icon-size-inline` (repo-wide grep: the only occurrence of
`--icon-inline` is this consumer). An undefined custom property makes the
declaration invalid at computed-value time, so the SVG most likely falls back
to Lucide's `width="24"`/`height="24"` attributes — a 24 px marker beside
14 px text. Labeled a hypothesis per L-0016 (not yet rendered and measured);
the implementation unit renders a deleted-category label and fixes the
sizing either way (this unit standardizes on `size-3.5`, see §7). If
confirmed, it shipped unnoticed because deleted-category labels are rare in
live data.

---

## 2. Architecture — one visual language, two icon sources

**Data model.** `categories.icon` — nullable `text`, holding a Lucide icon
name that must be a key of the curated map (§3). Validated at write time in
the management service; unknown or null renders the D4 fallback (§6), so a
future curation change can never crash a label.

**Resolution rule (per row/leg, display only):**

```
splitCount > 1      → Split marker + existing split text        (list only)
category present    → CATEGORY_ICON_MAP[category.icon] ?? D4 fallback
category absent     → KIND_ICON_MAP[transaction.kind] ?? D4 fallback
```

**Components.** `CategoryLabel` gains an optional `icon?: string | null` prop
and renders the resolved glyph *leading* the name. A sibling `KindLabel`
(same file, same geometry) renders the fixed kind glyph for category-less
rows. Both live in `category-label.tsx`, so every current and future surface
inherits by construction — no per-table icon logic anywhere.

**Static icon map.** One module, `src/components/category-icons.ts`:

```ts
import { Home, ShoppingCart /* … curated set only … */ } from "lucide-react";
export const CATEGORY_ICON_MAP = { home: Home, "shopping-cart": ShoppingCart, … } as const;
export type CategoryIconName = keyof typeof CATEGORY_ICON_MAP;
```

Named imports from lucide-react's ESM build tree-shake to just the curated
set — the bundle never carries the full 1500-icon barrel (verified in §11).
Stored names use Lucide's kebab-case slugs (stable across Lucide's own
PascalCase aliasing).

---

## 3. D1 — Icon vocabulary: curated set of 80, grouped, with client-side filter

**Recommendation: curated grid + text filter over the curated set.** No full
Lucide search.

| Option | Verdict |
|---|---|
| Full Lucide search (1500+) | Rejected: requires dynamic icon resolution (defeats tree-shaking or forces a lazy-loading seam), yields inconsistent metaphors (four different "money" glyphs), and serves a discovery problem two users don't have |
| Curated grid only | Workable at 40; at 80 icons scanning 11 groups gets slow |
| **Curated + filter** | **Chosen:** the filter is a client-side `includes()` over ~80 names/labels — no new machinery, no bundle cost, and the grid stays browsable when the filter is empty |

The escape hatch for a missing icon is **extending the curated map** — a
one-line addition ratified like any other change, not a runtime search.

**The curated set (80).** Every name verified against the installed
`lucide-react` (v1.24.0, `node_modules`) — none missing. Deliberate bias:
no dollar-sign glyphs (RON ledger), finance groups deepest, one metaphor per
concept.

| Group (EN / RO) | Icons |
|---|---|
| Home & housing / Casă și locuință (8) | `Home` `Building2` `KeyRound` `Sofa` `Wrench` `Hammer` `Paintbrush` `WashingMachine` |
| Utilities & connectivity / Utilități și conectivitate (8) | `Lightbulb` `Zap` `Flame` `Droplets` `Wifi` `Phone` `Smartphone` `Tv` |
| Food & drink / Mâncare și băutură (6) | `ShoppingCart` `UtensilsCrossed` `Coffee` `Pizza` `Wine` `Beer` |
| Transport / Transport (7) | `Car` `Fuel` `Bus` `TrainFront` `Bike` `CarTaxiFront` `SquareParking` |
| Shopping & personal / Cumpărături și personal (6) | `ShoppingBag` `Shirt` `Gift` `Scissors` `Sparkles` `Glasses` |
| Health / Sănătate (4) | `HeartPulse` `Stethoscope` `Pill` `Dumbbell` |
| Family, pets & learning / Familie, animale și educație (5) | `Baby` `Dog` `Cat` `GraduationCap` `BookOpen` |
| Leisure & travel / Timp liber și călătorii (10) | `Ticket` `Film` `Music` `Gamepad2` `Plane` `Hotel` `Bed` `Mountain` `TreePalm` `Umbrella` |
| Money — income & investing / Bani — venituri și investiții (12) | `Banknote` `HandCoins` `Coins` `PiggyBank` `Wallet` `WalletCards` `CreditCard` `TrendingUp` `TrendingDown` `ChartLine` `ChartPie` `Percent` |
| Business & obligations / Afaceri și obligații (10) | `Briefcase` `Users` `Handshake` `FileText` `Receipt` `Landmark` `Scale` `Shield` `AppWindow` `Cloud` |
| General / General (4) | `Package` `Repeat` `Leaf` `CircleHelp` |

(UI-chrome glyphs the picker itself needs — `ChevronDown`, `Search`, `X` —
are imported directly where used and are not part of the assignable set.)

---

## 4. D2 — Picker UX in /manage

**Placement.** A new labeled field **"Icon" / "Pictogramă"** in the
category create/edit dialog
([management-client.tsx:861](../../src/components/management/management-client.tsx)),
between **Kind** and **Parent** (create) or after **Kind** (edit). `fields`
gains `icon: string` (`""` = none), so the existing dirty-guard
(JSON compare → discard confirm) covers icon changes with zero new wiring.

**Interaction pattern: popover grid.** An inline grid of 80 icons would
dominate a form whose other fields are one line each, and the dialog already
scrolls at `max-h-[90vh]`; a popover keeps the form scannable and matches the
system's disclosure idiom. Anatomy:

```
Pictogramă
┌──────────────────────────────────┐
│ ⛒ ShoppingCart              ⌄ │   ← trigger: fieldClass geometry
└──────────────────────────────────┘
        ╭──────────────────────────╮
        │ [🔍 Caută pictograme…  ] │   ← filter input (fieldClass)
        │  Fără pictogramă         │   ← clear row (ghost, checkmark when active)
        │  CASĂ ȘI LOCUINȚĂ        │   ← group header: text-micro uppercase muted
        │  ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢        │   ← 8-col grid, 32px cells
        │  UTILITĂȚI…              │
        │  ▢ ▢ ▢ ▣ ▢ ▢ ▢ ▢        │   ← selected: accent bg
        ╰──────────────────────────╯
```

| Part | Spec | Rationale |
|---|---|---|
| Trigger | `<button>` with `fieldClass` geometry; content: current glyph at 14 px + icon's display name, or `iconNone` text when unset; trailing `ChevronDown` 14 px | Reads as a peer of the selects above it |
| Popover | Base UI Popover (existing primitive), `w-80`, `max-h-96` scroll; **must import `base-ui-config`** (L-0004) since it opens inside a Dialog | |
| Filter | text input, `fieldClass`, filters cells by icon name + localized label; focused on open **via effect** (L-0005) | |
| Clear row | full-width ghost row "Fără pictogramă / No icon" above the groups; selecting sets `icon: ""` and closes | The brief's explicit none-affordance; a row (not a grid cell) because "no icon" is not an icon |
| Grid | `grid-cols-8`, cells 32 px (`size-8`), `gap-1`, glyph at 16 px (`icon-default` — a picker is UI chrome, not inline-with-text) | 8 × 32 + 7 × 4 = 284 px fits `w-80` with padding |
| Cell states | rest: transparent, `text-text-primary`; hover: `bg-surface-inactive`; **selected: `bg-accent` `text-accent-foreground`** (the token system's selection language, same as the segmented control); focus: exact L-0001 ring classes; radius `radius-badge` | |
| Cell a11y | `aria-pressed` on buttons, `aria-label` + `title` = localized icon name (§10) | Cells are icon-only — the one context needing accessible names |

**Keyboard & focus.** Trigger: Enter/Space opens. Inside: Tab order is
filter → clear row → grid (grid is **one** tab stop, roving tabindex).
Arrows move by cell, wrapping rows; with 8 columns, ↑/↓ move by 8 (grid
navigation, not a flat list). Enter/Space selects, closes, returns focus to
the trigger. Escape closes without change and must **not** bubble into the
dialog's own Escape/dirty-guard path (popover swallows the first Escape —
verified in §11). Filtering re-flows the grid; group headers with zero
matches hide.

**The /manage category table** gains the icon before the name (same mount as
everywhere: `CategoryLabel`, not bespoke markup) so the owner sees
assignments where they manage them. The deleted-categories table stays
text-only (J4).

---

## 5. D3 — Default assignment: one-time suggested backfill (option b)

**Recommendation: (b)** — a proposed mapping for the existing categories,
ratified at rulings, applied by name in the gated backfill migration. For a
two-user app the whole point is rows becoming scannable *now*; option (a)
delivers an icon system where nothing has icons and 20 manual assignments as
homework. (a) remains the automatic fallback for any name the backfill
doesn't match.

**Source caveat (per the brief's no-invention rule):** this worktree carries
no `.env`, so the live database was not readable from here. The list below is
every category name the repo itself creates — the phase-1 seed
([seed.ts](../../src/db/seed.ts) 96–147) plus the one-off
[add-income-categories.ts](../../scripts/add-income-categories.ts) — which is
also exactly the protected-names set in the management service plus the
seeded household tree. **The owner confirms at rulings whether live has
renames/additions beyond these** (categories created via /manage since);
unmatched live names simply stay `NULL` → fallback. The migration matches on
`(entity, lower(name), kind)`, live rows only.

| Entity | Category | Kind | Proposed icon |
|---|---|---|---|
| Household | Groceries | expense | `ShoppingCart` |
| Household | Dining | expense | `UtensilsCrossed` |
| Household | Transport | expense | `Car` |
| Household | Housing | expense | `Home` |
| Household | Utilities | expense | `Lightbulb` |
| Household | Health | expense | `HeartPulse` |
| Household | Leisure | expense | `Ticket` |
| Household | Subscriptions | expense | `Repeat` |
| Household | Travel | expense | `Plane` |
| Household | Investment gains | income | `TrendingUp` |
| Household | Investment losses | expense | `TrendingDown` |
| Household | Dividends | income | `Coins` |
| Household | Brokerage fees | expense | `Percent` |
| Household | Other income | income | `HandCoins` |
| Each company (×2) | Software subscriptions | expense | `AppWindow` |
| Each company (×2) | Services | expense | `Briefcase` |
| Each company (×2) | Bank fees | expense | `Receipt` |
| Each company (×2) | Salaries | expense | `WalletCards` |
| Each company (×2) | Taxes | expense | `Landmark` |
| Each company (×2) | Revenue | income | `Banknote` |

Deliberate pairings: `WalletCards` already means "salary" in /manage (the
salary-profile button) and matches the salary kind glyph (§7); `Coins`
matches the dividend kind glyph; `Landmark` (state institution) goes to
Taxes, leaving `Receipt` for Bank fees.

**Child categories** (two-level tree, currently unused by the seed): no icon
inheritance in v1 — a leaf shows its own icon or the fallback. Inheritance
needs a parent join in every display query for a tree that is flat today;
noted as a future refinement if the owner starts nesting.

---

## 6. D4 — Fallback for icon-less categories: render nothing

**Recommendation: no glyph, no reserved space** — an icon-less category
label looks exactly like today.

Ranked against the brief's two constraints (must not look like an error, must
not outweigh assigned icons):

| Option | Verdict |
|---|---|
| **Nothing** | **Chosen.** A blank is the only treatment with zero false signal. After the D3 backfill, icon-less means "owner skipped the picker on a new category" — rare and self-healing (assign in /manage). Today's tables *are* this state everywhere |
| Neutral dot | A column of dots reads as a bullet list and invents a non-token mark |
| Generic Lucide shape (`Circle`, `Tag`) | Repeated identical glyphs down a column are noise that *competes* with real icons — the exact "outweigh" failure; `Tag` also collides with the future tags column |
| Category initial | A fake avatar system: two glyph languages (letters + icons) in one column |

The mixed-column alignment cost (icon-less labels start 18 px left of
icon-bearing ones) is accepted: the column is left-aligned prose, not
tabular data, and reserving ghost space would put permanent holes in every
table for a transient state. In the **picker trigger** the none state is the
explicit `iconNone` text (§4), never a blank.

`KindLabel` uses the same rule: a kind with no mapping (`standard`, §7)
renders text only.

---

## 7. D5 — Type-derived icons for category-less rows

Fixed, not user-editable, defined next to `CATEGORY_ICON_MAP` in the same
module. Kinds from the `transaction_kind` enum
([enums.ts](../../src/db/schema/enums.ts)):

| Kind | Icon | Notes |
|---|---|---|
| `transfer` | `ArrowLeftRight` | Transfers are never categorized (schema rule). Covers **owner transfers** too: `owner_transfer` is an import-classifier label, not a row kind — it books as `kind: "transfer"` ([booking.ts:94](../../src/lib/import/booking.ts)), so it needs and gets no separate icon |
| `salary` | `WalletCards` | Fires only when the company's "Salaries" category is missing — the salary flow *does* categorize its expense leg when the category exists ([flow-actions.ts:276](../../src/lib/ledger/flow-actions.ts)), and then the category icon (same glyph, §5) shows instead. Same concept, same glyph, either path |
| `opening_balance` | `Flag` | A starting marker, not money movement; `Scale` was considered and rejected (reads "justice/taxes") |
| `dividend` | `Coins` | Matches the Dividends category icon — same concept either path |
| `trade` | `ChartCandlestick` | Trade cash↔position legs are uncategorized; fee/gain legs carry categories |
| `standard` | *(none — D6 fallback)* | An uncategorized standard row (e.g. an imported `state_payment` settling tax liability) has no honest glyph; inventing one would mislabel it |
| *(split rows)* | `Split` leading the existing "Împărțit ({count})" text | Not a kind — the list's `splitCount > 1` state; included so the one remaining bare text state joins the visual language (J2 if the owner prefers text-only) |

**Read identically, not muted (recommendation).** The kind glyph renders
exactly like a category glyph — same size, stroke, `currentColor`. The
category cell is already `text-text-muted` in the list, so both sources
inherit the same muted tone there; a *further* dimming would create a
three-level gray hierarchy inside one column to encode a distinction
(assignable vs fixed) that only matters in /manage, where it's already
explicit. No UX reason found, so no visual split — one language, per the
brief's premise.

Accompanying text: the cell keeps its current text behavior (bare `"—"`),
now preceded by the kind glyph — except see **J1**, which proposes replacing
`"—"` with the localized kind label (`enums.transactionKind.*`, both locales
already in the catalog) since the list has no Kind column and the glyph
shouldn't carry meaning alone (§10). Detail-page posting legs keep plain
`"—"` — a leg has no kind, and the transaction kind is already in the page
header.

---

## 8. D6 — Table treatment

**Size: 14 px (`icon-inline`), correcting the brief's 16 px working
assumption.** The verification the brief asked for: list cells are
`text-secondary` (14 px / 20 px line) with compact row padding 8 px → ~36 px
rows. Both 14 and 16 fit the 20 px line box, but the token system's stated
role for glyphs inline with text *is* `icon-inline` 14 — 16 (`icon-default`)
is the standalone/control size. Deciding evidence: the shipped Archive
marker and the DB badge both chose 14 next to 14/11 px text, and the icon
sits in the same inline flex as the Archive marker — two sizes in one span
would be visibly mismatched. 16 px would also make the muted metadata column
optically louder than the black description column, inverting the
number-first hierarchy.

| Property | Spec |
|---|---|
| Implementation | `size-3.5` (14 px), matching the badge; **not** `size-[var(--icon-size-inline)]` until the O-1 token-consumption question is settled — and never the currently-broken `var(--icon-inline)` |
| Stroke | `strokeWidth={1.5}` + `absoluteStrokeWidth` (existing `ICON_PROPS`) |
| Placement | Leading the label, `shrink-0`, same inline flex |
| Gap | `gap-1` (4 px) — the archived treatment shipped with `gap-1`; one gap value per span, and 4 px reads correctly at this density (J3 offers 6 px) |
| Color | `currentColor` — inherits the cell (`text-text-muted` in list, `text-text-secondary` in detail). No semantic/per-category color: 80 same-color glyphs is the design; color stays reserved for money and status |
| Vertical fit | 14 px glyph in a 20 px line box, flex-centered — no row-height change |

**Archived composition** — leading icon and trailing Archive marker
coexist; the brief's crowding concern resolves by position, not removal:

```
[⛒ icon]·Groceries·[Archive]     ← whole span text-text-muted, title tooltip
```

Worst realistic case (14 + 4 + name + 4 + 14) adds 36 px over the bare name —
within what the category column absorbs today from long names themselves.
The category icon renders muted like the rest of the span (it inherits), so
the archive signal (mute + trailing marker) stays legible.

**Density / money-column check** (verified at implementation, §11): amount
and RON cells are `whitespace-nowrap` right-aligned `tabular-nums`, so they
cannot wrap; the risk is table auto-layout redistributing width. The icon
adds a fixed 18 px to one left-aligned prose column at the list's current
8-column layout — screenshot check at 1280 px and the narrowest supported
width confirms no money-column shift and no description squeeze.

**Filter pill** (deleted-category state) inherits the icon via
`CategoryLabel`: 14 px glyph beside the pill's 12 px caption text is
accepted — one size everywhere beats a pill-only 12 px variant.

---

## 9. D7 — Surface audit: what inherits, what doesn't

**Inherits with zero extra work** (mounts `CategoryLabel`/`KindLabel`):
transactions list cells + filter pill, transaction detail posting cells —
and every *future* surface that renders a category label through the shared
component, including review-inbox rows **after booking** (booked rows land in
the transactions list).

**Grep for category-name rendering outside `CategoryLabel`** (excluding
tests; `rg "category\.name|row\.category|categoryName"`):

| Hit | Class | Disposition |
|---|---|---|
| [management-client.tsx:571](../../src/components/management/management-client.tsx) live category table | Label | **In scope**: mounts `CategoryLabel` with icon (§4) |
| management-client.tsx:621 deleted-categories table | Label | Text-only in v1 (J4) |
| management-client.tsx:578 parent-name column | Label | Text-only in v1 — a reference to another row, not that row's identity; icons here double every glyph in the table (J4) |
| management-client.tsx:896 parent `<option>`s | Picker | Native `<option>` cannot render SVG — out of scope |
| transactions/page.tsx:172 filter `<option>`s | Picker | Same — native select |
| [standard-form.tsx:68](../../src/components/forms/standard-form.tsx) category Select items | Picker | Custom Select *could* carry icons — deliberately deferred (J5): pickers are a different surface class, and v1 scope is labels |
| [import-inbox.tsx:219–232](../../src/components/import/import-inbox.tsx) suggested-category combobox/select | Picker | Same as above (J5). Inbox rows never render a category as a *label* pre-booking |
| gallery.tsx:748 | Dev-only demo data | Ignore |

Conclusion: the CategoryLabel-mount premise holds for every **label**
surface; the only additions are the /manage live table (in scope) and the
optional picker-item enhancement (J5). No surface renders a category label
raw where an icon is expected and wouldn't appear.

---

## 10. D8 — i18n and a11y

**Decorative rule.** Wherever the icon accompanies the visible name (every
label surface), it is `aria-hidden="true"` + `focusable="false"` — matching
the shipped Archive marker. Names stay the accessible text; nothing about a
category's accessible name changes when an icon is assigned. `KindLabel`
under J1 (icon + visible kind label) is likewise decorative.

**Icon-only contexts found (both need accessible names, RO + EN):**

1. **Picker grid cells** (§4) — `aria-label` + `title` = localized icon
   display name.
2. **`KindLabel` if J1 is declined** (icon + `"—"`) — the glyph becomes the
   sole meaning carrier and takes `aria-label` from the existing
   `enums.transactionKind.*` keys (RO/EN already present). If J1 is accepted,
   this context disappears — one more reason to accept it.

**Catalog additions (EN / RO):** `manage.icon` ("Icon" / "Pictogramă"),
`manage.iconNone` ("No icon" / "Fără pictogramă"), `manage.iconSearch`
("Search icons…" / "Caută pictograme…"), `manage.iconGroup.*` — 11 group
names (§3 table carries both languages), and `icons.*` — **80 display names
in both languages** for the picker cells (mechanical but real; see J6 for
the cheaper alternative the owner may prefer). Existing keys reused:
`enums.transactionKind.*`, `transactions.split`,
`manage.deletedCategoryTooltip`.

RO pluralization/diacritics: display names are nouns, no plural forms
needed; all RO copy above written with diacritics per catalog convention.

---

## 11. Bundle strategy and verification plan (for the implementation unit)

**Bundle.** Only named imports from `lucide-react` inside
`category-icons.ts`; no `import * as icons`, no computed access into the
package, no `dynamic()` icon loading. Lucide ships ESM with per-icon modules
and `sideEffects: false`, so the curated 80 (+3 chrome glyphs) tree-shake to
roughly 80 × ~0.4 KB ≈ 32 KB pre-gzip in the shared client chunk — noted,
accepted, and *checked*, not assumed:

Objective gate per `review-standards.md` §2 (cache-cleared tsc per L-0013,
eslint, G1–G4 greps, scope guard, checklist), plus unit-specific:

1. **Tree-shake proof:** `next build`, then grep the client chunks for a
   sentinel icon name absent from the curated set (e.g. `lucide-rocket` /
   its path data) — must be absent; spot-check one curated glyph is present.
   Record the first-load JS delta.
2. **O-1 fix proof:** deleted-category label renders its Archive marker at
   14 px (computed style, per L-0006 headless method).
3. **Picker walkthrough** (scripted, `pointerType: "mouse"` per L-0008):
   open picker inside the dialog (L-0004 config active), filter, arrow
   through the grid, Enter selects, focus returns to trigger; Escape closes
   the popover *without* triggering the dialog's dirty guard; a second
   Escape reaches the dialog and the guard fires when dirty.
4. **Dirty guard:** changing only the icon marks the form dirty;
   escape/outside-press shows the discard confirm.
5. **Alignment fixture:** transactions list at compact density, 1280 px and
   narrow width, mixed rows (icon category, icon-less category, transfer,
   split, archived + icon) — money columns' x-positions unchanged vs
   baseline screenshot; no row-height change (L-0006-style computed checks
   where headless).
6. **Type-derived rows:** transfer/opening-balance/trade rows show the §7
   glyphs; an uncategorized `standard` row shows none; split rows show
   `Split` + text.
7. **a11y greps:** every `CATEGORY_ICON_MAP`/`KIND_ICON_MAP` render site
   carries `aria-hidden` except picker cells, which carry `aria-label`.
8. **Catalog parity** EN/RO for all new keys, cache-cleared tsc.
9. **Write-path validation:** category create/update rejects an icon name
   outside the curated map (service-level test).
10. **`globals.css` checksum unchanged** — no token edits in this unit
    (`size-3.5` is on-scale; if the owner instead rules to *define*
    `--icon-inline`, that becomes a separate ruled token edit).

**Migration unit (separate, Tier 3, gated):** `icon text` column (nullable,
no default), Drizzle migration + §5 backfill `UPDATE`s matching
`(entity_id, lower(name), kind)` on live rows; down path drops the column.
Runs only after Checkpoint A rulings, per the standing db escalation.

---

## 12. Scope and judgment flags

**In scope at implementation (Tier 2):** `category-label.tsx` (icon prop,
`KindLabel`, O-1 fix), `category-icons.ts` (new), the /manage picker + table
mount + `fields.icon`, `icon` passthrough in
`src/lib/management/service.ts`/`actions.ts` create/update values and in the
display queries' category selects, catalog keys, tests above.

**Explicitly out of scope:** the migration/backfill (separate gated unit);
ledger service/flow-actions/tax/fx logic; per-account or per-transaction
icons; picker-item icons in transaction forms (J5); any new tokens.

**Judgment flags — owner decides:**

- **J1 — category-less cell text:** recommend replacing the bare `"—"` with
  glyph + localized kind label ("Transfer", "Sold inițial") — the list has
  no Kind column, the catalog keys exist, and it removes the icon-only a11y
  context (§10). Decline = glyph + `"—"` with `aria-label`.
- **J2 — split-row marker:** recommend the `Split` glyph before the existing
  split text; decline leaves split rows the one text-only state in the
  column.
- **J3 — icon–label gap:** recommend `gap-1` (4 px, matches the shipped
  archived span); alternative 6 px everywhere, which nudges the shipped
  Archive marker 2 px right.
- **J4 — /manage secondary surfaces:** deleted-categories table and
  parent-name column stay text-only (recommended); or icons everywhere in
  /manage.
- **J5 — pickers with icons (future unit):** custom Select/combobox items in
  standard-form and import-inbox could show icons; deferred, not designed
  here.
- **J6 — icon display-name catalog:** recommend the full 80×2 `icons.*`
  catalog (correct RO for picker tooltips/filter); the cheap alternative —
  humanized English slugs ("shopping-cart" → "Shopping cart") — leaves RO
  users filtering in English inside an otherwise-RO UI.

**Open points:**

- **O-1** — `var(--icon-inline)` sizing defect hypothesis (§1); fix rides
  the implementation unit either way.
- **O-2** — live category list: the §5 table covers every repo-created name;
  owner confirms at rulings whether live has renames/additions (this
  worktree cannot read the database — no `.env`), and the backfill's
  name-matching makes any gap safe (stays `NULL` → fallback).

**Proposed ledger entries:** none — no new class of gotcha surfaced; O-1 is
an instance of existing token-conformance review (G-class), already covered.
