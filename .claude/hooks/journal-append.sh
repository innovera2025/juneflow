#!/usr/bin/env bash
# journal-append.sh — Stop hook.
# When a loop agent's round ends, append one timestamped line to its journal
# (agents/journal/<agent>.md, per PLAN.md section 10). Manual sessions
# (LOOP_AGENT unset) do not journal. Always exits 0 — never blocks.
set -u

# Drain stdin (hook payload is not needed here).
cat >/dev/null 2>&1 || true

[ -n "${LOOP_AGENT:-}" ] || exit 0

# Defensive: agent names are simple slugs; refuse anything path-like.
printf '%s' "$LOOP_AGENT" | grep -Eq '^[A-Za-z0-9_-]+$' || exit 0

REPO_ROOT="${CLAUDE_PROJECT_DIR:-/Users/innovera/Documents/juneflow}"
journal_dir="$REPO_ROOT/agents/journal"
mkdir -p "$journal_dir" 2>/dev/null || exit 0

printf -- '- %s loop round ended (agent: %s)\n' "$(date -u +%FT%TZ)" "$LOOP_AGENT" \
  >> "$journal_dir/$LOOP_AGENT.md" 2>/dev/null || true

exit 0
