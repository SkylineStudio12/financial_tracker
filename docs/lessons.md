# Lessons ledger

Process lessons for this repo — the gotchas that cost time once and must not
cost it twice. **Read this file before starting any unit of work.**

## Rules

1. **Read before work; propose after review.** Every task starts by reading
   this ledger. A review pass that surfaces a lesson ends with a *proposed*
   entry — it becomes `ratified` only after the owner approves it. The ledger
   is never appended to autonomously.
2. **Lessons only, not decisions.** Design and domain decisions live in
   `docs/design-tokens.md`, `docs/review-standards.md`, and commit messages.
   If an entry starts describing *what we chose*, it belongs there instead.
3. **Actionable or nothing.** Every entry carries a one-line **Apply** — the
   thing to actually do. No war stories.
4. **Capped.** An entry is at most ~6 lines. If it needs more, it's probably
   a doc, not a lesson.
5. **Dedup before append.** If an existing entry covers the ground, strengthen
   it (with owner approval) rather than adding a near-duplicate.
6. **Supersede, don't rewrite.** A wrong lesson gets a new entry that
   supersedes it (`status: superseded by L-NNNN`); history stays honest.

## Index

| ID | Category | Lesson (short) |
|---|---|---|
| L-0001 | styling | Focus states are part of "done" for interactive elements |
| L-0002 | primitives | Every `shadcn` add/init must be reconciled to our tokens |
| L-0003 | primitives | Strip `dark:` and exit-animation classes from imported primitives |
| L-0004 | base-ui | Popups need the animations-disabled flag; refresh after close completes |
| L-0005 | react | `autoFocus` doesn't fire on hydration — focus via effect |
| L-0006 | verification | Headless tabs can't hold window focus — prove `:focus` via compiled CSS |
| L-0007 | process | One concern per commit; untangle mixed files before committing |
| L-0008 | verification | Synthetic pointer events need `pointerType: "mouse"` for Base UI |
| L-0009 | tooling | Token value changes require `rm -rf .next` — HMR won't pick them up |

---

### L-0001 · 2026-07-06 · styling · ratified (strengthened 2026-07-07)
**Lesson:** Form fields shipped without any focus state and passed several
reviews — absence of a state is invisible until you tab into it.
**Apply:** New interactive elements either compose `Button`/a primitive that
carries the ring, or copy the exact ring classes (`outline-none
focus-visible:ring-3 focus-visible:ring-focus-ring`); raw-class buttons and
`tabIndex` elements silently bypass the cva ring — sweep for them at review.
**Origin:** Phase-2 restyle stage 3 (`fieldClass`); baseline sweep 2026-07-07
(RowLink, popover rows, raw-class buttons).

### L-0002 · 2026-07-04 · primitives · ratified
**Lesson:** `shadcn` init/add injects a parallel oklch palette, a `.dark`
block, and breaks `--font-sans` — silently competing with our token system.
**Apply:** After ANY `shadcn` command: checksum `globals.css` (must be
unchanged), then reconcile the new component to semantic tokens before use.
**Origin:** Phase 2.6 init damage; gallery add ran with an md5 guard.

### L-0003 · 2026-07-04 · primitives · ratified
**Lesson:** Imported primitives carry `dark:` variants and `data-closed:*`
exit-animation classes that violate the light-first system and (with L-0004)
leave popups mounted forever.
**Apply:** On import, strip all `dark:` and `data-closed:*` classes and remap
shadcn colors to semantic tokens (shadcn `accent`→`surface-inactive` FIRST,
then `primary`→`accent`).
**Origin:** Gallery starter-set reconciliation script.

### L-0004 · 2026-07-04 · base-ui · ratified
**Lesson:** Base UI popups never unmount here (the animations-finished wait
hangs), and refreshing during the close animation cancels the unmount.
**Apply:** Popup components import `@/components/ui/base-ui-config` (sets
`BASE_UI_ANIMATIONS_DISABLED`); any `router.refresh()` after a close goes in
`onOpenChangeComplete`, never alongside `setOpen(false)`.
**Origin:** Phase 2.6 dialog debugging.

### L-0005 · 2026-07-04 · react · ratified
**Lesson:** `autoFocus` does not fire when the page hydrates from SSR, so
"focus the first field" silently no-ops.
**Apply:** Focus imperatively in a `useEffect` via a ref (see the forms'
`amountRef` pattern).
**Origin:** Entry-form focus bug, phase 2.6.

### L-0006 · 2026-07-06 · verification · ratified
**Lesson:** The headless preview tab never holds real window focus, so
`:focus`/`focus-visible` styles can't be exercised live and *look* broken.
**Apply:** Verify the rule exists in the served CSS (fetch + grep for the
compiled selector), state plainly that the live check remains for the owner —
never claim interactive verification that didn't happen.
**Origin:** Filter-pill search widen; form focus rings.

### L-0007 · 2026-07-06 · process · ratified
**Lesson:** Two concerns landing in one file (route move + restyle) makes a
single commit dishonest and history unreviewable.
**Apply:** One concern per commit. If a file mixes two, temporarily revert
one change set, commit, re-apply, commit — deterministic and clean.
**Origin:** Stage-3 routes vs list-restyle separation (466fc22/459962b).

### L-0008 · 2026-07-06 · verification · ratified
**Lesson:** Base UI triggers ignore synthetic pointer events unless the
`PointerEvent` init includes `pointerType: "mouse"` — the full
pointerdown→click sequence alone silently does nothing.
**Apply:** In `preview_eval` interaction tests, always dispatch the full
sequence with `pointerId, isPrimary, pointerType: "mouse"`.
**Origin:** Profile-switcher popover verification.

### L-0009 · 2026-07-06 · tooling · ratified
**Lesson:** Turbopack serves stale `@theme` token VALUES after edits to
`globals.css` — surviving HMR and even a dev-server restart.
**Apply:** After changing design-token values: `rm -rf .next`, then restart
the dev server, then re-verify computed styles in the browser.
**Origin:** shadcn type-scale remap (sizes stuck at old values).
