#!/usr/bin/env bash
# finance-e2e-live.sh — orch-B: run the finance money-path E2E (Gate G4) live on the
# batch-9 node-dist stack. Confirms the finance chain (AP billing/PV net + approval
# ladder + GL Dr=Cr + bank suggest/confirm) end-to-end on the prod image, not just tsx.
# Isolated compose + ports. Throwaway worktree @ the given SHA.
# Usage: bash finance-e2e-live.sh <dev-sha>
set -uo pipefail
DEV_REF="${1:-dev}"
FILTER="${2:-finance-flow}"   # playwright test filter (spec substring). e.g. b097-rollback
ROOT="/Users/innovera/Documents/juneflow"
WT="/Users/innovera/juneflow-wt/fine2e"
export COMPOSE_PROJECT_NAME="juneflow-fine2e"
export POSTGRES_PORT=5437 REDIS_PORT=6384 API_PORT=3104 WEB_PORT=5276
PROXY_PORT=5299
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${WT}/infra/docker-compose.yml"

cleanup(){ echo "== teardown =="; $COMPOSE down -v --remove-orphans 2>/dev/null||true; git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null||true; }
trap cleanup EXIT

echo "== 1. worktree @ ${DEV_REF} + install =="
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
git -C "$ROOT" worktree add --force --detach "$WT" "$DEV_REF"
( cd "$WT" && pnpm install --frozen-lockfile --prefer-offline )
( cd "$WT" && pnpm --dir tests exec playwright install chromium ) 2>/dev/null || true

echo "== 2. compose up --wait ALL (migrate-seed + api node-dist boot + web for the proxy) =="
# --wait (all, not just api) so the web service is up before playwright's live-proxy
# webServer health-check forwards / → web (otherwise 502 → 60s webServer timeout).
$COMPOSE up -d --build --wait

echo "== 3. run finance-flow.spec LIVE (E2E_LIVE=1 · api-level via E2E_API_URL · proxy→compose) =="
cd "$WT/tests"
E2E_LIVE=1 \
  E2E_API_URL="http://localhost:${API_PORT}" \
  PROXY_PORT="${PROXY_PORT}" \
  PROXY_WEB_TARGET="http://localhost:${WEB_PORT}" \
  PROXY_API_TARGET="http://localhost:${API_PORT}" \
  pnpm exec playwright test --config e2e/playwright.config.ts "$FILTER" --workers=1 2>&1 | tail -45

echo "== done (teardown on exit) =="
