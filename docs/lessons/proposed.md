# Proposed lessons — staging

Candidates awaiting owner ratification. **Agents APPEND ONLY.** No agent
edits or removes a block here, including its own (L-0023: two writers on
one file need append-only discipline). Nothing in this file is in force.

Ratification is the owner's, in batch per checkpoint:

- **Yes** → the entry moves to its target file (`../lessons.md`,
  `claude-code.md`, or `codex.md`) with the next L-number, and the block
  here is replaced by one line: `P-… → L-nnnn (ratified <date>)`.
- **No** → `**Status:**` becomes `rejected: <one line why>` and **the block
  stays**. The rejected record is what stops a dead candidate from being
  re-proposed.

Ratified/rejected blocks older than ~90 days are pruned during a
consolidation pass. Format:

```
### P-YYYYMMDD-nn · proposed by <unit key> · target: shared|claude-code|codex
**Candidate:** <the lesson, max ~6 lines, same bar as a ratified entry>
**Evidence:** <commit hash / report key / file:line — at least one durable link>
**Status:** proposed
```

A candidate that contradicts an existing lesson must say so in its block;
if ratified it lands as a superseding entry (ledger rule 6), never as an
edit to the old one.

---

### P-20260725-01 · proposed by 20-14-LOOP (owner-supplied, label 2026-07-25-a) · target: shared
**Candidate:** A migration unit's gate must include applying the migration
to the TEST DB through the real migrator before STOP; "do not run against
any DB" is the wrong instruction (tsc cannot catch runtime catalog
dependencies).
**Evidence:** 20-04-U1 gate gap; defect surfaced only at 20-04.1's suite run
(trigger column-list dependency, 0018). Fix landed in `drizzle/0018_sharp_hulk.sql` (commit b5d86e3).
**Status:** proposed

### P-20260725-02 · proposed by 20-14-LOOP (owner-supplied, label 2026-07-25-b) · target: shared
**Candidate:** Any live-mutating command in a multi-agent, multi-database
session requires an explicit DB-target proof (echo DATABASE_URL + SELECT
current_database()) immediately before execution; an agent's or operator's
success impression is not proof of target.
**Evidence:** 20-06T FAIL (0018 believed applied, live untouched); resolved
20-07-U1.1 with targeting proof. Related: L-0025.
**Status:** proposed

### P-20260725-03 · proposed by 20-14-LOOP (owner-supplied, label 2026-07-25-c) · target: shared
**Candidate:** Repoint briefs for computed values must name value authority
and provenance linkage as separable roles when an FK pins provenance; "no
remaining reference" is unsatisfiable where a NOT NULL FK requires an id
lookup, while "no remaining RATE reference" is the achievable intent.
**Evidence:** 20-12-U3 gate (f) reframe (`tax_accruals.tax_rule_id` NOT NULL
FK to `tax_rules`). Same prompt-authoring family as L-0035.
**Status:** proposed

### P-20260725-04 · proposed by 20-14-LOOP · target: claude-code
**Candidate:** The subagent registry is resolved at session start, so a
`.claude/agents/*.md` file created mid-session is NOT invocable by name in
that same session (`Agent type '<name>' not found`). To exercise a
just-authored agent, either start a fresh session or invoke a
general-purpose agent instructed to read the definition file and adopt it;
the registry pickup itself must be re-verified in the next session.
**Evidence:** 20-14-LOOP Part D — `subagent_type: "unit-reviewer"` failed
immediately after creating `.claude/agents/unit-reviewer.md`; the fallback
produced the verdict.
**Status:** SUPERSEDED by P-20260725-04R below — the "needs a fresh session"
claim was falsified; original text kept for its observation history.

