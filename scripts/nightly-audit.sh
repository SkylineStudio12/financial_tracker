#!/usr/bin/env bash
#
# Nightly audit launcher — FINDINGS-ONLY v1.
#
# Runs docs/briefs/nightly-audit.md unattended against the TEST database and
# leaves a docket at docs/briefs/reports/nightly-<date>.md. Installs nothing,
# commits nothing, and never connects to the live database.
#
# Usage:
#   scripts/nightly-audit.sh                 # the cron path
#   NIGHTLY_AUDIT_PRINT_ONLY=1 scripts/...   # print the resolved config and
#                                            # exit; writes NOTHING, whatever
#                                            # the tree state
#   NIGHTLY_AUDIT_ALLOW_DIRTY=1 scripts/...  # manual only; cron must never set it
#
# Exit codes: 0 ok or cleanly skipped, 2 refused (bad environment),
# 3 audit agent failed, 4 audit agent timed out.
#
# Every non-print exit leaves something for the morning read, and an existing
# docket is NEVER overwritten: when a real docket for the date already exists,
# failure and skip notes divert to nightly-<date>-FAILED.md beside it.

set -Eeuo pipefail

# --- repo root, derived from this script's location (never hardcoded) --------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
cd -- "${REPO_ROOT}"

# cron runs with PATH=/usr/bin:/bin, where neither claude nor npm/npx exists on
# a Homebrew macOS box. APPEND the usual prefixes rather than failing at 2am —
# appended, not prepended, so an operator's own PATH still wins.
export PATH="${PATH}:/opt/homebrew/bin:/usr/local/bin"

BRIEF="docs/briefs/nightly-audit.md"
DATE="${NIGHTLY_AUDIT_DATE:-$(date +%Y-%m-%d)}"
REPORT_DIR="docs/briefs/reports"
REPORT="${REPORT_DIR}/nightly-${DATE}.md"
FAILED_NOTE="${REPORT_DIR}/nightly-${DATE}-FAILED.md"
LOG_DIR="logs"
LOG="${LOG_DIR}/nightly-${DATE}.json"
TIMEOUT_SECONDS="${NIGHTLY_AUDIT_TIMEOUT_SECONDS:-7200}"   # 2h

log() { printf '%s nightly-audit: %s\n' "$(date +%H:%M:%S)" "$*"; }

# Staged-but-uncommitted lesson-candidate blocks in proposed.md. The dirty-tree
# guard excludes that file (one night's append must not self-skip every later
# night), so its growth is surfaced HERE, in the docket the owner actually
# reads. grep -c prints 0 before exiting 1 on no matches, hence the || true.
candidate_count() {
  git diff HEAD -- docs/lessons/proposed.md 2>/dev/null | grep -c '^+### P-' || true
}

# Write a note the owner will find in the morning. NEVER overwrites an
# existing docket: if the date's report already exists, the note goes to the
# -FAILED sidecar instead, leaving real findings intact (21-06R finding 3).
note() {
  local headline="$1" body="${2:-}"
  local target="${REPORT}"
  [[ -f "${REPORT}" ]] && target="${FAILED_NOTE}"
  mkdir -p -- "${REPORT_DIR}" 2>/dev/null || true
  {
    printf 'PROMPT-KEY: NIGHT-%s\n\n' "${DATE}"
    printf '%s\n' "${headline}"
    if [[ -n "${body}" ]]; then printf '\n```\n%s\n```\n' "${body}"; fi
    printf '\nStaged, uncommitted lesson-candidate blocks in docs/lessons/proposed.md: %s\n' "$(candidate_count)"
  } > "${target}" 2>/dev/null || true
  log "note written to ${target}"
}

refuse() {
  printf 'nightly-audit: REFUSED — %s\n' "$1" >&2
  note "refused, audit not run — $1"
  exit 2
}

# --- resolve targeting (no refusals yet: print-only must reach its printout) -
# TEST_DATABASE_URL may come from the environment or from .env. cron gets a
# minimal environment, so .env is the realistic source; read it without
# sourcing the file, so a live DATABASE_URL line can never leak into scope.
if [[ -z "${TEST_DATABASE_URL:-}" && -f .env ]]; then
  TEST_DATABASE_URL="$(sed -n 's/^TEST_DATABASE_URL=//p' .env | head -1)"
