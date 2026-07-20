#!/usr/bin/env bash
# phase4-meta1-enrich-verify.sh — orch-B LIVE proof of META-1 wire enrichment (P2-BE-43).
# Proves ON REAL POSTGRES:
#   1. project_name is POPULATED on enriched wires (periods + acceptance-center).
#   2. §0 GUARD: title is DATA-ONLY — contains NO translatable Thai UI word "งวดที่"
#      (the exact word gate-4.5 caught + orch-A moved to the FE / B-116).
#   3. honest-empty (C10): overdue / wait_days / due_text / docs_count are ABSENT (no fabrication).
#   4. tenant fail-closed (401) + project_name never cross-tenant (foreign→404/empty).
# Usage: bash phase4-meta1-enrich-verify.sh <sha>
set -uo pipefail
DEV_REF="${1:-dev}"
ROOT="/Users/innovera/Documents/juneflow"; WT="/Users/innovera/juneflow-wt/meta1"
export COMPOSE_PROJECT_NAME="juneflow-meta1" POSTGRES_PORT=5440 REDIS_PORT=6387 API_PORT=3107 WEB_PORT=5279
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${WT}/infra/docker-compose.yml"
API="http://localhost:${API_PORT}/api/v1"; PASS=0; FAIL=0
ok(){ echo "  ✓ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ✘ $1"; FAIL=$((FAIL+1)); }
jqp(){ python3 -c "import sys,json;d=json.load(sys.stdin);$1" 2>/dev/null; }
cleanup(){ echo "== teardown =="; $COMPOSE down -v --remove-orphans 2>/dev/null||true; git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null||true; }
trap cleanup EXIT

echo "== 1. worktree + install =="
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
git -C "$ROOT" worktree add --force --detach "$WT" "$DEV_REF" >/dev/null 2>&1
( cd "$WT" && pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 ) || { echo INSTALL-FAIL; exit 1; }
echo "== 2. compose up --wait =="
$COMPOSE up -d --build --wait >/dev/null 2>&1 || { echo COMPOSE-FAIL; $COMPOSE logs api|tail -40; exit 1; }
ok "stack boots"
echo "== 3. login =="
TOKEN=$(curl -s -X POST "${API}/auth/login" -H 'content-type: application/json' -d '{"email":"wipha@rungrueang.co.th","password":"juneflow-dev"}' | jqp 'print(d.get("token",""))')
[ -n "$TOKEN" ] && ok login || { bad login; exit 1; }
A=(-H "authorization: Bearer ${TOKEN}")

echo "== 4. periods enrichment: project_name populated · title data-only (no 'งวดที่') · honest-empty =="
CID=$(curl -s "${A[@]}" "${API}/subcon-contracts" | jqp 'r=d.get("data",d);print(r[0]["id"] if r else "")')
[ -n "$CID" ] && ok "got contract ${CID:0:8}" || { bad "no subcon contract"; exit 1; }
PBODY=$(curl -s "${A[@]}" "${API}/subcon-contracts/${CID}/periods")
echo "$PBODY" | jqp 'r=d.get("data",d);import sys;sys.exit(0 if r and r[0].get("project_name") else 1)' && ok "period.project_name populated = $(echo "$PBODY"|jqp 'r=d.get("data",d);print(r[0].get("project_name"))')" || bad "project_name empty/absent"
# §0 GUARD: NO 'งวดที่' anywhere in the enriched payload
echo "$PBODY" | grep -q "งวดที่" && bad "§0 VIOLATION: 'งวดที่' leaked into wire!" || ok "§0 clean: no 'งวดที่' UI-word in wire (title data-only)"
echo "$PBODY" | jqp 'r=d.get("data",d);import sys;sys.exit(0 if r and ("overdue" not in r[0] and "wait_days" not in r[0] and "due_text" not in r[0]) else 1)' && ok "honest-empty: overdue/wait_days/due_text ABSENT (C10)" || bad "a sourceless field is present (fabricated?)"
echo "  sample period title = $(echo "$PBODY"|jqp 'r=d.get("data",d);print(repr(r[0].get("title")))')"

echo "== 5. acceptance-center slices carry project_name + no 'งวดที่' =="
for t in period pm gr house; do
  b=$(curl -s "${A[@]}" "${API}/acceptance-center?type=${t}")
  echo "$b" | grep -q "งวดที่" && bad "type=${t}: 'งวดที่' leaked" || ok "type=${t}: no UI-word leak"
done
# pm owner = tech (real)
PMB=$(curl -s "${A[@]}" "${API}/acceptance-center?type=pm")
echo "$PMB" | jqp 'r=d.get("data",d);import sys;sys.exit(0 if not r or "project_name" in r[0] else 1)' && ok "pm slice has project_name field" || bad "pm slice missing project_name"

echo "== 6. fail-closed =="
c401=$(curl -s -o /dev/null -w '%{http_code}' "${API}/subcon-contracts/${CID}/periods")
[ "$c401" = "401" ] && ok "no-bearer → 401" || bad "no-bearer → ${c401}"
cF=$(curl -s -o /dev/null -w '%{http_code}' "${A[@]}" "${API}/subcon-contracts/00000000-0000-0000-0000-000000000000/periods")
case "$cF" in 404|200) ok "foreign contract → ${cF} (no cross-tenant project_name leak)";; *) bad "foreign → ${cF}";; esac

echo ""; echo "======== PHASE-4 META-1 ENRICH LIVE VERIFY (${DEV_REF}) — PASS ${PASS} / FAIL ${FAIL} ========"
[ "$FAIL" = "0" ] && echo "VERDICT: GO" || echo "VERDICT: FAIL"
