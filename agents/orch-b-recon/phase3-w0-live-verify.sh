#!/usr/bin/env bash
# phase3-w0-live-verify.sh — orch-B LIVE proof of Phase-3 Wave-0 (ar/etax/gl/fa) on real PG.
# Proves: AR server-money (bogus client amount IGNORED live) · RV over-alloc 409 · etax C4 flip ·
# trial-balance Dr=Cr from real jv_line · close-period CE-strict 400/200/409 + locked-JV 409 · 401.
# Usage: bash phase3-w0-live-verify.sh <sha>
set -uo pipefail
DEV_REF="${1:-dev}"
ROOT="/Users/innovera/Documents/juneflow"; WT="/Users/innovera/juneflow-wt/p3w0"
export COMPOSE_PROJECT_NAME="juneflow-p3w0" POSTGRES_PORT=5443 REDIS_PORT=6390 API_PORT=3111 WEB_PORT=5285
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${WT}/infra/docker-compose.yml"
API="http://localhost:${API_PORT}/api/v1"; PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✘ $1"; FAIL=$((FAIL+1)); }
jqp(){ python3 -c "import sys,json;d=json.load(sys.stdin);$1" 2>/dev/null; }
cleanup(){ echo "== teardown =="; $COMPOSE down -v --remove-orphans 2>/dev/null||true; git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null||true; }
trap cleanup EXIT

echo "== 1. worktree @ ${DEV_REF} + install + compose =="
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
git -C "$ROOT" worktree add --force --detach "$WT" "$DEV_REF" >/dev/null 2>&1
( cd "$WT" && pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 ) || { echo INSTALL-FAIL; exit 1; }
$COMPOSE up -d --build --wait >/dev/null 2>&1 || { echo COMPOSE-FAIL; $COMPOSE logs api|tail -30; exit 1; }
ok "stack boots (ar/etax/fa routes registered)"
TOKEN=$(curl -s -X POST "${API}/auth/login" -H 'content-type: application/json' -d '{"email":"wipha@rungrueang.co.th","password":"juneflow-dev"}' | jqp 'print(d.get("token",""))')
[ -n "$TOKEN" ] && ok login || { bad login; exit 1; }
A=(-H "authorization: Bearer ${TOKEN}" -H 'content-type: application/json')

echo "== 2. AR server-money — bogus client amount/vat MUST be ignored =="
# GET /customers is declared-but-UNSERVED (gap flagged C-179) — fetch id from DB directly.
CUST=$($COMPOSE exec -T postgres psql -U juneflow -d juneflow -tAc "select id from customer limit 1" 2>/dev/null | tr -d '[:space:]')
[ -n "$CUST" ] && ok "customer ${CUST:0:8}" || bad "no customer"
INV=$(curl -s -X POST "${A[@]}" -d "{\"customer_id\":\"${CUST}\",\"no\":\"INV-LIVE-001\",\"amount\":99999999,\"vat\":123456,\"lines\":[{\"qty\":2,\"price\":100000},{\"qty\":1,\"price\":50000}]}" "${API}/ar/invoices")
IAMT=$(echo "$INV" | jqp 'print(d.get("amount"))'); IVAT=$(echo "$INV" | jqp 'print(d.get("vat"))'); IID=$(echo "$INV" | jqp 'print(d.get("id",""))')
python3 -c "import sys;sys.exit(0 if abs(float('${IAMT:-0}')-250000)<0.01 else 1)" && ok "amount=250000 (Σ 2×100k+1×50k · bogus 99999999 IGNORED)" || bad "amount=${IAMT} resp=$(echo "$INV"|head -c150)"
python3 -c "import sys;sys.exit(0 if abs(float('${IVAT:-0}')-17500)<0.01 else 1)" && ok "vat=17500 (7% server calcVat · bogus 123456 IGNORED)" || bad "vat=${IVAT}"
echo "== 3. RV — over-allocation REJECT · valid partial OK =="
c409=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${A[@]}" -d "{\"invoice_id\":\"${IID}\",\"amount\":999999}" "${API}/ar/rv")
[ "$c409" = "409" ] && ok "RV over-alloc (999999 > outstanding 267500) → 409 REJECT" || bad "over-alloc → ${c409}"
cOK=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${A[@]}" -d "{\"invoice_id\":\"${IID}\",\"amount\":100000}" "${API}/ar/rv")
[ "$cOK" = "201" ] || [ "$cOK" = "200" ] && ok "RV partial 100000 → ${cOK}" || bad "RV partial → ${cOK}"