fi

# DATABASE_URL is a DELIBERATELY UNREACHABLE sentinel — not live, not the test
# URL, and not overridable. The runner scripts read it only to prove it differs
# from TEST_DATABASE_URL and never connect to it, so this satisfies their guard
# while making any stray ad-hoc query fail to connect instead of reaching live.
# dotenv does not override an already-exported variable, which is what keeps
# .env's real live URL out of every child process. It cannot collide with
# TEST_DATABASE_URL, because that must end in _test and this does not.
DATABASE_URL_SENTINEL="postgresql://nightly-audit-no-live@127.0.0.1:1/nightly_audit_sentinel"

# --- tool surface -------------------------------------------------------------
# Tightest form the installed CLI supports (verified against `claude --help`,
# 2.1.204):
#   --setting-sources ""   permission ceiling comes ONLY from this script; no
#                          machine-local settings file can widen a 2am run
#                          (help: "Comma-separated list of setting sources to
#                          load (user, project, local)." — empty list parses,
#                          a bogus value is rejected, so the flag validates).
#   --tools                hard-restricts the built-in toolset.
#   --allowedTools         the effective CEILING, because --permission-mode
#                          dontAsk denies anything not pre-approved instead of
#                          prompting (a prompt would hang a 2am job forever).
#   Write is path-scoped to the docket directory; Edit to the one lessons file
#   agents may append to (docs/lessons.md rules preamble).
# git is allowed as `git status` ONLY: git diff/log accept --output=<path>,
# an arbitrary file write no redirection check can see (21-06R finding 4).
# The candidate count the docket needs is computed by THIS launcher, which is
# not permission-gated, so the agent needs no git diff at all.
CLAUDE_TOOLS="Read,Grep,Glob,Bash,Write,Edit"
CLAUDE_ALLOWED=(
  "Read" "Grep" "Glob"
  "Write(${REPORT_DIR}/**)"
  "Edit(docs/lessons/proposed.md)"
  "Bash(npm run test:*)"
  "Bash(npx tsc:*)"
  "Bash(git status:*)"
  "Bash(rm -f tsconfig.tsbuildinfo)"
  # The eleventh runner needs its documented L-0025 override, which begins with
  # an env assignment rather than "npm". Whether the matcher accepts an
  # env-prefixed command is UNVERIFIED (see the brief); the brief instructs the
  # agent to record a denial rather than skip the runner silently.
  "Bash(DATABASE_URL=* npm run test:import-inbox-bulk)"
)
CLAUDE_DENIED=(
  "NotebookEdit" "WebFetch" "WebSearch" "Task"
  "Bash(git commit:*)" "Bash(git add:*)" "Bash(git push:*)" "Bash(git checkout:*)"
  "Bash(git reset:*)" "Bash(git stash:*)" "Bash(git tag:*)" "Bash(git branch:*)"
  "Bash(git rm:*)" "Bash(git clean:*)" "Bash(git diff:*)" "Bash(git log:*)"
  "Bash(git ls-files:*)"
  "Bash(npm run db:*)" "Bash(npx drizzle-kit:*)" "Bash(psql:*)" "Bash(pg_dump:*)"
  "Bash(npm i:*)" "Bash(npm install:*)" "Bash(curl:*)" "Bash(gh:*)"
  "Bash(sed:*)" "Bash(tee:*)" "Bash(mv:*)" "Bash(cp:*)" "Bash(chmod:*)"
)

