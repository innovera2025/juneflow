#!/usr/bin/env bash
# group-c-wave1-verify.sh — orch-B independent live-verify of group-C Wave-1 on a
# FRESH prod-image stack at <dev-sha>. Does NOT trust orch-A's proof — boots its own
# isolated compose (migrate 0000..0030 + seed), logs in, and curls the endpoints to
# confirm: (1) the clock-relative seed trips the overdue alert + negative cashflow
# TODAY (not just on orch-A's run day), (2) GET /audit-log returns rows newest-first
# + the ?action filter works, (3) the 7 dashboard endpoints all respond. Tenant
# isolation is proven structurally (TenantDb door auto-scopes) + unit (audit-log.test).
# Usage: bash group-c-wave1-verify.sh <dev-sha>
set -uo pipefail
DEV_REF="${1:-dev}"
ROOT="/Users/innovera/Documents/juneflow"
WT="/Users/innovera/juneflow-wt/fine2e"
export COMPOSE_PROJECT_NAME="juneflow-fine2e"
export POSTGRES_PORT=5437 REDIS_PORT=6384 API_PORT=3104 WEB_PORT=5276
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${WT}/infra/docker-compose.yml"
API="http://localhost:${API_PORT}/api/v1"
PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✘ $1"; FAIL=$((FAIL+1)); }

cleanup(){ echo "== teardown =="; $COMPOSE down -v --remove-orphans 2>/dev/null||true; git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null||true; }
trap cleanup EXIT

echo "== 1. worktree @ ${DEV_REF} + install =="
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
git -C "$ROOT" worktree add --force --detach "$WT" "$DEV_REF" >/dev/null 2>&1
( cd "$WT" && pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 ) || { echo "INSTALL FAILED"; exit 1; }

echo "== 2. compose up --wait (live migrate 0000..0030 + seed + api node-dist boot) =="
$COMPOSE up -d --build --wait >/dev/null 2>&1 || { echo "COMPOSE UP FAILED"; $COMPOSE logs api 2>/dev/null | tail -30; exit 1; }

echo "== 3. login (wipha@ · seed pw) → bearer =="
TOKEN=$(curl -s -X POST "${API}/auth/login" -H 'content-type: application/json' \
  -d '{"email":"wipha@rungrueang.co.th","password":"juneflow-dev"}' | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
[ -n "$TOKEN" ] && ok "login → bearer token" || { bad "login failed"; exit 1; }
AUTH=(-H "authorization: Bearer ${TOKEN}")

echo "== 4. checks =="
# (a) overdue alert trips TODAY (clock-relative seed: INV due=today-10)
ALERTS=$(curl -s "${AUTH[@]}" "${API}/dashboard/alerts")
echo "$ALERTS" | grep -q 'OVERDUE_PAYABLE' && ok "alerts trips OVERDUE_PAYABLE (clock-relative seed live TODAY)" || bad "no OVERDUE_PAYABLE in alerts: $(echo "$ALERTS" | head -c 200)"

# (b) cashflow net negative (payables-only per Wei ruling)
CF=$(curl -s "${AUTH[@]}" "${API}/dashboard/cashflow-forecast")
NET=$(echo "$CF" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("net_total", d.get("net","")))' 2>/dev/null)
python3 -c "import sys; sys.exit(0 if float('$NET' or 0) < 0 else 1)" 2>/dev/null && ok "cashflow net_total < 0 (=${NET}, payables-only as-ruled)" || bad "cashflow net not negative (=${NET}): $(echo "$CF" | head -c 200)"

# (c) audit-log returns rows, newest-first
AL=$(curl -s "${AUTH[@]}" "${API}/audit-log")
python3 - "$AL" <<'PY' && ok "audit-log rows>0 + newest-first (at DESC)" || bad "audit-log rows/order fail"
import sys,json
d=json.loads(sys.argv[1]); rows=d.get("data",[])
ats=[r["at"] for r in rows]
assert len(rows)>0, "no rows"
assert ats==sorted(ats,reverse=True), "not newest-first"
PY

# (d) ?action=approve filter narrows
ALA=$(curl -s "${AUTH[@]}" "${API}/audit-log?action=approve")
NA=$(echo "$ALA" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("data",[])))' 2>/dev/null)
ALL=$(echo "$AL" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("data",[])))' 2>/dev/null)
python3 -c "import sys; sys.exit(0 if 0 < int('$NA' or 0) <= int('$ALL' or 0) else 1)" 2>/dev/null && ok "?action=approve narrows (${NA} of ${ALL})" || bad "action filter fail (${NA}/${ALL})"

# (e) tenant-scope live proof: audit-log 401 without a token (fail-closed)
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${API}/audit-log")
[ "$CODE" = "401" ] && ok "audit-log 401 fail-closed (no bearer)" || bad "audit-log without token = $CODE (expected 401)"

# (f) 7 dashboard endpoints all respond 200
DEP=(summary budget-actual approvals-inbox phase-progress alerts cashflow-forecast contractors)
D7=0; for e in "${DEP[@]}"; do c=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${API}/dashboard/${e}"); [ "$c" = "200" ] && D7=$((D7+1)) || echo "    dashboard/${e} = $c"; done
[ "$D7" = "7" ] && ok "7/7 dashboard endpoints respond 200" || bad "only ${D7}/7 dashboard endpoints 200"

echo ""
echo "======== group-C Wave-1 LIVE VERIFY (dev ${DEV_REF}) — PASS ${PASS} / FAIL ${FAIL} ========"
[ "$FAIL" = "0" ] && echo "VERDICT: GO" || echo "VERDICT: FAIL — see ✘ above"