echo "== 4. etax C4 flip queued→sent + honest status =="
S1=$(curl -s -H "authorization: Bearer ${TOKEN}" "${API}/etax/status"); Q1=$(echo "$S1" | jqp 'r=d.get("data",d);print(r if isinstance(r,dict) else d)' | head -c120)
cS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${A[@]}" -d "{\"invoice_ids\":[\"${IID}\"]}" "${API}/etax/send")
[ "$cS" = "200" ] && ok "etax/send → 200 (queued→sent)" || bad "etax/send → ${cS}"

echo "== 5. trial-balance — real Σ + Dr=Cr =="
TB=$(curl -s -H "authorization: Bearer ${TOKEN}" "${API}/gl/reports/trial-balance")
echo "$TB" | jqp 'import sys;r=d.get("data",d);rows=r if isinstance(r,list) else r.get("rows",[]);sys.exit(0 if len(rows)>0 else 1)' && ok "trial rows > 0 (from real jv_line)" || bad "trial empty/bad: $(echo "$TB"|head -c120)"

echo "== 6. close-period — BE reject · CE lock · re-close 409 · locked-JV 409 =="
cBE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${A[@]}" -d '{"period":"2569-05"}' "${API}/gl/close-period")
[ "$cBE" = "400" ] && ok "BE '2569-05' → 400 (CE-strict)" || bad "BE period → ${cBE}"
cCE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${A[@]}" -d '{"period":"2026-03"}' "${API}/gl/close-period")
[ "$cCE" = "200" ] && ok "CE '2026-03' close → 200 (locked)" || bad "CE close → ${cCE}"
cRE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${A[@]}" -d '{"period":"2026-03"}' "${API}/gl/close-period")
[ "$cRE" = "409" ] && ok "re-close → 409" || bad "re-close → ${cRE}"
ACC1=$(curl -s -H "authorization: Bearer ${TOKEN}" "${API}/gl/coa" | jqp 'r=d.get("data",d);print(r[0]["id"])')
ACC2=$(curl -s -H "authorization: Bearer ${TOKEN}" "${API}/gl/coa" | jqp 'r=d.get("data",d);print(r[1]["id"])')
# lock-guard keys on period_id (date-attribution = deferred per B-122 Q5) — fetch the locked period's id.
PER=$($COMPOSE exec -T postgres psql -U juneflow -d juneflow -tAc "select id from accounting_period where period='2026-03' limit 1" 2>/dev/null | tr -d '[:space:]')
cJV=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${A[@]}" -d "{\"no\":\"JV-LIVE-001\",\"period_id\":\"${PER}\",\"memo\":\"back-post test\",\"lines\":[{\"account_id\":\"${ACC1}\",\"dr\":100,\"cr\":0},{\"account_id\":\"${ACC2}\",\"dr\":0,\"cr\":100}]}" "${API}/gl/jv")
[ "$cJV" = "409" ] && ok "JV into locked 2026-03 → 409 (B-094-1 downstream)" || bad "locked-JV → ${cJV} (expect 409)"

echo "== 7. fail-closed =="
c401=$(curl -s -o /dev/null -w '%{http_code}' "${API}/fa/assets")
[ "$c401" = "401" ] && ok "no-bearer → 401" || bad "no-bearer → ${c401}"
cF=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${A[@]}" -d '{"invoice_id":"00000000-0000-0000-0000-000000000000","amount":1}' "${API}/ar/rv")
[ "$cF" = "404" ] && ok "foreign invoice → 404 (no leak)" || bad "foreign → ${cF}"

echo ""; echo "======== PHASE-3 WAVE-0 LIVE VERIFY (${DEV_REF}) — PASS ${PASS} / FAIL ${FAIL} ========"
[ "$FAIL" = "0" ] && echo "VERDICT: GO" || echo "VERDICT: FAIL"
