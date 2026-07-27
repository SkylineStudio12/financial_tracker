# Ratified lessons — Claude Code harness (CC / Fable)

Scope: lessons about **this harness's behavior or tooling** — session
mechanics, worktrees, subagents, memory, tool quirks. Domain, repo, and
process lessons belong in the shared ledger (`../lessons.md`). When in
doubt: shared.

**Owner-append-only.** Agents never write here; candidates go to
`proposed.md` and reach this file only through owner ratification. All
`../lessons.md` rules apply unchanged (actionable, ~6 lines, dedup before
append, supersede rather than rewrite). L-numbers come from the single
sequence shared with every ratified file; the master index in
`../lessons.md` lists every entry with its scope.

Conflict rule: where a scoped lesson contradicts a shared one, the shared
one wins until the owner rules; the reviewer flags the conflict rather
than either agent resolving it.

Read this file in full at session start (see
`../session-start-verification.md`, step 0.5).

---

L-0057 is the first ratified entry in this scoped file. Existing
harness-specific lessons (e.g. L-0030 worktrees, L-0031 session environment)
remain in `../lessons.md`; re-homing them is an owner-batched consolidation
decision, not automatic.

### L-0057 · 2026-07-25 · tooling · ratified · scope: claude-code
**Lesson:** A newly created `.claude/agents/*.md` is not immediately invocable
by name, committing it does not trigger pickup, and it can become resolvable
later in the same session without a restart.
**Apply:** Probe the subagent by name first. Fall back to a general-purpose
agent instructed to read the definition file. Re-probe on later passes rather
than assuming the earlier failure still holds. The refresh trigger is not
understood.
**Origin:** 20-14-LOOP Part D failed on create; 20-12.1-U3 gate f failed
post-commit; 20-12.2-U3 resolved mid-session with no restart. Supersedes
P-20260725-04, whose "needs a fresh session" claim was falsified.
