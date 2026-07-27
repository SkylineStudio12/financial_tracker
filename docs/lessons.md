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

## Where lessons live

This file is the **shared ratified ledger** and the master index for every
ratified lesson, whatever file it lives in. Alongside it:

- `lessons/claude-code.md` — ratified lessons scoped to the CC/Fable harness;
- `lessons/codex.md` — ratified lessons scoped to Codex agents;
- `lessons/proposed.md` — **staging**: candidates awaiting ratification, the
  only lessons file agents may write to, and append-only at that.

Scoping rule: a lesson is scoped only when it is about that harness's
*behavior or tooling*; domain, repo, and process lessons stay shared. When
in doubt, shared. One L-number sequence spans all ratified files, allocated
at ratification. Where a scoped lesson contradicts a shared one, the shared
one wins until the owner rules.

## Index

| ID | Scope | Category | Lesson (short) |
|---|---|---|---|
| L-0001 | shared | styling | Focus states are part of "done" for interactive elements |
| L-0002 | shared | primitives | Every `shadcn` add/init must be reconciled to our tokens |
| L-0003 | shared | primitives | Strip `dark:` and exit-animation classes from imported primitives |
| L-0004 | shared | base-ui | Popups need the animations-disabled flag; refresh after close completes |
| L-0005 | shared | react | `autoFocus` doesn't fire on hydration — focus via effect |
| L-0006 | shared | verification | Headless tabs can't hold window focus — prove `:focus` via compiled CSS |
| L-0007 | shared | process | One concern per commit; untangle mixed files before committing |
| L-0008 | shared | verification | Synthetic pointer events need `pointerType: "mouse"` for Base UI |
| L-0009 | shared | tooling | Token value changes require `rm -rf .next` — HMR won't pick them up |
| L-0010 | shared | assumption | Long-ref import dedup key: stability unverified AND coverage known-partial |
| L-0011 | shared | db | Partial unique index on a soft-deleted table must scope to live rows |
| L-0012 | shared | ledger | Generic ledger mutations must account for dependent structures |
| L-0013 | shared | tooling | i18n tsc key-completeness masked by incremental build cache |
| L-0014 | shared | i18n | Code-only error classes must convert all producers |
| L-0015 | shared | import | Verify external rate and ratio direction empirically |
| L-0016 | shared | assumption | Sample-based inferences must be labeled as hypotheses |
| L-0017 | shared | process | Ambiguous continuation does not waive a STOP gate |
| L-0018 | shared | provenance | Untracked material keeps its provenance label |
| L-0019 | shared | review | Tier-3 checkpoint evidence must be durable in the repo |
| L-0021 | shared | process | STOP-gated actions require independent state verification |
| L-0022 | shared | review | Checkpoint rows distinguish migrations from separate scripts |
| L-0023 | shared | process | One prompt is addressed to exactly one named agent |
| L-0024 | shared | verification | Handover state assertions are hypotheses pending verified snapshots |
| L-0025 | shared | tooling | Database targeting is session state and must be recorded |
| L-0026 | shared | process | Prompt tier follows the paths a unit may touch |
| L-0027 | shared | design | Empty and sparse states are the primary data-driven design |
| L-0028 | shared | verification | Verify font-feature claims against delivered binaries |
| L-0029 | shared | process | Gated actions require PROMPT-KEY'd briefs |
| L-0030 | shared | tooling | Worktree isolation separates committed from uncommitted deliverables |
| L-0031 | shared | tooling | Do not clean worktrees while agent sessions may be live |
| L-0032 | shared | react | Reset popup initial state on every open |
| L-0033 | shared | process | Orchestration requires a complete live-session register |
| L-0034 | shared | verification | Verification docs carry exact executable commands and queries |
| L-0035 | shared | process | Do not imply reversible symmetry without an accepted design |
| L-0036 | shared | i18n | Default Romanian routes require bilingual keys at creation |
| L-0037 | shared | db | Migration gates run the real migrator against the test DB |
| L-0038 | shared | verification | Mutations require an immediate explicit DB-target proof |
| L-0039 | shared | process | Value authority and provenance linkage are separate roles |
| L-0040 | shared | provenance | Relayed placeholders are incomplete input |
| L-0041 | shared | verification | Assert every changed call site, not a sibling |
| L-0042 | shared | verification | Negative assertions must target invariants that existed |
| L-0043 | shared | db | Postgres enum ordering follows declaration order |
| L-0044 | shared | process | Verify a screen displays a disputed value before repointing it |
| L-0045 | shared | verification | Temporary production edits require byte-identity proof on restore |
| L-0046 | shared | tooling | Unattended dirty-tree guards exclude their own output |
| L-0047 | shared | tooling | Read-only limits require bounded shell commands |
| L-0048 | shared | tooling | Every unattended exit path writes the durable owner artifact |
| L-0049 | shared | process | Never cite a lesson id from memory |
| L-0050 | shared | process | Append-only ledgers anchor on structural features |
| L-0051 | shared | review | Prompt authors derive tier from touched paths |
| L-0052 | shared | review | Reviewer briefs need a rubric and at most one focus item |
| L-0053 | shared | process | STOP conditions describe required action, not matches |
| L-0054 | shared | verification | A gate must be capable of failing to provide evidence |
| L-0055 | shared | process | Withdrawn prompt keys remain visibly dead artifacts |
| L-0056 | shared | process | Confirm owner-side preconditions before relying on them |
| L-0057 | claude-code | tooling | Newly created subagents may resolve later without restart |

