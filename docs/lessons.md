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
| L-0010 | assumption | Long-ref import dedup key: stability unverified AND coverage known-partial |
| L-0011 | db | Partial unique index on a soft-deleted table must scope to live rows |
| L-0012 | ledger | Generic ledger mutations must account for dependent structures |
| L-0013 | tooling | i18n tsc key-completeness masked by incremental build cache |
| L-0014 | i18n | Code-only error classes must convert all producers |
| L-0015 | import | Verify external rate and ratio direction empirically |
| L-0016 | assumption | Sample-based inferences must be labeled as hypotheses |

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

### L-0010 · 2026-07-07 · assumption · ratified
*(Deliberately exceeds the rule-4 length cap — owner call: the coverage gap
and the stability caveat are both load-bearing.)*
**Lesson:** Import dedup was designed to key off the ING long bank reference.
The first real statement shows that ref is present on only 6 of 17 rows — all
POS purchases, all fees, and the revenue credit carry no long ref. So the key is
both unverified for stability AND known-partial in coverage from day one.
**Apply:** The long-ref unique index and assertBatchExternalRefsUnique remain
correct but insufficient alone. Stage 4 MUST design an import identity for
refless rows before any real import — do not ship import relying on the long ref
as the sole key. If the batch guard ever throws on a genuine statement, stop and
diagnose whether a ref actually repeats or the parser misread it before changing
the key; do not assume a specific composite replacement.
**Origin:** Phase 3 — long-ref dedup settled in Stage 1, coverage gap found
against the real fixture in Stage 2.

### L-0011 · 2026-07-07 · db · ratified
*(Deliberately exceeds the rule-4 length cap — owner call: the
migration-safety corollary is owner-worded and load-bearing, kept whole
rather than compressed.)*
**Lesson:** The `external_ref` partial unique index was created with only
`WHERE external_ref IS NOT NULL`. On a soft-deleted table that permanently
blocks legitimate re-creation: a soft-deleted imported posting keeps its ref
reserved, so re-importing that same statement row can never book again.
**Apply:** A partial unique index on a soft-deleted table MUST include
`AND deleted_at IS NULL` in its predicate so the constraint binds only live
rows. When adding any unique index, ask "does a soft-deleted row here need to
free this key for re-creation?" — if yes, scope the predicate to live rows.
Migration-safety corollary: this scoping is effectively one-way. Once live and
deleted rows share a key under the scoped predicate, the un-scoped version can
no longer be rebuilt, so a down-migration that widens the predicate can fail on
real data — treat the widening rollback as unsafe, not routine.
**Origin:** Phase 3 Stage 4 — found while designing re-import safety; fixed in
migration 0003 with a delete-then-reimport regression test.

### L-0012 · 2026-07-07 · ledger · ratified
*(Deliberately exceeds the rule-4 length cap — owner call: the two failure
modes are owner-worded and load-bearing, kept whole rather than compressed.)*
**Lesson:** Generic ledger mutations (edit, delete) know nothing about the
structures other subsystems hang off transactions and postings — and each new
subsystem silently adds some. Three instances: form edits stripped import
external_refs (Stage-4 edit guard), soft-deleting a booked import left its
inbox row falsely "booked" (parked, policy pending), soft-deleting trades
required consumption cascade + a consumed-buy delete guard.
**Apply:** When a unit attaches dependent rows or semantics to transactions or
postings, that SAME unit must decide what every generic mutation path does to
them. Two failure modes to check for, because they need different fixes:
CORRUPTION — the mutation breaks integrity (strips a ref, orphans basis, drives
a balance negative) → add a guard or cascade in the single write service.
STALENESS — the mutation succeeds but a dependent view now misreports state (an
inbox row still says "booked" after its transaction is deleted) → propagate the
status or reconcile, or explicitly park the policy. Never leave the generic path
free to corrupt or strand the dependent structure silently. At review, ask: "what
happens when the owner edits or deletes this from the normal UI — does it corrupt,
or does it go stale?"
**Origin:** Phase 3 Stage 4 (edit guard); import delete stale-status (parked
2026-07-07); Phase 4 Stage 2 (lot-consumption delete integrity).

### L-0013 · 2026-07-09 · tooling · ratified
**Lesson:** next-intl types catalog keys from en.json, so a missing key (incl.
enum labels reached via typed-union template literals) is a tsc error — but
tsc's incremental cache served a stale CLEAN result after the key was deleted;
the error only surfaced once the cache was cleared.
**Apply:** For every i18n/catalog change, run the review-time tsc gate with the
incremental cache cleared (`rm -f tsconfig.tsbuildinfo .tsbuildinfo && npx tsc
--noEmit`); CI should run non-incremental.
**Origin:** i18n Stage 3b — enum-label completeness demo false-negatived, then
errored once cache-cleared.

### L-0014 · 2026-07-10 · i18n · ratified
**Lesson:** A "code-only" error class is only code-only if every producer emits
codes. Converting the named sites while leaving adjacent producers on prose
leaves the class carrying English through those paths — and the tsc
completeness guard cannot catch it, because the guard checks code-to-catalog
parity, not prose-to-code migration. The type guarantee is a facade until the
last prose producer is converted.
**Apply:** When converting an error class to codes, convert the whole class in
one unit. Scope the unit by class, not by file list. If a producer must stay
prose (e.g. IngParseError, by separate ruling), it must be a different class so
the code-only class stays strictly code-only.
**Origin:** i18n Stage 3f — LedgerValidationError also had producers in
adjacent import, tax, prices, valuation, and trade-rules files beyond the named
primary producers.

### L-0015 · 2026-07-11 · import · ratified
**Lesson:** Never assume the semantic direction of a rate or ratio column in an
external export.
**Apply:** Verify empirically against known historical values on at least three
rows spanning the date range, and lock the direction with a unit test fixture.
**Origin:** Revolut brokerage import — inverted FX-rate direction.

### L-0016 · 2026-07-11 · assumption · ratified
**Lesson:** Sample-based inferences in a design doc must be labeled as
hypotheses. Full-population computation or an external anchor supersedes them.
**Apply:** Treat sample findings as provisional until the full population or a
verified external anchor confirms them.
**Origin:** Revolut brokerage import — atypical fee sample and phantom-cash
prediction both overturned by full-data and live-account verification.
