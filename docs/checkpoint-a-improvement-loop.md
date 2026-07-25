# Checkpoint A — Continuous-improvement loop (review agent + per-agent lessons)

Status: DRAFT (20-10P, Fable/CC, 2026-07-25). Design only — nothing here is
implemented, committed, or in force until owner rulings land. Zero file
overlap with the tax-cutover workstream (U2–U6).

Owner goal: every completed unit gets an automated agent review before the
owner gate, and lessons from every unit are captured, stored per-agent, and
loaded at session start — so the process compounds and the owner's role
narrows to rulings and batch ratification. Owner MECHANICS shrink; owner
AUTHORITY is unchanged.

---

## 0. What already exists (extend, don't duplicate)

This repo already has more of the loop than the source article's baseline.
Every overlap named explicitly:

| Existing artifact | What it already does | Gap this design fills |
|---|---|---|
| `docs/review-standards.md` | A full review rubric: risk tiers, objective gate (tsc/eslint/G1–G4 greps/scope guard/checklist), four judgment flags, a report format (§4) that already ends with `Proposed lessons:` | The pass is run by the **implementing agent on its own work**. L-0021's whole point is that an agent's narration of its own compliance is a claim, not proof. Missing: an *independent* reviewer reading the actual diff. |
| `docs/lessons.md` | Ratified shared ledger, 36 entries, with exactly the right governance rules: read-before-work, propose-after-review, owner-only ratification, actionable-or-nothing, ~6-line cap, dedup-before-append, supersede-don't-rewrite | No per-agent scoping; no durable **staging** area — proposals live in chat reports and rely on the owner catching them before the transcript scrolls away (the L-0019 failure shape, applied to lessons). No rejected-candidate record, so dead proposals can be re-proposed. |
| `AGENTS.md` workflow §1–4 | The unit lifecycle with review gate, lessons step, owner-confirmed commits; prompt-key discipline | Steps 1–2 don't name an independent reviewer or a staging file; nothing forces the closing report to carry a review verdict + lesson candidates. |
| `docs/session-start-verification.md` | Executable, tiered session-start checks (DB target, git, anchors) | Lessons-loading is in AGENTS.md step 1 but not in this executable checklist; per-agent lesson files don't exist to load. |
| `.githooks/pre-commit` (via `core.hooksPath`) | G1–G4 token greps on staged files, <2s, objective-only | Proof the loop is needed: **the hook has already drifted from its spec** — review-standards §2.2 G4 added `olive` on 2026-07-17 (10-25C); the hook's G4 regex still lacks it. Silent doc/artifact drift is exactly what a standing reviewer rubric line catches. |
| Claude Code native memory (`CLAUDE.md` → `@AGENTS.md` import; auto memory dir) | The project already uses the officially recommended import mechanism; CC/Fable sessions also carry a machine-local auto-memory directory | Auto memory is machine-local, not owner-ratified, and invisible to Codex agents — it must be subordinated to the repo ledger, not become a second brain (split-brain risk; see §4 and open question Q6). |

Also relevant, from the lessons ledger itself: L-0030/L-0031 (harness
worktrees — an uncommitted staging-file append in a worktree session may
never reach the main tree) and L-0023 (double-execution — two writers on one
staging file need append-only discipline).

## 1. Review agent

### 1.1 Form

A Claude Code **subagent** definition at `.claude/agents/unit-reviewer.md`
(read-only tools: Read/Grep/Glob/Bash for the gate commands; no Edit/Write).
The implementing session invokes it after implementation and **before**
composing the STOP-gate report. Subagents run in their own context window —
which delivers the independence requirement for free: the reviewer starts
blind.

Why a subagent and not a second orchestrated agent window: same-session, no
relay overhead, fresh context, and per the tombstone in AGENTS.md only C and
F are distinct agents anyway — a cross-vendor reviewer (Terra/Sol) stays
available as an owner-invoked escalation for Tier-3 money paths, not the
default (see Q1).

### 1.2 Inputs — evidence, never narration (L-0021)

The reviewer receives exactly:

1. the unit brief (prompt key + text, verbatim);
2. the actual diff (`git diff` / `git diff --cached` for the unit's touched
   files) and, where the unit produced runtime evidence, the raw artifacts
   (test logs, psql output files) — **not** the implementing agent's report;
3. `docs/review-standards.md` (the rubric source);
4. `docs/lessons.md` + the per-agent lessons file of the *implementing*
   agent (§2), so it can check the diff against ratified lessons.

