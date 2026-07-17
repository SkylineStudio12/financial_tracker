# Nav IA — sidebar → top navigation reconciliation — Checkpoint A

**PROMPT-KEY:** 10-18F
**Status:** ACCEPTED 2026-07-17 (Checkpoint A) — rulings in review-log. Design doc only; no
code. Tier 2 at implementation (layout + nav components; no Tier-3 paths).
**Frozen-path statement up front:** this IA is designed to require **zero
edits to `globals.css` or `docs/design-tokens.md`** — bar geometry composes
existing spacing/density tokens, and every visual comes from 10-10F's
component specs. If implementation discovers a genuine token need (it should
not), that is a named owner-authorized step, never absorbed.

**Givens honored, not re-litigated:** five profiles via `/p/[profile]`
(config-driven capability flags); All-entities = dashboard-only view below a
menu separator with context chips (10-10F §1.2–1.3); active state =
`surface-inactive` wayfinding fill; review inbox = load-bearing registry
entry 4; components per 10-10F (this doc slots them, respecs nothing).

---

## 0. Decision table (owner ratifies; rationale in the numbered sections)

| # | Decision | Ruling proposed |
|---|---|---|
| D1 | Bar item set | Noun destinations: Dashboard, Transactions, Imports (badge), Investments, Manage + SRL-only New salary / New dividend; Reports = Soon; Accounts/Tax/notifications omitted (§1) |
| D2 | Item order | Dashboard · Transactions · Imports · Investments \| New salary · New dividend \| Reports(Soon) · Manage (§1.3) |
| D3 | Roadmap link | Moves into the avatar menu, out of the bar (§2.3) |
| D4 | Bar layout | Switcher left · nav flat row · spacer · locale toggle + avatar right; 56 px; `bg-surface` + bottom hairline; sticky (§2) |
| D5 | Nav labels | Text-only in the bar (no per-item icons); icons appear in overflow-menu rows only (§3.1) |
| D6 | Collapse strategy | Deterministic breakpoint tiers folding into one trailing "More" menu; never wrap, never truncate (§3) |
| D7 | All-entities route | `/p/household/dashboard?view=all`; underlying context is always Household; **no banner** — chips + trigger subtitle carry the state (§5) |
| D8 | Migration | One unit: bar in, sidebar out, same commit; `ui/sidebar.tsx` primitive retired in a named cleanup follow-up (§6) |
| D9 | Inbox badge scope | One Imports item serves both inboxes; count = profile's pending rows across statement + brokerage (§1.2) |

## 1. Which items exist, per profile (D1, D2, D9)

### 1.1 From today's real routes only

The sidebar's nine entries consolidate to seven bar items. Two sidebar
entries are not first-class destinations and merge:

- **"Import statement" + "Import brokerage" → one `Imports` item** (both
  href `/imports` already; the split was group-cosmetic). This item IS the
  10-10F §3 review-inbox item; the implementing unit records the placement
  change in registry entry 4. Badge count (D9): the profile's pending
  review rows across both inbox types — one number, because the item's job
  is "unreviewed rows exist here", not inbox taxonomy.
- **"Record trade" → `Investments`** (route `/investments`). The bar names
  destinations; verb phrasing survives only on the two entries that open
  entry flows (below). New catalog keys; old keys retire with the sidebar.

| Item | Route | Visible on | Mechanism |
|---|---|---|---|
| Dashboard | `${base}/dashboard` | all | always |
| Transactions | `${base}/transactions` | all | always |
| Imports *(badge)* | `${base}/imports` | Skyline, DRMX, Greg | capability: `companyFlows \|\| owner === "greg"` — **flag: promote to an explicit `imports` capability flag on `Profile`** rather than deriving from owner (config-driven rule stays honest) |
| Investments | `${base}/investments` | Household, Greg, Andra | existing `investments` flag |
| New salary | `${base}/transactions?entry=salary` | SRLs | existing `companyFlows` |
| New dividend | `${base}/flows/dividend` | SRLs | existing `companyFlows` |
| Reports | — | all | **Soon item** (10-10F §4) |
| Manage | `${base}/manage` | all | always |

Per-profile result: Household/Andra 4 items (+Soon), Greg 5 (+Soon),
SRLs 6 (+Soon). All conditional items use 10-10F §2 (hidden, config-flag,
no animation).

### 1.2 Mock items with no built page — per-item ruling

