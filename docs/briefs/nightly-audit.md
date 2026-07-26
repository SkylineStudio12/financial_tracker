# Standing brief — nightly audit (FINDINGS-ONLY v1)

PROMPT-KEY: NIGHT-[date]

This is a standing brief executed unattended by `scripts/nightly-audit.sh`.
The `[date]` token is substituted by the script before the prompt is handed
to the agent; echo the resolved key as line 1 of the report.

## Hard limits — v1

1. **TEST DB only.** Verify the sentinel before ANY database command: echo
   the connection target and confirm it names a `*_test` database. If it does
   not, stop and record the refusal. Never connect to `financial_tracker`.
2. **No commits.** No `git commit`, no `git add`, no `git push`, no tags, no
   branches, no stash, no checkout, no reset.
3. **NO FIXES, AND ONLY TWO WRITABLE PATHS.** v1 may write exactly two
   things: the new report at `docs/briefs/reports/nightly-[date].md`, and
   appended candidate blocks at the end of `docs/lessons/proposed.md`. Zero
   edits to anything else — no fixes, no formatting, no "obvious" one-liners,
   no README touch-ups, and no rewriting of an existing `proposed.md` block. A
   finding is the deliverable; a fix is not. Fix-on-branch mode arrives only
   by a later owner-ratified edit to THIS brief. The launcher enforces this by
   path-scoping the write tools, but the limit is yours to keep: do not reach
   for a shell command to do what the tools are scoped to prevent.
4. **Findings are claims, not verdicts** (L-0020/L-0021). Every finding cites
   `file:line` re-derived from the code in front of you. Nothing here gates
   anything; the owner rules in the morning.
5. **No network.** No web fetches, no package installs, no `npm i`.

## DIRTY-TREE GUARD — do this first

Run

```
git status --porcelain -uall -- . ':(exclude)docs/briefs/reports' ':(exclude)docs/lessons/proposed.md'
```

If it returns anything at all, write a report whose entire body is one line —
`skipped, dirty tree` plus the offending paths — and exit 0. Do not audit a
half-finished working tree: findings against uncommitted work are noise, and
the owner may be mid-unit. If the command itself ERRORS, stop and record the
refusal — a git error is not evidence of a clean tree.

Both exclusions are deliberate: the docket directory and `proposed.md` are
this job's own sanctioned outputs, and counting either as dirty would make the
job self-skip every night after its first productive one (an appended lesson
candidate is exactly such an output). The compensating visibility is the
staged-candidate count the launcher appends to every docket. `-uall` is
required: without that flag git collapses untracked directories to a single
entry and the exclusion cannot bite. Do not simplify this command back to a
bare `git status --porcelain`.

The launcher enforces this too, before spending a token. Both layers exist on
purpose; do not treat the launcher's check as making yours redundant.

## Environment posture — read before running the suite

The launcher exports a **deliberately unreachable** `DATABASE_URL` sentinel,
not the live URL and not the test URL. This is load-bearing:

- The DB-backed runners under `scripts/run-*.ts` read `DATABASE_URL` **only**
  to prove it is DISTINCT from `TEST_DATABASE_URL`, then hand their children
  `TEST_DATABASE_URL`. They never connect to it. The three component runners
  (`*.tsx`) never read it at all. The sentinel therefore satisfies the
  distinctness check while making a stray ad-hoc query fail to connect rather
  than reach live.
- `test:import-inbox-bulk` is the exception: it runs its test file directly
  and calls `requireTestDatabase`, so it needs `DATABASE_URL` pointed AT the
  test database. Run it as
  `DATABASE_URL="$TEST_DATABASE_URL" npm run test:import-inbox-bulk`
  and record the override in the report (L-0025).
  That command begins with an env assignment rather than `npm`, so whether the
  launcher's `Bash(npm run test:*)` rule matches it is **unverified**. If the
  call is denied, record it in the docket as *denied by tool policy, runner
  not exercised* — one named, visible gap. Never let it read as a pass, and
  never drop it from the count to make the numbers tidy.

This asymmetry is the documented runner-manifest gap from `21-02T`. Enumerate
every runner by name with its result; never report a bare count.

## Step 1 — LOAD

Read, in this order, and treat as the standing rubric:

1. `docs/lessons.md` — ratified ledger, rules plus every entry.
2. `docs/lessons/claude-code.md` — harness-scoped lessons.
3. `docs/review-standards.md` — the objective gate and the judgment flags.
4. `.claude/agents/unit-reviewer.md` — the review rubric this audit applies
   repo-wide rather than per-unit.
