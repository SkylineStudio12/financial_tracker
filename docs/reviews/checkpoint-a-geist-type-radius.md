# Checkpoint A — Geist type scale, radius and elevation

Unit 2 of 2 of the Geist adoption. Unit 1 was the palette swap, recorded in
`docs/reviews/checkpoint-a-geist-palette.md` (commit `7e65640`).

Authored chat 23. Owner rulings ratified in chat 23. No brief exists yet; this
doc must be committed before one is authored (`L-0056`).

---

## 1. Source of record

Two published sources, both fetched 2026-07-27:

| Source | What it carries |
|---|---|
| `vercel.com/design.md` | Machine-readable token file. `version: alpha`. Concrete `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, radii, elevation. |
| `vercel.com/geist/typography` | Semantic usage guide. Role names, Tailwind class forms, Subtle/Strong mechanism. |

The two were compared. They agree on all 30 typography token names and on the
set. No contradiction found. Every literal in this doc comes from one of them.
Nothing is recalled.

**Deviation-marker series.** The palette doc owns `/* D1 */` to `/* D6 */` in
`globals.css`. This doc uses `/* T-D1 */` onward so a reader can tell which doc
a marker points at. Do not reuse the bare `D` series.

---

## 2. Owner rulings

| Id | Ruling |
|---|---|
| `T1` | Full Vercel DS adoption. Nothing is deleted for being currently unused. |
| `T2` | Legacy off-scale values take their nearest published Geist value. |
| `T3` | Custom tokens are permitted only where Geist does not serve the purpose at all. A value Geist already serves within a few px is not such a case. |
| `T4` | The `micro` 11px uppercase overrule is **withdrawn**. |
| `T5` | `display` 46px takes Geist 48. `title` 30px takes Geist 32. |
| `T6` | `--radius-input` splits into a control token and a menu token. |
| `T7` | G3 reversed. Headings move from weight 300 to Geist 600. |
| `T8` | Subtle and Strong values are out of scope here. Post-swap unit. |
| `T9` | The ten legacy role names survive as an **alias layer**. All 30 Geist tokens are defined alongside them. Call-site migration is a separate later unit. |

`T7` supersedes the ratified G3 ruling. The `--text-*` comment block at
`globals.css:142-148` asserts "export's 600 REJECTED (G3). Headings stay light."
That assertion is now false and must be replaced, not merely edited around.

---

## 3. Tracking: the px-to-em conversion is exact

Geist expresses `letterSpacing` in px at a stated size. The repo scale is in em.
This is not a lossy conversion. Every published heading resolves to one of three
exact em values:

| Geist sizes | Published px | em |
|---|---|---|
| 72, 64, 56, 48, 40 | -4.32, -3.84, -3.36, -2.88, -2.40 | **-0.06em** |
| 32, 24 | -1.28, -0.96 | **-0.04em** |
| 20, 16, 14 | -0.40, -0.32, -0.28 | **-0.02em** |

Rule: pick the band by size. Never transcribe a px literal across sizes.
Transcribing `-2.88px` onto a 30px title yields -0.096em, which is the failure
this table exists to prevent.

**Tracking is heading-only.** `copy-*`, `label-*` and `button-*` carry no
`letterSpacing` in the published file. Every non-heading role goes to zero.

---

## 4. Type mapping

Consumer counts from `23-02T`. "Prod" excludes `src/app/dev/`.

| Role | Current | Target | Published target values | Consumers (prod) |
|---|---|---|---|---|
| `display` | 46 / 300 / 50 / -0.01em | `heading-48` | 48 / 600 / 56 / -0.06em | 1 (0) |
| `title` | 30 / 300 / 36 / -0.005em | `heading-32` | 32 / 600 / 40 / -0.04em | 14 (12) |
| `number-lg` | 24 / — / 32 / -0.005em | **custom** `mono-24` | see `T-D1` | 4 (1) |
| `card-title` | 20 / 500 / 28 | `heading-20` | 20 / 600 / 26 / -0.02em | 17 (15) |
| `subtitle` | 18 / 500 / 24 | `label-18` | 18 / 400 / 20 | 0 |
| `body` | 16 / — / 24 | `copy-16` | 16 / 400 / 24 | 9 (8) |
| `secondary` | 14 / — / 20 | `copy-14` | 14 / 400 / 20 | 166 (~152) |
| `body-sm` | 13 / — / 18 | `copy-13` | 13 / 400 / 18 | 0 |
| `caption` | 12 / — / 16 / +0.005em | `label-12` | 12 / 400 / 16 | 126 (~114) |
| `micro` | 11 / — / 14 / +0.04em | `label-12` | 12 / 400 / 16 | 28 (23) |

Four map exactly with no visual change: `body`, `secondary`, `body-sm`,
`caption` (bar its 0.005em tracking).

**`label-14` versus `copy-14`.** Both are 14 / 400 / 20 in the published file,
metrically identical. Label is single-line, Copy is multi-line. The 166
`secondary` sites are mapped to `copy-14` wholesale because a wrong pick has no
visual cost. Per-site triage is a later refinement, not a blocker.

**`micro` and the caps idiom.** `label-12` is documented as carrying capitals
("the capitals in Calendars") and its example renders "AND CAPS". The uppercase
character therefore survives `T4`; only the 11px size and the +0.04em tracking
are lost. Existing `text-transform: uppercase` on those 23 sites is retained.

---

## 5. Token architecture: alias layer (`T9`)

`T1` says adopt everything. It does not say whether the ten legacy role names
survive. Two readings existed; the owner ruled the second.

**Reading A, rejected — replace.** Define the 30 Geist tokens as the type layer,
delete the ten role names, rewrite all 365 call sites to `text-copy-14`,
`text-label-12` and so on.

**Reading B, ratified as `T9` — alias.** Define all 30 Geist tokens. Keep the
ten role names as a thin alias layer pointing at Geist values. Call sites
unchanged. Migrate them in a separate later unit.

**Rationale, recorded so a future reader does not "correct" it.** Unit 1
succeeded because the swap was contained to `globals.css` entirely: forty
primitives changed, zero components touched, the whole change verifiable by
reading one file. Reading A couples a token swap that can be reviewed in one
file to a 365-site rename that cannot. Reading B preserves that property and
reaches the same end state one unit later. It also satisfies `T1` more
literally, since all 30 tokens exist and are consumable immediately, including
the ones nothing uses yet.

**Consequence for the Sol brief.** The type portion of the swap touches
`globals.css` and nothing else. Any edit outside that file is a stop condition.

---

## 6. Radius

Geist publishes four radii and assigns them by surface class: 6px everyday
surfaces and controls, 12px menus and modals, 16px fullscreen, 9999px pills.
The repo has four tokens assigned by component name, and two of them straddle
Geist categories.

| Token | Current | Target | Note |
|---|---|---|---|
| `--radius-card` | 20px | **6px** | 24 consumers stay. Two move, below. |
| `--radius-modal` | — | **12px** (new) | Takes `dialog.tsx:62` and `alert-dialog.tsx:58` off `--radius-card`. |
| `--radius-control` | — | **6px** (renamed from `--radius-input`) | Inputs, textareas, buttons, tabs, combobox, input-group, select trigger, sonner, alert. |
| `--radius-menu` | — | **12px** (new) | `popover.tsx:43`, `dropdown-menu.tsx:45,139`, `select.tsx:100`. |
| `--radius-badge` | 8px | **6px** | See `T-D4`. 43 consumers. |
| `--radius-pill` | 9999px | 9999px | Exact. 3 consumers. |
| `--radius-fullscreen` | — | **16px** (new) | No consumer yet. Defined per `T1`. |

`--radius-card` currently dresses both cards and modals. A flat 6px would put
dialogs at a spec-violating radius, on the exact two components `11-09M` is an
open fit check on. That is why the split in `T6` extends to modals, not only
inputs.

After this, three tokens hold 6px (`card`, `control`, `badge`). That is
acceptable at the semantic tier and mirrors the four-token `gray-900` collision
the palette doc already records. Note it; do not de-duplicate in this unit.

---

## 7. Elevation, and a hard sequencing constraint

The repo has **one** shadow token. Geist publishes three.

| Purpose | Published value |
|---|---|
| Raised cards | `0 2px 2px rgba(0, 0, 0, 0.04)` |
| Popovers, menus, tooltips | `0 1px 1px rgba(0,0,0,0.02), 0 4px 8px -4px rgba(0,0,0,0.04), 0 16px 24px -8px rgba(0,0,0,0.06)` |
| Modals, dialogs | `0 1px 1px rgba(0,0,0,0.02), 0 8px 16px -4px rgba(0,0,0,0.04), 0 24px 32px -8px rgba(0,0,0,0.06)` |

Current `--shadow-raised` is `0 8px 24px rgb(0 0 0 / 0.08)`. The Geist raised
value is roughly an eighth of that presence.

**The constraint.** `--color-surface-raised` and `--color-surface` both resolve
to `background-100`. A raised surface is distinguished from the page by shadow
alone. Geist can afford a near-invisible shadow because its elevation is
border-first: a `0 0 0 1px` translucent line, and `gray-alpha-400` borders on
surfaces. The repo has no such border on `card.tsx`.

If the shadow reduction ships without a card border landing in the same unit,
cards stop reading as cards. This is a correctness constraint on the swap, not a
polish follow-up. The border is component CSS on `card.tsx:15`, not a token
change, so it must be named explicitly in the Sol brief or it will be missed.

---

## 8. Recorded deviations

| Id | Deviation | Reason |
|---|---|---|
| `T-D1` | Custom mono token at 24px for `number-lg` | Money surfaces are required to use `--font-numeric`. Geist publishes mono at 14, 13 and 12 only. No Geist token can satisfy the requirement. Authorised by `T3`. |
| `T-D2` | `micro` folds into `label-12`; uppercase retained via `text-transform` | `T4`. Geist has no size below 12 and no label tracking. The caps idiom is native to `label-12`. |
| `T-D3` | `caption` loses +0.005em | Published labels carry no tracking. |
| `T-D4` | `--radius-badge` 8px becomes 6px | Geist publishes no 8px radius. Nearest is 6px. |
| `T-D5` | `subtitle` line-height 24 becomes 20 | Geist has no heading at 18. `label-18` and `copy-18` are equidistant at 20 and 28; label chosen because the role is a single-line subsection heading. Zero consumers, so zero visual risk. |
| `T-D6` | Three weights exist system-wide: 600 headings, 500 buttons, 400 copy | Geist's own rule is at most two weights **per view**, not per system. Its published tokens carry all three. Not a violation. Recorded because it looks like one. |

---

## 9. Out of scope

- Subtle and Strong values. The mechanism is a descendant `<strong>` selector
  inside a typography class. On Headings, Subtle renders as a lighter grey, a
  colour change. On Label and Copy, Strong renders heavier, a weight change.
  Two different mechanisms in one docs section, and `design.md` publishes values
  for neither. They must be read off Vercel's computed CSS, not inferred from a
  rendered screenshot (`L-0028`).
- The two-layer focus ring, `0 0 0 2px <surface>, 0 0 0 4px #006bff`. Component
  CSS. Note the inner layer is the **surface colour**, not literally white;
  `#ffffff` is correct only because `background-100` is white.