### P-20260725-04R · proposed by 20-17-PROP · target: claude-code
_Supersedes P-20260725-04 above._
**Candidate:** A newly created `.claude/agents/*.md` is not immediately
invocable by name, and pickup is NOT triggered by committing it — but it can
become resolvable later in the same session without a restart. The refresh
trigger is not understood. Therefore: probe the subagent by name first, fall
back to a fresh general-purpose agent that reads the definition if
unresolved, and RE-PROBE on later passes rather than assuming the earlier
failure still holds.
**Evidence:** 20-14-LOOP Part D (failed on create); 20-12.1-U3 gate f
(failed post-commit); 20-12.2-U3 (resolved mid-session, no restart).
**Status:** proposed

### P-20260725-05 · proposed by 20-14-LOOP · target: shared
**Candidate:** A relayed brief containing an unfilled placeholder (e.g.
"[paste X here when relaying]") is incomplete input: flag it and name the
substitute source before executing, never silently reconstruct or
paraphrase the missing material. Same family as L-0018 (provenance travels
with the material).
**Evidence:** 20-14-LOOP appendix relayed as
`[paste the full 20-12-U3 brief text here when relaying]`; the brief text
was sourced verbatim from the session transcript and the substitution
declared before the reviewer ran.
**Status:** proposed

### P-20260726-01 · proposed by 20-12.1-U3 · target: shared
**Candidate:** A test that exercises a *sibling* of the changed function
pins nothing. When a fix applies to N call sites of the same rule,
enumerate the sites and assert each one; verify the test fails with the
fix reverted at THAT site, not merely somewhere in the file.
**Evidence:** 20-12.1-U3 reviewer finding 1 — the fail-loud test covered
`previewDividend` (which never called `getActiveRule`, so it passed
pre-fix) while the actual F3 swap lived in `saveDividend`, leaving half
the change unpinned until a follow-up test was added.
**Status:** proposed

### P-20260726-02 · proposed by 20-12.1-U3 · target: shared
**Candidate:** A negative assertion (`doesNotMatch`) against a string that
never existed in the repo's history can never fail. When pinning a
corrected user-facing string, assert the *invariant* (the wrong framing is
absent in any form) and confirm with `git log -S` that the assertion could
ever have fired; a positive assertion that is a verbatim substring of the
implementation is close to a tautology.
**Evidence:** 20-12.1-U3 reviewer finding 3 — `/as the YTD basis/` appeared
nowhere in git history (the wrong wording was only ever in an uncommitted
tree); replaced with a ban on `\bYTD\b` framing.
**Status:** proposed

### P-20260726-03 · proposed by 20-21-U5 · target: shared
**Candidate:** A Postgres **enum** column orders by DECLARATION order, not
lexically, so `ORDER BY <enum col>` yields declaration order. Never pin a
lexical expectation against one; when the consumer regroups the rows anyway,
assert order-independently rather than pinning an incidental detail.
**Evidence:** 20-21-U5 — the viewer pin asserted alphabetical parameter order
and failed against `asc(taxConfig.parameter)`, which returned enum order.
**Status:** proposed

### P-20260726-04 · proposed by 20-21-U5 · target: shared
**Candidate:** A "repoint X so screen A agrees with screen B" brief must first
verify screen A actually DISPLAYS the disputed value. If it does not, the
repoint closes no visible contradiction and can add a failure mode to a path
that never shows the number — check the render site before accepting the
premise.
**Evidence:** 20-21-U5 reviewer finding 4 — `estimateDividendTaxes`' CASS was
computed, dropped by `estimateDividendAction`, and never rendered by
`trade-form.tsx`, while `resolveCassInvestmentBrackets` became fatal on that
panel's critical path (made non-fatal in 20-22-U5.1).
**Status:** proposed

