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
