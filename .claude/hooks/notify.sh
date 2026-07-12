#!/usr/bin/env bash
# notify.sh — push notifications via ntfy (topic from env). Never blocks: this
# hook/tool ALWAYS exits 0, even when sending fails.
#
# Env:
#   NTFY_TOPIC   required — no topic = silent no-op
#   NTFY_SERVER  optional — default https://ntfy.sh
#   NTFY_TOKEN   optional — bearer token for protected topics
#
# Two modes:
#   1. CLI mode:   notify.sh <title> <message...>
#      For events hooks cannot see from a payload — e.g. "gates แดงครบ 3 รอบ"
#      (call-site wiring in loop-runner.sh pending Wei's answer on B-005):
#        .claude/hooks/notify.sh "Juneflow gates RED x3" "<task-id> ..."
#   2. Hook mode (no args, payload on stdin):
#      - Stop + LOOP_AGENT set            -> loop round ended
#      - PostToolUse on BLOCKERS.md       -> new/updated blocker
#      - PostToolUse on REVIEW-QUEUE.md   -> task entered review queue
#      Anything else -> silent no-op.
# Titles are ASCII (HTTP header safety); Thai detail goes in the body.
set -u

SERVER="${NTFY_SERVER:-https://ntfy.sh}"

send() { # $1 = title (ASCII), $2 = body
  auth=()
  [ -n "${NTFY_TOKEN:-}" ] && auth=(-H "Authorization: Bearer ${NTFY_TOKEN}")
  curl -fsS -m 5 ${auth[@]+"${auth[@]}"} \
    -H "Title: $1" \
    --data "$2" \
    "${SERVER%/}/${NTFY_TOPIC}" >/dev/null 2>&1 || true
}

# --- CLI mode -----------------------------------------------------------------
# Checked BEFORE any stdin read: CLI callers (loop-runner, scripts) may leave
# stdin attached to a terminal — draining it here would hang until EOF.
if [ "$#" -ge 1 ]; then
  [ -n "${NTFY_TOPIC:-}" ] || exit 0
  title="$1"; shift
  send "$title" "${*:-$title}"
  exit 0
fi

# --- Hook mode (payload on stdin) -------------------------------------------------
payload="$(cat 2>/dev/null || true)"
[ -n "${NTFY_TOPIC:-}" ] || exit 0
[ -n "$payload" ] || exit 0

have_jq() { command -v jq >/dev/null 2>&1; }
have_py() { command -v python3 >/dev/null 2>&1; }

top_field() {
  if have_jq; then
    printf '%s' "$payload" | jq -r --arg k "$1" '.[$k] // empty' 2>/dev/null
  elif have_py; then
    printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    v = d.get(sys.argv[1])
    sys.stdout.write("" if v is None else str(v))
except Exception:
    pass
' "$1" 2>/dev/null
  fi
}

ti_field() {
  if have_jq; then
    printf '%s' "$payload" | jq -r --arg k "$1" '(.tool_input // {})[$k] // empty' 2>/dev/null
  elif have_py; then
    printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    v = (d.get("tool_input") or {}).get(sys.argv[1])
    sys.stdout.write("" if v is None else str(v))
except Exception:
    pass
' "$1" 2>/dev/null
  fi
}

event="$(top_field hook_event_name)"

case "$event" in
  Stop)
    if [ -n "${LOOP_AGENT:-}" ]; then
      send "Juneflow loop round done" "agent: ${LOOP_AGENT} — จบรอบ loop แล้ว (ดู agents/journal/${LOOP_AGENT}.md)"
    fi
    ;;
  PostToolUse)
    fp="$(ti_field file_path)"
    case "$fp" in
      *BLOCKERS.md)
        send "Juneflow BLOCKER" "BLOCKERS.md ถูกอัปเดต — มี blocker ใหม่หรือการแก้ไข รอ Wei ตรวจ"
        ;;
      *REVIEW-QUEUE.md)
        send "Juneflow REVIEW-QUEUE" "มีงานใหม่เข้า REVIEW-QUEUE.md — รอ Wei ตรวจ/promote"
        ;;
    esac
    ;;
esac

exit 0