# --- PRINT-ONLY: sits ABOVE every refuse()/note() call ON PURPOSE ------------
# It resolves and prints; it writes nothing, whatever the tree or environment
# state (21-06R finding 2). Unset or invalid values print as such.
if [[ "${NIGHTLY_AUDIT_PRINT_ONLY:-}" == "1" ]]; then
  log "PRINT-ONLY: resolved configuration, nothing invoked, nothing written"
  printf 'repo root      : %s\n' "${REPO_ROOT}"
  printf 'date           : %s\n' "${DATE}"
  printf 'prompt key     : NIGHT-%s\n' "${DATE}"
  if [[ -f "${BRIEF}" ]]; then
    printf 'brief          : %s (%s lines)\n' "${BRIEF}" "$(wc -l < "${BRIEF}" | tr -d ' ')"
  else
    printf 'brief          : %s (MISSING — a real run would refuse)\n' "${BRIEF}"
  fi
  printf 'report         : %s\n' "${REPORT}"
  printf 'failure note   : %s (only when a docket already exists)\n' "${FAILED_NOTE}"
  printf 'log            : %s\n' "${LOG}"
  printf 'timeout        : %ss\n' "${TIMEOUT_SECONDS}"
  printf 'TEST_DATABASE_URL : %s\n' "${TEST_DATABASE_URL:-<unset — a real run would refuse>}"
  printf 'DATABASE_URL      : %s (sentinel)\n' "${DATABASE_URL_SENTINEL}"
  printf 'setting sources   : "" (machine-local settings excluded)\n'
  printf 'tools          : %s\n' "${CLAUDE_TOOLS}"
  printf 'allowedTools   : %s\n' "${CLAUDE_ALLOWED[*]}"
  printf 'disallowedTools: %s\n' "${CLAUDE_DENIED[*]}"
  exit 0
fi

# --- refusals -----------------------------------------------------------------
[[ -f "${BRIEF}" ]] || refuse "brief not found at ${BRIEF}"
command -v claude >/dev/null 2>&1 || refuse "the claude CLI is not on PATH (${PATH})"
command -v npm >/dev/null 2>&1 || refuse "npm is not on PATH (${PATH})"
[[ -n "${TEST_DATABASE_URL:-}" ]] || refuse "TEST_DATABASE_URL is unset"
[[ "${TEST_DATABASE_URL}" == *_test ]] || \
  refuse "TEST_DATABASE_URL does not name a *_test database: ${TEST_DATABASE_URL}"
export TEST_DATABASE_URL
export DATABASE_URL="${DATABASE_URL_SENTINEL}"

# --- dirty-tree guard, fail-CLOSED --------------------------------------------
# The docket directory and proposed.md are excluded on purpose: both are the
# job's own sanctioned outputs, and counting either as "dirty" would make the
# job self-skip forever after its first productive night (21-06R finding 1;
# candidate P-20260726-06). proposed.md growth is surfaced by the candidate
# count in every docket instead. -uall is required: without it git collapses
# untracked directories and the exclusion cannot bite. A git ERROR refuses —
# an error is not evidence of a clean tree.
set +e
DIRTY="$(git status --porcelain -uall -- . \
  ':(exclude)'"${REPORT_DIR}" \
  ':(exclude)docs/lessons/proposed.md' 2>&1)"
GUARD_STATUS=$?
set -e
if [[ ${GUARD_STATUS} -ne 0 ]]; then
  refuse "git status failed (exit ${GUARD_STATUS}); refusing to treat an error as a clean tree: ${DIRTY}"
fi
if [[ -n "${DIRTY}" ]]; then
  if [[ "${NIGHTLY_AUDIT_ALLOW_DIRTY:-}" == "1" ]]; then
    log "tree is dirty but NIGHTLY_AUDIT_ALLOW_DIRTY=1 — proceeding (manual run)"
  else
    note "skipped, dirty tree — $(printf '%s\n' "${DIRTY}" | wc -l | tr -d ' ') uncommitted path(s), audit not run" "${DIRTY}"
    log "skipped, dirty tree"
    exit 0
  fi
fi

mkdir -p -- "${REPORT_DIR}" "${LOG_DIR}"

# Fingerprint any same-date docket left by an earlier attempt — CLASSIFICATION
# only, never grounds to overwrite (21-06R finding 3). A checksum rather than
# an mtime: mtime is whole-second and a rerun inside the same second would
# read as fresh.
REPORT_SIG_BEFORE="absent"
if [[ -f "${REPORT}" ]]; then
  REPORT_SIG_BEFORE="$(shasum -a 256 "${REPORT}" | cut -d' ' -f1)"
fi

# --- resolve the prompt -------------------------------------------------------
PROMPT="$(sed "s/\[date\]/${DATE}/g" "${BRIEF}")"

