#!/usr/bin/env bash
# b095-reaudit.sh — orch-B static re-audit of orch-A's applied B-095 fix.
# Read-only. Verifies the applied packaging fix matches agents/orch-b-recon/b095-fix-spec.md
# WITHOUT needing a build or a booting stack — catches deviations early.
#
# Usage:  bash b095-reaudit.sh [repo-root]     # default: current dev checkout
#         bash b095-reaudit.sh /Users/innovera/juneflow-wt/backend   # audit pre-merge
set -uo pipefail
R="${1:-/Users/innovera/Documents/juneflow}"
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

audit_pkg() {  # $1=pkg  $2="subpath1 subpath2 ..."
  local p="$1"; shift; local subs="$*"
  local f="$R/packages/$p/package.json"
  echo "── @juneflow/$p"
  [ -f "$f" ] || { no "package.json missing"; return; }
  grep -q '"build"' "$f" && ok "build script present" || no "no build script"
  grep -q './dist/' "$f" && ok "exports point to ./dist" || no "exports still raw (no ./dist)"
  grep -q '"development"' "$f" && ok "development→src condition present" || no "no development condition"
  grep -q '"default".*dist' "$f" && ok "default→dist.js present" || no "no default→dist.js"
  python3 -c "import json,sys;d=json.load(open('$f'));sys.exit(1 if ('main' in d or 'types' in d) else 0)" && ok "top-level main/types removed" || no "top-level main/types still present (spec: remove)"
  [ -f "$R/packages/$p/tsconfig.build.json" ] && ok "tsconfig.build.json exists" || no "tsconfig.build.json MISSING"
  grep -q 'types.*\[\]' "$R/packages/$p/tsconfig.json" 2>/dev/null && ok "types:[] kept (no @types/node)" || echo "  •  (verify types unchanged)"
  # each subpath maps to a dist file
  for s in $subs; do
    grep -q "dist/$s" "$f" && ok "subpath dist/$s wired" || no "subpath $s not wired to dist"
  done
}

echo "=========================================================="
echo " B-095 static re-audit  ·  root: $R"
echo "=========================================================="
audit_pkg tax-engine "index" "thailand/index" "config"
audit_pkg bank-file  "index" "kbank-direct/index" "config"
# notifications is optional (folded proactively) — audit only if it was touched
if grep -q '"build"' "$R/packages/notifications/package.json" 2>/dev/null; then
  audit_pkg notifications "index" "adapters/line" "adapters/email" "adapters/webpush" "config"
else
  echo "── @juneflow/notifications: (not folded — optional, OK)"
fi

echo "── apps/api/Dockerfile (build ORDER: packages before api)"
D="$R/apps/api/Dockerfile"
te=$(grep -n 'filter @juneflow/tax-engine build' "$D" | head -1 | cut -d: -f1)
bf=$(grep -n 'filter @juneflow/bank-file build'  "$D" | head -1 | cut -d: -f1)
ap=$(grep -n 'filter @juneflow/api build'        "$D" | head -1 | cut -d: -f1)
[ -n "$te" ] && ok "tax-engine build line present" || no "tax-engine build line missing"
[ -n "$bf" ] && ok "bank-file build line present"  || no "bank-file build line missing"
if [ -n "$te" ] && [ -n "$bf" ] && [ -n "$ap" ] && [ "$te" -lt "$ap" ] && [ "$bf" -lt "$ap" ]; then
  ok "packages build BEFORE api build (order correct)"
else
  no "build order wrong / api build line not found (packages must precede api)"
fi

echo "── gitignore: dist/ ignored (emitted output not committed)"
grep -qE '^dist/' "$R/.gitignore" && ok "dist/ gitignored" || echo "  •  check .gitignore"

echo "=========================================================="
if [ "$FAIL" -eq 0 ]; then
  echo " RESULT: ✅ APPLIED CORRECTLY ($PASS checks) — matches b095-fix-spec.md"
else
  echo " RESULT: ⚠️  $FAIL deviation(s) / not-yet-applied · $PASS ok"
  echo " (if all ❌ = orch-A hasn't landed the fix here yet)"
fi
echo "=========================================================="
echo "NEXT: build-emit proof (optional, needs deps):"
echo "  pnpm --filter @juneflow/tax-engine build && ls $R/packages/tax-engine/dist"