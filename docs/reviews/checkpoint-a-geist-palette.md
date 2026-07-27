# Checkpoint A — Geist palette swap (colour + font family)

Owner-ratified 2026-07-27. Rulings R1–R8.

Source of truth for every literal below: `https://vercel.com/design.md`,
Vercel's published machine-readable Geist token file, **Light theme**.
No value in this document is recalled or inferred. Dark theme is out of scope.

Scope of the unit this document specifies: colour primitives, colour semantic
tokens, and the `--font-sans` family. **Type scale, radius, and shadow are NOT
in this unit** (ratified R6/R7, deferred to a second unit).

---

## Rulings applied

| # | Ruling |
|---|---|
| R1 | Pure black is dropped. Accent becomes `gray-1000 #171717`. |
| R2 | Geist publishes no primary-hover value. `accent-hover` steps down to `gray-900`. Recorded as deviation D4. |
| R3 | The lime family is deleted. Its two real consumers are remapped. |
| R4 | Links adopt Geist blue. |
| R5 | Money numerals stay Geist **Sans** (tnum binary-verified at the 10-20C gate). Geist Mono not adopted. |
| R6 | Heading weight and tracking adopt Geist. **Second unit.** |
| R7 | Radius adopts Geist (6 / 12 / 16 / 9999). **Second unit.** |
| R8 | Primitive tokens adopt Geist names, so the block is diffable against the published source. |

---

## Primitive tier: 41 tokens out, 24 in

Only steps this system actually consumes are defined. Full 10-step scales
would reintroduce dead tokens, which is what the deletion below removes.
Every one of the 24 is consumed by at least one semantic token; verified
by hand against the semantic table.

### Deleted (all 41)

All `--color-gray-0/25/50/100/200/300/400/500/600/700/800/900/950`,
all `--color-lime-*` (6), all `--color-olive-*` (7), all `--color-red-*` (7),
all `--color-amber-*` (5), and `--color-green-neon`, `--color-red-neon`,
`--color-grey-fill`.

Nine of these had **no semantic consumer at all** before the swap and were
already dead code: `gray-25`, `lime-50`, `olive-100`, `olive-500`, `red-100`,
`red-500`, `amber-100`, `amber-200`, `amber-600`. They are named here so the
deletion is not mistaken for a mapping omission.

`--color-grey-fill` was also the only token in the file spelled `grey` while
thirteen others were spelled `gray`. The inconsistency dies with it.

### New primitive block

```css
  /* Wipe Tailwind's default palette so only system colors exist. */
  --color-*: initial;

  /* ---- Tier 1: primitives — Geist Light (vercel.com/design.md) ------- */
  /* Backgrounds are a scale DISTINCT from gray. Never interchange them. */
  --color-background-100: #ffffff;
  --color-background-200: #fafafa;

  /* Gray — consumed steps only */
  --color-gray-100: #f2f2f2;
  --color-gray-200: #ebebeb;
  --color-gray-500: #c9c9c9;
  --color-gray-600: #a8a8a8;
  --color-gray-700: #8f8f8f;
  --color-gray-800: #7d7d7d;
  --color-gray-900: #4d4d4d;
  --color-gray-1000: #171717;

  /* Blue — links and focus */
  --color-blue-700: #006bff;
  --color-blue-800: #0059ec;

  /* Green — money positive */
  --color-green-100: #ecfdec;
  --color-green-400: #b9f5bc;
  --color-green-600: #4ce15e;
  --color-green-900: #107d32;
  --color-green-1000: #003a00;

  /* Red — money negative */
  --color-red-100: #ffeeef;
  --color-red-400: #ffd7d6;
  --color-red-600: #ff676d;
  --color-red-900: #d8001b;
  --color-red-1000: #47000c;

  /* Amber — warnings */
  --color-amber-100: #fff6de;
  --color-amber-900: #aa4d00;
```

Geist step semantics, for anyone extending this later:
`100` default background · `200` hover background · `300` active background ·
`400` default border · `500` hover border · `600` active border ·
`700` solid fill · `800` solid fill hover · `900` secondary text ·
`1000` primary text.

---

## Semantic tier

