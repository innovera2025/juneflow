#!/usr/bin/env bash
# batch9-migrate-verify.sh — orch-B live migration+seed+boot verify for batch-9.
# The thing orch-A can't do (env creds). `compose up --wait api` runs the
# migrate-seed service (migrations 0000-00NN + seed) then boots the api; api only
# turns HEALTHY if migrate-seed exited 0 → migrations applied clean on real PG16
# (0028 partial-unique won't fail = seed has no dup pv/cheque/rv; 0029 pv.created_by
# applies) AND the prod `node dist` API boots (B-095 stays fixed).
# Isolated project + ports. No pnpm install / no playwright (all runs in docker).
set -uo pipefail
DEV_REF="${1:-dev}"
ROOT="/Users/innovera/Documents/juneflow"
WT="/Users/innovera/juneflow-wt/b9mig"
export COMPOSE_PROJECT_NAME="juneflow-b9mig"
export POSTGRES_PORT=5436 REDIS_PORT=6383 API_PORT=3103 WEB_PORT=5275
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${WT}/infra/docker-compose.yml"

cleanup(){ echo "== teardown =="; $COMPOSE down -v --remove-orphans 2>/dev/null||true; git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null||true; }
trap cleanup EXIT

echo "== 1. throwaway worktree @ ${DEV_REF} =="
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
git -C "$ROOT" worktree add --force --detach "$WT" "$DEV_REF"
echo "   SHA: $(git -C "$WT" rev-parse --short HEAD)"

echo "== 2. compose up --wait api  (migrate-seed 0000-00NN + seed + api boot) =="
# postgres + migrate-seed (runs to completion) + api (waits for migrate-seed success + /health)
$COMPOSE up -d --build --wait api
UP=$?

echo "== 3. results =="
echo "-- migrate-seed exit code (0 = migrations+seed clean) --"
$COMPOSE ps -a --format '{{.Service}} {{.Status}} (exit {{.ExitCode}})' 2>/dev/null | grep -E 'migrate-seed|api|postgres'
echo "-- migrate-seed log tail (which migrations applied) --"
$COMPOSE logs migrate-seed 2>/dev/null | grep -iE 'migrat|seed|0028|0029|applied|insert|error|fail' | tail -15
echo "-- api /health via host --"
curl -s -m 5 "http://localhost:${API_PORT}/health" 2>/dev/null | head -c 200; echo
echo "-- applied migrations in DB (drizzle journal) --"
docker exec ${COMPOSE_PROJECT_NAME}-postgres-1 psql -U juneflow -d juneflow -tAc \
  "select count(*) from drizzle.__drizzle_migrations;" 2>/dev/null | tr -d ' ' | sed 's/^/   migrations rows: /' || echo "   (psql query skipped)"
echo "-- seed sanity: bank_statement_line + pv.created_by column --"
docker exec ${COMPOSE_PROJECT_NAME}-postgres-1 psql -U juneflow -d juneflow -tAc \
  "select count(*) from bank_statement_line;" 2>/dev/null | tr -d ' ' | sed 's/^/   bank_statement_line rows: /' || true
docker exec ${COMPOSE_PROJECT_NAME}-postgres-1 psql -U juneflow -d juneflow -tAc \
  "select column_name from information_schema.columns where table_name='pv' and column_name='created_by';" 2>/dev/null | sed 's/^/   pv.created_by column: /' || true

if [ "$UP" -eq 0 ]; then echo "== VERDICT: ✅ api HEALTHY → migrate-seed exited 0 → 0000-00NN + seed CLEAN on live PG16 + prod boot OK =="
else echo "== VERDICT: ⚠️ up --wait non-zero — inspect migrate-seed log above (migration or boot failure) =="; fi
