<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Workflow: review gate + lessons ledger

Supervised loop — the owner accepts every unit of work and ratifies every
lesson; nothing reviews, learns, or commits autonomously.

1. **Before starting any unit of work:** read `docs/lessons.md` (rules +
   entries) so known gotchas are applied, not rediscovered. For every
   session-start pass, use `docs/session-start-verification.md` as the
   canonical checklist and report its read-only results before proceeding.
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

## Documentation policies

- New UI strings use next-intl keys with EN values. RO translation is
  deferred to the end-purge unit; the current `ro.json` EN-mirror is done by
  hand and pinned by test (no mirror script exists in the repo), preventing
  runtime breakage when a key is missing.
- L-0013's cache-cleared-`tsc` i18n rider is **SUSPENDED** for new feature
  units during development. It MUST be reinstated for the end-purge unit.
- The 14-02M category-icons unit predates the EN-values-only policy:
  `manage.icon*` and `errors.manage.categoryIconInvalid` are already
  RO-authored. The end-purge EN==RO identity grep correctly passes over
  them; do not "correct" those keys.

# Orchestration conventions

Every orchestrator prompt carries a key in its title:
`[chat]-[seq][tier]`, e.g. `09-06L` = chat 09, sixth prompt, Luna.
Tier letters: M = Sol medium, H = Sol high/max, T = Terra,
L = Luna, C = CC, F = Fable.
The prompt instructs the agent to open its report with
`PROMPT-KEY: <key>`. Rules:

- A report without a key is unattributed; the orchestrator asks
  before acting on it.
- A key whose tier letter does not match the agent that ran it is
  a tier-drift flag, raised immediately.
- A report answering multiple prompts echoes one key per prompt.
- The echo confirms correlation only, not compliance; STOP gates
  and review remain the compliance layer.

Tombstone: the tier-suffix clarification is CLOSED. T/M/H/L are Codex
tiers; only C and F are distinct agents. This was a one-time parallel-window
relay error in chat 11, not a notation ambiguity. Do not reopen it.
