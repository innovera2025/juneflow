#!/usr/bin/env bash
# format-changed-file.sh — PostToolUse hook for Edit|Write|MultiEdit|NotebookEdit.
# Auto-formats the file that was just written, by file type:
#   - ts/tsx/js/jsx/mjs/cjs/css/scss/html/json -> eslint --fix (best effort),
#     then prettier --write (repo-local binaries only)
#   - dart -> dart format
# Markdown/YAML are intentionally NOT formatted: loop bookkeeping tables
# (TASKS.md / BLOCKERS.md / REVIEW-QUEUE.md) and workflow/openapi YAML must not
# churn from a formatter. Read-only reference dirs are never touched.
# Always exits 0 — this hook never blocks and never fails a turn.
set -u

REPO_ROOT="${CLAUDE_PROJECT_DIR:-/Users/innovera/Documents/juneflow}"
payload="$(cat 2>/dev/null || true)"

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
[ -n "$fp" ] || exit 0
case "$fp" in
  /*) abs="$fp" ;;
  *) abs="$REPO_ROOT/$fp" ;;
esac
[ -f "$abs" ] || exit 0

# Never reformat read-only references, generated output, or merged migrations.
case "$abs" in
  */pototype/*|*/juneflow-extract/*|*/design_handoff_juneflow/*) exit 0 ;;
  */docs/extract/*|*/docs/handoff/*|*/tests/visual/reference/*)  exit 0 ;;
  */node_modules/*|*/dist/*|*/build/*|*/.turbo/*|*/.git/*)       exit 0 ;;
  */packages/db/drizzle/*)                                       exit 0 ;;
esac

ext="${abs##*.}"
case "$ext" in
  ts|tsx|js|jsx|mjs|cjs|css|scss|html|json)
    eslint_bin="$REPO_ROOT/node_modules/.bin/eslint"
    prettier_bin="$REPO_ROOT/node_modules/.bin/prettier"
    case "$ext" in
      ts|tsx|js|jsx|mjs|cjs)
        [ -x "$eslint_bin" ] && "$eslint_bin" --fix "$abs" >/dev/null 2>&1 || true
        ;;
    esac
    [ -x "$prettier_bin" ] && "$prettier_bin" --write --log-level silent "$abs" >/dev/null 2>&1 || true
    ;;
  dart)
    command -v dart >/dev/null 2>&1 && dart format "$abs" >/dev/null 2>&1 || true
    ;;
esac

exit 0
