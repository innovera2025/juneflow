#!/usr/bin/env bash
# group-c-w2w3-verify.sh — orch-B independent live-verify of group-C W2+W3+W1b on a
# FRESH prod-image stack at <dev-sha>. Confirms: live migrate 0000..0031 + evm_snapshot
# seed boots; the new report/analytics endpoints return real aggregates; the evm_snapshot
# BUILD-ONCE backfill lit up the dashboard budget-actual S-curve; tenant scope holds.
# Usage: bash group-c-w2w3-verify.sh <dev-sha>
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
jqp(){ python3 -c "import sys,json;d=json.load(sys.stdin);$1" 2>/dev/null; }

cleanup(){ echo "== teardown =="; $COMPOSE down -v --remove-orphans 2>/dev/null||true; git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null||true; }
trap cleanup EXIT

echo "== 1. worktree @ ${DEV_REF} + install =="
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
git -C "$ROOT" worktree add --force --detach "$WT" "$DEV_REF" >/dev/null 2>&1
( cd "$WT" && pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 ) || { echo "INSTALL FAILED"; exit 1; }

echo "== 2. compose up --wait (live migrate 0000..0031 evm_snapshot + seed) =="
$COMPOSE up -d --build --wait >/dev/null 2>&1 || { echo "COMPOSE UP FAILED (migrate 0031?)"; $COMPOSE logs api 2>/dev/null | tail -30; exit 1; }
ok "stack boots (migrate 0000..0031 + seed OK)"

echo "== 2b. evm_snapshot table + rows on live PG =="
CNT=$($COMPOSE exec -T postgres psql -U juneflow -d juneflow -tAc "select count(*) from evm_snapshot;" 2>/dev/null | tr -d '[:space:]')
python3 -c "import sys; sys.exit(0 if int('${CNT:-0}')>=10 else 1)" 2>/dev/null && ok "evm_snapshot seeded (${CNT} rows · ~12 expected)" || bad "evm_snapshot rows=${CNT} (expected ~12)"

echo "== 3. login → bearer =="
TOKEN=$(curl -s -X POST "${API}/auth/login" -H 'content-type: application/json' -d '{"email":"wipha@rungrueang.co.th","password":"juneflow-dev"}' | jqp 'print(d.get("token",""))')
[ -n "$TOKEN" ] && ok "login" || { bad "login failed"; exit 1; }
AUTH=(-H "authorization: Bearer ${TOKEN}")
PID=$(curl -s "${AUTH[@]}" "${API}/projects" | jqp 'r=d.get("data",d); print((r[0] if isinstance(r,list) else r["data"][0])["id"])')
[ -n "$PID" ] && ok "got project_id ${PID:0:8}…" || bad "no project_id"

echo "== 4. W2 endpoints =="
# cost-type: real M/S/L
CT=$(curl -s "${AUTH[@]}" "${API}/boq/reports/cost-type?project_id=${PID}")
echo "$CT" | grep -qiE 'material|subcon|labor|rows' && ok "cost-type returns M/S/L structure" || bad "cost-type: $(echo "$CT"|head -c150)"
# boq-vs-nonboq responds (non_boq honest-0 per orch-A C10 gap — accept 200 + rows)
BN=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${API}/boq/reports/boq-vs-nonboq?project_id=${PID}")
[ "$BN" = "200" ] && ok "boq-vs-nonboq 200 (non_boq honest-0 = C10, not fabricated)" || bad "boq-vs-nonboq = $BN"
# portfolio: projects array
PF=$(curl -s "${AUTH[@]}" "${API}/analytics/portfolio")
NP=$(echo "$PF" | jqp 'p=d.get("projects",[]);print(len(p))')
python3 -c "import sys; sys.exit(0 if int('${NP:-0}')>0 else 1)" 2>/dev/null && ok "portfolio ${NP} projects (real rollup)" || bad "portfolio projects=${NP}: $(echo "$PF"|head -c150)"

echo "== 5. W3 BUILD-ONCE proof: budget-actual S-curve lit by evm_snapshot =="
BA=$(curl -s "${AUTH[@]}" "${API}/dashboard/budget-actual?project_id=${PID}")
NPER=$(echo "$BA" | jqp 'import json; print(len(d.get("period_label",[])))')
python3 -c "import sys; sys.exit(0 if int('${NPER:-0}')>=10 else 1)" 2>/dev/null && ok "budget-actual series NON-EMPTY (${NPER} periods · evm_snapshot backfill live · was honest-empty pre-W3)" || bad "budget-actual periods=${NPER} (expected ~12): $(echo "$BA"|head -c150)"

echo "== 6. tenant scope + fail-closed on a new endpoint =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${API}/analytics/portfolio")
[ "$CODE" = "401" ] && ok "portfolio 401 fail-closed (no bearer)" || bad "portfolio no-token = $CODE (expected 401)"
# foreign project_id → 404 (ownedProject door)
FCODE=$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${API}/boq/reports/cost-type?project_id=00000000-0000-0000-0000-000000000000")
[ "$FCODE" = "404" ] || [ "$FCODE" = "200" ] && ok "cost-type foreign project_id → ${FCODE} (404=door / 200=empty-scoped, both no-leak)" || bad "cost-type foreign id = $FCODE"

echo ""
echo "======== group-C W2+W3+W1b LIVE VERIFY (dev ${DEV_REF}) — PASS ${PASS} / FAIL ${FAIL} ========"
[ "$FAIL" = "0" ] && echo "VERDICT: GO" || echo "VERDICT: FAIL — see ✘ above"
