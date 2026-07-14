#!/usr/bin/env bash
#
# loop-runner.sh — per-agent autonomous loop driver for Juneflow
# (Bootstrap Manifest v2 group 4.1 + PLAN.md §10 Autonomous Loop Protocol)
#
# Usage:
#   scripts/loop-runner.sh --agent <backend|web|mobile|qa|integrations|devops> \
#                          [--max-rounds N] [--budget-usd X]
#
# Defaults for --max-rounds / --budget-usd come from scripts/loop-config.json
# (per-agent value first, then the "defaults" block). Config is read with jq.
#
# Each round:
#   1. verify clean git state (no merge/rebase/cherry-pick in progress;
#      round 1 additionally requires no modified tracked files)
#   2. invoke `claude -p` headless with a prompt telling the zone agent to pick
#      ONE `ready` task in its zone from TASKS.md, follow its zone CLAUDE.md,
#      run the gates (PLAN.md §9), and update TASKS.md / REVIEW-QUEUE.md /
#      BLOCKERS.md / its journal
#   3. compare a repo fingerprint (HEAD + status + diff + untracked content)
#      before/after the round to detect progress
#   4. append a round summary to agents/journal/<agent>.md
#
# Stop conditions:
#   - no eligible `ready` task left in the zone              -> exit 0
#   - round cap reached                                      -> exit 0
#   - budget cap reached (cost tracked from claude JSON
#     output; a --max-budget style CLI flag is passed too
#     when the installed claude CLI advertises one)          -> exit 0
#   - empty diff 2 consecutive rounds (no-progress)          -> park `doing`
#     tasks of this zone to `blocked` in TASKS.md + exit 0
#   - any error (fail safe)                                  -> journal + exit non-zero
#
# Extra knobs:
#   LOOP_CLAUDE_FLAGS  env var overriding defaults.claudeFlags from
#                      loop-config.json (space-separated flags for `claude -p`)

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/loop-config.json"

AGENT=""
MAX_ROUNDS_OVERRIDE=""
BUDGET_OVERRIDE=""
ROUND=0
TOTAL_COST_USD="0"
NO_PROGRESS_STREAK=0
LAST_TASK="-"
JOURNAL_FILE=""
PARKED_TASKS="-"
ROUND_COST="0"
ROUND_TASK="-"
ROUND_STATUS="-"

usage() {
  cat <<'EOF'
Usage: scripts/loop-runner.sh --agent <name> [--max-rounds N] [--budget-usd X]

  --agent       one of: backend | web | mobile | qa | integrations | devops
  --max-rounds  round cap for this run (default: loop-config.json maxRoundsPerNight)
  --budget-usd  budget cap in USD for this run (default: loop-config.json budgetUsdPerNight)
EOF
}

log() { printf 'loop-runner[%s]: %s\n' "${AGENT:-?}" "$*" >&2; }

# Append one round-summary entry to agents/journal/<agent>.md.
# Entry body follows the Thai journal template used by the zone journals.
# $1 = header suffix, $2 = "ทำอะไร" line, $3 = "เจออะไร" line
append_journal() {
  [ -n "${JOURNAL_FILE}" ] || return 0
  {
    printf '\n## %s · loop-runner · %s\n' "$(date '+%Y-%m-%d %H:%M')" "$1"
    printf '%s\n' "- ทำอะไร: $2"
    printf '%s\n' "- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)"
    printf '%s\n' "- เจออะไร: $3"
  } >>"${JOURNAL_FILE}" 2>/dev/null || true
}

# Fail safe (PLAN.md §10): journal the failure, then exit non-zero.
die() {
  log "FATAL: $*"
  append_journal "fail-safe" \
    "หยุดการทำงานจาก error: $* (รอบที่ ${ROUND}/${MAX_ROUNDS:-?} · task ล่าสุด: ${LAST_TASK})" \
    "ตรวจสถานะ repo และ log ก่อนสั่งรันใหม่ · งบสะสมรอบนี้: \$${TOTAL_COST_USD}"
  exit 1
}

on_error() {
  local status=$?
  trap - ERR
  die "unexpected error (exit ${status}) at round ${ROUND}"
}
trap on_error ERR

# --- argument parsing --------------------------------------------------------