- Call-site migration, if Reading B is adopted.
- `--color-text-muted` / `--color-text-secondary` de-duplication (palette `D3`).
- `--font-numeric` is retained. It is the only record that money surfaces carry
  a tabular-figure requirement.

Items 1 and 2 belong together in one post-swap component-CSS unit.

---

## 10. Notes for the Sol brief

Not a brief. Constraints the brief must carry.

1. **Split by file boundary.** Token definitions in `globals.css` are one unit.
   Component CSS (`card.tsx` border, focus ring) is another. Call-site
   migration, if ruled, is a third and must be split further by directory.
2. **The `globals.css:142-148` comment block must be rewritten, not patched.**
   It asserts the G3 ruling `T7` reverses.
3. **Zero-residue greps are blind where old and new names collide.** `22-02S`
   hit this. `--radius-input` becoming `--radius-control` is a rename; a grep
   for `radius-input` is valid. Adding `--radius-menu` alongside is not
   detectable by absence.
4. **`11-09M` has no automated guard.** The Urbanist label-width assertion was
   deleted in `39e763f`. A Romanian three-segment label in Geist at 600 weight
   may exceed the 103.9px the deleted constant assumed. Owner eye-pass, not a
   test.
5. **Stop conditions must be phrased as "stop if completing this task would
   require an edit outside your file list"**, never as "stop if the grep finds a
   hit" (`L-0053`).

