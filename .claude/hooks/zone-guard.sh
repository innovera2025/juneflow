#!/usr/bin/env bash
# zone-guard.sh — PreToolUse guard for Edit|Write|MultiEdit|NotebookEdit.
# Enforces "one agent = one zone" (PLAN.md section 8) during autonomous loops.
# No-op unless LOOP_AGENT is set. Zone paths come from scripts/loop-config.json.
# Allowed outside the zone: TASKS.md, BLOCKERS.md, REVIEW-QUEUE.md and the
# agent's own journal file. Exit 0 = allow, exit 2 = block.
# Fails OPEN on parse/config errors (this is a discipline guard, not a vault —
# protect-files.sh is the fail-closed layer).
set -u

REPO_ROOT="${CLAUDE_PROJECT_DIR:-/Users/innovera/Documents/juneflow}"
payload="$(cat 2>/dev/null || true)"

[ -n "${LOOP_AGENT:-}" ] || exit 0

have_jq() { command -v jq >/dev/null 2>&1; }
have_py() { command -v python3 >/dev/null 2>&1; }

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

fp="$(ti_field file_path)"
[ -n "$fp" ] || fp="$(ti_field notebook_path)"
[ -n "$fp" ] || exit 0  # fail-open: no path found (or parse error)

case "$fp" in
  /*) abs="$fp" ;;
  *) abs="$REPO_ROOT/$fp" ;;
esac
if have_py; then
  abs="$(python3 -c 'import os,sys; sys.stdout.write(os.path.normpath(sys.argv[1]))' "$abs" 2>/dev/null || printf '%s' "$abs")"
fi
case "$abs" in
  "$REPO_ROOT"/*) rel="${abs#"$REPO_ROOT"/}" ;;
  *) exit 0 ;;
esac

# Shared loop files every agent may write.
case "$rel" in
  TASKS.md|BLOCKERS.md|REVIEW-QUEUE.md|"agents/journal/$LOOP_AGENT.md") exit 0 ;;
esac

config="$REPO_ROOT/scripts/loop-config.json"
[ -f "$config" ] || exit 0  # fail-open: config missing

if have_jq; then
  zones="$(jq -r --arg a "$LOOP_AGENT" '(.agents[$a].zonePaths // [])[]' "$config" 2>/dev/null)"
elif have_py; then
  zones="$(python3 -c '
import json, sys
try:
    cfg = json.load(open(sys.argv[1]))
    zones = ((cfg.get("agents") or {}).get(sys.argv[2]) or {}).get("zonePaths") or []
    sys.stdout.write("\n".join(str(z) for z in zones))
except Exception:
    pass
' "$config" "$LOOP_AGENT" 2>/dev/null)"
else
  zones=""
fi

[ -n "$zones" ] || exit 0  # fail-open: unknown agent or unparseable config

zone_list=""
while IFS= read -r z; do
  [ -n "$z" ] || continue
  z="${z%/}"
  zone_list="${zone_list:+$zone_list · }$z"
  case "$rel" in
    "$z"|"$z"/*) exit 0 ;;
  esac
done <<EOF_ZONES
$zones
EOF_ZONES

{
  printf '%s\n' "หนึ่ง agent = หนึ่งเขต (PLAN.md §8) — agent \"$LOOP_AGENT\" ห้ามเขียนไฟล์นอกเขตของตัวเอง"
  printf '%s\n' "ไฟล์ที่พยายามเขียน: $rel"
  printf '%s\n' "เขตที่เขียนได้: $zone_list + ไฟล์ร่วม (TASKS.md · BLOCKERS.md · REVIEW-QUEUE.md · agents/journal/$LOOP_AGENT.md)"
  printf '%s\n' "งานที่ต้องแก้นอกเขต → เขียน BLOCKERS.md แล้วข้ามไป task อื่น ห้ามข้ามเขตเอง"
} >&2
exit 2
