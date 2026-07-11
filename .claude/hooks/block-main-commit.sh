#!/usr/bin/env bash
# block-main-commit.sh — PreToolUse guard for Bash.
# Enforces the promote flow from PLAN.md section 10 / CLAUDE.md:
#   feature -> dev (auto when CI green) -> main (Wei promotes alone).
# Rules:
#   1. Any `git push --force/-f` targeting main is blocked ALWAYS.
#   2. `git commit` / `git push` while the current branch is main is blocked.
# Exit 0 = allow, exit 2 = block. Fails OPEN on parse errors.
set -u

REPO_ROOT="${CLAUDE_PROJECT_DIR:-/Users/innovera/Documents/juneflow}"
payload="$(cat 2>/dev/null || true)"

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

cmd="$(ti_field command)"
[ -n "$cmd" ] || exit 0  # fail-open: no command found (or parse error)

# `git <options...> <subcommand>` detector — tolerates flags between git and
# the subcommand (e.g. `git -C /path commit`), stops at pipeline separators.
is_git_commit() {
  printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_.-])git[[:space:]]+([^|;&[:space:]]+[[:space:]]+)*commit([^[:alnum:]_-]|$)'
}
is_git_push() {
  printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_.-])git[[:space:]]+([^|;&[:space:]]+[[:space:]]+)*push([^[:alnum:]_-]|$)'
}
has_force_flag() {
  printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])(--force[^[:space:]]*|-f)([[:space:]]|$)'
}
mentions_main() {
  printf '%s' "$cmd" | grep -Eq '(^|[[:space:]/:])main([[:space:]:]|$)'
}

# Rule 1: force push to main is blocked always, whatever the current branch.
if is_git_push && has_force_flag && mentions_main; then
  {
    printf '%s\n' "ห้าม force push ไป main เด็ดขาด (PLAN.md §10)"
    printf '%s\n' "flow ที่ถูกต้อง: feature → dev (auto เมื่อ CI เขียว) → main (Wei promote คนเดียว)"
  } >&2
  exit 2
fi

# Rule 2: no commit/push while the checkout is on main.
if is_git_commit || is_git_push; then
  cwd="$(top_field cwd)"
  repo_dir="$REPO_ROOT"
  if [ -n "$cwd" ] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
    repo_dir="$cwd"
  fi
  branch="$(git -C "$repo_dir" branch --show-current 2>/dev/null || true)"
  if [ "$branch" = "main" ]; then
    {
      printf '%s\n' "ห้าม commit/push บน branch main — Wei เป็นผู้ promote เข้า main คนเดียว (PLAN.md §10 + CLAUDE.md กฎเหล็ก)"
      printf '%s\n' "ให้ทำงานบน feature branch ของเขตตัวเอง (ดู scripts/loop-config.json) แล้วปล่อยให้ CI merge เข้า dev"
    } >&2
    exit 2
  fi
fi

exit 0
