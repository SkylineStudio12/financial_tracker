# Design token foundation

Light-first, airy, number-forward. Off-white canvas, white cards floating on
it, black as the primary accent, olive/red reserved for money status, and an
electric-lime highlight family held in reserve (fills only, unadopted). This
document is the single source the app's central tokens file implements.
Components use **semantic tokens only** — never primitives.

Scope: color, typography, spacing, radius, density, iconography. No components.

**Provenance (2026-07-17, unit 10-22C):** color values and typography adopted
from the Claude Design token export under REPO NAMES (10-14C Phase 1 mapping,
option (a)); all deviations from the export are owner-ruled and listed in §5.
**Font model is a HYBRID (owner ruling):** Urbanist is the UI typeface
(`--font-sans`); **Geist stays the numeric face** (`--font-numeric`). The
export's "one face, numbers too" premise failed the 10-20C gate: GSUB parsing
of both the Google-served and upstream Urbanist files proved `tnum` (and
`lnum`/`cv05`) absent, with strongly proportional digit advances ('1' = 530
vs '0' = 1191 units) — the Lufga failure mode repeated. Geist's `tnum` was
re-verified as the control in the same gate. Consequence: **every
money/aligned-number surface MUST resolve through `font-numeric` +
`tabular-nums`; an amount rendering in `--font-sans` is a defect** (the
10-22C Checkpoint B report lists the six sites found by that audit).

---

## Tier 1 — Primitives

### 1.1 Neutral ramp (achromatic — the export removed the old blue cast)

| Primitive | Value | Ramp role |
|---|---|---|
| `gray-0` | `#FFFFFF` | Pure white |
| `gray-25` | `#FBFBFC` | Whisper step (new; unassigned) |
| `gray-50` | `#F5F5F8` | Soft off-white — page background |
| `gray-100` | `#ECECF0` | Inactive fill |
| `gray-200` | `#E0E0E5` | Hairline tone |
| `gray-300` | `#CDCDD4` | Input border tone |
| `gray-400` | `#9A9AA3` | Disabled/placeholder tone |
| `gray-500` | `#6F6F78` | Muted text tone |
| `gray-600` | `#55555D` | Secondary text tone |
| `gray-700` | `#3B3B42` | Deep grey (info text) |
| `gray-800` | `#232328` | Near-black (hover on black) |
| `gray-900` | `#121215` | Primary text / inverse surface |
| `gray-950` | `#000000` | Pure black |

### 1.2 Chromatic ramps

**Lime (highlight — fills ONLY, never text on light; 1.16:1 as text on white):**
`lime-50 #FAFFDE · 100 #F3FFB0 · 300 #E7FE6A · 500 #D7FE03 · 600 #C2E603 · 700 #A6C405`

**Olive (money positive — deliberately distinct from lime):**
`olive-50 #F4F9EC · 100 #E6F1D2 · 200 #CBE3A2 · 500 #83AF3B · 600 #4D7C0F · 700 #3F6212 · 800 #365314`

**Red (money negative):**
`red-50 #FEF3F2 · 100 #FEE4E2 · 200 #FECDCA · 400 #F97066 (dark surfaces only) · 500 #D64B3F · 600 #B42318 · 700 #912018`

**Amber (attention/estimates):**
`amber-50 #FFFAEB · 100 #FEF0C7 · 200 #FEDF89 · 600 #B54708 · 700 #93370D`

**Legacy fill primitives (kept by owner ruling — no export successor):**

| Primitive | Value | Role |
|---|---|---|
| `green-neon` | `#86FF7B` | Positive dots/badges — fills only |
| `red-neon` | `#FF6262` | Negative dots/badges — fills only |
| `grey-fill` | `#B9BFC7` | Neutral indicator (ex `neutral-300`) |

### 1.3 Spacing scale — unchanged