The implementer's report is deliberately withheld. The reviewer re-derives;
it does not confirm.

### 1.3 Rubric — review-standards G1–G4 as the floor, three extensions

The existing objective gate runs unchanged (tsc, eslint, G1–G4 greps, scope
guard, checklist). On top, three passes the RSI article's reviewer motivates
(bugs and security caught before human review):

- **R1 Correctness pass** — read the diff for defects: off-by-one, inverted
  conditions, unhandled nulls, dead guards, transaction/locking mistakes,
  Postgres semantics (this repo's 0018 trigger-dependency defect is the
  archetype: tsc-clean, review-plausible, fails only against real catalog
  semantics — a reviewer instructed to trace every DDL statement against
  the live schema's dependents would have flagged it pre-gate).
- **R2 Data-safety pass (Tier 3 only)** — every invariant touched, checked
  in the diff itself: zero-sum postings, RON mirroring, soft-delete
  predicates on new indexes (L-0011), accrual links (L-0012), deferred
  trigger windows, single-write-path.
- **R3 Lessons-compliance pass** — does the diff violate any ratified
  lesson? (e.g. a new partial unique index without `deleted_at IS NULL` →
  L-0011 firing.) This is the compounding step: every ratified lesson
  becomes a standing reviewer check for free. Include doc/artifact parity
  when the diff touches specs that have enforcement twins (the G4/olive
  drift class).

### 1.4 Output — a verdict the owner reads in under a minute

Extends the §4 report format; the reviewer emits:

```
REVIEWER — <unit key> — Tier <n> — independent pass
Objective gate: PASS | FAIL (re-run by reviewer, not copied)
R1 correctness: CLEAR | n findings
R2 data safety: CLEAR | n findings (Tier 3)
R3 lessons compliance: CLEAR | n findings (cite L-nnnn)
Findings (max 5, severity-ordered): each = one sentence + file:line + why it fails
Verdict: LOOKS-SHIPPABLE | FINDINGS-FIRST   ← a CLAIM, not a gate
```

Hard rules: max five findings (review-standards' own "five useful findings
beat twenty minor notes"); every finding cites file:line evidence — a
finding without a citation is invalid; **the verdict gates nothing**. Per
L-0020/L-0021 it is a claim that informs the owner gate. If implementer and
reviewer disagree, both positions go to the owner verbatim; the implementer
never silently resolves a reviewer finding out of existence (it may fix and
re-run the reviewer, stating both rounds).

## 2. Lessons architecture

### 2.1 Files

```
docs/lessons.md              — shared ratified ledger (role unchanged) + master index
docs/lessons/claude-code.md  — ratified, scoped: CC/Fable harness + workflow lessons
docs/lessons/codex.md        — ratified, scoped: Terra/Sol/Luna (Codex) lessons
docs/lessons/proposed.md     — staging: candidates + rejected record (append-only for agents)
```

Deviation from the brief's sketch (cc/terra/sol/luna as four files),
flagged as Q2: AGENTS.md's own tombstone rules that T/M/H/L are Codex
*tiers*, not distinct agents — only C and F are distinct, and they share
the CC harness. Two scoped files match the real agent topology; four would
re-open the closed tier-suffix question and split lessons that apply to one
harness across files that must then be kept in sync.

Scoping rule: a lesson goes in a scoped file only when it is about that
harness/agent's *behavior or tooling* (L-0030 worktrees → claude-code.md;
L-0021 STOP-overrun → codex.md). Anything about the domain, the repo, or
the process goes in the shared ledger. When in doubt: shared. Existing
entries L-0001…L-0036 stay where they are — no migration churn; scoping
applies to new ratifications (a later consolidation pass may re-home the
few agent-specific ones, owner-batched).

Numbering: ONE L-sequence across all ratified files, allocated at
ratification time. The master index stays in `docs/lessons.md` and gains a
`scope` column (`shared | claude-code | codex`), so "read the index" still
means one file.

### 2.2 The staging file — durable proposals (L-0019 applied to lessons)

`docs/lessons/proposed.md` format, one block per candidate:

```
### P-YYYYMMDD-nn · proposed by <unit key> · target: shared|claude-code|codex
**Candidate:** <max 6 lines, same bar as ratified entries>
**Evidence:** <commit hash / report key / file:line — at least one durable link>
**Status:** proposed
```

- Agents APPEND only; never edit or remove another block (L-0023's
  double-writer discipline).
- Every unit's closing report includes its candidates **twice**: appended to
  `proposed.md` *and* verbatim in the report — because a worktree session's
  file append may not reach the main tree (L-0030); the chat copy is the
  fallback, the file is the system of record once committed.
- Ratification (owner, in batch): one yes/no per candidate. Yes → entry
  moves to its target file with the next L-number; the staging block is
  replaced by one line `P-… → L-nnnn (ratified <date>)`. No → status
  becomes `rejected: <one line why>` and the block STAYS — the rejected
  record is what prevents re-proposal. Staging is pruned of ratified/
  rejected blocks older than ~90 days during consolidation passes.

### 2.3 Loading at session start

Two mechanisms, matched to the two harnesses:

- **CC/Fable:** keep the existing rule (AGENTS.md step 1: read the ledger
  before any work) and make it *executable*: add step 0.5 to
  `docs/session-start-verification.md` — "Read `docs/lessons.md` index +
  every `shared` and `claude-code` entry touched paths may hit; read
  `docs/lessons/claude-code.md` in full; skim `proposed.md` for open
  candidates in your lane." Deliberately **not** a `@`-import in CLAUDE.md:
  imports load at launch into every session including trivial ones, the
  ledger is already ~450 lines and growing, and the official memory
  guidance is explicit that oversized always-loaded context reduces
  adherence. The read-step costs the same tokens only when a real unit
  starts, and the session-start checklist is already the enforced entry
  ritual. (Q3 offers the import variant if the owner prefers enforcement
  over context economy.)
- **Codex tiers (T/M/H/L):** they never see CLAUDE.md. The standing brief
  template (§3) carries the line: "Before work: read docs/lessons.md and
  docs/lessons/codex.md; apply, don't rediscover." This is already how
  lessons reach them today; it just gains the second file.

### 2.4 Dedup and conflict rules

Existing rules 5–6 stand (dedup before append; supersede, don't rewrite).
Two additions:

- **Cross-file conflict:** if a scoped lesson contradicts a shared one, the
  shared one wins until the owner rules; the reviewer flags the conflict
  (R3) rather than either agent resolving it.
- **Contradiction = supersession, never edit:** a candidate that
  contradicts an existing L-nnnn must say so in the candidate block and, if
  ratified, lands as a superseding entry (`status: superseded by L-mmmm`
  on the old one) — same as today, now enforced by the proposal format
  asking for it.

## 3. Loop integration — where each step fires

```
brief (keyed, carries lessons-read line)
  → implement
  → REVIEWER PASS (unit-reviewer subagent; Tier 1 LIGHT mode may skip, §4)
  → STOP-gate report — must now contain:
       • the reviewer's verdict block, verbatim
       • implementer response to each finding (fixed / disputed / deferred)
       • lesson candidates (or the explicit line "Lesson candidates: none")
         appended to proposed.md AND quoted in the report
  → owner gate (Checkpoint B unchanged)
  → owner-confirmed commit (unchanged)
```

Doc changes that make this automatic rather than remembered:

- **AGENTS.md** workflow §2 gains one sentence: "the review pass includes an
  independent reviewer run (`.claude/agents/unit-reviewer.md`) for Tier 2–3
  units; its verdict is a claim (L-0020/L-0021) and rides in the report."
  §3 gains: "candidates are appended to `docs/lessons/proposed.md` and
  quoted in the report; 'none' is stated explicitly."
- **review-standards.md §4** report format gains the `REVIEWER` block and
  the implementer-response lines shown above.
- **The standing brief template** (orchestrator side) gains two fixed lines:
  the lessons-read line (per harness) and "close with reviewer verdict +
  lesson candidates or 'none'."

Nothing else in the lifecycle moves. Prompt-key discipline, STOP gates,
Tier-3 escalation, owner commit confirmation: unchanged. No overlap with
U2–U6 files.

## 4. Safety rails

- **Lesson inflation.** Bar unchanged (rules 2–4: actionable, ~6 lines,
  lessons-not-decisions) plus: default ≤2 candidates per unit (more needs a
  sentence of justification); soft cap ~50 ratified lessons across all
  files — at the cap, each ratification names one existing entry to merge
  or retire in the same batch; a consolidation pass (owner-batched, ~per
  checkpoint) prunes staging and merges near-duplicates. Rationale: the
  ledger's value is that agents actually read and apply it; 300 trivial
  entries would kill exactly that (and blow the session-start token
  budget the loop is supposed to earn back).
- **Self-ratification — never.** Agents write ONLY to `proposed.md`, and
  only by appending. `docs/lessons.md` and the scoped files change only in
  owner-ratified commits. This is already ledger rule 1; the new files
  inherit it verbatim. Non-negotiable.
- **Review theater.** The reviewer (a) never receives the implementer's
  report, (b) re-runs the objective gate itself rather than trusting green
  claims, (c) must cite file:line per finding, and (d) reviews the diff and
  raw evidence artifacts. A reviewer output with no citations, or one that
  quotes the implementer's report, is discarded and re-run. The verdict
  gates nothing — L-0020/L-0021 are load-bearing here.
- **Cost, honestly estimated.** A reviewer pass reads the diff (typically
  <1k lines), two docs (~700 lines), and runs the gate commands: roughly
  30–80k input tokens and a few thousand output — single-digit minutes of
  wall time per unit, zero owner time. Against that: this project has
  already paid for late-caught defects several times (0018's trigger
  dependency found only at first execution; L-0011's index predicate;
  L-0032's frozen popup state). One caught Tier-3 defect repays months of
  reviewer passes. **LIGHT mode:** Tier-1 units (styling, docs, gallery)
  skip the subagent entirely — the implementer runs the objective gate and
  the candidates line, nothing else. Tier 2–3 get the full pass. The owner
  can order a HEAVY pass (cross-vendor second reviewer) for money-path
  units; it is never the default.
- **Amdahl's-law check (the article's warning, applied).** The binding
  constraint in this project is owner attention, not agent throughput.
  Every piece above is shaped to move owner time from *re-deriving* to
  *ruling on structured claims*: one-minute verdicts, batch ratification,
  a rejected-record so nothing is re-litigated. If a piece starts
  consuming owner attention instead of saving it, it fails the design's
  own test and §5's drop rule applies.

## 5. Rollout — staged, with a kill criterion per stage

1. **Stage 1 — lessons plumbing** (cheapest, ships first): create
   `docs/lessons/` (scoped files seeded empty + `proposed.md` with format
   header), add the master-index scope column, the AGENTS.md +
   review-standards + brief-template lines, and session-start step 0.5.
   One docs-tier unit, owner-gated as usual.
2. **Stage 2 — the reviewer**: add `.claude/agents/unit-reviewer.md`; run
   it on every Tier 2–3 unit starting with the next tax-cutover unit (U3
   is Tier 3 — ideal first target, high stakes, well-briefed).
3. **Stage 3 — prove it or shrink it**: the reviewer must produce ≥1
   owner-confirmed real finding (defect, invariant violation, or lessons
   breach — not a style nit) within its first 6 reviewed units. Hit →
   standing. Miss → demote to Tier-3-only. Two more misses over the next 6
   → drop the subagent, keep the lessons plumbing (which pays rent
   independently).
4. **Immediate proof-of-value micro-unit** (can precede Stage 1): fix the
   G4/olive drift in `.githooks/pre-commit` found during this design's
   research — the loop's first real catch, evidence that rubric-driven
   parity checks find true defects.
5. **Standing drop rule**: any piece that goes 10 consecutive units without
   one owner-actioned output is ceremony and gets cut by a one-line
   AGENTS.md edit (owner-gated, with a lesson recording why).

## 6. Sources

Repo: docs/lessons.md; docs/review-standards.md; AGENTS.md;
docs/session-start-verification.md; .githooks/pre-commit (via
`git config core.hooksPath`).

External: see the source summaries in the 20-10P report — Anthropic,
"Recursive self-improvement" (anthropic.com/institute); Claude Code docs,
"Memory" and "Subagents" (code.claude.com/docs); Anthropic, "Building
effective agents"; Shinn et al., "Reflexion" (arXiv:2303.11366).

## 7. Open questions for owner ruling

Numbered, each with a recommendation — listed in the 20-10P report and
mirrored here: Q1 reviewer form (recommend CC subagent, cross-vendor only
as Tier-3 escalation); Q2 scoped-file topology (recommend two files by
harness, not four by tier letter); Q3 loading mechanism (recommend
checklist step, not CLAUDE.md import); Q4 ratification cadence (recommend
per checkpoint); Q5 staging file committed per-unit vs batched (recommend
committed with each unit's docs commit); Q6 CC auto-memory subordination
(recommend: repo ledger canonical; auto memory restricted to harness
mechanics, never domain rules).
