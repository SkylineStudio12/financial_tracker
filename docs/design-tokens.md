# Design token foundation

Light-first, airy, number-forward. Off-white canvas, white cards floating on it,
black as the primary accent, green/red reserved for money status. This document
is the single source the app's central tokens file implements. Components use
**semantic tokens only** — never primitives.

Scope: color, typography, spacing, radius, density, iconography. No components.

---

## Tier 1 — Primitives

### 1.1 Neutral ramp (white → black, cool-tinted)

| Primitive | Value | Ramp role |
|---|---|---|
| `neutral-0` | `#FFFFFF` | Pure white (raw palette) |
| `neutral-50` | `#F5F6F8` | Soft off-white |
| `neutral-100` | `#EBEDEF` | Inactive grey (raw palette) |
| `neutral-150` | `#E3E6E9` | Hairline tone |
| `neutral-200` | `#D6DADE` | Stronger line / input border tone |
| `neutral-300` | `#B9BFC7` | Visible indicator grey |
| `neutral-400` | `#99A1AB` | Disabled text / placeholder tone |
| `neutral-500` | `#67707F` | Muted text tone |
| `neutral-600` | `#5C636E` | Secondary text tone |
| `neutral-700` | `#40454E` | Deep grey |
| `neutral-800` | `#26292E` | Near-black (hover on black) |
| `neutral-900` | `#141719` | Primary text tone |
| `neutral-1000` | `#000000` | Pure black (raw palette) |

### 1.2 Status primitives

| Primitive | Value | Origin |
|---|---|---|
| `green-neon` | `#86FF7B` | Raw palette ("ready green") — fills only |
| `green-700` | `#157A3C` | **Derived** text-safe green (same hue family, deepened) |
| `red-neon` | `#FF6262` | Raw palette ("alert red") — fills only |
| `red-700` | `#C93636` | **Derived** text-safe red (same hue, deepened) |

### 1.3 Spacing scale

Base unit **4 px**. Steps are multiples of the base; no off-scale values.

| Primitive | Value |
|---|---|
| `space-05` | 2 px |
| `space-1` | 4 px |
| `space-2` | 8 px |
| `space-3` | 12 px |
| `space-4` | 16 px |
| `space-5` | 20 px |
| `space-6` | 24 px |
| `space-8` | 32 px |
| `space-10` | 40 px |
| `space-12` | 48 px |
| `space-16` | 64 px |
| `space-20` | 80 px |

### 1.4 Radius scale

| Primitive | Value | Intended for |
|---|---|---|
| `radius-xs` | 4 px | Tiny chips, checkbox |
| `radius-sm` | 8 px | Badges, small controls |
| `radius-md` | 12 px | Inputs, buttons |
| `radius-lg` | 16 px | Popovers, small cards |
| `radius-xl` | 20 px | Cards (within the 16–24 target) |
| `radius-full` | 9999 px | Pills, avatars, status dots |

### 1.5 Type scale (fixed — do not extend)

Font: **Lufga**. The scale uses **Light (300)** and **Regular (400)**;
**Medium (500)** is the permitted ceiling for exceptional needs (owner
decision 2026-07-04) — semibold and bolder remain banned. Emphasis comes from
size and text-color tokens, never from weight. Fallback stack:
`Lufga, system-ui, sans-serif`.

**Verified (2026-07-04):** the project's Lufga cut has **no `tnum` feature and
proportional digits** ('1' = 375 units vs '0' = 643), so amounts cannot align
in pure Lufga. Decision: money values use the tabular companion font below;
Lufga covers all other text.

| Primitive | Value |
|---|---|
| `font-family-sans` | Lufga (Light 300 / Regular 400 / Medium 500) |
| `font-family-numeric` | Geist Sans — verified to ship `tnum` — with `font-numeric` enabled |

| Primitive | Size | Weight | Line height | Letter spacing | Notes |
|---|---|---|---|---|---|
| `type-52` | 52 px | 300 light | 56 px (1.08) | −0.01 em | Hero number |
| `type-31` | 31 px | 300 light | 36 px (1.16) | −0.005 em | Page/section title |
| `type-27` | 27 px | 400 regular | 32 px (1.19) | −0.005 em | Large number in cards |
| `type-21` | 21 px | 400 regular | 28 px (1.33) | 0 | Card title / subsection |
| `type-17` | 17 px | 400 regular | 24 px (1.41) | 0 | Body / default UI |
| `type-14` | 14 px | 400 regular | 20 px (1.43) | 0 | Secondary text |
| `type-12` | 12 px | 400 regular | 16 px (1.33) | +0.005 em | Small label / caption |
| `type-11` | 11 px | 400 regular | 14 px (1.27) | +0.06 em | Micro label, UPPERCASE |