Every entry above and every entry below is `shared` except L-0057, which is
scoped to the Claude Code harness.

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

### L-0020 · NEVER ISSUED

This number was never allocated to an entry. L-0021 cites "L-0020" as being
about an agent's narration of its own compliance; that citation is
unresolvable. Verified absent 2026-07-27 across lessons.md,
lessons/claude-code.md, lessons/codex.md and lessons/proposed.md. Do not
reuse this number: reusing it would make L-0021's citation wrong in a new way
rather than correct.

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

Every state assertion in a handover is a hypothesis, not a fact. This covers
expected-state deltas, transaction counts, migration heads, and remote sync
state. Reconcile against a snapshot verified in the owner's shell before
treating a mismatch as an anomaly; the recorded assertion, not the observed
state, is the likelier error.

Context: the 0012 apply STOPped on live counts 319/298/21 against an expected
318/297/21; the discrepancy was chat-07's expected delta omitting the June
salary booking, not a live anomaly.

Strengthened 2026-07-27: chat 21's handover asserted "seven commits, all
pushed" while `git status -sb` reported ahead 1. The commit hash in the
handover was correct and the push claim was false.

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

## L-0030

The session harness launches agent sessions in isolated git worktrees under
.claude/worktrees/ by default. This is normal launcher behavior, not agent
misbehavior. Consequences: (1) COMMITTED work propagates — worktrees share
the repository, so approved commits reach main regardless of which tree the
session ran in. UNCOMMITTED deliverables do not — a design document awaiting
rulings exists only in that session's worktree. (2) A design agent's delivery
report is therefore not proof the artifact exists in the main tree. Procedure:
the agent reports the absolute path; the owner copies the file to the main
tree; the doc-commit unit verifies the file exists at the main-tree path
before editing anything. (3) When a delivery is accepted out-of-band
(rulings recorded directly in the repo), the originating session is left
holding a stale STOP gate. Never answer that gate with rulings — the agent
would revise its worktree copy, creating a divergent version of an
already-committed document (L-0023's double-write shape, in docs form). Send
an explicit closure instead: accepted, committed at <hash>, do not edit, end
session. Closing the orphaned session is part of the cleanup. (Firings: a
Fable session delivered import-inbox-checkpoint-a.md into a worktree while
the acceptance was committed at 0004519 out-of-band; a later Fable session
correctly STOPped on the worktree guard, confirming the harness pins
worktrees by default.)

## L-0031

Two session-environment rules. (1) Tier-drift detection by agents is post-hoc;
prevention is at relay time. Implementation-tier briefs (C/M/H keys) are never
relayed into a Fable window; the Fable window stays closed unless a design unit
is active. Drift onto Fable past a read-only phase is stopped and re-relayed,
not accepted — the 11-05C precedent covers read-only phases only. (2) Never
remove or prune a worktree while any agent session may be live: the harness
silently re-roots orphaned sessions into the MAIN working tree, dissolving the
sandbox mid-conversation. Worktree cleanup happens only when all agent sessions
are closed, and each worktree's `git status --porcelain` is diffed against
origin/main before removal. (Firing: the 11-11C gate check ran in a stale
worktree at 6e9ce82; worktrees were removed mid-session; the session's
close-out then reported pwd at the main tree, clean at 8cb90b4 — zero writes by
luck of timing, not by design.)

## L-0032

A Base UI popup's content stays mounted after close, so any per-open initial
state (visible month, focus target, `default*` props) must be controlled and
reset in `onOpenChange(true)`; `default*` props silently freeze at first open.
(Firing: the date-picker unit's calendar froze `defaultMonth` at first open —
type December, reopen, see July — and react-day-picker's `autoFocus` fired
before the popup subtree could take focus. Both fixed in-unit,
regression-pinned; ratified at the 11-11C Checkpoint B.)

## L-0033

The orchestrator can only serialize sessions it knows exist. Every relay of a
brief to any agent is reported to the orchestrator in the same breath — key,
agent, window — and the orchestrator maintains the live-session register in
the handover. Cleanup operations, "all sessions closed" attestations (L-0031),
and collision sequencing all check that register; an unregistered session
invalidates them. (Firing: 11-11C was relayed without a report and its
existence was lost; the worktree audit rediscovered the unit as 18 unexplained
dirty files, mid-cleanup, while an "all sessions closed" attestation was
already in force.)

## L-0034

Verification checklist steps must contain the exact executable command/query,
schema-qualified where applicable. A step describing what to check without
how forces improvisation, reintroducing the chat-memory dependency the doc
exists to remove. New verification docs get one full dry run before
ratification.

## L-0035

Prompt-authoring must not describe reversible-looking operations as symmetric
pairs unless the accepted design defines both directions. "Confirm/un-confirm"
and "book/un-book" imply a symmetry ledger operations rarely have — a booking
reverses through posting reversal, not a state toggle. Name each direction
against its design section.

## L-0036

The "EN-value keys during development, ro.json in bulk at end-purge" i18n
policy assumed English as the fallback locale. The app's default locale is
Romanian with NO configured fallback, so an EN-only next-intl key renders its
raw key path and throws MISSING_MESSAGE on the default route. Until an
EN-fallback is configured, new next-intl keys that render on a default-locale
route must be authored in BOTH locales at creation (bilingual-from-birth), not
EN-only. The end-purge deferral applies ONLY to keys that do not render before
the purge runs.

### L-0037 · 2026-07-25 · db · ratified
**Lesson:** A migration unit's gate must include applying the migration to the
test DB through the real migrator before STOP.
**Apply:** Gate every migration unit on a real migrator run against
`financial_tracker_test`. "Do not run against any DB" is the wrong
instruction: `tsc` cannot catch runtime catalog dependencies.
**Origin:** 20-04-U1 gate gap. The trigger column-list dependency in 0018
surfaced only at 20-04.1's suite run. Fix in `drizzle/0018_sharp_hulk.sql`
(b5d86e3).

### L-0038 · 2026-07-25 · verification · ratified
**Lesson:** A live-mutating command needs an explicit DB-target proof
immediately before execution.
**Apply:** Echo `DATABASE_URL` and run `SELECT current_database()` in the same
shell, immediately before the mutating command. An agent's or operator's
impression of success is not proof of target. Related: L-0025.
**Origin:** 20-06T FAIL, 0018 believed applied while live was untouched;
resolved at 20-07-U1.1 with targeting proof.

### L-0039 · 2026-07-25 · process · ratified
**Lesson:** Value authority and provenance linkage are separable roles; a
repoint brief must name which one it retires.
**Apply:** Where a NOT NULL FK pins provenance, "no remaining reference" is
unsatisfiable. Write the achievable intent instead: "no remaining RATE
reference." Same prompt-authoring family as L-0035.
**Origin:** 20-12-U3 gate (f) reframe, `tax_accruals.tax_rule_id` NOT NULL FK
to `tax_rules`.

### L-0040 · 2026-07-25 · provenance · ratified
**Lesson:** A relayed brief containing an unfilled placeholder is incomplete
input.
**Apply:** Flag the placeholder and name the substitute source before
executing. Never silently reconstruct or paraphrase the missing material.
Same family as L-0018.
**Origin:** 20-14-LOOP relayed with `[paste the full 20-12-U3 brief text here
when relaying]`; the text was sourced from the transcript and the substitution
declared before the reviewer ran.

### L-0041 · 2026-07-26 · verification · ratified
**Lesson:** A test that exercises a sibling of the changed function pins
nothing.
**Apply:** When one fix applies to N call sites, enumerate the sites and
assert each. Verify the test fails with the fix reverted at THAT site, not
merely somewhere in the file.
**Origin:** 20-12.1-U3 finding 1. The fail-loud test covered `previewDividend`,
which never called `getActiveRule`, while the F3 swap lived in `saveDividend`.

### L-0042 · 2026-07-26 · verification · ratified
**Lesson:** A negative assertion against a string that never existed in the
repo's history can never fail.
**Apply:** Assert the invariant, not one wrong wording, and confirm with
`git log -S` that the assertion could ever have fired. A positive assertion
that is a verbatim substring of the implementation is near-tautological.
**Origin:** 20-12.1-U3 finding 3. `/as the YTD basis/` appeared nowhere in git
history; replaced with a ban on `\bYTD\b` framing.

### L-0043 · 2026-07-26 · db · ratified
**Lesson:** A Postgres enum column orders by declaration order, not lexically.
**Apply:** Never pin a lexical expectation against an enum column. Where the
consumer regroups the rows anyway, assert order-independently rather than
pinning an incidental detail.
**Origin:** 20-21-U5. The viewer pin asserted alphabetical parameter order and
failed against `asc(taxConfig.parameter)`, which returned enum order.

### L-0044 · 2026-07-26 · process · ratified
**Lesson:** A "make screen A agree with screen B" brief must first verify that
screen A displays the disputed value.
**Apply:** Check the render site before accepting the premise. If A never
shows the number, the repoint closes no visible contradiction and can add a
failure mode to a path that shows nothing.
**Origin:** 20-21-U5 finding 4. `estimateDividendTaxes`' CASS was computed,
dropped by `estimateDividendAction`, and never rendered, while
`resolveCassInvestmentBrackets` became fatal on that panel's path.

### L-0045 · 2026-07-26 · verification · ratified
**Lesson:** A unit that temporarily edits a production file to demonstrate a
pin must prove byte-identity after restoration.
**Apply:** Where the file is clean at HEAD, `git diff --quiet` is genuine
byte-identity and cheaper than a stored hash. Otherwise record the content
hash before the edit and prove the identical hash after. A grep confirms the
absence of the string searched for, not the absence of change.
**Origin:** 21-01-U5.1-A restored two edits to `src/lib/ledger/queries.ts` and
proved it by grep with no pre-edit hash; confirmed later by an independent
read at 21-02T item 4.

### L-0046 · 2026-07-26 · tooling · ratified
**Lesson:** A dirty-tree guard must exclude the job's own output, or the job
self-disables from run two onward.
**Apply:** Exclude the artifact path, and with git add `-uall`, because
`git status --porcelain` collapses untracked directories and a pathspec
exclusion cannot match the collapsed entry. Generalizes to any unattended job
whose artifact lands inside the state it inspects.
**Origin:** 20-15-NIGHT finding 2. `scripts/nightly-audit.sh` guarded on bare
`git status --porcelain` while writing to the non-ignored
`docs/briefs/reports/`; the shipped docket listed `?? docs/briefs/` as its own
skip reason.

### L-0047 · 2026-07-26 · tooling · ratified
**Lesson:** A "no edits" limit is unenforceable while any general-purpose
shell command sits in the allow list.
**Apply:** Allow only commands whose write surface is bounded by their own
name, and let the read tools serve reads. `sed -i`, `tee`, and any allowed
command plus `>` are write vectors, so denying Edit while pre-approving
`Bash(sed:*)` or `Bash(cat:*)` is theatre.
**Origin:** 20-15-NIGHT finding 1. The launcher denied Edit while allowing
`Bash(sed:*)`, `Bash(cat:*)` and `Bash(grep:*)`; any of the three could have
rewritten a tracked file at 2am.

### L-0048 · 2026-07-26 · tooling · ratified
**Lesson:** Every exit path of an unattended job must write to the durable
artifact the owner actually reads.
**Apply:** Never record a failure only in a gitignored log, or "the job
failed" becomes indistinguishable from "cron never fired." Verify tool
availability under a cron-shaped environment, not an interactive one: cron's
PATH is `/usr/bin:/bin`.
**Origin:** 20-15-NIGHT finding 3. Refusals exited 2/3/4 leaving no docket,
and `command -v claude` under `env -i PATH=/usr/bin:/bin` resolved nothing.

### L-0049 · 2026-07-26 · process · ratified
**Lesson:** Never cite a lesson id from memory.
**Apply:** Grep `docs/lessons.md` for the id and read the entry before
invoking it. This matters most where the citation justifies narrowing an owner
instruction: a wrong id turns a scope reduction into an unfounded one.
**Origin:** 20-15-NIGHT finding 4. The nightly brief refused a `proposed.md`
append citing "append-only discipline (L-0023)", while the ledger's own
preamble names `proposed.md` as the one lessons file agents may append to.
Fired again at 22-02S, where the orchestrator cited a non-existent L-0020.

### L-0050 · 2026-07-26 · process · ratified
**Lesson:** An append to an append-only ledger must anchor on a structural
feature, never on a token inserted into existing content.
**Apply:** Anchor on end of file, a section boundary, or a footnote block.
Inserting an anchor is a modification of the thing the append-only rule
protects, even when reverted.
**Origin:** 21-04 planted a placeholder token in review-log row 20-12-U3,
self-caught and reverted with byte-identity proved; the append then succeeded
anchored on the footnote block.

### L-0051 · 2026-07-27 · review · ratified
**Lesson:** A brief's tier is derived from the paths it touches, by the prompt
author, at authoring time.
**Apply:** Apply L-0026 when writing the brief, not when reviewing it. A tier
asserted in a header and corrected by the reviewer has already mis-scoped the
gates.
**Origin:** U5 was briefed Tier 2 while touching `src/lib/tax/`.

### L-0052 · 2026-07-27 · review · ratified
**Lesson:** A reviewer brief that asks for enumeration, historical
reconstruction, or multi-item deep dives is a research task in a review
costume, and costs accordingly.
**Apply:** Give a reviewer brief a rubric and at most one focus item.
Enumeration and reconstruction are separate units with their own budget.
**Origin:** 21-18C consumed roughly 135k tokens against a brief carrying four
named deep-dive items.

### L-0053 · 2026-07-27 · process · ratified
**Lesson:** A STOP condition must be expressed in terms of what would require
action, not what would produce a match.
**Apply:** Write "stop if completing the task would require editing a file not
authorized." Never write "stop if the grep finds a hit," which fires on
comments, definitions, and the unit's own completed work. A sweep for a
changed default must name the identifier, not the prop that consumes it.
**Origin:** Four spurious STOPs in one chat-22 unit. 22-03S V1 fired on
gallery demonstrations of both variants; the Urbanist sweep fired on comments;
22-03S.2 fired on the unit's own completed edits. Separately, 22-03S V1 swept
for `numericDayGrid` call sites and missed
`scripts/run-date-field-test.tsx:198`, which pinned
`DEFAULT_NUMERIC_DAY_GRID` by source text.

### L-0054 · 2026-07-27 · verification · ratified
**Lesson:** A gate that cannot fail is not evidence.
**Apply:** Before reporting PASS, state what result would have constituted
FAIL. If no such result exists, the gate proves nothing. Three recurring
shapes: a name-collision grep, a gate that never touches the deliverable, and
a comparison between two identifier spaces.
**Origin:** 22-02S. The residue grep could not distinguish a replaced from an
unreplaced value for the eleven tokens whose old and new names collide; the
full gate set passed identically for any hex value on a pure transcription
unit; 22-01T compared a Drizzle journal idx against a Postgres serial.

### L-0055 · 2026-07-27 · process · ratified
**Lesson:** A withdrawn brief remains a valid-looking PROMPT-KEY'd artifact,
and its withdrawal is invisible at relay time.
**Apply:** Either amend content under the same key, or name the dead key
explicitly in the replacement brief's header. Never leave two live-looking
keys for one change.
**Origin:** 22-02S.1 was withdrawn and relayed anyway. The agent executed it
correctly and stopped, costing a round trip.

### L-0056 · 2026-07-27 · process · ratified
**Lesson:** A brief must not depend on an owner-side manual precondition the
orchestrator has not confirmed.
**Apply:** Confirm the precondition first, or put the instruction in the same
message as the brief, stated as a numbered step rather than an aside. A file
the orchestrator generated is not in the repo until someone puts it there.
**Origin:** 22-02S.3 gated on `docs/reviews/checkpoint-a-geist-palette.md`
existing. The instruction to save it was mentioned twice in passing and never
confirmed; the P1 check stopped the unit on the third attempt.