while [ $# -gt 0 ]; do
  case "$1" in
    --agent)      [ $# -ge 2 ] || die "--agent requires a value";      AGENT="$2"; shift 2 ;;
    --max-rounds) [ $# -ge 2 ] || die "--max-rounds requires a value"; MAX_ROUNDS_OVERRIDE="$2"; shift 2 ;;
    --budget-usd) [ $# -ge 2 ] || die "--budget-usd requires a value"; BUDGET_OVERRIDE="$2"; shift 2 ;;
    -h|--help)    usage; exit 0 ;;
    *)            usage >&2; die "unknown argument: $1" ;;
  esac
done

[ -n "${AGENT}" ] || { usage >&2; die "--agent is required"; }

# Export LOOP_AGENT for this process and every `claude -p` child round so the
# env-keyed hooks (zone-guard, journal-append, notify) activate in headless runs
# where there is no interactive session to infer the agent from (B-005).
export LOOP_AGENT="${AGENT}"

for bin in git jq claude awk shasum mktemp; do
  command -v "${bin}" >/dev/null 2>&1 || die "required tool not found on PATH: ${bin}"
done

[ -f "${CONFIG_FILE}" ] || die "config not found: ${CONFIG_FILE}"
jq -e --arg a "${AGENT}" '.agents[$a]' "${CONFIG_FILE}" >/dev/null 2>&1 \
  || die "unknown agent \"${AGENT}\" — must be one of: $(jq -r '.agents | keys | join(", ")' "${CONFIG_FILE}")"

# --- config ------------------------------------------------------------------

ZONE_PATHS="$(jq -r --arg a "${AGENT}" '.agents[$a].zonePaths | join(" ")' "${CONFIG_FILE}")"
FEATURE_BRANCH="$(jq -r --arg a "${AGENT}" '.agents[$a].featureBranch' "${CONFIG_FILE}")"
ZONE_CLAUDE_MD="$(jq -r --arg a "${AGENT}" '.agents[$a].zoneClaudeMd // ""' "${CONFIG_FILE}")"
MAX_ROUNDS="${MAX_ROUNDS_OVERRIDE:-$(jq -r --arg a "${AGENT}" '.agents[$a].maxRoundsPerNight // .defaults.maxRoundsPerNight' "${CONFIG_FILE}")}"
BUDGET_USD="${BUDGET_OVERRIDE:-$(jq -r --arg a "${AGENT}" '.agents[$a].budgetUsdPerNight // .defaults.budgetUsdPerNight' "${CONFIG_FILE}")}"

case "${MAX_ROUNDS}" in (''|*[!0-9]*) die "--max-rounds must be a positive integer (got: ${MAX_ROUNDS})" ;; esac
[ "${MAX_ROUNDS}" -ge 1 ] || die "--max-rounds must be >= 1"
printf '%s' "${BUDGET_USD}" | grep -Eq '^[0-9]+(\.[0-9]+)?$' || die "--budget-usd must be numeric (got: ${BUDGET_USD})"

JOURNAL_FILE="${REPO_ROOT}/agents/journal/${AGENT}.md"
mkdir -p "$(dirname "${JOURNAL_FILE}")"

# Flags passed to `claude -p`. Overridable via LOOP_CLAUDE_FLAGS env var.
CLAUDE_FLAGS=()
if [ -n "${LOOP_CLAUDE_FLAGS:-}" ]; then
  read -r -a CLAUDE_FLAGS <<<"${LOOP_CLAUDE_FLAGS}"
else
  while IFS= read -r flag; do
    if [ -n "${flag}" ]; then CLAUDE_FLAGS+=("${flag}"); fi
  done < <(jq -r '.defaults.claudeFlags[]?' "${CONFIG_FILE}")
fi

# Budget cap: pass a --max-budget style flag when the installed claude CLI
# advertises one (probed from --help, longest names first so a prefix does not
# shadow a longer flag). Cost is ALWAYS also tracked from the JSON output as
# the enforcement of last resort, alongside the round cap.
BUDGET_FLAG_ARGS=()
CLAUDE_HELP="$(claude --help 2>/dev/null || true)"
for flag_name in --max-budget-usd --max-budget --max-cost-usd --max-cost; do
  if printf '%s' "${CLAUDE_HELP}" | grep -q -- "${flag_name}"; then
    BUDGET_FLAG_ARGS=("${flag_name}" "${BUDGET_USD}")
    break
  fi
done

# --- git helpers ---------------------------------------------------------------

git_repo() { git -C "${REPO_ROOT}" "$@"; }