# --- invoke, with a portable watchdog -----------------------------------------
# This host has neither `timeout` nor `gtimeout`, so the deadline is enforced
# by a background watchdog rather than by coreutils.
log "starting audit NIGHT-${DATE} (timeout ${TIMEOUT_SECONDS}s)"
set +e
claude -p "${PROMPT}" \
  --output-format json \
  --setting-sources "" \
  --tools "${CLAUDE_TOOLS}" \
  --allowedTools "${CLAUDE_ALLOWED[@]}" \
  --disallowedTools "${CLAUDE_DENIED[@]}" \
  --permission-mode dontAsk \
  --no-session-persistence \
  > "${LOG}" 2> "${LOG}.stderr" &
CLAUDE_PID=$!
# The watchdog's fds go to /dev/null on purpose. Inheriting this script's
# stdout would let its sleeping child hold the pipe open after the audit
# finishes, so a piped caller — cron mailing stdout, for one — would block
# until the full timeout even though the work was already done.
(
  sleep "${TIMEOUT_SECONDS}"
  kill -TERM "${CLAUDE_PID}" 2>/dev/null
  sleep 15
  kill -KILL "${CLAUDE_PID}" 2>/dev/null
) >/dev/null 2>&1 &
WATCHDOG_PID=$!
wait "${CLAUDE_PID}"
STATUS=$?
# Kill the sleeping child first: killing only the subshell orphans the sleep.
pkill -P "${WATCHDOG_PID}" 2>/dev/null
kill "${WATCHDOG_PID}" 2>/dev/null
wait "${WATCHDOG_PID}" 2>/dev/null
set -e

if [[ ${STATUS} -eq 143 || ${STATUS} -eq 137 ]]; then
  note "TIMED OUT after ${TIMEOUT_SECONDS}s — no audit result; partial transcript at ${LOG}"
  log "TIMED OUT after ${TIMEOUT_SECONDS}s; partial log at ${LOG}"
  exit 4
fi

# A refused or unauthenticated CLI can exit 0 while reporting is_error, so exit
# status alone is not evidence the audit ran. Surface the message rather than
# letting a 2am auth failure read as "the repo was clean".
AGENT_ERROR=""
if command -v jq >/dev/null 2>&1 && [[ -s "${LOG}" ]]; then
  if [[ "$(jq -r '.is_error // false' "${LOG}" 2>/dev/null)" == "true" ]]; then
    AGENT_ERROR="$(jq -r '.result // "unknown"' "${LOG}" 2>/dev/null)"
  fi
fi
if [[ -n "${AGENT_ERROR}" ]]; then
  note "audit agent reported an error, no findings produced — ${AGENT_ERROR}"
  log "AGENT REPORTED AN ERROR: ${AGENT_ERROR}"
  exit 3
fi
if [[ ${STATUS} -ne 0 ]]; then
  note "audit agent exited ${STATUS}, no findings produced; transcript at ${LOG}"
  log "audit agent exited ${STATUS}; see ${LOG} and ${LOG}.stderr"
  exit 3
fi

# Freshness classification, no overwrite on any branch. An unchanged docket is
# reported via the -FAILED sidecar; a byte-identical fresh docket therefore
# costs a spurious sidecar note, never a destroyed report.
REPORT_SIG_AFTER="absent"
if [[ -f "${REPORT}" ]]; then
  REPORT_SIG_AFTER="$(shasum -a 256 "${REPORT}" | cut -d' ' -f1)"
fi
if [[ "${REPORT_SIG_AFTER}" != "absent" && "${REPORT_SIG_AFTER}" != "${REPORT_SIG_BEFORE}" ]]; then
  # Compensating visibility for the proposed.md guard exclusion: the count of
  # staged, uncommitted candidate blocks rides in the docket itself.
  printf '\nStaged, uncommitted lesson-candidate blocks in docs/lessons/proposed.md: %s\n' \
    "$(candidate_count)" >> "${REPORT}"
  log "done — docket at ${REPORT}, transcript at ${LOG}"
else
  if [[ "${REPORT_SIG_AFTER}" == "absent" ]]; then
    log "agent exited 0 but wrote no report; see ${LOG}"
  else
    log "agent exited 0 and left the docket byte-unchanged; see ${LOG}"
  fi
  note "audit agent exited 0 but produced no fresh docket; transcript at ${LOG}"
  exit 3
fi
