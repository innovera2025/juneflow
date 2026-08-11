#!/usr/bin/env bash
# live-g5-batch8.sh — orch-B FULL batch-8 live-G5 regression sweep (~28 screens).
# FIRE AFTER B-095 packaging fix lands on dev (api boots in the prod image).
#
# Superset of live-g5-finance.sh: instead of the 7 finance screens, it sweeps
# EVERY ported screen (PORTED_SCREENS ∪ dashboard ∪ users) so a Wave-2 change
# that regressed an earlier BOQ/procurement/master screen is caught before promote.
# The manifest is BUILT at run time by parsing apps/web/src/router.tsx (PORTED_SCREENS)
# × tests/visual/reference-index.md — self-updating, no hand-transcribed refs.
#
# login is EXCLUDED (pre-auth screen: with a token injected it redirects to dashboard).
#
# Isolated (own compose project + offset ports) · read-only vs reference/ · runs from
# a throwaway worktree pinned to a clean dev SHA (never the dirty live dev checkout).
#
# Usage:  bash live-g5-batch8.sh <fixed-dev-SHA>     # post-B-095 dev tip
set -euo pipefail

DEV_REF="${1:-dev}"
ROOT="/Users/innovera/Documents/juneflow"
WT="/Users/innovera/juneflow-wt/g5batch8"
OUT="$ROOT/agents/orch-b-recon/live-g5-batch8-results"
STATE="/private/tmp/g5batch8-auth-state.json"

export COMPOSE_PROJECT_NAME="juneflow-g5b8"
export POSTGRES_PORT=5435 REDIS_PORT=6382 API_PORT=3102 WEB_PORT=5274
API="http://localhost:${API_PORT}"
WEB="http://localhost:${WEB_PORT}"
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${WT}/infra/docker-compose.yml"

SEED_EMAIL="wipha@rungrueang.co.th"   # MD/Director L4 — sees every screen
SEED_PASSWORD="juneflow-dev"
TOKEN_KEY="juneflow-token"            # apps/web/src/auth-token.ts

cleanup() {
  echo "== teardown =="
  $COMPOSE down -v --remove-orphans 2>/dev/null || true
  git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
  rm -f "$STATE" 2>/dev/null || true
}
trap cleanup EXIT

echo "== 1. throwaway worktree @ ${DEV_REF} =="
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
git -C "$ROOT" worktree add --force --detach "$WT" "$DEV_REF"

echo "== 1b. install worktree host deps (git worktree add does NOT install → playwright CLI needed) =="
( cd "$WT" && pnpm install --frozen-lockfile --prefer-offline )
( cd "$WT" && pnpm --dir tests exec playwright install chromium ) 2>/dev/null || true

echo "== 2. BUILD manifest from PORTED_SCREENS × reference-index (auto, self-updating) =="
python3 - "$WT" <<'PY'
import json, re, sys, pathlib
wt = pathlib.Path(sys.argv[1])

# route -> ref, parsed from the authoritative reference-index.md (all of g1..g5)
idx = (wt / "tests/visual/reference-index.md").read_text(encoding="utf-8")
route_ref = {}
for m in re.finditer(r"\|\s*`(gallery/[^`]+)`\s*\|[^|]*\|\s*`([a-z][a-z0-9._-]+)`", idx):
    ref, route = m.group(1), m.group(2)
    route_ref.setdefault(route, ref)   # first (primary) ref wins

# PORTED_SCREENS route ids from router.tsx
router = (wt / "apps/web/src/router.tsx").read_text(encoding="utf-8")
block = router[router.index("PORTED_SCREENS"):]
block = block[:block.index("}")]
ported = sorted(set(re.findall(r'"([a-z][a-z.]+)"', block)))

# The sweep set: every ported screen + dashboard + users (login excluded — pre-auth).
sweep = set(ported) | {"dashboard", "users"} - {"login"}

mpath = wt / "tests/visual/screens.manifest.json"
d = json.loads(mpath.read_text(encoding="utf-8"))
# B-304: dedupe on ROUTE id, not screen id. `sweep` holds ROUTE ids, and a
# manifest row's `screen` is frequently a DIFFERENT string from its `route`
# (app-shell/dashboard, opex-budget/opex, gr-list/gr.list, ...). Comparing the
# two sets appended ~84 duplicate rows pointing at prototype gallery/ refs on top
# of the 99 real app-baseline rows -> 183 capture records, which is where the
# misleading "194 total" came from.
have = {s.get("route", s["screen"]) for s in d["screens"]} | {s["screen"] for s in d["screens"]}
added, missing = [], []
for route in sorted(sweep):
    if route in have:
        continue
    ref = route_ref.get(route)
    if not ref:
        missing.append(route); continue
    # viewport = reference size (folded into the committed spec, P0-QA-04): g5 = 924x540, else 1600x1000
    vp = {"width": 924, "height": 540} if ref.startswith("gallery/g5/") else {"width": 1600, "height": 1000}
    d["screens"].append({"screen": route, "route": route, "ref": ref,
                         "masks": ["sidebar-logo-b044"], "viewport": vp})
    added.append(route)
