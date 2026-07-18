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
| L-0017 | process | Ambiguous continuation does not waive a STOP gate |
| L-0018 | provenance | Untracked material keeps its provenance label |
| L-0019 | review | Tier-3 checkpoint evidence must be durable in the repo |

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

### L-0017 · 2026-07-12 · process · ratified
**Lesson:** Ambiguous continuation phrasing does not waive a STOP gate.
**Apply:** If the owner's message can be read as anything other than explicit
approval, stop and ask.
**Origin:** Part 2 step 2 was committed before review on an ambiguous
continuation.

### L-0018 · 2026-07-12 · provenance · ratified
**Lesson:** Material without a tracked source or task-prompt mandate must be
flagged to the owner when carried into a document, never silently included or
compressed. Provenance labels travel with the material.
**Apply:** Surface the source and approval status before carrying such material.
**Origin:** The provisional model-tiering note was carried into the handover
refresh unflagged and its provenance label was dropped.

### L-0019 · 2026-07-12 · review · ratified
**Lesson:** Tier-3 checkpoint evidence must be durable in the repo.
**Apply:** Record at least one line per checkpoint in `docs/review-log.md` with
date, unit, checkpoint, verdict, and owner-approval timestamp; full reports are
optional for heavy units. Treat a Tier-3 commit with no review-log entry as ungated.
**Origin:** The 3f gate was honored but unprovable from the repo; evidence
survived only in a chat transcript.

## L-0021

An agent action taken past a STOP gate is unverified until the resulting
state is independently confirmed, regardless of the agent's own "done"
report.

Context: the five-step live-migration prompt gated every step on owner
approval. Codex committed 0009 (eb4b096) during the turn that was supposed
to stop at "ready to commit, awaiting approval," then reported the commit
as already done. The commit was the approval-gated action; it ran without
approval.

Rule: when an agent is found to have acted past a STOP, do not accept its
report of the action as evidence the action was correct. Verify the
committed or applied state directly (git status, file hash, journal
consistency, database row counts as applicable). The agent's self-report
and the actual state are separate claims. Same family as L-0017 and
L-0020: an agent's narration of its own compliance is a claim, not proof.

Corollary: after a STOP violation on a reversible step, tighten
supervision on every subsequent step rather than loosening it. An agent
that ran past a reversible STOP cannot be trusted to hold an irreversible
one on its own.

## L-0022

A review-log checkpoint row must distinguish what the migration file
contains from what a separate script does. Do not let a row imply an
artifact holds something it does not.

Context: the tax-config Checkpoint B row read "2026 confirmed seed," which
led owner and orchestrator to expect seed rows to appear on live when 0008
was applied. 0008 contains schema only; the seed is a separate path. The
apply succeeded and left tax_config empty, which read as a failure until
the artifact was inspected. Same family as the "committed vs approved"
drift and L-0019.

Rule: when a unit's schema and its seed/data population live in different
artifacts, the checkpoint row names both and states which one the verdict
covers. "Seed approved" is not "seed shipped in the migration."

## L-0023

Every agent prompt is addressed to exactly one named agent. Duplicate
delivery of one prompt to two agents produces double execution: conflicting
writes to shared files and context-switching inside in-flight units. When it
happens, the surviving artifact must be verified against both reports, and
the interrupted agent's unit state independently confirmed.

Incident 2026-07-17: management-UI rulings prompt executed by both CC and
Codex; CC misattributed an uncommitted file to commit 0845689, Codex's later
rewrite corrected it. Contradiction caught only because both reports landed
in the single orchestrator context.

## L-0024

Handover expected-state deltas are hypotheses. Reconcile against a verified
snapshot before treating a baseline mismatch as an anomaly; the recorded
delta, not the recorded count, is the likelier error.

Context: the 0012 apply STOPped on live counts 319/298/21 vs an expected
318/297/21; the discrepancy was chat-07's expected delta omitting the June
salary booking, not a live anomaly.

## L-0025

Dev-server database targeting is session state. Any DATABASE_URL override is
recorded when made; owner UI tests are attributed to a database, not assumed
to hit live.

Context: fired twice in two days — the management-UI test on 2026-07-16 and
the employee + July salary entry on 2026-07-17 both landed on the test DB
because the dev server had been started with DATABASE_URL overridden.

## L-0026

Prompt tier must be derived from the path-defined tier of files the unit will
plausibly touch, checked against review-standards.md at prompt-writing time,
not estimated from perceived difficulty.

## L-0027

Every data-driven card ships its empty and sparse states as the primary design;
dense is earned. No zero-filled or sample-data charts, ever.

## L-0028

A font-feature claim in a design handoff is verified against the delivered
binaries before any adoption step — GSUB tags + digit advances, with a
known-good control font validating the method.

## L-0029

**Gated actions execute only on PROMPT-KEY'd briefs.** An informal owner
imperative addressed to an agent ("push", "commit", "go ahead") signals that a
brief is coming; it is not itself authorization. When an agent holds a
pending gated action and receives an informal imperative, it holds and asks
for the prompt key. Ratified 2026-07-17 after the double-channel push
incident (10-27C), where an informal "Push" and the gated brief authorized
the same action through two channels.
