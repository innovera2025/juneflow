#!/usr/bin/env bash
# full-suite-e2e-live.sh — orch-B: batch-12 promote gate. Bring the prod-image
# stack up ONCE at <dev-sha>, then run every live business-flow E2E spec against
# it (each its own playwright invocation so specs never share assertion state).
# Verifies the B-099 per-user throttle lets the full suite run GREEN (not skip)
# from one IP, and that batch-12 didn't regress the FLOW-A/F money-paths or the
# B-097 txn-door rollback. Isolated compose project + ports. Throwaway worktree.
# Usage: bash full-suite-e2e-live.sh <dev-sha>
set -uo pipefail
DEV_REF="${1:-dev}"
ROOT="/Users/innovera/Documents/juneflow"
WT="/Users/innovera/juneflow-wt/fine2e"
export COMPOSE_PROJECT_NAME="juneflow-fine2e"
export POSTGRES_PORT=5437 REDIS_PORT=6384 API_PORT=3104 WEB_PORT=5276
PROXY_PORT=5299
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${WT}/infra/docker-compose.yml"
SPECS=(smoke finance-flow procurement-flow b084-exploit b097-rollback)

cleanup(){ echo "== teardown =="; $COMPOSE down -v --remove-orphans 2>/dev/null||true; git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null||true; }
trap cleanup EXIT

echo "== 1. worktree @ ${DEV_REF} + install =="
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
git -C "$ROOT" worktree add --force --detach "$WT" "$DEV_REF"
( cd "$WT" && pnpm install --frozen-lockfile --prefer-offline ) || { echo "INSTALL FAILED"; exit 1; }
( cd "$WT" && pnpm --dir tests exec playwright install chromium ) 2>/dev/null || true

echo "== 2. compose up --wait ALL (live migrate 0000..0030 + seed + api node-dist boot + web) =="
$COMPOSE up -d --build --wait || { echo "COMPOSE UP FAILED"; $COMPOSE ps; $COMPOSE logs api | tail -40; exit 1; }

echo "== 2b. confirm migration 0030 applied on live PG =="
$COMPOSE exec -T postgres psql -U juneflow -d juneflow -c \
  "select indexname from pg_indexes where indexname in ('ap_billing_vendor_idx','jv_line_jv_idx','jv_period_idx','reconcile_statement_idx','reconcile_period_idx') order by 1;" 2>&1 || echo "(psql index check skipped)"

echo "== 3. run each live spec (E2E_LIVE=1 · workers=1 · own invocation) =="
cd "$WT/tests"
declare -a RESULTS
for spec in "${SPECS[@]}"; do
  echo "---- SPEC: ${spec} ----"
  out=$(E2E_LIVE=1 \
    E2E_API_URL="http://localhost:${API_PORT}" \
    PROXY_PORT="${PROXY_PORT}" \
    PROXY_WEB_TARGET="http://localhost:${WEB_PORT}" \
    PROXY_API_TARGET="http://localhost:${API_PORT}" \
    pnpm exec playwright test --config e2e/playwright.config.ts "${spec}" --workers=1 2>&1)
  echo "$out" | tail -20
  # Extract EVERY playwright summary line — playwright prints "N failed" and
  # "M passed" on SEPARATE lines when there are failures, so `tail -1` would grab
  # only "M passed" and hide the failures (false-green). Join all summary lines.
  line=$(echo "$out" | grep -E '^\s*[0-9]+ (passed|failed|skipped|flaky)' | paste -sd' ' -)
  RESULTS+=("${spec}: ${line:-NO-SUMMARY}")
done

echo ""
echo "======== FULL-SUITE E2E SUMMARY (dev ${DEV_REF}) ========"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo "========================================================"
echo "== done (teardown on exit) =="
