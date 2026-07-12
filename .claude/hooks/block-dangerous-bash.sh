#!/usr/bin/env bash
# block-dangerous-bash.sh — PreToolUse guard for Bash.
# Blocks destructive / forbidden shell commands (harness delta 11 ก.ค. 2569 — B-004):
#   1. rm with recursive+force flags (rm -rf and every spelling of it)
#   2. git push --force / -f (any target, any branch)
#   3. git push targeting main directly (flow: feature -> dev -> main, Wei only)
#   4. drizzle-kit drop
#   5. commands touching .env / secrets files (.env.example is allowed)
#   6. docker system prune
# Exit 0 = allow, exit 2 = block (stderr is shown to the model).
# Fails OPEN on parse errors (same convention as block-main-commit.sh —
# fail-closed on the Bash matcher would paralyze every command).
#
# Design notes:
# - Rules 1 and 3 are evaluated PER SEGMENT (command split on ; | &) so a flag
#   or branch word in one command is not attributed to another one.
# - The guard is fail-safe: dangerous strings inside quoted data still block
#   (over-blocking accepted). A determined evasion via shell expansion (e.g.
#   $IFS tricks) cannot be fully stopped by a regex hook — this is a guardrail
#   against accidents, not a sandbox.
set -u

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

cmd="$(ti_field command)"
[ -n "$cmd" ] || exit 0  # fail-open: no command found (or parse error)

block() {
  {
    printf '%s\n' "block-dangerous-bash: คำสั่งถูกบล็อก — $1"
    printf '%s\n' "$2"
  } >&2
  exit 2
}

# Split a compound command into segments at ; | & (newlines too). Splitting
# inside quoted strings over-blocks; accepted (fail-safe).
SEGMENTS="$(printf '%s\n' "$cmd" | tr ';|&' '\n\n\n')"

seg_has() { # $1 = segment, $2 = ERE
  printf '%s' "$1" | grep -Eq "$2"
}

# Token detectors. The negated prefix class admits '/', '\', quotes, etc., so
# path-prefixed (/bin/rm) and escaped (\rm) invocations are caught.
RM_WORD='(^|[^[:alnum:]_.-])rm([[:space:]]|$)'
RECURSIVE_FLAG="(^|[[:space:]\"'])(-[A-Za-z]*[rR][A-Za-z]*|--recursive)([[:space:]\"']|\$)"
FORCE_FLAG="(^|[[:space:]\"'])(-[A-Za-z]*f[A-Za-z]*|--force)([[:space:]\"']|\$)"
GIT_PUSH='(^|[^[:alnum:]_.-])git[[:space:]]+([^|;&[:space:]]+[[:space:]]+)*push([^[:alnum:]_-]|$)'
PUSH_FORCE_FLAG="(^|[[:space:]])(--force[^[:space:]]*|-f)([[:space:]]|\$)"
MAIN_REF="(^|[[:space:]/:\"'])main([[:space:]:\"']|\$)"

# --- rules 1 + 3: per-segment ---------------------------------------------------
while IFS= read -r seg; do
  [ -n "$seg" ] || continue

  # rule 1: rm with recursive + force in the same segment
  if seg_has "$seg" "$RM_WORD" \
     && seg_has "$seg" "$RECURSIVE_FLAG" \
     && seg_has "$seg" "$FORCE_FLAG"; then
    block "rm แบบ recursive + force (rm -rf)" \
      "ลบแบบกวาดทิ้งทั้งโฟลเดอร์ต้องทำโดย Wei เองนอก Claude · ถ้าจำเป็นจริงให้ลบแบบระบุไฟล์ (ไม่ใช้ -rf) หรือเขียน BLOCKERS.md"
  fi

  # rule 2: git push with a force flag in the same segment (any target)
  if seg_has "$seg" "$GIT_PUSH" && seg_has "$seg" "$PUSH_FORCE_FLAG"; then
    block "git push --force/-f ทุกกรณี" \
      "force push ถูกห้ามทั้ง repo (PLAN.md §10) — history บน remote ต้องไม่ถูกเขียนทับ"
  fi

  # rule 3: git push targeting main in the same segment
  if seg_has "$seg" "$GIT_PUSH" && seg_has "$seg" "$MAIN_REF"; then
    block "push ตรงเข้า main" \
      "flow ที่ถูกต้อง: feature → dev (auto เมื่อ CI เขียว + diff-reviewer PASS) → main (Wei promote คนเดียว — PLAN.md §10)"
  fi
done <<SEGEOF
$SEGMENTS
SEGEOF

# --- rule 4: drizzle-kit drop ---------------------------------------------------
if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_.-])drizzle-kit[[:space:]]+([^|;&[:space:]]+[[:space:]]+)*drop([^[:alnum:]_-]|$)'; then
  block "drizzle-kit drop" \
    "ห้าม drop schema/migration ผ่าน agent — merged migrations เป็น sacred (PLAN.md §10) · ต้องการจริงให้เขียน BLOCKERS.md รอ Wei"
fi

# --- rule 5: commands touching .env / secrets -----------------------------------
# Allowed lookalikes are stripped first: .env.example (explicit carve-out) and
# the code identifiers process.env / import.meta.env (routine grep targets in a
# TS monorepo — they are not files).
stripped="$(printf '%s' "$cmd" | sed -e 's/\.env\.example//g' -e 's/process\.env//g' -e 's/import\.meta\.env//g')"
if printf '%s' "$stripped" | grep -Eq '\.env(\.[A-Za-z0-9_-]+)?([^A-Za-z0-9_-]|$)'; then
  block "คำสั่งแตะไฟล์ .env (secrets)" \
    "secrets ห้ามแตะทุกกรณี (ยกเว้น .env.example) — ตาม CLAUDE.md กฎเหล็ก + PLAN.md §10 · จัดการค่า env จริงเป็นงานของ Wei"
fi
# secrets as a PATH (dir segment or filename with extension) — the bare word
# "secrets" in prose/commit messages/grep patterns is allowed.
if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])secrets?/' \
   || printf '%s' "$cmd" | grep -Eq '/secrets?([^[:alnum:]_-]|$)' \
   || printf '%s' "$cmd" | grep -Eq "(^|[[:space:]\"'/=])secrets?\.[A-Za-z0-9]+"; then
  block "คำสั่งแตะไฟล์/โฟลเดอร์ secrets" \
    "secrets ห้ามแตะทุกกรณี — ตาม CLAUDE.md กฎเหล็ก + PLAN.md §10"
fi

# --- rule 6: docker system prune -------------------------------------------------
if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_.-])docker[[:space:]]+([^|;&[:space:]]+[[:space:]]+)*system[[:space:]]+prune([^[:alnum:]_-]|$)'; then
  block "docker system prune" \
    "กวาดล้าง docker ทั้งเครื่องกระทบ container/volume ของ dev stack (infra/) — ให้ Wei รันเองถ้าจำเป็น"
fi

exit 0
