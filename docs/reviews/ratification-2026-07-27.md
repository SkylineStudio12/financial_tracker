# Lessons ratification record — 2026-07-27

Owner-ratified in one sitting. This document is the source text for the
append; it is not itself a lessons file. Every entry below is final wording.

**Allocation:** L-0037 to L-0057. Twenty entries target `docs/lessons.md`.
One, L-0057, targets `docs/lessons/claude-code.md` and is that file's first
ratified entry.

**Format ruling:** new entries conform to ledger rules 3 and 4, so each
carries a one-line `Apply` and stays near six lines. L-0021 to L-0036 remain
in their existing freeform style; converting them is a separate unit.

**Verified before allocation:** `docs/lessons.md` bodies L-0001 to L-0036 with
no L-0020; `docs/lessons/claude-code.md` and `docs/lessons/codex.md` hold zero
ratified entries; no number above L-0036 exists anywhere.

---

## Part 1 — new entries for `docs/lessons.md`

Append in this order, after L-0036, anchored on end of file (L-0050 governs
this append).

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

---

## Part 2 — new entry for `docs/lessons/claude-code.md`

This is that file's FIRST ratified entry. The "no ratified entries yet" note
at claude-code.md:24-25 must be updated, not deleted: its second sentence
about L-0030 and L-0031 remaining in `../lessons.md` is still true.

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

---

## Part 3 — the L-0020 note

L-0020 was never issued. L-0021 cites it. Insert this block in
`docs/lessons.md` between the L-0019 entry and the `## L-0021` heading, in the
older heading style to match its neighbours.

```
### L-0020 · NEVER ISSUED

This number was never allocated to an entry. L-0021 cites "L-0020" as being
about an agent's narration of its own compliance; that citation is
unresolvable. Verified absent 2026-07-27 across lessons.md,
lessons/claude-code.md, lessons/codex.md and lessons/proposed.md. Do not
reuse this number: reusing it would make L-0021's citation wrong in a new way
rather than correct.
```

---

## Part 4 — strengthened L-0024

Ledger rule 5 permits strengthening an existing entry with owner approval
rather than adding a near-duplicate. Approved. L-0024 keeps its existing
freeform style; only its content broadens. Replace the entry body with:

```
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
```

---

## Part 5 — the L-0023 miscitation

`docs/lessons/proposed.md` lines 3 to 5 justify the append-only rule with a
parenthetical citing L-0023. Per L-0049's origin, that citation is wrong: the
actual authority is the "Where lessons live" section of `docs/lessons.md`,
which names `proposed.md` as the one lessons file agents may write to.

Do not assume what L-0023 says. Read it, quote its first line in the report,
and then either cite it correctly or drop the parenthetical in favour of a
reference to "Where lessons live" in `../lessons.md`.

---

## Part 6 — index rows

`docs/lessons.md` claims to be the master index for every ratified lesson
whatever file it lives in, so L-0057 gets a row with scope `claude-code`.

Existing row format: `| L-0001 | shared | styling | <short lesson> |`

Add rows L-0037 to L-0057, scope `shared` except L-0057. Derive each short
lesson from the `**Lesson:**` line above, compressed to one line.

Also backfill rows for L-0021 to L-0036, which are currently unindexed. Those
entries are freeform prose with no `Lesson` line, so their one-line summaries
must be authored from the entry text. Flag every one of the sixteen in the
report for owner review; they are the only text in this unit not already
ratified.

The `**Known gap**` note under the index becomes false once the backfill
lands and must be removed. If the backfill is not completed, narrow the note
to name the exact remaining range instead of leaving it as written.