**Every semantic token name is unchanged except the six deletions.** Only the
right-hand side moves. This is why the swap stays contained to `globals.css`:
Q3 of 22-01T returned zero direct primitive references outside the token files.

```css
  /* Surfaces */
  --color-canvas: var(--color-background-200);
  --color-surface: var(--color-background-100);
  --color-surface-raised: var(--color-background-100);
  --color-surface-inactive: var(--color-gray-100);
  --color-border-hairline: var(--color-gray-200);
  --color-border-input: var(--color-gray-500);            /* D1 */

  /* Text */
  --color-text-primary: var(--color-gray-1000);
  --color-text-secondary: var(--color-gray-900);
  --color-text-muted: var(--color-gray-900);              /* D3 */
  --color-text-disabled: var(--color-gray-700);

  /* Status (finance) */
  --color-status-positive-text: var(--color-green-900);
  --color-status-positive-fill: var(--color-green-600);
  --color-status-negative-text: var(--color-red-900);
  --color-status-negative-fill: var(--color-red-600);
  --color-status-neutral-text: var(--color-gray-900);
  --color-status-neutral-fill: var(--color-gray-600);
  --color-status-warning-text: var(--color-amber-900);

  /* Accent */
  --color-accent: var(--color-gray-1000);
  --color-accent-foreground: var(--color-background-100);
  --color-accent-hover: var(--color-gray-900);            /* D4 */

  /* Interaction. shadow-raised is NOT touched in this unit. */
  --color-scrim: color-mix(in srgb, var(--color-gray-1000) 40%, transparent);
  --color-focus-ring: color-mix(in srgb, var(--color-blue-700) 30%, transparent);

  /* Money */
  --color-money-positive-strong: var(--color-green-1000);
  --color-money-positive-bg: var(--color-green-100);
  --color-money-positive-border: var(--color-green-400);
  --color-money-negative-strong: var(--color-red-1000);
  --color-money-negative-bg: var(--color-red-100);
  --color-money-negative-border: var(--color-red-400);
  --color-money-neutral-strong: var(--color-gray-1000);
  --color-money-symbol: var(--color-gray-900);            /* D2 */
  --color-money-decimals: var(--color-gray-900);          /* D2 */

  /* Links */
  --color-text-link: var(--color-blue-700);
  --color-text-link-hover: var(--color-blue-800);

  /* Brand-subtle */
  --color-brand-subtle: var(--color-gray-100);
  --color-brand-subtle-text: var(--color-gray-1000);
  --color-brand-border: var(--color-gray-500);

  /* Inverse / hero-card family */
  --color-surface-inverse: var(--color-gray-1000);
  --color-surface-inverse-card: var(--color-gray-1000);
  --color-surface-inverse-raised: var(--color-gray-900);
  --color-text-on-inverse: var(--color-background-100);
  --color-text-on-inverse-secondary: rgb(255 255 255 / 0.64);  /* D5 */
  --color-border-on-inverse: rgb(255 255 255 / 0.14);          /* D5 */
  --color-money-positive-on-inverse: var(--color-green-600);
  --color-money-negative-on-inverse: var(--color-red-600);

  /* Charts */
  --color-chart-accent: var(--color-blue-700);
  --color-chart-strong: var(--color-gray-1000);
  --color-chart-strong-on-inverse: var(--color-background-100);
  --color-chart-hatch: var(--color-gray-700);
  --color-chart-hatch-on-inverse: var(--color-gray-800);
  --color-chart-muted: var(--color-gray-200);
  --color-chart-muted-on-inverse: var(--color-gray-900);

  /* Status backgrounds + info pair */
  --color-status-success-bg: var(--color-green-100);
  --color-status-error-bg: var(--color-red-100);
  --color-status-warning-bg: var(--color-amber-100);
  --color-status-info-text: var(--color-gray-900);        /* D6 */
  --color-status-info-bg: var(--color-gray-100);
  --color-status-neutral-bg: var(--color-gray-100);
```

### Deleted semantic tokens (6, all from the highlight family)

`--color-highlight` · `--color-highlight-hover` · `--color-highlight-active` ·
`--color-highlight-foreground` · `--color-highlight-subtle` ·
`--color-highlight-border`

Safe to delete: the file's own comment records that no component consumes
them, and 22-01T Q3 confirms no component reaches a primitive directly.