| Mock item | Ruling | Justification |
|---|---|---|
| **Accounts** | **Omit** | Accounts management is designed as a *section of Manage* (10-09F), not a page. A Soon item would promise a destination that will never exist; when 10-09F ships, Manage covers it with zero nav change |
| **Tax** | **Omit** | Same shape: tax settings live at `/manage/tax` (10-08F) and the tax panel lives on the dashboard (10-07F). No top-level Tax page is designed or planned |
| **Reports** | **Soon-flag** | A genuine planned top-level destination (Phase 5 of the agreed plan — net worth, cash flow, P&L, quarterly tax dashboard). The Soon item honestly preserves the mock's promise and stakes the bar position it will occupy. RO "Rapoarte" |
| **Notifications (bell)** | **Omit** | No notification system exists in any phase of the plan. A Soon bell is vaporware chrome; when/if a real need appears it enters through its own unit |

The dividing rule, stated once: **Soon is for planned pages that will live
in the bar; omission is for things that are sections of existing pages or
unplanned.** (10-10F §2's invariant continues to govern
conditional-vs-Soon.)

### 1.3 Order and grouping (D2)

```
[Switcher] Dashboard Tranzacții Importuri① Investiții │ Salariu nou Dividend nou │ Rapoarte[CURÂND] Administrare      [RO|EN] (G)
```

- **Flat list, no group labels** — a bar has no room for the sidebar's
  Views/Flows/Investments headings; *order* carries the grouping instead:
  read-destinations first (frequency order: the dashboard is the landing
  surface, transactions the daily surface), entry flows second, meta last.
- **Manage sits last** — settings-like items belong at the end of a bar by
  convention; it also makes Manage the natural first fold (§3).
- **No visual separators between clusters** (the `│` above is notation
  only). Six items with 8 px gaps don't need fences; separators would
  reintroduce group chrome the move away from the sidebar sheds. The one
  meaningful boundary (real items vs Soon) is already carried by the Soon
  item's distinct muted+chip treatment.
- **Reports (Soon) sits before Manage**, in the position the real page
  will take — shipping the page later changes the item's state, not the
  bar's geometry.

## 2. Bar layout (D3, D4)

### 2.1 Regions

```
╭──────────────────────────────────────────────────────────────────────╮
│ ▣ Skyline Studio SRL ⌄   Panou  Tranzacții  Importuri③ …   [RO|EN] Ⓖ │ 56px
╰──────────────────────────────────── border-hairline ─────────────────╯
```

Left → right: **profile switcher** (identity first — it sets the context
everything after it operates in, and it holds the top-left position the
sidebar trained for a year of muscle memory) · **nav items** (flat row,
`space-1` gaps) · **flex spacer** · **utilities**: locale toggle, then
avatar.

### 2.2 Geometry and surface — no new tokens

- **Height 56 px** = `calc(var(--spacing) * 14)`: 36 px items (10-10F §0)
  + 10 px vertical padding each side. On the 4 px base, expressed as a
  spacing calc exactly like the density presets — **no new token**.
- Background `surface` (white) over the `canvas` page, bottom border
  `border-hairline` — the bar is chrome, and white-on-off-white with a
  hairline is the existing card grammar doing wayfinding duty. **No
  shadow, no blur, no scroll-elevation effect** — that restraint is what
  keeps this unit out of `globals.css`.
- **Sticky** (`position: sticky; top: 0`): the bar is the only navigation
  left after the sidebar goes; losing it on scroll on a long transaction
  list would orphan the page.
- Content area below becomes full-width with the existing page max-width
  conventions (pages already own their `max-w-*`; the shell stops
  reserving a sidebar column — that is the entire layout change).

### 2.3 Locale toggle and user block (D3)

- **Locale toggle: stays visible in the bar**, unchanged component
  (compact EN/RO segmented pair). Rationale: it is the app's only
  bilingual control, both users genuinely switch, and it is 70 px wide —
  burying it one level deep to save that is a bad trade.
