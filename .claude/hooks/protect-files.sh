#!/usr/bin/env bash
# protect-files.sh — PreToolUse guard for Edit|Write|MultiEdit|NotebookEdit.
# Blocks writes to sacred/immutable files per PLAN.md section 0 + section 10.
# Exit 0 = allow, exit 2 = block (stderr is shown to the model).
# This hook FAILS CLOSED: if the hook payload cannot be parsed, it blocks,
# because a sacred path could be hiding behind the parse error.
# Escape hatch: SACRED_OVERRIDE=wei-approved:B-<n> (a Wei-approved blocker id)
# allows the write with a stderr note.
set -u

REPO_ROOT="${CLAUDE_PROJECT_DIR:-/Users/innovera/Documents/juneflow}"
payload="$(cat 2>/dev/null || true)"

have_jq() { command -v jq >/dev/null 2>&1; }
have_py() { command -v python3 >/dev/null 2>&1; }

fail_closed() {
  printf '%s\n' "protect-files: อ่าน hook payload ไม่สำเร็จ — บล็อกไว้ก่อน (fail-closed) เพื่อคุ้มครอง sacred files ตาม PLAN.md §10 · ถ้าติดปัญหานี้ซ้ำให้บันทึกใน BLOCKERS.md" >&2
  exit 2
}

json_valid() {
  if have_jq; then
    printf '%s' "$payload" | jq -e . >/dev/null 2>&1
  elif have_py; then
    printf '%s' "$payload" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1
  else
    return 1
  fi
}

top_field() {
  if have_jq; then
    printf '%s' "$payload" | jq -r --arg k "$1" '.[$k] // empty' 2>/dev/null
  else
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
  else
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

json_valid || fail_closed

tool="$(top_field tool_name)"
case "$tool" in
  ""|Edit|Write|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

fp="$(ti_field file_path)"
[ -n "$fp" ] || fp="$(ti_field notebook_path)"
[ -n "$fp" ] || exit 0

# Resolve relative paths against the repo root, then normalize. realpath (not
# normpath) so symlinks cannot smuggle a write through to a sacred target.
case "$fp" in
  /*) abs="$fp" ;;
  *) abs="$REPO_ROOT/$fp" ;;
esac
if have_py; then
  abs="$(python3 -c 'import os,sys; sys.stdout.write(os.path.realpath(sys.argv[1]))' "$abs" 2>/dev/null || printf '%s' "$abs")"
  ROOT_REAL="$(python3 -c 'import os,sys; sys.stdout.write(os.path.realpath(sys.argv[1]))' "$REPO_ROOT" 2>/dev/null || printf '%s' "$REPO_ROOT")"
else
  ROOT_REAL="$REPO_ROOT"
fi

case "$abs" in
  "$ROOT_REAL"/*) rel="${abs#"$ROOT_REAL"/}" ;;
  "$REPO_ROOT"/*) rel="${abs#"$REPO_ROOT"/}" ;;
  *) exit 0 ;;  # outside the repo — not governed by this guard
esac

# Leading slash anchors patterns to the repo root inside `case`. Matching is
# done on a LOWERCASED copy: the repo lives on a case-insensitive filesystem
# (APFS default), so PLAN.MD / Claude.md / POTOTYPE/... resolve to the same
# inode as the sacred file and must hit the same rules.
p="$(printf '/%s' "$rel" | tr '[:upper:]' '[:lower:]')"
rule=""
case "$p" in
  /docs/extract/*)                       rule="docs/extract/** — Cowork extract pack (ข้อเท็จจริงถอดจาก prototype) ห้ามแก้" ;;
  /packages/i18n/src/i18n-full.json)     rule="packages/i18n/src/i18n-full.json — คำแปล 4 ภาษา ห้ามแปลใหม่/แก้ไขแม้แต่คำเดียว" ;;
  /packages/contracts/openapi.yaml)      rule="packages/contracts/openapi.yaml — OpenAPI contract เดียวของระบบ เปลี่ยนได้เมื่อ Wei อนุมัติเท่านั้น" ;;
  /packages/db/drizzle/*)                rule="packages/db/drizzle/** — merged migrations ห้ามแก้ย้อนหลัง" ;;
  */claude.md)                           rule="CLAUDE.md ทุกใบ (รวม root) — sacred file" ;;
  /.github|/.github/*)                   rule=".github/** — CI config เป็น sacred file" ;;
  /plan.md)                              rule="PLAN.md — แผนกลาง Wei เป็นผู้แก้คนเดียว" ;;
  /juneflow-bootstrap.md)                rule="JUNEFLOW-BOOTSTRAP.md — เอกสาร bootstrap ห้ามแก้" ;;
  /pototype/*)                           rule="pototype/** — แหล่งอ้างอิง read-only (กฎหมายสูงสุดของ design)" ;;
  /juneflow-extract/*)                   rule="juneflow-extract/** — แหล่งอ้างอิง read-only" ;;
  /design_handoff_juneflow/*)            rule="design_handoff_juneflow/** — แหล่งอ้างอิง read-only" ;;
  /tests/visual/reference/*)             rule="tests/visual/reference/** — ภาพอ้างอิงของ visual gate ห้ามแก้/ทับ" ;;
  */.env.example)                        rule="" ;;  # .env.example is explicitly allowed
  */.env|*/.env.*)                       rule=".env / .env.* — secrets ห้ามแตะ (ยกเว้น .env.example)" ;;
  *)                                     rule="" ;;
esac

if [ -n "$rule" ]; then
  # Override must match as a WHOLE single-line value — grep's ^...$ anchors are
  # per-line, so a multi-line value could smuggle one valid line past the check.
  if [ "$(printf '%s' "${SACRED_OVERRIDE:-}" | wc -l | tr -d '[:space:]')" = "0" ] \
     && printf '%s' "${SACRED_OVERRIDE:-}" | grep -Eq '^wei-approved:B-[0-9]+$'; then
    printf '%s\n' "protect-files: อนุญาตแก้ sacred file ($rel) ตาม override ที่ Wei อนุมัติ: ${SACRED_OVERRIDE}" >&2
    exit 0
  fi
  {
    printf '%s\n' "ห้ามแก้ sacred file: $rel"
    printf '%s\n' "กฎที่ชน: $rule (ตาม PLAN.md §0 + §10)"
    printf '%s\n' "ต้องแก้จริง → เขียนเหตุผลใน BLOCKERS.md แล้วรอ Wei อนุมัติ (Wei จะให้รันด้วย SACRED_OVERRIDE=wei-approved:B-<เลข blocker>) จากนั้นข้ามไป task อื่นก่อน ห้ามเดา ห้ามตัดสินเอง"
  } >&2
  exit 2
fi

exit 0
