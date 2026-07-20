#!/usr/bin/env bash
# phase4-g5-rebaseline.sh — B-120=ข: capture APP-BASELINE refs from the Wei-approved
# app (dev tip == promoted a99031d content) → tests/visual/reference/app-baseline/,
# point the manifest at them (masks dropped — same-env app-vs-app), then run the
# harness against the SAME live stack to prove the regression gate goes green.
# Runs from the ROOT repo (no worktree — captures + manifest land in the repo).
# Usage: bash phase4-g5-rebaseline.sh
set -uo pipefail
ROOT="/Users/innovera/Documents/juneflow"
export COMPOSE_PROJECT_NAME="juneflow-g5base" POSTGRES_PORT=5442 REDIS_PORT=6389 API_PORT=3110 WEB_PORT=5283
PROXY_PORT=5284
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${ROOT}/infra/docker-compose.yml"
API="http://localhost:${API_PORT}/api/v1"
BASE_DIR="${ROOT}/tests/visual/reference/app-baseline"
STATE="/tmp/juneflow-g5base-state.json"
jqp(){ python3 -c "import sys,json;d=json.load(sys.stdin);$1" 2>/dev/null; }
PROXY_PID=""
cleanup(){ echo "== teardown =="; [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null; $COMPOSE down -v --remove-orphans 2>/dev/null||true; }
trap cleanup EXIT

echo "== 1. compose up from ROOT (dev tip = approved a99031d content) =="
$COMPOSE up -d --build --wait >/dev/null 2>&1 || { echo COMPOSE-FAIL; $COMPOSE logs api|tail -30; exit 1; }
echo "  stack up (api :${API_PORT} · web :${WEB_PORT})"

echo "== 2. login → storageState (origin = proxy :${PROXY_PORT}) =="
TOKEN=$(curl -s -X POST "${API}/auth/login" -H 'content-type: application/json' -d '{"email":"wipha@rungrueang.co.th","password":"juneflow-dev"}' | jqp 'print(d.get("token",""))')
[ -n "$TOKEN" ] || { echo LOGIN-FAIL; exit 1; }
python3 - "$STATE" "$TOKEN" "$PROXY_PORT" <<'PY'
import sys, json
p,t,port=sys.argv[1],sys.argv[2],sys.argv[3]
json.dump({"cookies":[],"origins":[{"origin":f"http://localhost:{port}",
  "localStorage":[{"name":"juneflow-token","value":t}]}]},open(p,"w"))
PY

echo "== 3. micro-proxy :${PROXY_PORT} =="
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

echo "== 4. capture app-baselines (1600x1000 · 7 routes incl subcon.accept first-ref) =="
mkdir -p "$BASE_DIR"
( cd "$ROOT/tests" && node - "$PROXY_PORT" "$STATE" "$BASE_DIR" <<'JS'
const { chromium } = require("@playwright/test");
const [port, statePath, baseDir] = process.argv.slice(2);
const ROUTES = [
  ["dashboard", "dashboard"],
  ["subcon-contracts", "subcon.contracts"],
  ["subcon-accept", "subcon.accept"],
  ["pm-assets", "pm.assets"],
  ["pm-dashboard", "pm.dashboard"],
  ["pm-schedule", "pm.schedule"],
  ["pm-wo", "pm.wo"],
];
(async () => {
  const browser = await chromium.launch();
  for (const [name, route] of ROUTES) {
    // FRESH context per route — mirrors the gate's cold query cache exactly
    // (the harness runs each screen in its own page). Same waits as the gate:
    // networkidle + 1500ms settle (visual-gate.spec.ts capture, B-120).
    const ctx = await browser.newContext({
      storageState: statePath,
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/#/${route}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${baseDir}/${name}.png`, fullPage: false });
    await ctx.close();
    console.log(`  captured ${name} (${route})`);
  }
  await browser.close();
})().catch((e) => { console.error("CAPTURE-FAIL", e.message); process.exit(1); });
JS
) || { echo CAPTURE-STEP-FAIL; exit 1; }

echo "== 5. point manifest at app-baselines (masks dropped · B-120=ข) =="
python3 - "$ROOT" <<'PY'
import json, sys
root = sys.argv[1]
p = f"{root}/tests/visual/screens.manifest.json"
m = json.load(open(p))
MASKS = ["header-update-time-b120","header-date-chip-b120"]
rows = [
  {"screen":"app-shell","route":"dashboard","ref":"app-baseline/dashboard.png","masks":MASKS},
  {"screen":"subcon-contracts","route":"subcon.contracts","ref":"app-baseline/subcon-contracts.png","masks":MASKS},
  {"screen":"subcon-accept","route":"subcon.accept","ref":"app-baseline/subcon-accept.png","masks":MASKS},
  {"screen":"pm-assets","route":"pm.assets","ref":"app-baseline/pm-assets.png","masks":MASKS},
  {"screen":"pm-dashboard","route":"pm.dashboard","ref":"app-baseline/pm-dashboard.png","masks":MASKS},
  {"screen":"pm-schedule","route":"pm.schedule","ref":"app-baseline/pm-schedule.png","masks":MASKS},
  {"screen":"pm-wo","route":"pm.wo","ref":"app-baseline/pm-wo.png","masks":MASKS},
]
m["screens"] = rows
m["note"] += " B-120=ข (2026-07-20 · Wei): refs switched to app-baseline/ — captures of the Wei-APPROVED app (a99031d content, same rendering environment) → strict-0 = a real REGRESSION gate. The prototype gallery pack stays untouched as the §0 design ground-truth used at PORT time (human/agent comparison). Masks dropped (same-env). Re-baseline only after a Wei-approved visual change, never to silence a diff."
json.dump(m, open(p,"w"), ensure_ascii=False, indent=2)
print(f"  manifest → {len(rows)} app-baseline rows")
PY

echo "== 6. PROVE the regression gate — run harness vs the SAME stack (expect all PASS · 0 diff) =="
( cd "$ROOT" && VISUAL_BASE_URL="http://localhost:${PROXY_PORT}" VISUAL_STORAGE_STATE="$STATE" \
  pnpm --filter @juneflow/tests test:visual 2>&1 | tail -12 )
echo ""
echo "== 7. report =="
grep -E "^\| (app-shell|subcon|pm-)" "$ROOT/tests/visual/.results/visual-report.md" 2>/dev/null | sed 's/ · diff:.*//' | cut -c1-160
echo "======== G5 RE-BASELINE (B-120=ข) COMPLETE ========"