Numeric feature primitive: `font-numeric` = `font-feature-settings: "tnum" 1, "lnum" 1`.

### 1.6 Icon primitives

Lucide. Stroke width is absolute (Lucide `absoluteStrokeWidth`), so it stays a
true 1.5 px hairline at every size.

| Primitive | Value |
|---|---|
| `icon-stroke` | 1.5 px |
| `icon-14` | 14 px |
| `icon-16` | 16 px |
| `icon-20` | 20 px |
| `icon-24` | 24 px |

---

## Tier 2 — Semantic tokens

### 2.1 Surfaces

| Semantic token | References | Role |
|---|---|---|
| `canvas` | `neutral-50` | Page background — soft off-white so cards float |
| `surface` | `neutral-0` | Card surface (pure white) |
| `surface-raised` | `neutral-0` | Popovers/menus above cards — separation comes from elevation shadow, defined in the component pass |
| `surface-inactive` | `neutral-100` | Inactive fills, disabled controls, skeletons |
| `border-hairline` | `neutral-150` | 1 px dividers and card outlines |
| `border-input` | `neutral-200` | Input and control borders (slightly stronger than hairline) |

Divider token: `divider` = 1 px solid `border-hairline`.

### 2.2 Text

| Semantic token | References | Role |
|---|---|---|
| `text-primary` | `neutral-900` | Headings, amounts, primary content |
| `text-secondary` | `neutral-600` | Supporting copy, table headers |
| `text-muted` | `neutral-500` | De-emphasized metadata, captions |
| `text-disabled` | `neutral-400` | Disabled labels, placeholders (decorative-level contrast, never for information) |

### 2.3 Status (finance)

Text variants are for money values rendered as text; fill variants are the
vivid tones for dots, small badges, and chart accents only.

| Semantic token | References | Role |
|---|---|---|
| `status-positive-text` | `green-700` | Income, gains, credits as text |
| `status-positive-fill` | `green-neon` | Positive dots/badges/chart accents |
| `status-negative-text` | `red-700` | Expenses, losses, debits as text |
| `status-negative-fill` | `red-neon` | Negative dots/badges/chart accents |
| `status-neutral-text` | `neutral-600` | Transfers, zero, unchanged as text |
| `status-neutral-fill` | `neutral-300` | Neutral dots/indicators (visible on white, unlike `neutral-100`) |

Useful pairing note: black passes AA **on** both neon fills (16.60:1 on green,
7.18:1 on red), so badge text/icons on neon fills should use `accent`.

### 2.4 Accent (interactive / selected)

