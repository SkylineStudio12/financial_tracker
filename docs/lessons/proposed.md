# Proposed lessons — staging

Candidates awaiting owner ratification. **Agents APPEND ONLY.** No agent
edits or removes a block here, including its own. See "Where lessons live"
in `../lessons.md`. Nothing in this file is in force.

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

P-20260725-01 → L-0037 (ratified 2026-07-27)

P-20260725-02 → L-0038 (ratified 2026-07-27)

P-20260725-03 → L-0039 (ratified 2026-07-27)

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

P-20260725-04R → L-0057 (ratified 2026-07-27)

P-20260725-05 → L-0040 (ratified 2026-07-27)

P-20260726-01 → L-0041 (ratified 2026-07-27)

P-20260726-02 → L-0042 (ratified 2026-07-27)

P-20260726-03 → L-0043 (ratified 2026-07-27)

P-20260726-04 → L-0044 (ratified 2026-07-27)

P-20260726-05 → L-0045 (ratified 2026-07-27)

P-20260726-06 → L-0046 (ratified 2026-07-27)

P-20260726-07 → L-0047 (ratified 2026-07-27)

P-20260726-08 → L-0048 (ratified 2026-07-27)

P-20260726-09 → L-0049 (ratified 2026-07-27)

P-20260726-10 → L-0050 (ratified 2026-07-27)

P-20260727-01 → L-0051 (ratified 2026-07-27)
P-20260727-02 → L-0052 (ratified 2026-07-27)
P-20260727-03 → L-0053 (ratified 2026-07-27)
P-20260727-04 → L-0054 (ratified 2026-07-27)
P-20260727-05 → L-0055 (ratified 2026-07-27)
P-20260727-06 → L-0056 (ratified 2026-07-27)
