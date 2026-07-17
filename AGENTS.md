<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Workflow: review gate + lessons ledger

Supervised loop — the owner accepts every unit of work and ratifies every
lesson; nothing reviews, learns, or commits autonomously.

1. **Before starting any unit of work:** read `docs/lessons.md` (rules +
   entries) so known gotchas are applied, not rediscovered.
2. **When a unit is finished:** run the review pass in
   `docs/review-standards.md` — gate on the OBJECTIVE items (tsc, eslint,
   token greps, scope guard, checklist), answer the four JUDGMENT flags, post
   the report in its format, and wait for owner acceptance. Tier-3 paths
   (ledger service/actions/flow-actions, tax, fx, db, drizzle) escalate to
   the owner by default.
3. **Lessons:** the review may end with *proposed* ledger entries; the owner
   ratifies before anything is appended to `docs/lessons.md`.
4. **Commits:** the owner confirms every commit (message proposed first);
   one concern per commit.

# Orchestration conventions

Every orchestrator prompt carries a key in its title:
`[chat]-[seq][tier]`, e.g. `09-06L` = chat 09, sixth prompt, Luna.
Tier letters: S = Sol high/max, M = Sol medium, T = Terra,
L = Luna, C = Claude Code, F = Fable.
The prompt instructs the agent to open its report with
`PROMPT-KEY: <key>`. Rules:

- A report without a key is unattributed; the orchestrator asks
  before acting on it.
- A key whose tier letter does not match the agent that ran it is
  a tier-drift flag, raised immediately.
- A report answering multiple prompts echoes one key per prompt.
- The echo confirms correlation only, not compliance; STOP gates
  and review remain the compliance layer.