Base unit **4 px**; steps `space-05` 2 · `1` 4 · `2` 8 · `3` 12 · `4` 16 ·
`5` 20 · `6` 24 · `8` 32 · `10` 40 · `12` 48 · `16` 64 · `20` 80. No
off-scale values. (Spacing was out of the export's scope.)

### 1.4 Radius scale — unchanged

`radius-xs` 4 (chips) · `sm` 8 (badges/small controls) · `md` 12
(inputs/buttons) · `lg` 16 (popovers) · `xl` 20 (cards) · `full` 9999 (pills).

### 1.5 Type scale (fixed — do not extend)

Fonts: **HYBRID (2026-07-17)** — **Urbanist** for UI text (`--font-sans`,
via `next/font`, subsets latin + latin-ext for Romanian diacritics);
**Geist** for numerals (`--font-numeric`, unchanged — `tnum` verified; the
2026-07-06 Lufga→Geist history stands). Amounts align via `font-numeric` +
`tabular-nums`; Urbanist must never render money (no tabular figures — see
Provenance). Weights: **Light (300)** and **Regular (400)**; **Medium (500)**
is the permitted ceiling (owner decision 2026-07-04, re-affirmed 10-22C: the
export's 600 weight was NOT adopted — gate G3 enforces). Emphasis comes from
size and text-color tokens, never from weight. Fallbacks:
`Urbanist, system-ui, sans-serif` / `Geist, system-ui, sans-serif`.

| Primitive | Size | Weight | Line height | Letter spacing | Notes |
|---|---|---|---|---|---|
| `type-46` | 46 px | 300 light | 50 px | −0.01 em | Hero number (export display; **was 36**) |
| `type-30` | 30 px | 300 light | 36 px | −0.005 em | Page/section title (export h1) |
| `type-24` | 24 px | 400 | 32 px | −0.005 em | Large number in cards |
| `type-20` | 20 px | **500 medium** | 28 px | 0 | Card title (export h2; **was 400**) |
| `type-18` | 18 px | 500 medium | 24 px | 0 | **New** — subsection heading (export h3) |
| `type-16` | 16 px | 400 | 24 px | 0 | Body / default UI (= export `md`) |
| `type-14` | 14 px | 400 | 20 px | 0 | Secondary text (= export `base`) |
| `type-13` | 13 px | 400 | 18 px | 0 | **New** — dense table body (export `sm`) |
| `type-12` | 12 px | 400 | 16 px | +0.005 em | Small label / caption |
| `type-11` | 11 px | 400 | 14 px | **+0.04 em** | Micro label, UPPERCASE (tracking was 0.06; export label value, JSON wins) |

Export-name mapping note: our `body` (16) = export `md`; our `secondary` (14)
= export `base` — the export's own "body" role is 14 px, which this repo
renders as `secondary`. Values unchanged; only the name correspondence is
recorded here so future exports reconcile cleanly.

Numeric feature primitive: `font-numeric` = Geist + `tabular-nums`
(`font-variant-numeric`). The export's `--numeric-features` string
(`"tnum" 1, "lnum" 1, "cv05" 1`) was **not adopted**: Geist's mechanism
already works, and the string references features Urbanist doesn't implement.
Under the hybrid model `font-numeric` is **load-bearing**: it is what moves
digits off Urbanist onto Geist — `tabular-nums` alone is a silent no-op in
the sans face.

### 1.6 Icon primitives — unchanged

Lucide, `absoluteStrokeWidth`, stroke 1.5; sizes 14/16/20/24.

---

## Tier 2 — Semantic tokens

### 2.1 Surfaces

| Semantic token | References | Role |
|---|---|---|
| `canvas` | `gray-50` | Page background |
| `surface` | `gray-0` | Card surface |
| `surface-raised` | `gray-0` | Popovers/menus — separation via `shadow-raised` (kept; elevation out of export scope) |
| `surface-inactive` | `gray-100` | Inactive fills, disabled controls, skeletons |
| `border-hairline` | `gray-200` | 1 px dividers and card outlines |
| `border-input` | `gray-300` | Input and control borders |

### 2.2 Text

| Semantic token | References | Role |
|---|---|---|
| `text-primary` | `gray-900` | Headings, amounts, primary content |
| `text-secondary` | `gray-600` | Supporting copy, table headers |
| `text-muted` | `gray-500` | De-emphasized metadata, captions |
| `text-disabled` | `gray-400` | Disabled labels, placeholders (decorative-level contrast, never for information) |

### 2.3 Status (finance)

Text variants for money values as text; fill variants (vivid legacy tones)
for dots, small badges, and chart accents only.

| Semantic token | References | Role |
|---|---|---|
| `status-positive-text` | `olive-600` | Income, gains, credits as text (**was green-700**) |
| `status-positive-fill` | `green-neon` | Positive dots/badges — kept |
| `status-negative-text` | `red-600` | Expenses, losses, debits as text |
| `status-negative-fill` | `red-neon` | Negative dots/badges — kept |
| `status-neutral-text` | `gray-600` | Transfers, zero, unchanged as text |
| `status-neutral-fill` | `grey-fill` | Neutral dots/indicators — kept |
| `status-warning-text` | `amber-700` | Estimates/caution (ESTIMATE badges) |

Pairing note: black passes AA on both neons and on lime-500 (18.07:1), so
badge text/icons on vivid fills use `accent`.

### 2.4 Accent (interactive / selected) — black; export's "brand" family

| Semantic token | References | Role |
|---|---|---|
| `accent` | `gray-950` | Primary interactive/selected |
| `accent-foreground` | `gray-0` | Text/icons on accent (21:1) |
| `accent-hover` | `gray-800` | Hover/pressed lift |

### 2.4b Interaction & elevation

| Semantic token | Value | Role |
|---|---|---|
| `scrim` | `gray-900` at **40%** | Modal overlay (**was 20%** — export value adopted; owner eye pass at Checkpoint B) |
| `focus-ring` | `accent` at 30% | **KEPT** — export's 16% shadow variant rejected (owner deviation; 33 call sites unchanged) |
| `shadow-raised` | `0 8px 24px rgb(0 0 0 / 0.08)` | Kept; elevation out of export scope |

### 2.5 Typography roles

Unchanged role names over the §1.5 scale: `font-display` (46), `font-title`
(30), `font-number-lg` (24 + numeric), `font-card-title` (20/500),
`font-subtitle` (18/500, new), `font-body` (16), `font-secondary` (14),
`font-body-sm` (13, new), `font-caption` (12), `font-micro` (11 uppercase),
`font-amount-*` (numeric variants, `tabular-nums` everywhere).

### 2.6 Density presets — unchanged

Comfortable/compact as before (card padding 24/16, control height 44/36…).

### 2.7 Radius roles — unchanged

`radius-card` 20 · `radius-input` 12 · `radius-badge` 8 · `radius-pill` full.

### 2.8 Icon roles — unchanged

`icon-inline` 14 · `icon-default` 16 · `icon-ui` 20 · `icon-feature` 24 ·
stroke 1.5.

---

## Tier 2 additions (adopted 10-22C, **no component consumes these yet**)

Each future adoption is its own reviewed unit; the tokens exist so those units
need no frozen-path edits.

| Family | Tokens | Notes |
|---|---|---|
| **Highlight** (export "accent", renamed — lime) | `highlight`, `-hover`, `-active`, `-foreground` (black), `-subtle`, `-border` | FILLS ONLY, never text on light; ration 1–3 per screen |
| **Money extensions** | `money-positive-strong/-bg/-border`, `money-negative-strong/-bg/-border`, `money-neutral-strong`, `money-symbol`, `money-decimals` | Pill treatments + digit dressing; `money-symbol` **deviates to `gray-500`** (§5) |
| **Links** | `text-link` (olive-700), `text-link-hover` (olive-800) | Current links use `accent`; olive adoption is a future unit |
| **Brand-subtle** | `brand-subtle`, `brand-subtle-text`, `brand-border` | Quiet black-family emphasis |
| **Inverse / hero card** | `surface-inverse`, `-inverse-card`, `-inverse-raised`, `text-on-inverse`, `-secondary`, `border-on-inverse`, `money-positive-on-inverse` (lime), `money-negative-on-inverse` (red-400) | Max one inverse card per screen |
| **Chart** | `chart-accent`, `-strong`, `-strong-on-inverse`, `-hatch`, `-hatch-on-inverse`, `-muted`, `-muted-on-inverse` | Emphasis palette; categorical identity palette (10-07F Q8) remains open |
| **Status backgrounds** | `status-success-bg`, `status-error-bg`, `status-warning-bg`, `status-info-text/-bg`, `status-neutral-bg` | Pill/banner backgrounds for the existing status texts |

---

## Measured contrast (WCAG 2.x) — recomputed 2026-07-17 post-swap

| Token | Value | vs `surface` #FFF | vs `canvas` #F5F5F8 | AA ≥ 4.5 |
|---|---|---|---|---|
| `status-positive-text` | `#4D7C0F` | **4.99** | **4.59** | pass |
| `status-negative-text` | `#B42318` | **6.57** | **6.04** | pass |
| `status-warning-text` | `#93370D` | **7.52** | **6.91** | pass |
| `status-neutral-text` | `#55555D` | **7.38** | **6.79** | pass |
| `text-primary` | `#121215` | 18.70 | 17.18 | pass |
| `text-secondary` | `#55555D` | 7.38 | 6.79 | pass |
| `text-muted` | `#6F6F78` | 4.98 | 4.57 | pass |
| `money-positive-strong` | `#3F6212` | 7.08 | 6.50 | pass |
| `money-negative-strong` | `#912018` | 8.66 | 7.96 | pass |
| `money-symbol` / `money-decimals` | `#6F6F78` | 4.98 | 4.57 | pass |
| `text-link` | `#3F6212` | 7.08 | 6.50 | pass |
| `status-info-text` | `#3B3B42` | 11.11 | 10.21 | pass |
| `accent-hover` | `#232328` | 15.64 | 14.38 | pass |

Own-background pill pairs: olive-600/olive-50 **4.66**; red-600/red-50
**6.05**; amber-700/amber-50 **7.21**; gray-700/gray-100 **9.43**;
gray-600/gray-100 **6.27** — all pass. Inverse (on `gray-900`): white
18.70, lime-500 16.09, red-400 6.71 — all pass. Lime-500 as text on white:
**1.16 — fails by design; fills only.**

## §5 Deviations from the export (owner-ruled, 10-22C)

1. **Names:** export values adopted under REPO semantic names (option (a));
   the export's lime "accent" enters as `highlight-*` because `accent` here
   means black-interactive (51 component call sites).
2. **`money-symbol` at `gray-500`, not the export's `gray-400`** — 2.79:1
   is sub-AA and a currency symbol is information in a RON/EUR/USD ledger.
3. **`focus-ring` kept** (accent at 30%, ring utility) — export's 16%
   shadow variant rejected.
4. **Status fills kept** (`green-neon`, `red-neon`, `grey-fill`) — no export
   successor for vivid money dots/badges.
5. **`surface-raised` + `shadow-raised` kept** — elevation excluded from the
   export's scope.
6. **Weight 600 rejected** — Medium 500 stays the ceiling; G3 greps for
   regressions.
7. **Uppercase micro idiom OVERRULED vs the export's "no uppercase labels"**
   — the 27 uppercase call sites stand; only the tracking value (0.04em) was
   adopted.
8. **Hybrid font model, not the export's single face** — Urbanist adopted for
   UI text only; Geist kept for all numerals because Urbanist verifiably
   lacks `tnum` (10-20C gate evidence in that unit's report); the export's
   `--numeric-features` string not adopted. Corollary rule: money never
   renders in `--font-sans`.

## Flags / open points

- `surface-raised` shares white with `surface`; separation via
  `shadow-raised` (resolved earlier; unchanged).
- The type scale gap between 30 and 46 remains deliberate; do not improvise
  intermediate display sizes.
- **G4 gate gap (found 10-22C):** the G4 grep's palette list does not include
  `olive` — components using `text-olive-600` etc. would slip past it.
  Fix is an owner-ratified edit to `docs/review-standards.md` (its §6 rule),
  proposed at this unit's Checkpoint B — not silently patched here.
- Historical: Lufga replaced by Geist 2026-07-06 (`tnum` missing); unused
  `Lufga-*.otf` files in `src/fonts/` can still be deleted. Urbanist rejected
  2026-07-17 for the same defect (see Provenance).