| Semantic token | References | Role |
|---|---|---|
| `accent` | `neutral-1000` | Primary interactive/selected: buttons, active nav, selection |
| `accent-foreground` | `neutral-0` | Text/icons on accent (21:1) |
| `accent-hover` | `neutral-800` | Hover/pressed state (black can't darken, so it lifts) |

### 2.4b Interaction & elevation (added phase 2.6, owner-approved 2026-07-04)

| Semantic token | Value | Role |
|---|---|---|
| `scrim` | `neutral-1000` at 20% | Modal overlay (+ subtle backdrop blur at component level) |
| `focus-ring` | `accent` at 30% | 3 px focus-visible ring on interactive controls |
| `shadow-raised` | `0 8px 24px rgb(0 0 0 / 0.08)` | Elevation for `surface-raised` (dialogs, popovers) — resolves the deferred flag below |

### 2.5 Typography roles

| Semantic token | References | Role |
|---|---|---|
| `font-display` | `type-52` | Hero dashboard figure |
| `font-title` | `type-31` | Page/section titles |
| `font-number-lg` | `type-27` + `font-numeric` | Large card numbers |
| `font-card-title` | `type-21` | Card titles, subsections |
| `font-body` | `type-17` | Default UI text |
| `font-secondary` | `type-14` | Secondary text |
| `font-caption` | `type-12` | Small labels, captions |
| `font-micro` | `type-11` | Uppercase metadata rows |
| `font-amount-hero` | `type-52` metrics + `font-family-numeric` | Hero money figure |
| `font-amount` | `type-17` metrics + `font-family-numeric` | Amounts in rows/tables |
| `font-amount-sm` | `type-14` metrics + `font-family-numeric` | Amounts in dense tables |

All `font-amount-*` styles render in `font-family-numeric` (Geist Sans,
`tnum` on) at the type-scale sizes/line-heights, because Lufga's digits are
proportional. `font-number-lg` (27 px card numbers) also uses
`font-family-numeric` when the number sits in an aligned column; standalone
single figures may stay in Lufga for look, at the designer's discretion.

### 2.6 Density presets

Both presets reference the spacing scale — compact is a re-mapping, not new
numbers. Control heights are base-unit multiples (4 px × 11 / × 9).

| Semantic token | Comfortable | Compact |
|---|---|---|
| `density-card-padding` | `space-6` (24) | `space-4` (16) |
| `density-section-gap` | `space-8` (32) | `space-4` (16) |
| `density-row-padding-y` | `space-4` (16) | `space-2` (8) |
| `density-row-padding-x` | `space-4` (16) | `space-3` (12) |
| `density-stack-gap` | `space-4` (16) | `space-2` (8) |
| `density-control-height` | 44 px | 36 px |

Comfortable: dashboard and overview cards. Compact: transaction lists, tables,
entry forms.

### 2.7 Radius roles

| Semantic token | References |
|---|---|
| `radius-card` | `radius-xl` (20 px) |
| `radius-input` | `radius-md` (12 px) |
| `radius-badge` | `radius-sm` (8 px) |
| `radius-pill` | `radius-full` |

### 2.8 Icon roles

| Semantic token | References | Role |
|---|---|---|
| `icon-inline` | `icon-14` | Inside 12/14 px text lines |
| `icon-default` | `icon-16` | Row icons, buttons |
| `icon-ui` | `icon-20` | Nav, section headers |
| `icon-feature` | `icon-24` | Empty states, feature callouts |
| `icon-stroke-default` | `icon-stroke` (1.5) | All icons; matches hairline aesthetic |

---

## Measured contrast (WCAG 2.x)

Text-safe status variants, measured against both backgrounds:

| Token | Value | vs `surface` #FFFFFF | vs `canvas` #F5F6F8 | AA ≥ 4.5 |
|---|---|---|---|---|
| `status-positive-text` | `#157A3C` | **5.41 : 1** | **5.00 : 1** | pass |
| `status-negative-text` | `#C93636` | **5.17 : 1** | **4.78 : 1** | pass |
| `status-neutral-text` | `#5C636E` | **6.06 : 1** | **5.60 : 1** | pass |

Raw palette as text (why derivation was required):

| Raw value | vs white | vs canvas | Verdict |
|---|---|---|---|
| `#86FF7B` ready green | 1.26 : 1 | 1.17 : 1 | fails hard — fills only |
| `#FF6262` alert red | 2.93 : 1 | 2.71 : 1 | fails — fills only |

Regular text tokens (also verified):

| Token | Value | vs white | vs canvas |
|---|---|---|---|
| `text-primary` | `#141719` | 18.01 : 1 | 16.65 : 1 |
| `text-secondary` | `#5C636E` | 6.06 : 1 | 5.60 : 1 |
| `text-muted` | `#67707F` | 5.00 : 1 | 4.62 : 1 |
| `accent-foreground` on `accent` | white on black | 21 : 1 | — |
| `accent-hover` | `#26292E` | 14.59 : 1 | 13.50 : 1 |

## Palette adjustments made for contrast

1. **Green**: `#86FF7B` is a 1.26:1 near-white as text — unusable. Derived
   `green-700 #157A3C` (same hue family, deepened to AA with margin) for all
   textual money values; the neon stays as the fill/indicator tone.
2. **Red**: `#FF6262` reaches only 2.93:1. Derived `red-700 #C93636` for text;
   neon red stays for fills.
3. **Muted text**: a mid-grey around `#7A828E` (a natural ramp midpoint) only
   reaches 3.88:1, so `neutral-500` was pushed darker to `#67707F` (5.00 /
   4.62) — muted copy in a daily finance tool should still be genuinely
   readable.
4. `#EBEDEF` (raw inactive grey) is kept verbatim as `neutral-100` /
   `surface-inactive`, but it is too faint as a status indicator on white, so
   `status-neutral-fill` uses `neutral-300 #B9BFC7` instead.

## Flags / open points

- `surface-raised` shares `neutral-0` with `surface`; its separation depends on
  an elevation shadow to be defined in the component pass (no shadow tokens in
  this foundation).
- The type scale has no size between 31 and 52; if a screen ever needs an
  intermediate display size, that is a scale change to decide explicitly — do
  not improvise one.
- ~~Lufga must be loaded with `tnum` support confirmed.~~ **Resolved
  2026-07-04**: verified missing (no `tnum`, proportional digits); amounts use
  the Geist Sans companion (`font-family-numeric`), confirmed to ship `tnum`.
- The Lufga files came from a font-sharing site; confirm licensing before any
  public (non-local) deployment.