5. `docs/checkpoint-a-improvement-loop.md` — the parked plan and the
   ratified termination rule.
6. `docs/lessons/proposed.md` — so an already-staged candidate is not
   re-proposed as new.

## Step 2 — AUDIT (read-only)

Apply the unit-reviewer rubric to the whole repository, not to a diff.

1. **G1–G4 globally.** Run the review-standards token greps across all of
   `src/`, not just changed files. Report every hit with `file:line`.
2. **Every ratified lesson as a standing check.** Walk `docs/lessons.md`
   entry by entry and ask whether the repo currently violates it anywhere.
   This is the point of the exercise: a lesson that is never re-checked
   decays into a story. Name the lesson id against each finding.
3. **R2 data-safety invariants on money paths.** Integer minor units end to
   end; no float arithmetic outside display formatters; zero-sum postings;
   RON mirroring (`amountRon`) never confused with transaction-currency
   `amount`; half-open windows and bands; fail-loud over silent fallback.
4. **Docs-vs-code drift** (the olive-regex class): assertions in `docs/`
   about how the code behaves that the code no longer honours. Check the
   claims that are cheap to falsify — commands, file paths, flag names,
   counts, hook behaviour.
5. **TODO / orphaned-i18n sweep.** Inventory `TODO`/`FIXME`/`XXX`/`HACK`
   markers (no age attribution — `git log` is not in your tool ceiling; note
   that limit rather than guessing); `messages/en.json` keys with no consumer
   in `src/`; keys present in one locale and missing in the other. RO is the
   DEFAULT locale with no EN fallback (L-0036), so a missing RO key is a
   runtime break, not cosmetic.
6. **Cache-cleared tsc.** Delete `tsconfig.tsbuildinfo` and run
   `npx tsc --noEmit`. Report the exact output.
7. **Full isolated suite on the TEST DB**, every runner in `package.json`'s
   `test:*` family, using the environment posture above. Report each by name
   with pass / fail / denied-by-policy / killed-at-tool-cap, plus any residue
   assertion that fired.
   **Known limit:** your Bash tool caps a foreground command at 10 minutes,
   and this configuration has no background-retrieval path. A runner killed
   at that cap is `killed at the 10-minute tool cap — result unknown`, not a
   failure; record it as that named limit, never as a mystery.

## Step 3 — REPORT

Write `docs/briefs/reports/nightly-[date].md`. Structure:

```
PROMPT-KEY: NIGHT-<date>

## Verdict line
one sentence: what an owner needs to know before coffee

## Findings
| # | Severity | file:line | Finding | Proposed remedy | Needs ruling? |
severity: blocker | correctness | data-safety | hygiene | docs-drift
"Needs ruling?" = YES when the fix requires an owner decision rather than
mechanical work (a domain rule, a tax question, a UX choice).

## Suite
per-runner result, every runner named; tsc output; any L-0025 override used

## Lesson candidates
Full staging blocks in the `docs/lessons/proposed.md` format, or the explicit
line "Lesson candidates: none".
```

After you finish, the launcher appends one line to the docket: the count of
staged, uncommitted candidate blocks in `docs/lessons/proposed.md`, derived
from `git diff` outside your tool ceiling. That line is the compensating
visibility for the guard's `proposed.md` exclusion — do not duplicate it, and
do not remove it from a docket you are re-reading on a later night.

**Zero findings is a legitimate result.** If the repo is clean, say so in one
line and stop. Do not pad the table to look productive: a fabricated finding
costs the owner more than a missed one, because it burns the one resource
this loop runs on, which is trust in the docket.

**Lesson candidates go in the report AND are appended to
`docs/lessons/proposed.md`.** The ledger's own rule (`docs/lessons.md`, the
rules preamble) makes `proposed.md` the one lessons file agents may write to,
and append-only at that. So: append new blocks at the end of the file with the
next free `P-YYYYMMDD-nn` ordinal, and NEVER edit, reorder, reformat, or
delete an existing block, including one you wrote on a previous night. If the
ordinal you want is taken, take the next one; if you cannot append without
touching an existing block, put the block in the report only and say why.
Nothing you append is in force — the owner ratifies in batch.

## Close

Report and stop. Do not fix, do not commit, do not push, do not open a PR,
do not schedule follow-up work. The owner reads the docket in the morning.