# Fingerprint of everything that can change during a round: HEAD, index/worktree
# status, tracked diff, and the content of untracked files. Identical fingerprint
# before/after a round = empty diff = no progress.
repo_fingerprint() {
  {
    git_repo rev-parse HEAD 2>/dev/null || printf 'no-head\n'
    git_repo status --porcelain 2>/dev/null
    git_repo diff HEAD 2>/dev/null || true
    git_repo ls-files --others --exclude-standard 2>/dev/null | while IFS= read -r f; do
      shasum -a 256 "${REPO_ROOT}/${f}" 2>/dev/null || true
    done
  } | shasum -a 256 | awk '{print $1}'
}

# Clean-state check before invoking the headless agent:
# - never run while a merge/rebase/cherry-pick/revert is in progress
# - on round 1 the tracked worktree must be clean (untracked files are allowed:
#   read-only source packs live untracked until the scaffold lands)
verify_clean_state() {
  local git_dir marker
  git_dir="$(git_repo rev-parse --git-dir)"
  case "${git_dir}" in
    /*) : ;;
    *) git_dir="${REPO_ROOT}/${git_dir}" ;;
  esac
  for marker in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD REBASE_HEAD rebase-merge rebase-apply; do
    if [ -e "${git_dir}/${marker}" ]; then
      die "git operation in progress (${marker}) — repo state is not clean"
    fi
  done
  if [ "${ROUND}" -eq 1 ] && [ -n "$(git_repo status --porcelain --untracked-files=no)" ]; then
    die "tracked worktree is dirty at loop start — commit or stash changes first (clean-state requirement)"
  fi
}

# One agent = one worktree = one feature branch (PLAN.md §8). Never work on main.
ensure_feature_branch() {
  local current
  current="$(git_repo rev-parse --abbrev-ref HEAD)"
  if [ "${current}" != "${FEATURE_BRANCH}" ]; then
    if git_repo show-ref --verify --quiet "refs/heads/${FEATURE_BRANCH}"; then
      git_repo switch "${FEATURE_BRANCH}" >/dev/null 2>&1 || die "cannot switch to ${FEATURE_BRANCH}"
    else
      git_repo switch -c "${FEATURE_BRANCH}" >/dev/null 2>&1 || die "cannot create ${FEATURE_BRANCH}"
    fi
    log "switched to zone feature branch: ${FEATURE_BRANCH}"
  fi
}

# Park (PLAN.md §10 no-progress guardrail): flip this zone's `doing` rows in
# TASKS.md to `blocked`. Best-effort mechanical edit of the markdown table
# (columns: | id | zone | status | ...).
park_doing_tasks() {
  local tasks_file tmp_body tmp_ids
  tasks_file="${REPO_ROOT}/TASKS.md"
  if [ ! -f "${tasks_file}" ]; then
    log "TASKS.md not found — nothing to park"
    PARKED_TASKS="-"
    return 0
  fi
  tmp_body="$(mktemp)"
  tmp_ids="$(mktemp)"
  awk -v zone="${AGENT}" '
    BEGIN { FS = OFS = "|" }
    {
      if (NF >= 5) {
        z = $3; gsub(/^[ \t]+|[ \t]+$/, "", z)
        s = $4; gsub(/^[ \t]+|[ \t]+$/, "", s)
        if (z == zone && s == "doing") {
          id = $2; gsub(/^[ \t]+|[ \t]+$/, "", id)
          print id >> IDS
          $4 = " blocked "
        }
      }
      print
    }
  ' IDS="${tmp_ids}" "${tasks_file}" >"${tmp_body}"
  PARKED_TASKS="$(tr '\n' ' ' <"${tmp_ids}" | sed 's/ *$//')"
  if [ -n "${PARKED_TASKS}" ]; then
    mv "${tmp_body}" "${tasks_file}"
    log "parked task(s) doing -> blocked: ${PARKED_TASKS}"
  else
    rm -f "${tmp_body}"
    PARKED_TASKS="-"
  fi
  rm -f "${tmp_ids}"
}

# --- headless round ------------------------------------------------------------

build_prompt() {
  cat <<EOF
You are the autonomous "${AGENT}" zone agent for the Juneflow monorepo. Run exactly ONE round of the Autonomous Loop Protocol (PLAN.md §10). Work from the repo root.

Zone paths (your only writable area): ${ZONE_PATHS}
Zone CLAUDE.md: ${ZONE_CLAUDE_MD:-the CLAUDE.md files inside your zone paths}
Feature branch: ${FEATURE_BRANCH} (current branch — NEVER commit to main)

Do this, in order:
1. Read PLAN.md — start with §0 (Design Fidelity Protocol) and §10 — then the root CLAUDE.md and your zone CLAUDE.md. Follow them exactly.
2. In TASKS.md, pick exactly ONE task in zone "${AGENT}" with status "ready" whose dependencies are all "done" (or empty "—"). Change its status to "doing".
3. Read the spec referenced by the task's "spec pointer" column, then implement the task strictly inside your zone paths.
4. Run the gates listed in the task row (PLAN.md §9, or the stated minimum CI criteria for infrastructure tasks).
5. Decide the outcome per PLAN.md §10:
   - GREEN: commit the work on ${FEATURE_BRANCH}, set the task status to "review", and add a row to REVIEW-QUEUE.md.
   - RED: fix and re-run the gates (max 3 attempts within this round). Still red after 3 -> leave status "doing" and record what remains in your journal.
   - STUCK (spec conflict, out-of-zone change needed, missing i18n key, sacred-file change needed): append an entry to BLOCKERS.md, set the task status to "blocked", and stop.
6. Append ONE journal entry to agents/journal/${AGENT}.md following the template at the top of that file.

Hard rules: never touch sacred files (PLAN.md §10: packages/contracts/openapi.yaml, merged migrations, any CLAUDE.md, .github/workflows/*, secrets, docs/extract/*, i18n-full.json) · never redesign UI or re-translate (PLAN.md §0) · never resolve spec conflicts yourself — escalate via BLOCKERS.md only.

End your reply with exactly one line in this format:
TASK_RESULT: <task-id> <status>
where <status> is one of: review | doing | blocked
If no eligible "ready" task exists in your zone, change nothing and end with:
TASK_RESULT: none no-task
EOF
}

run_round() {
  local prompt out_file err_file is_error result_text task_line
  prompt="$(build_prompt)"
  out_file="$(mktemp)"
  err_file="$(mktemp)"
  log "round ${ROUND}/${MAX_ROUNDS}: invoking claude -p headless..."
  if ! (cd "${REPO_ROOT}" && claude -p "${prompt}" --output-format json \
        ${CLAUDE_FLAGS[@]+"${CLAUDE_FLAGS[@]}"} \
        ${BUDGET_FLAG_ARGS[@]+"${BUDGET_FLAG_ARGS[@]}"} \
        >"${out_file}" 2>"${err_file}"); then
    log "claude stderr (tail): $(tail -c 500 "${err_file}" 2>/dev/null || true)"
    rm -f "${out_file}" "${err_file}"
    die "claude -p exited non-zero in round ${ROUND}"
  fi
  is_error="$(jq -r '.is_error // false' "${out_file}" 2>/dev/null || echo parse-error)"
  ROUND_COST="$(jq -r '.total_cost_usd // 0' "${out_file}" 2>/dev/null || echo 0)"
  result_text="$(jq -r '.result // ""' "${out_file}" 2>/dev/null || echo "")"
  rm -f "${out_file}" "${err_file}"
  if [ "${is_error}" = "true" ] || [ "${is_error}" = "parse-error" ]; then
    die "claude round ${ROUND} returned an error result (is_error=${is_error})"
  fi
  task_line="$(printf '%s\n' "${result_text}" | grep -E '^TASK_RESULT:' | tail -n 1 || true)"
  if [ -n "${task_line}" ]; then
    ROUND_TASK="$(printf '%s\n' "${task_line}" | awk '{print $2}')"
    ROUND_STATUS="$(printf '%s\n' "${task_line}" | awk '{print $3}')"
  else
    ROUND_TASK="unknown"
    ROUND_STATUS="unknown"
  fi
  LAST_TASK="${ROUND_TASK}"
  TOTAL_COST_USD="$(awk -v a="${TOTAL_COST_USD}" -v b="${ROUND_COST}" 'BEGIN { printf "%.4f", a + b }')"
}

budget_exhausted() {
  awk -v spent="${TOTAL_COST_USD}" -v cap="${BUDGET_USD}" 'BEGIN { exit !(spent >= cap) }'
}

# --- main loop -----------------------------------------------------------------

log "agent=${AGENT} zone=[${ZONE_PATHS}] branch=${FEATURE_BRANCH} max-rounds=${MAX_ROUNDS} budget-usd=${BUDGET_USD}"
if [ ${#BUDGET_FLAG_ARGS[@]} -gt 0 ]; then
  log "claude CLI budget flag detected and passed: ${BUDGET_FLAG_ARGS[0]} ${BUDGET_USD}"
else
  log "no budget flag in claude CLI — enforcing budget from tracked cost + round cap"
fi

ROUND=1
verify_clean_state
ensure_feature_branch

while [ "${ROUND}" -le "${MAX_ROUNDS}" ]; do
  if budget_exhausted; then
    append_journal "หยุดที่เพดานงบ" \
      "หยุดลูปก่อนรอบที่ ${ROUND}: งบสะสม \$${TOTAL_COST_USD} ถึงเพดาน \$${BUDGET_USD} (guardrail ตาม PLAN.md §10)" \
      "task ล่าสุด: ${LAST_TASK} · รันใหม่ได้ในรอบคืนถัดไป"
    log "budget cap reached (\$${TOTAL_COST_USD} >= \$${BUDGET_USD}) — stopping"
    exit 0
  fi

  verify_clean_state
  before_fp="$(repo_fingerprint)"
  run_round
  after_fp="$(repo_fingerprint)"

  if [ "${ROUND_TASK}" = "none" ]; then
    append_journal "คิวว่าง" \
      "รอบที่ ${ROUND}/${MAX_ROUNDS}: ไม่มี task สถานะ ready ที่ dependencies ครบในเขต ${AGENT} — จบลูป" \
      "งบสะสม \$${TOTAL_COST_USD}/\$${BUDGET_USD} · เติมคิว ready ให้ครบ ≥ 5 task ต่อเขต (PLAN.md §10)"
    log "no eligible ready task in zone — exiting"
    exit 0
  fi

  # Gates still red after the 3-attempt cap: run_round's contract leaves
  # ROUND_STATUS=doing (review/blocked/none/unknown are handled elsewhere).
  # Fire a one-shot "gates RED x3" push via the notify hook's CLI mode (B-005).
  # notify.sh never blocks (silent no-op without NTFY_TOPIC); keep the loop
  # resilient with >/dev/null and a trailing || true regardless.
  if [ "${ROUND_STATUS}" = "doing" ]; then
    "${REPO_ROOT}/.claude/hooks/notify.sh" "Juneflow gates RED x3" \
      "agent: ${AGENT} · task ${ROUND_TASK} ยังแดงหลังครบ 3 รอบ (ROUND_STATUS=doing) — ดู agents/journal/${AGENT}.md" \
      >/dev/null 2>&1 || true
    log "gates still red after 3-attempt cap (task ${ROUND_TASK}) — notify fired"
  fi

  if [ "${before_fp}" = "${after_fp}" ]; then
    NO_PROGRESS_STREAK=$((NO_PROGRESS_STREAK + 1))
    progress_label="no (streak ${NO_PROGRESS_STREAK}/2)"
  else
    NO_PROGRESS_STREAK=0
    progress_label="yes"
  fi

  append_journal "รอบที่ ${ROUND}/${MAX_ROUNDS} · task: ${ROUND_TASK}" \
    "รัน claude headless 1 รอบ · task ${ROUND_TASK} → สถานะ ${ROUND_STATUS} · ค่าใช้จ่ายรอบนี้ \$${ROUND_COST} (สะสม \$${TOTAL_COST_USD}/เพดาน \$${BUDGET_USD})" \
    "git progress: ${progress_label}"

  if [ "${NO_PROGRESS_STREAK}" -ge 2 ]; then
    park_doing_tasks
    append_journal "park task (no progress)" \
      "diff ว่าง 2 รอบติด → park task ตาม PLAN.md §10: เปลี่ยนสถานะ doing → blocked ในเขต ${AGENT} (task: ${PARKED_TASKS})" \
      "ต้อง review สาเหตุใน journal/BLOCKERS.md ก่อนปลด block · จบลูป"
    log "no progress for 2 consecutive rounds — parked (${PARKED_TASKS}) and exiting"
    exit 0
  fi

  ROUND=$((ROUND + 1))
done

append_journal "ครบเพดานรอบ" \
  "จบลูปที่เพดานรอบ ${MAX_ROUNDS} รอบ (ตาม loop-config.json / --max-rounds) · งบสะสม \$${TOTAL_COST_USD}/\$${BUDGET_USD}" \
  "task ล่าสุด: ${LAST_TASK} · รันใหม่ได้ในรอบคืนถัดไป"
log "round cap reached (${MAX_ROUNDS}) — stopping"
exit 0
