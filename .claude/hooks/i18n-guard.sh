#!/usr/bin/env bash
# i18n-guard.sh — PreToolUse guard for Edit|Write|MultiEdit.
# Blocks hardcoded Thai text (U+0E00-U+0E7F) in UI code files:
#   apps/web/src/**/*.ts|*.tsx  and  apps/mobile/lib/**/*.dart
# UI strings must be i18n keys from packages/i18n/src/i18n-full.json
# (PLAN.md section 0 rule 2). Skips .md/.json and test files.
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

tool="$(top_field tool_name)"
case "$tool" in
  ""|Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

fp="$(ti_field file_path)"
[ -n "$fp" ] || exit 0

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
p="/$rel"

# Skip test files (and .md/.json never pass the extension gate below anyway).
case "$p" in
  *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*_test.dart|*/__tests__/*|*/test/*) exit 0 ;;
esac

# Only guard UI code files.
case "$p" in
  /apps/web/src/*.ts|/apps/web/src/*.tsx|/apps/mobile/lib/*.dart) ;;
  *) exit 0 ;;
esac

# Collect all text being written: Write content, Edit new_string,
# and every new_string inside MultiEdit edits[].
if have_jq; then
  text="$(printf '%s' "$payload" | jq -r '
    [((.tool_input // {}).content // ""),
     ((.tool_input // {}).new_string // ""),
     (((.tool_input // {}).edits // []) | map(.new_string // "") | join("\n"))]
    | join("\n")' 2>/dev/null)"
elif have_py; then
  text="$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    ti = d.get("tool_input") or {}
    parts = [str(ti.get("content") or ""), str(ti.get("new_string") or "")]
    for e in (ti.get("edits") or []):
        parts.append(str((e or {}).get("new_string") or ""))
    sys.stdout.write("\n".join(parts))
except Exception:
    pass
' 2>/dev/null)"
else
  text=""
fi

[ -n "$text" ] || exit 0

has_thai() {
  if have_py; then
    printf '%s' "$text" | python3 -c '
import sys
data = sys.stdin.buffer.read().decode("utf-8", "ignore")
sys.exit(0 if any("฀" <= ch <= "๿" for ch in data) else 1)
'
  else
    # Byte-level fallback: Thai block encodes as UTF-8 0xE0 0xB8/0xB9 0x8x-0xBx.
    printf '%s' "$text" | LC_ALL=C grep -q "$(printf '\xe0\xb8')" || \
    printf '%s' "$text" | LC_ALL=C grep -q "$(printf '\xe0\xb9')"
  fi
}

if has_thai; then
  {
    printf '%s\n' "พบตัวอักษรไทย hardcode ในไฟล์โค้ด UI: $rel"
    printf '%s\n' "UI strings ต้องเป็น i18n key จาก packages/i18n/src/i18n-full.json เท่านั้น — ห้าม hardcode/แปลใหม่แม้แต่คำเดียว (PLAN.md §0 กฎข้อ 2)"
    printf '%s\n' "ไม่มี key ที่ต้องใช้ → เขียน BLOCKERS.md แล้วข้ามไป task อื่น"
    printf '%s\n' "เตือนเพิ่มเติม: โค้ด / comment / config ต้องเป็นภาษาอังกฤษทั้งหมด (CLAUDE.md หัวข้อภาษา)"
  } >&2
  exit 2
fi

exit 0
