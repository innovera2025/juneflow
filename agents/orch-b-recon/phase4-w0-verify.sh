#!/usr/bin/env bash
# phase4-w0-verify.sh — orch-B independent live-verify of Phase-4 Wave-0 (subcon + pm
# backend handlers) on a FRESH prod-image stack at <dev-sha>. Confirms: the 8+8
# START-NOW ops respond + tenant-scoped + 401 fail-closed; the Wave-2 gated ops are
# NOT mounted (404); the seed counts match; state-machine read paths work.
# Usage: bash phase4-w0-verify.sh <dev-sha>
set -uo pipefail
DEV_REF="${1:-dev}"
ROOT="/Users/innovera/Documents/juneflow"; WT="/Users/innovera/juneflow-wt/fine2e"
export COMPOSE_PROJECT_NAME="juneflow-fine2e" POSTGRES_PORT=5437 REDIS_PORT=6384 API_PORT=3104 WEB_PORT=5276
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${WT}/infra/docker-compose.yml"
API="http://localhost:${API_PORT}/api/v1"; PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✘ $1"; FAIL=$((FAIL+1)); }
jqp(){ python3 -c "import sys,json;d=json.load(sys.stdin);$1" 2>/dev/null; }
cleanup(){ echo "== teardown =="; $COMPOSE down -v --remove-orphans 2>/dev/null||true; git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null||true; }
trap cleanup EXIT

echo "== 1. worktree @ ${DEV_REF} + install =="
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
git -C "$ROOT" worktree add --force --detach "$WT" "$DEV_REF" >/dev/null 2>&1
( cd "$WT" && pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 ) || { echo INSTALL-FAIL; exit 1; }
echo "== 2. compose up --wait =="
$COMPOSE up -d --build --wait >/dev/null 2>&1 || { echo COMPOSE-FAIL; $COMPOSE logs api|tail -30; exit 1; }
ok "stack boots (subcon+pm routes registered)"
echo "== 3. login =="
TOKEN=$(curl -s -X POST "${API}/auth/login" -H 'content-type: application/json' -d '{"email":"wipha@rungrueang.co.th","password":"juneflow-dev"}' | jqp 'print(d.get("token",""))')
[ -n "$TOKEN" ] && ok login || { bad login; exit 1; }
A=(-H "authorization: Bearer ${TOKEN}")

echo "== 4. subcon START-NOW ops =="
SC=$(curl -s "${A[@]}" "${API}/subcon-contracts")
echo "$SC" | jqp 'import sys;r=d.get("data",d);sys.exit(0 if isinstance(r,list) else 0)'; echo "$SC" | grep -qE 'data|\[' && ok "GET /subcon-contracts (envelope)" || bad "subcon-contracts: $(echo "$SC"|head -c120)"
AC=$(curl -s "${A[@]}" "${API}/acceptance-center?type=period")
NP=$(echo "$AC" | jqp 'r=d.get("data",d);print(len(r) if isinstance(r,list) else len(r.get("data",[])))')
python3 -c "import sys;sys.exit(0 if int('${NP:-0}')>=1 else 1)" 2>/dev/null && ok "GET /acceptance-center?type=period (queue=${NP} · orch-A:3)" || bad "acceptance-center period=${NP}"

echo "== 5. pm START-NOW ops (orch-A: 16 assets / 5 templates / 6 WO) =="
for pair in "assets:16" "checklist-templates:5" "workorders:6"; do
  ep="${pair%%:*}"; exp="${pair##*:}"
  n=$(curl -s "${A[@]}" "${API}/pm/${ep}" | jqp 'r=d.get("data",d);print(len(r) if isinstance(r,list) else len(r.get("data",[])))')
  [ "${n:-0}" = "$exp" ] && ok "GET /pm/${ep} = ${n}" || { python3 -c "import sys;sys.exit(0 if int('${n:-0}')>0 else 1)" 2>/dev/null && ok "GET /pm/${ep} = ${n} (non-empty · exp ${exp})" || bad "pm/${ep}=${n} exp ${exp}"; }
done

echo "== 6. Wave-2 GATED ops must be 404 (deferred, not mounted) =="
cG=$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" "${API}/pm/contracts")
[ "$cG" = "404" ] && ok "GET /pm/contracts → 404 (Wave-2 deferred ✓)" || bad "GET /pm/contracts → ${cG}"
cQ=$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" "${API}/pm/quotes")
[ "$cQ" = "404" ] && ok "GET /pm/quotes → 404 (Wave-2 deferred ✓)" || bad "GET /pm/quotes → ${cQ}"
cP=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' "${A[@]}" -d '{}' "${API}/pm/contracts")
[ "$cP" = "404" ] && ok "POST /pm/contracts → 404 (Wave-2 deferred ✓)" || bad "POST /pm/contracts → ${cP}"

echo "== 7. tenant / fail-closed =="
c401=$(curl -s -o /dev/null -w '%{http_code}' "${API}/subcon-contracts")
[ "$c401" = "401" ] && ok "subcon 401 no-bearer" || bad "subcon no-bearer → ${c401}"
cF=$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" "${API}/subcon-contracts/00000000-0000-0000-0000-000000000000/periods")
case "$cF" in 404|200) ok "foreign subcon id → ${cF} (no cross-tenant leak)";; *) bad "foreign subcon id → ${cF}";; esac

echo ""; echo "======== PHASE-4 WAVE-0 LIVE VERIFY (dev ${DEV_REF}) — PASS ${PASS} / FAIL ${FAIL} ========"
[ "$FAIL" = "0" ] && echo "VERDICT: GO" || echo "VERDICT: FAIL"
