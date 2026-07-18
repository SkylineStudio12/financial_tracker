# Review standards — the pre-accept gate

Every finished unit of work (a component, a page, a stage of a brief) gets a
review pass against this document **before the owner is asked to accept it**.
The reviewing agent **gates on OBJECTIVE items** (hard pass/fail, no
discretion) and **flags JUDGMENT items** (a short list the owner decides —
the agent never decides these). The gate is deliberately small and
high-confidence: five useful findings beat twenty minor notes. This is
process infrastructure for the review loop — the owner accepts every unit
and ratifies every lesson; nothing here runs or decides autonomously.

Related: `docs/lessons.md` (read before starting work), `docs/design-tokens.md`
(the design spec these rules encode).

---

## 1. Risk tiers — how much review a change earns

Tier by what the change **touches**, not by its size.

| Tier | Touches | Review depth |
|---|---|---|
| **1 — Styling / docs / gallery** | classNames, copy, docs, `/dev/components` | Objective gate + a judgment glance. No escalation by default. |
| **2 — UI behavior** | forms, navigation, dialogs, display queries, profile views | Objective gate + every JUDGMENT item explicitly answered in the report. |
| **3 — Money & data** | `src/lib/ledger/service.ts`, `src/lib/ledger/actions.ts`, `src/lib/ledger/flow-actions.ts` (posting/accrual math), `src/lib/tax/`, `src/lib/fx/`, `src/db/` (schema, seed — seed carries the fixed entity UUIDs the PROFILES config depends on), `drizzle/` | **Escalate to the owner by default.** The gate still runs, but passing it does NOT imply acceptance: the report must list every invariant touched (zero-sum, RON mirroring, accrual links, soft-delete) and the owner reviews the diff itself. |

A task brief can move a change up a tier, never down.

## 2. OBJECTIVE gate — hard pass/fail, agent decides

Run from the repo root. Any FAIL blocks the accept request until fixed or the
task brief explicitly authorized the deviation (quote the brief line in the
report).

### 2.1 Compiles and lints

```bash
npx tsc --noEmit          # must be clean (review-time, not the hook — see §5)
npx eslint <changed files> # must be clean
```

### 2.2 Token conformance — encoded as greps, not vibes

All four must return no matches on changed files (repo-wide shown; scope to
the diff when reviewing):

```bash
# G1 — no color literals outside globals.css (hex, rgb()/oklch(), arbitrary [#…])
grep -rnE '#[0-9a-fA-F]{6}\b|rgb\(|oklch\(|-\[#' src --include="*.tsx" --include="*.ts"

# G2 — no dark: variants (light-first system; dark mode is a token decision, not a class)
grep -rn 'dark:' src --include="*.tsx" --include="*.ts"

# G3 — weight ceiling is Medium (500); nothing heavier, ever
grep -rnE 'font-(semibold|bold|extrabold|black)' src --include="*.tsx" --include="*.ts"

# G4 — no raw Tailwind palette and no Tier-1 primitives in components
#      (components consume SEMANTIC tokens only; gray-### etc. live in globals.css)
#      olive added 2026-07-17 (10-25C, owner-ratified): the token adoption
#      introduced an olive ramp outside Tailwind's stock palette names.
grep -rnE '(bg|text|border|ring|fill|stroke)-(red|blue|green|slate|gray|zinc|neutral|stone|amber|yellow|lime|olive|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|orange)-[0-9]{2,3}' src --include="*.tsx"
```

Baseline 2026-07-06: all four CLEAN on the full tree. A new match is a
regression by definition.

### 2.3 Scope guard — no unauthorized Tier-3 or token changes

```bash
# Tier-3 paths in the diff require the task brief to have named them
git diff --name-only HEAD | grep -E 'src/lib/ledger/(service|actions|flow-actions)\.ts|src/lib/tax/|src/lib/fx/|src/db/|drizzle/'

# Design tokens are frozen unless the task IS a token task
git diff --name-only HEAD | grep -E 'src/app/globals\.css|docs/design-tokens\.md'
```

Matches with no authorizing brief line → FAIL (and Tier 3 escalation).

### 2.4 Checklist items (yes/no by inspection, still objective)

- [ ] Interactive elements added/changed have a visible focus treatment
      (`focus-visible:ring-*` / `focus-within:*` or a primitive that provides
      one). Headless tabs can't hold window focus — verify the rule exists in
      compiled CSS, state that the live check remains for the owner.
- [ ] Lucide icons use `absoluteStrokeWidth` + `strokeWidth={1.5}` (or the
      shared `ICON_PROPS`).
- [ ] Imported shadcn primitives were reconciled: semantic tokens only,
      `data-closed:*` exit-animation classes stripped, `base-ui-config`
      imported by popup components, `globals.css` untouched (checksum it).
- [ ] Tests present and passing **where applicable** — the repo has no test
      runner yet; this item activates for units that add one or that the brief
      says to test. Until then: "n/a (no test infra)" is a passing answer,
      inventing untested claims is not.
- [ ] New/changed routes respond (curl status check) and the browser console
      is error-free on the touched screens.

## 3. JUDGMENT flags — the owner decides, the agent only raises

Exactly four questions. The review report answers each in one or two
sentences — flag concerns, never resolve them silently.

1. **Design intent** — does the result actually look/behave like the brief or
   reference intended, beyond passing the token greps?
2. **Domain semantics** — do displayed meanings respect the standing domain
   rules: money color by *meaning* (transfers neutral, never red); no joint
   accounts; owner is a view filter, not a bookkeeping split; micro revenue
   tax accrues automatically on company income; every transaction write goes
   through the ledger service — single write path, imports included when they
   arrive (a bypass is also a Tier-3 escalation, not just a flag);
   tax_liability balance negative = owed; estimated tax figures carry the
   ESTIMATE marker?
3. **Abstraction fit** — is the code in the right place (config vs DB, page vs
   component, primitive vs one-off), and would the next task fight it?
4. **Scope deviations** — anything done beyond (or short of) the brief, even
   if it passed the gate; anything the implementer chose that the owner
   should get to veto.

## 4. The review report format

Posted at the end of each unit, before asking for acceptance:

```
REVIEW — <unit name> — Tier <1|2|3>
Objective gate: PASS | FAIL (item → detail)
  tsc ✓/✗ · eslint ✓/✗ · G1–G4 ✓/✗ · scope ✓/✗ · checklist ✓/✗
Judgment flags:
  1 Design intent: …
  2 Domain semantics: …
  3 Abstraction fit: …
  4 Scope deviations: …
Proposed lessons: none | <draft entries for docs/lessons.md — await ratification>
```

Tier 3 adds: `Invariants touched: <list>` and the explicit line
`Escalation: owner must review the diff — gate pass does not imply acceptance.`

## 5. The pre-commit hook (optional layer, objective-only)

Speed rule: **if the hook takes more than ~2 seconds it will get skipped and
then disabled** — so the hook runs only staged-file eslint + the four token
greps on staged files. Full `tsc --noEmit` stays at review time (§2.1); CI
can run the full gate later if/when this repo gets CI. The hook is always
skippable with `git commit --no-verify`; it enforces objective criteria only
and never the judgment layer. (Wiring is Stage 4 — not installed by this
document.)

## 6. Maintenance

This document changes only by owner-confirmed commit, like any other unit.
If a gate rule misfires (false positive that blocks honest work), the fix is
an owner-ratified edit here plus a lesson entry — not a silent skip.