Lime's two real consumers are remapped above:
`--color-chart-accent` to `blue-700`, `--color-money-positive-on-inverse`
to `green-600`.

---

## Recorded deviations from Geist

Every deviation is deliberate. A future reader must not "correct" these back
to the published step.

**D1 — `border-input` uses `gray-500 #c9c9c9`, not Geist's border step
`gray-400 #eaeaea`.** Geist inputs use a translucent `gray-alpha-400` border,
and the solid `400` step is far lighter than our current `#cdcdd4`. This app
is form-heavy financial entry. A near-invisible input border is a usability
regression, so the visual weight of the old border is preserved.
`brand-border` follows it for consistency.

**D2 — `money-symbol` and `money-decimals` use `gray-900 #4d4d4d`, not
`gray-700 #8f8f8f`.** The step-for-step mapping is `gray-700`, which is
roughly 3.1:1 on `#fafafa` and fails AA. The existing token carried an
explicit AA deviation for exactly this reason: a currency symbol is
information, not decoration. That ruling survives the swap.

**D3 — `text-muted` converges with `text-secondary` at `gray-900`.** Geist
publishes three text steps (`1000` primary, `900` secondary, `700` disabled);
this system has four. The remaining option for `muted` was `gray-700`, which
fails AA. The two tokens now hold the same value. De-duplicating them is a
follow-up, not part of this swap, so that this unit stays a values change.

**D4 — `accent-hover` uses `gray-900`.** Geist publishes no primary-button
hover value. `gray-alpha` cannot serve, because those tokens darken and the
accent is already the darkest token. One published step lighter is the
smallest derivable answer.

**D5 — `text-on-inverse-secondary` and `border-on-inverse` stay raw
white-alpha.** The Geist Light theme publishes no light-on-dark alpha tokens.
Unchanged rather than invented.

**D6 — `status-info` stays in the gray family.** Geist assigns blue to
informational states, but blue is now the link colour (R4) and info would
collide with it. The quiet-gray info treatment predates the swap and is kept.

---

## Font family

```css
@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-numeric: var(--font-geist-sans);
}
```

`--font-numeric` is **not deleted.** It already resolved to Geist, so nothing
about it changes mechanically. It is kept because it is the codebase's only
record that money surfaces carry a tabular-figure requirement, and because
the `.font-numeric` class still carries `tabular-nums`, which Geist Sans needs
in order to produce tabular figures. An amount rendered without it is still
a defect.

Urbanist is dropped. Its loader and its CSS variable come out of
`src/app/layout.tsx`. The hybrid-font comment block in `globals.css` describes
a model that no longer exists and must be rewritten, not left in place.

---

## Explicitly out of scope for this unit

- `--radius-*` roles. Geist is 6px everyday, 12px menus and modals, 16px
  fullscreen, 9999px pills. Current values are 20 / 12 / 8 / 9999.
- The `--text-*` type scale. Geist headings are weight 600 with tracking from
  -0.02em at 16px to -0.06em at 48px. Current headings are weight 300 with
  tracking near zero. This reverses the G3 weight ruling and needs saying in
  the doc where G3 lives.
- `--shadow-raised`. Geist raised cards are `0 2px 2px rgb(0 0 0 / 0.04)`
  under a border-first elevation philosophy. Current value is
  `0 8px 24px rgb(0 0 0 / 0.08)`.
- The Geist focus ring is two layers
  (`box-shadow: 0 0 0 2px #ffffff, 0 0 0 4px #006bff`). That is component CSS,
  not a token, so `--color-focus-ring` is only repointed here.
- `docs/design-tokens.md`, which `globals.css` claims to implement. It goes
  stale the moment this lands and needs its own documentation unit.

---

## Expected visual consequences worth an eye-pass

- Positive money at `green-1000 #003a00` will read close to black. That is the
  Geist scale being what it is, not a mapping error. Confirm it is legible as
  *green* and not merely dark.
- Negative money at `red-1000 #47000c` has the same property.
- Every primary button and selected state moves off pure black.
- Every text metric on screen changes when Urbanist leaves.

Do not spend a browsing session on this until the second unit lands. Radius
and type weight change the same surfaces again.