## 11. Published typography values (appendix)

Transcribed from `vercel.com/design.md`, tracking converted to em per section 3. Family is Geist Sans unless marked Mono.

| Token | px | weight | line-height | tracking |
|---|---:|---:|---:|---|
| heading-72 | 72 | 600 | 72 | -0.06em |
| heading-64 | 64 | 600 | 64 | -0.06em |
| heading-56 | 56 | 600 | 56 | -0.06em |
| heading-48 | 48 | 600 | 56 | -0.06em |
| heading-40 | 40 | 600 | 48 | -0.06em |
| heading-32 | 32 | 600 | 40 | -0.04em |
| heading-24 | 24 | 600 | 32 | -0.04em |
| heading-20 | 20 | 600 | 26 | -0.02em |
| heading-16 | 16 | 600 | 24 | -0.02em |
| heading-14 | 14 | 600 | 20 | -0.02em |
| button-16 | 16 | 500 | 20 | none |
| button-14 | 14 | 500 | 20 | none |
| button-12 | 12 | 500 | 16 | none |
| label-20 | 20 | 400 | 32 | none |
| label-18 | 18 | 400 | 20 | none |
| label-16 | 16 | 400 | 20 | none |
| label-14 | 14 | 400 | 20 | none |
| label-14-mono | 14 | 400 | 20 | none (Mono) |
| label-13 | 13 | 400 | 16 | none |
| label-13-mono | 13 | 400 | 20 | none (Mono) |
| label-12 | 12 | 400 | 16 | none |
| label-12-mono | 12 | 400 | 16 | none (Mono) |
| copy-24 | 24 | 400 | 36 | none |
| copy-20 | 20 | 400 | 36 | none |
| copy-18 | 18 | 400 | 28 | none |
| copy-16 | 16 | 400 | 24 | none |
| copy-14 | 14 | 400 | 20 | none |
| copy-14-mono | 14 | 400 | 20 | none (Mono) |
| copy-13 | 13 | 400 | 18 | none |
| copy-13-mono | 13 | 400 | 18 | none (Mono) |

`label-13-mono` line-height is 20 while `label-13` is 16. This is as published, not a transcription error. `heading-20` line-height is 26, off the 4px grid; also as published.
