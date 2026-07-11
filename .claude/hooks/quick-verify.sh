#!/usr/bin/env bash
# quick-verify.sh — PostToolUse hook for Edit|Write|MultiEdit.
# After a TypeScript file changes, typecheck ONLY the workspace package that
# owns it, via turbo scoped run:  turbo run typecheck --filter=<package>
# Exit 0 = quiet pass (or nothing to do). Exit 2 = typecheck failed — stderr is
# fed back to the model as feedback (PostToolUse never blocks the tool itself).
# Fails open when the toolchain is not ready (no node_modules / no turbo / no
# typecheck script). Escape hatch: QUICK_VERIFY_DISABLE=1.
set -u

[ "${QUICK_VERIFY_DISABLE:-0}" = "1" ] && exit 0

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
[ -n "$fp" ] || exit 0

case "$fp" in
  *.ts|*.tsx|*.mts|*.cts) ;;
  *) exit 0 ;;
esac

case "$fp" in
  /*) abs="$fp" ;;
  *) abs="$REPO_ROOT/$fp" ;;
esac
case "$abs" in
  "$REPO_ROOT"/*) rel="${abs#"$REPO_ROOT"/}" ;;
  *) exit 0 ;;
esac
case "$rel" in
  */node_modules/*|*.d.ts) exit 0 ;;
esac

# Workspace package = first two path segments (apps/<x> or packages/<x>).
case "$rel" in
  apps/*/*|packages/*/*) pkg_dir="$(printf '%s' "$rel" | cut -d/ -f1-2)" ;;
  *) exit 0 ;;
esac

pkg_json="$REPO_ROOT/$pkg_dir/package.json"
turbo_bin="$REPO_ROOT/node_modules/.bin/turbo"
[ -f "$pkg_json" ] || exit 0
[ -x "$turbo_bin" ] || exit 0  # deps not installed yet — fail open
have_jq || exit 0

pkg_name="$(jq -r '.name // empty' "$pkg_json" 2>/dev/null)"
[ -n "$pkg_name" ] || exit 0
jq -e '.scripts.typecheck // empty' "$pkg_json" >/dev/null 2>&1 || exit 0

out="$(cd "$REPO_ROOT" && "$turbo_bin" run typecheck --filter="$pkg_name" --output-logs=errors-only 2>&1)"
status=$?

if [ "$status" -ne 0 ]; then
  {
    printf '%s\n' "quick-verify: typecheck ล้มเหลวใน package \"$pkg_name\" (หลังแก้ $rel) — แก้ type error ก่อนไปต่อ:"
    printf '%s\n' "$out" | tail -n 40
  } >&2
  exit 2
fi

exit 0