- **User block → avatar only** (32 px, existing `Avatar`), opening a small
  popover menu (same menu pattern/keyboard model as the switcher):
  identity line ("Greg · Finance Tracker" — the sidebar footer's content)
  and **Roadmap** as a menu link. Roadmap leaves the bar (D3): it is a
  meta page about the app, not a daily destination, and it costs 110 px of
  RO bar width ("Plan de lucru") where it competes with real work items.
  The avatar menu is its natural home; it remains one click away.

## 3. Responsive collapse (D5, D6)

### 3.1 Text-only items in the bar (D5)

Nav items render **without icons** in the bar. The 10-06F width argument
applies verbatim: RO labels are long, six items must fit, and an icon +
gap costs ~24 px per item (~150 px across an SRL bar) while adding no
information a label doesn't carry. Icons return in two places where they
earn their keep: **overflow-menu rows** (menus are scanned vertically,
icons aid that) and the utilities cluster. The badge and Soon chip are
trailing slots, not icons, and always render.

### 3.2 The fold: one trailing "More" menu, deterministic tiers (D6)

Labels never wrap and never truncate (given). The bar folds
lowest-priority items into a trailing **More ▾** item ("Mai multe")
opening a popover menu — same primitive family and keyboard model as the
switcher menu, no drawer, no second navigation pattern. Folded items keep
their full 10-10F behavior inside the menu (badge on the Imports row, Soon
chip on Reports, context chips in All-entities state).

**Deterministic breakpoint tiers, not runtime measurement.** A
ResizeObserver priority-collapse is smoother but unfalsifiable in review;
breakpoint tiers are computed once against the RO fixture (the width
budget below), are testable at exact widths, and cannot jitter. RO worst
case (SRL, all items + Soon): ≈ 800 px of items + ~200 px switcher
+ ~120 px utilities ≈ 1120 px:

| Tier | Viewport | In the bar | In More |
|---|---|---|---|
| Full | ≥ 1280 (`xl`) | everything | — (More absent) |
| 1 | ≥ 1024 (`lg`) | Dashboard, Transactions, Imports, Investments, flows | Reports(Soon), Manage |
| 2 | ≥ 768 (`md`) | Dashboard, Transactions, Imports/Investments | flows, Reports, Manage |
| 3 | < 768 | Dashboard, Transactions | everything else |

Fold order is the reverse of §1.3's priority: Soon first, Manage, flows,
then Investments/Imports; **Dashboard and Transactions never fold**. The
More item shows the **aggregate badge count** of folded badge-carrying
items (the inbox count must not disappear at narrow widths — registry
entry 4's honesty survives the fold). At tier 3 the switcher trigger drops
its label block to avatar+chevron (10-10F §1.1 already permits trigger
truncation; below `md` it goes icon-only — full names stay one click away
in its menu).

Exact tier boundaries are re-verified against rendered RO at
implementation (the ~7 px/char estimate is a design-time budget, not a
measurement); moving a fold one tier is an implementation freedom, adding
a wrap or a truncation is not.

## 4. Landmark and skip-link order

1. **Skip link** — first focusable element on every page: EN "Skip to
   content" / RO "Sari la conținut". Visually hidden until focused; when
   focused it renders as a standard button pinned top-left above the bar
   (existing focus-ring rules, L-0001). Target: `<main id="main">`. The
   sidebar era had no skip link; a persistent top bar in the tab path
   makes one mandatory (up to ~10 stops before content at full width).
2. **`<header role="banner">`** — the bar. Inside it, in DOM and tab
   order: profile switcher → **`<nav aria-label="Main">`** (RO
   "Principală") containing the nav items and, when present, the More
   trigger (folded items live inside the same landmark — one nav, always)
   → locale toggle (`role="group"`, existing) → avatar menu button.
3. **`<main id="main">`** — page content.

No footer landmark exists (the sidebar footer's contents moved into the
banner per §2.3). Keyboard model per 10-10F §0.3: links in tab order;
composite-widget arrows exist only inside the three popover menus
(switcher, More, avatar).

## 5. All-entities: route shape and the banner question (D7)

**Route: `/p/household/dashboard?view=all`.**

- **Why household hosts it:** consolidation is a lens over the *shared*
  view, and Household is the shared profile — the one profile whose
  dashboard already aggregates cross-entity (net cash, 10-07F). Hosting it
  anywhere else would either invent a sixth slug (`/p/all/…` — exactly the
  "sixth context" the ruling forbids, now in the URL where it would leak
  into every relative link) or make the underlying context depend on where
  you came from (hidden state; two users would see different "All
  entities" behaviors — untestable and unexplainable).
- **Deterministic consequence:** the underlying context is **always
  Household**. The switcher trigger reads "All entities · via Household"
  (RO "prin Gospodărie") and every context chip resolves to H — 10-10F
  §1.3 needs no per-origin memory.
- **The `?view=` param family is shared with 10-07F card 2** (which ruled
  `?view=entities` for the by-entity breakdown): one param, enumerated
  values, dashboard-only, evaporates on navigation — provably "a view,
  not a context" (the 10-07F verification item 7 covers this param's
  containment; `all` joins its enum). Dashboard *content* in this state is
  10-07F's scope, not this unit's.
- Navigating anywhere else from this state lands on plain
  `/p/household/<page>` — the param dies with the dashboard, by
  construction.

**Banner: NO (chips only).** 10-10F J3 allowed coexistence; this doc picks.
In the All-entities state the constraint is already voiced twice at the
point of action — the trigger subtitle ("via Household") and the context
chip + tooltip on every non-dashboard item. A page-level banner would be a
third voice saying the same sentence to an audience of two people who
chose the state one click ago. If real-use confusion emerges, a banner is
a purely additive follow-up (the coexistence design guarantees no
rework).

## 6. Migration (D8)

**What physically replaces the sidebar:**

| Breakpoint | Today | After |
|---|---|---|
| ≥ `md` | Fixed sidebar column + content | Top bar (tier per §3.2) + full-width content |
| < `md` | Sidebar sheet/rail (off-canvas) | Same top bar at tier 3 + More menu — **no drawer**: the off-canvas pattern retires with the sidebar; one nav pattern at every width |

**One unit, not phased — recommendation and rationale.** The swap is one
commit-reviewable concern (L-0007): `layout.tsx` mounts the bar instead of
`AppSidebar`, `app-sidebar.tsx` is deleted, skip link added. Phasing
(both navs alive, or per-route rollout) means two sources of navigation
truth for an app with two users and zero deployment risk — all cost, no
safety. The bar's components are already spec'd (10-10F) and the surface
is Tier 2 throughout. Internal sequencing *within* the unit (build bar →
visual pass → swap+delete in the final diff) is implementation freedom;
shipping state is atomic.

Boundary notes:
- `src/components/ui/sidebar.tsx` (the primitive) stays on disk, unused,
  and is removed in a named cleanup follow-up — deleting a 700-line
  primitive is its own reviewable concern, and the gallery may reference
  it (verify there before the cleanup, not during the swap).
- **Independence from 10-14C (Urbanist):** the bar composes semantic
  tokens and ships correctly on whichever token set is live; neither unit
  blocks the other. The §3.2 tier widths are re-checked after any font
  swap (different metrics, same method).
- Catalog: new keys for renamed/new items (`nav.imports`,
  `nav.investments`, `nav.reports`, `nav.more`, `nav.skipToContent`,
  avatar-menu keys); retired `sidebar.*` keys removed in the same unit
  (catalog parity + cache-cleared tsc per L-0013 catches stragglers).
- Registry: entry 4 gains the placement note (inbox nav face = the
  Imports bar item + badge; folded-state aggregate count) in the same
  diff, per the given.

## 7. Verification plan (implementation unit)

1. **Per-profile item sets:** DOM assertions for all five profiles — SRLs
   show flows + Imports; Greg shows Imports; Household/Andra don't;
   Reports(Soon) everywhere; no `sidebar.*` remnants render.
2. **Tier walkthrough at exact widths** (1280/1024/768/767) in **RO**: no
   wrap, no truncation, no horizontal scroll; folded items present in
   More with badge/chip/keyboard behavior intact; aggregate badge on More
   equals the sum of folded badges.
3. **All-entities containment:** selecting All entities lands on
   `/p/household/dashboard?view=all`; trigger reads "via
   Gospodărie"/"via Household"; chips on all non-dashboard items resolve
   H; navigating to any item yields a param-free household URL; no other
   route reads `view=all` (grep-level).
4. **Landmarks:** skip link is the first tab stop on every page and
   focuses `#main`; exactly one `banner`, one `nav[aria-label]`, one
   `main` per page; menus (switcher/More/avatar) pass the 10-10F keyboard
   walkthrough (L-0008 pointer init where scripted).
5. **Registry + honesty:** entry 4 updated in the same diff; badge zero
   state renders no element at every tier.
6. **Frozen-path proof:** `git diff --name-only` contains neither
   `globals.css` nor `design-tokens.md`; G1–G4 clean; cache-cleared tsc;
   eslint; `next build`; console clean on all five profiles × RO/EN;
   compiled-CSS focus-ring check (L-0006) for bar items, skip link, and
   menu rows.

## 8. Scope

**In scope at implementation:** the bar (shell, tiers, More menu), profile
switcher integration (10-10F §1 as spec'd), skip link + landmarks, avatar
menu, `layout.tsx` swap, `app-sidebar.tsx` deletion, `imports` capability
flag on `Profile` (flagged in §1.1), catalog changes, registry entry-4
note, this doc + A/B review-log rows.

**Out of scope:** dashboard content and the 10-07F card-2 toggle; any
component respec (10-10F is final); tokens/`globals.css` (§0 statement);
the `ui/sidebar.tsx` primitive deletion (named follow-up); Reports page
itself; notification systems; font migration (10-14C's unit).

**Judgment flags beyond the D-table:** none — D1–D9 are the decisions.

**Proposed lessons:** none — the unit applies L-0001/4/6/7/8/13 and this
chat's established grammars (hidden-vs-Soon, zero-badge, view-not-context)
without amending them.
