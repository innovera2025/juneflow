#!/usr/bin/env bash
# phase4-g5-bringup.sh — B-119 G5 harness bring-up (orch-B · Wei-ruled "before next web batch").
# Boots a FRESH seeded stack at <sha>, logs in for a real bearer, bridges the
# unwired-API-proxy gap with a zero-repo-edit micro-proxy (same-origin /api → api
# container · else → web nginx), then runs the REAL visual capture (Gate G5)
# against the 6 manifest-registered routes. Ends green-by-omission: every ported
# route now produces a real PASS/FAIL diff verdict for Wei.
# Usage: bash phase4-g5-bringup.sh <sha>
set -uo pipefail
DEV_REF="${1:-dev}"
ROOT="/Users/innovera/Documents/juneflow"; WT="/Users/innovera/juneflow-wt/g5bring"
export COMPOSE_PROJECT_NAME="juneflow-g5bring" POSTGRES_PORT=5441 REDIS_PORT=6388 API_PORT=3109 WEB_PORT=5281
PROXY_PORT=5282
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${WT}/infra/docker-compose.yml"
API="http://localhost:${API_PORT}/api/v1"
jqp(){ python3 -c "import sys,json;d=json.load(sys.stdin);$1" 2>/dev/null; }
PROXY_PID=""
cleanup(){ echo "== teardown =="; [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null; $COMPOSE down -v --remove-orphans 2>/dev/null||true; git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null||true; }
trap cleanup EXIT

echo "== 1. worktree @ ${DEV_REF} + install =="
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
git -C "$ROOT" worktree add --force --detach "$WT" "$DEV_REF" >/dev/null 2>&1
( cd "$WT" && pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 ) || { echo INSTALL-FAIL; exit 1; }

echo "== 2. compose up --wait (fresh build: web image must include the Phase-4 screens) =="
$COMPOSE up -d --build --wait >/dev/null 2>&1 || { echo COMPOSE-FAIL; $COMPOSE logs api | tail -30; exit 1; }
echo "  stack up (api :${API_PORT} · web :${WEB_PORT})"

echo "== 3. login → bearer → storageState (origin = proxy) =="
TOKEN=$(curl -s -X POST "${API}/auth/login" -H 'content-type: application/json' -d '{"email":"wipha@rungrueang.co.th","password":"juneflow-dev"}' | jqp 'print(d.get("token",""))')
[ -n "$TOKEN" ] || { echo LOGIN-FAIL; exit 1; }
# NOTE: must live OUTSIDE tests/visual/.results — globalSetup resetResults() wipes that dir at run start.
STATE="$WT/g5-state.json"
python3 - "$STATE" "$TOKEN" "$PROXY_PORT" <<'PY'
import sys, json
path, token, port = sys.argv[1], sys.argv[2], sys.argv[3]
json.dump({"cookies": [], "origins": [{"origin": f"http://localhost:{port}",
  "localStorage": [{"name": "juneflow-token", "value": token}]}]}, open(path, "w"))
print(f"  storageState → {path}")
PY

echo "== 4. micro-proxy :${PROXY_PORT} (same-origin bridge · /api→api · else→web nginx · zero repo edits) =="
node - "$PROXY_PORT" "$API_PORT" "$WEB_PORT" <<'JS' &
const [port, apiPort, webPort] = process.argv.slice(2).map(Number);
const http = require("http");
http.createServer((req, res) => {
  const target = req.url.startsWith("/api/") ? apiPort : webPort;
  const p = http.request({ host: "localhost", port: target, path: req.url,
    method: req.method, headers: { ...req.headers, host: `localhost:${target}` } },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", () => { res.writeHead(502); res.end("proxy-502"); });
  req.pipe(p);
}).listen(port, () => console.log(`  proxy up :${port}`));
JS
PROXY_PID=$!
sleep 1
curl -s -o /dev/null -w "  proxy→web %{http_code} · " "http://localhost:${PROXY_PORT}/"
curl -s -o /dev/null -w "proxy→api %{http_code}\n" -H "authorization: Bearer ${TOKEN}" "http://localhost:${PROXY_PORT}/api/v1/projects"

echo "== 5. REAL visual capture (Gate G5) — 6 manifest routes =="
( cd "$WT" && VISUAL_BASE_URL="http://localhost:${PROXY_PORT}" VISUAL_STORAGE_STATE="$STATE" \
  pnpm --filter @juneflow/tests test:visual 2>&1 | tail -30 )

echo ""
echo "== 6. diff report =="
REPORT="$WT/tests/visual/.results/visual-report.md"
if [ -f "$REPORT" ]; then
  cat "$REPORT"
  # persist the report + diff artifacts back to the ROOT repo for Wei review (gitignored .results kept out of worktree teardown)
  DEST="$ROOT/agents/orch-b-recon/g5-bringup-results"
  mkdir -p "$DEST"; cp "$REPORT" "$DEST/visual-report.md" 2>/dev/null
  cp -R "$WT/tests/visual/.results/diff" "$DEST/" 2>/dev/null || true
  cp -R "$WT/tests/visual/.results/capture" "$DEST/" 2>/dev/null || true
  ls "$WT/tests/visual/.results/" >> "$DEST/results-dirs.txt" 2>/dev/null
  echo ""; echo "  (report + diffs copied → agents/orch-b-recon/g5-bringup-results/)"
else
  echo "  NO REPORT PRODUCED — capture did not run; see playwright output above."
fi
echo "======== G5 BRING-UP RUN (${DEV_REF}) COMPLETE ========"