mpath.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"sweep screens: {len(d['screens'])}  (+{len(added)} added)")
print("added:", ", ".join(added))
if missing:
    print("!! no reference for (skipped):", ", ".join(missing))
PY

echo "== 3. (config patch no longer needed — folded into committed tests/visual · P0-QA-04) =="
# Committed playwright.visual.config.ts reads storageState from VISUAL_STORAGE_STATE (set in step 6);
# visual-gate.spec.ts sets the per-screen viewport from the manifest `viewport` field (added in step 2).
grep -q 'VISUAL_STORAGE_STATE' "$WT/tests/visual/playwright.visual.config.ts" \
  && echo "   committed config supports storageState ✓ (fold present on this SHA)" \
  || echo "   WARN: committed config lacks the fold on this SHA — capture may render logged-out"

echo "== 4. build + bring up ISOLATED stack (--wait = the B-095 boot gate) =="
$COMPOSE up -d --build --wait

echo "== 5. login seed user -> storageState (localStorage ${TOKEN_KEY}) =="
TOKEN=$(curl -s -X POST "${API}/api/v1/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"${SEED_EMAIL}\",\"password\":\"${SEED_PASSWORD}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')
if [ -z "$TOKEN" ]; then echo "FATAL: login failed"; exit 1; fi
python3 - "$STATE" "http://localhost:${PROXY_PORT:-5374}" "$TOKEN_KEY" "$TOKEN" <<'PY'
import json, sys
sp, web, key, tok = sys.argv[1:5]
open(sp, "w").write(json.dumps({"cookies": [], "origins": [
  {"origin": web, "localStorage": [{"name": key, "value": tok}]}]}))
print("storageState written")
PY

# ---------------------------------------------------------------------------
# B-304, defect 1 — THE reason this script used to report every screen red.
# apps/web/src/api-client.ts calls the RELATIVE path /api/v1, and the web image's
# nginx has only `try_files ... /index.html`. Pointing the gate straight at $WEB
# therefore made every API call return HTML with status 200, so every
# shell-bearing screen rendered DATALESS and failed — 99 rows, 1 PASS, and the
# one passer was `login`, the only screen that makes no API call. That was read
# as "the reference pack is stale" for two days. Same-origin proxy, same shape
# as full-rebaseline.sh.
PROXY_PORT=${PROXY_PORT:-5374}
BASE="http://localhost:${PROXY_PORT}"
echo "== 5b. micro-proxy :${PROXY_PORT} (same-origin: /api -> api · else -> web) =="
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
trap 'kill $PROXY_PID 2>/dev/null || true' EXIT
sleep 1

# FAIL LOUDLY rather than producing a plausible all-red sweep. A dataless render
# is indistinguishable from a real regression in the report, so assert the API
# actually answers JSON through the SAME origin the gate will use.
CT=$(curl -s -o /dev/null -w '%{content_type}' -H "authorization: Bearer ${TOKEN}" "${BASE}/api/v1/projects")
echo "  ${BASE}/api/v1/projects -> content-type: ${CT}"
case "$CT" in
  application/json*) : ;;
  *) echo "FATAL: /api/v1 did not return JSON through the gate's own origin (got '${CT}')."
     echo "       Every shell-bearing screen would render dataless and the sweep would report"
     echo "       a plausible-looking all-red result. Refusing to run — see B-304."; exit 1 ;;
esac

echo "== 6. run visual gate (capture mode) — full batch-8 sweep =="
cd "$WT"
VISUAL_BASE_URL="$BASE" VISUAL_STORAGE_STATE="$STATE" \
  pnpm --dir tests run test:visual || echo "(non-zero = some screens FAIL; per-screen catalog in report)"

echo "== 7. collect =="
rm -rf "$OUT"; mkdir -p "$OUT"
cp -R "$WT/tests/visual/.results/." "$OUT/" 2>/dev/null || true
echo "results -> $OUT"