### P-20260726-05 · proposed by 21-03 (owner-supplied, ratified for staging 2026-07-26) · target: shared
**Candidate:** A unit that temporarily edits a production file to demonstrate
a pin failing must record the file's content hash before the edit and prove
the identical hash after restoration. Greps and marker sweeps are indicative,
not conclusive: they confirm the absence of the specific string looked for,
not the absence of change.
**Evidence:** 21-01-U5.1-A restored two temporary edits to
`src/lib/ledger/queries.ts` and proved it by grep, with no pre-edit hash
available to compare against. The restoration was later confirmed by an
independent read (21-02T item 4, run in the owner's shell), which is the
available substitute but not equivalent to hash identity.
**Status:** proposed

### P-20260726-06 · proposed by 20-15-NIGHT · target: shared
**Candidate:** A guard that skips on "dirty tree" must EXCLUDE the job's own
output path, or the job self-disables from run two onward: run 1 leaves an
untracked artifact, run 2 sees it and skips, forever. Generalises to any
unattended job whose artifact lands inside the state it inspects. With git,
the exclusion also needs `-uall`, because `git status --porcelain` collapses
untracked directories and a pathspec exclusion cannot match the collapsed
entry.
**Evidence:** 20-15-NIGHT reviewer finding 2 — `scripts/nightly-audit.sh`
guarded on bare `git status --porcelain` while writing its docket to the
non-ignored `docs/briefs/reports/`; the shipped
`docs/briefs/reports/nightly-2026-07-26.md` listed `?? docs/briefs/` as its
own reason for skipping. Fixed before the STOP gate.
**Status:** proposed

### P-20260726-07 · proposed by 20-15-NIGHT · target: shared
**Candidate:** An unattended agent's "read-only" or "no edits" limit is
unenforceable while ANY general-purpose shell command sits in the allow list.
`sed -i`, `tee`, and any allowed command plus `>` redirection are write
vectors, so removing the Edit tool while pre-approving `Bash(sed:*)` or
`Bash(cat:*)` is theatre. Allow only commands whose write surface is bounded
by their own name, and let the read TOOLS serve reads.
**Evidence:** 20-15-NIGHT reviewer finding 1 — the launcher denied `Edit` and
excluded it from `--tools` while allowing `Bash(sed:*)`, `Bash(cat:*)`,
`Bash(grep:*)`; any of the three could have rewritten a tracked file at 2am.
**Status:** proposed

### P-20260726-08 · proposed by 20-15-NIGHT · target: shared
**Candidate:** For an unattended job, EVERY exit path must write to the
durable artifact the owner actually reads. When failures are recorded only in
a gitignored log, "the job failed" is indistinguishable from "cron never
fired" — and the most likely 2am failure is the environment itself (cron's
PATH is `/usr/bin:/bin`, so Homebrew binaries are absent). Verify tool
availability under a cron-shaped environment, not an interactive one.
**Evidence:** 20-15-NIGHT reviewer finding 3 — refusals and agent failures
exited 2/3/4 leaving no docket, and `command -v claude` under
`env -i PATH=/usr/bin:/bin` resolved nothing (`/opt/homebrew/bin/claude`).
Both fixed before the STOP gate.
**Status:** proposed

### P-20260726-09 · proposed by 20-15-NIGHT · target: shared
**Candidate:** Never cite a lesson id from memory. Grep `docs/lessons.md` for
the id and read the entry before invoking it, especially when the citation is
the justification for narrowing an owner instruction — a wrong id turns a
scope reduction into an unfounded one, and the ledger may say the opposite of
what the citation claims.
**Evidence:** 20-15-NIGHT reviewer finding 4 — the nightly brief refused to
append lesson candidates to `docs/lessons/proposed.md`, citing "append-only
discipline (L-0023)"; L-0023 is about one prompt delivered to two agents,
while the ledger's own rules preamble explicitly names `proposed.md` as the
one lessons file agents MAY append to. The narrowing was reversed.
**Status:** proposed

### P-20260726-10 · proposed by 21-10 (owner-supplied, ratified for staging 2026-07-26) · target: shared
**Candidate:** An append to an append-only ledger must anchor on a structural
feature (end of file, a section boundary, a footnote block) and never on a
token inserted into existing content. Inserting an anchor is a modification of
the thing the append-only rule protects, even when reverted.
**Evidence:** 21-04 planted a placeholder token in review-log row 20-12-U3 to
anchor an append, self-caught and reverted with byte-identity proved before
proceeding; the append then succeeded anchored on the footnote block.
**Status:** proposed
