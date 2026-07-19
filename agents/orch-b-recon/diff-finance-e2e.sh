#!/usr/bin/env bash
# diff-finance-e2e.sh — orch-B: differential finance-flow E2E to decide whether the
# 2 finance-flow failures (PV approval-ladder tiers) are a batch-12 REGRESSION or a
# pre-existing finance-flow issue. Runs the SAME spec, full-log, at two SHAs on the
# same isolated ports (serially, torn down between). Captures the real HTTP status.
# Usage: bash diff-finance-e2e.sh
set -uo pipefail
ROOT="/Users/innovera/Documents/juneflow"
WT="/Users/innovera/juneflow-wt/fine2e"
export COMPOSE_PROJECT_NAME="juneflow-fine2e"
export POSTGRES_PORT=5437 REDIS_PORT=6384 API_PORT=3104 WEB_PORT=5276
PROXY_PORT=5299
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${WT}/infra/docker-compose.yml"

run_at () {
  local SHA="$1" TAG="$2"
  echo ""
  echo "########## ${TAG} @ ${SHA} ##########"
  $COMPOSE down -v --remove-orphans 2>/dev/null || true
  git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
  git -C "$ROOT" worktree add --force --detach "$WT" "$SHA" >/dev/null 2>&1
  ( cd "$WT" && pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 ) || { echo "${TAG} INSTALL FAILED"; return 1; }
  ( cd "$WT" && pnpm --dir tests exec playwright install chromium >/dev/null 2>&1 ) || true
  if ! $COMPOSE up -d --build --wait >/dev/null 2>&1; then
    echo "${TAG} COMPOSE UP FAILED"; $COMPOSE logs api 2>/dev/null | tail -20; return 1
  fi
  cd "$WT/tests"
  echo "---- ${TAG}: finance-flow FULL LOG ----"
  E2E_LIVE=1 \
    E2E_API_URL="http://localhost:${API_PORT}" \
    PROXY_PORT="${PROXY_PORT}" \
    PROXY_WEB_TARGET="http://localhost:${WEB_PORT}" \
    PROXY_API_TARGET="http://localhost:${API_PORT}" \
    pnpm exec playwright test --config e2e/playwright.config.ts finance-flow --workers=1 2>&1 \
    | grep -vE 'live-proxy|Progress:|^\s*$' | tail -80
  cd "$ROOT"
}

cleanup(){ echo "== teardown =="; $COMPOSE down -v --remove-orphans 2>/dev/null||true; git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null||true; }
trap cleanup EXIT

run_at e81c1fe "BATCH-12"
run_at eb88544 "PRE-BATCH-12 (main)"
echo ""
echo "== differential done — compare the two finance-flow results above =="
