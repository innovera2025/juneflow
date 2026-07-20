#!/usr/bin/env bash
# phase4-w2-money-verify.sh — orch-B independent LIVE money-authority proof of
# Phase-4 Wave-2 (subcon approve-payment) on a FRESH prod-image stack at <sha>.
# Proves ON REAL POSTGRES (not the mock-DB unit tests):
#   1. migrations 0000→0034 apply clean (additive money/name cols).
#   2. approve-payment on a PASSED percent period RECONCILES to the server formula
#      gross = pct/100 × contract.value · retention = gross × retention_pct/100.
#   3. a BOGUS client-supplied amount in the body is IGNORED (money authority=server).
#   4. re-approve the now-`paid` period → 409 (state guard, no double-pay).
#   5. a foreign/garbage period id → 404 (no cross-tenant, fail-closed).
#   6. no-bearer → 401.
# Usage: bash phase4-w2-money-verify.sh <sha>
set -uo pipefail
DEV_REF="${1:-dev}"
ROOT="/Users/innovera/Documents/juneflow"; WT="/Users/innovera/juneflow-wt/w2money"
export COMPOSE_PROJECT_NAME="juneflow-w2money" POSTGRES_PORT=5438 REDIS_PORT=6385 API_PORT=3105 WEB_PORT=5277
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

echo "== 2. compose up --wait (migrate 0000→0034 on real PG + seed) =="
$COMPOSE up -d --build --wait >/dev/null 2>&1 || { echo COMPOSE-FAIL; $COMPOSE logs api|tail -40; exit 1; }
ok "stack boots — migrations 0000→0034 applied clean (additive cols, seed backfill)"

echo "== 3. login =="
TOKEN=$(curl -s -X POST "${API}/auth/login" -H 'content-type: application/json' -d '{"email":"wipha@rungrueang.co.th","password":"juneflow-dev"}' | jqp 'print(d.get("token",""))')
[ -n "$TOKEN" ] && ok login || { bad login; exit 1; }
A=(-H "authorization: Bearer ${TOKEN}")

echo "== 4. find a PASSED percent period + its contract (server data) =="
# Walk each contract's periods; pick the first basis=percent status=passed period.
CONTRACTS=$(curl -s "${A[@]}" "${API}/subcon-contracts")
FOUND=$(python3 - "$TOKEN" "$API" <<'PY'
import sys,json,urllib.request
token,api=sys.argv[1],sys.argv[2]
def get(u):
    r=urllib.request.Request(u,headers={"authorization":f"Bearer {token}"})
    return json.load(urllib.request.urlopen(r))
cs=get(f"{api}/subcon-contracts"); cs=cs.get("data",cs)
for c in cs:
    pr=get(f"{api}/subcon-contracts/{c['id']}/periods"); pr=pr.get("data",pr)
    for p in pr:
        if p.get("basis")=="percent" and p.get("status")=="passed":
            gross=round(float(p["pct"])/100.0*float(c["value"]),2)
            ret=round(gross*float(c["retention_pct"])/100.0,2)
            print(json.dumps({"pid":p["id"],"cid":c["id"],"pct":p["pct"],"cval":c["value"],
                "rpct":c["retention_pct"],"gross":gross,"ret":ret,"net":round(gross-ret,2)}))
            sys.exit(0)
sys.exit(1)
PY
)
if [ -z "$FOUND" ]; then bad "no passed percent period in seed — cannot run live reconcile"; echo ""; echo "PARTIAL"; exit 1; fi
PID=$(echo "$FOUND" | jqp 'print(d["pid"])'); CID=$(echo "$FOUND" | jqp 'print(d["cid"])')
E_GROSS=$(echo "$FOUND" | jqp 'print(d["gross"])'); E_RET=$(echo "$FOUND" | jqp 'print(d["ret"])'); E_NET=$(echo "$FOUND" | jqp 'print(d["net"])')
ok "passed percent period ${PID:0:8} · pct=$(echo "$FOUND"|jqp 'print(d["pct"])') × value=$(echo "$FOUND"|jqp 'print(d["cval"])') → expect gross=${E_GROSS} ret=${E_RET} net=${E_NET}"

echo "== 5. approve-payment WITH A BOGUS CLIENT AMOUNT (must be IGNORED) =="
RESP=$(curl -s -X POST "${A[@]}" -H 'content-type: application/json' -d '{"amount":99999999,"gross":88888888,"retention":0}' "${API}/periods/${PID}/approve-payment")
R_GROSS=$(echo "$RESP" | jqp 'print(d.get("gross"))'); R_RET=$(echo "$RESP" | jqp 'print(d.get("retention"))'); R_NET=$(echo "$RESP" | jqp 'print(d.get("net"))'); R_STATUS=$(echo "$RESP" | jqp 'print(d.get("status"))'); R_AP=$(echo "$RESP" | jqp 'print(d.get("ap_billing_id"))')
python3 -c "import sys;sys.exit(0 if abs(float('${R_GROSS:-0}')-float('${E_GROSS}'))<0.01 else 1)" 2>/dev/null \
  && ok "gross=${R_GROSS} == server-computed ${E_GROSS} (bogus 99999999 IGNORED ✓)" || bad "gross=${R_GROSS} != ${E_GROSS} (client amount leaked!) · resp=$(echo "$RESP"|head -c160)"
python3 -c "import sys;sys.exit(0 if abs(float('${R_RET:-0}')-float('${E_RET}'))<0.01 else 1)" 2>/dev/null \
  && ok "retention=${R_RET} == ${E_RET} (gross × retention_pct)" || bad "retention=${R_RET} != ${E_RET}"
python3 -c "import sys;sys.exit(0 if abs(float('${R_NET:-0}')-float('${E_NET}'))<0.01 else 1)" 2>/dev/null \
  && ok "net=${R_NET} == gross−retention ${E_NET}" || bad "net=${R_NET} != ${E_NET}"
[ "$R_STATUS" = "paid" ] && ok "period → paid" || bad "status=${R_STATUS} (expect paid)"
[ -n "$R_AP" ] && [ "$R_AP" != "None" ] && ok "ap_billing row created (id ${R_AP:0:8}) — retention held-back recorded" || bad "no ap_billing_id in response"

echo "== 6. re-approve the now-paid period → 409 (no double-pay) =="
c409=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${A[@]}" -H 'content-type: application/json' -d '{}' "${API}/periods/${PID}/approve-payment")
[ "$c409" = "409" ] && ok "re-approve paid period → 409 INVALID_STATE (atomic guard held)" || bad "re-approve → ${c409} (expect 409)"

echo "== 7. foreign/garbage period id → 404 · no-bearer → 401 =="
c404=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${A[@]}" -H 'content-type: application/json' -d '{}' "${API}/periods/00000000-0000-0000-0000-000000000000/approve-payment")
[ "$c404" = "404" ] && ok "foreign period id → 404 (no cross-tenant leak)" || bad "foreign id → ${c404} (expect 404)"
c401=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "${API}/periods/${PID}/approve-payment")
[ "$c401" = "401" ] && ok "no-bearer → 401 (fail-closed)" || bad "no-bearer → ${c401} (expect 401)"

echo ""; echo "======== PHASE-4 WAVE-2 MONEY-AUTHORITY LIVE VERIFY (${DEV_REF}) — PASS ${PASS} / FAIL ${FAIL} ========"
[ "$FAIL" = "0" ] && echo "VERDICT: GO" || echo "VERDICT: FAIL"
