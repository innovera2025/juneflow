#!/usr/bin/env bash
# live-g5-finance.sh — orch-B live-G5 round on the 7 Wave-2 finance screens.
# FIRE AFTER B-095 packaging fix lands on dev (api boots in the prod image).
#
# Fully isolated (own compose project + offset ports) so it NEVER collides with
# orch-A. Read-only vs tests/visual/reference/ (ground truth — never modified).
# Runs from a THROWAWAY git worktree pinned to a clean dev SHA, so it does not
# touch the live (dirty, orch-A-owned) dev checkout or the stale feature/qa.
#
# Usage:   bash live-g5-finance.sh <fixed-dev-SHA>      # e.g. the post-B-095 dev tip
#          bash live-g5-finance.sh dev                  # or just current dev
set -euo pipefail

DEV_REF="${1:-dev}"
ROOT="/Users/innovera/Documents/juneflow"
WT="/Users/innovera/juneflow-wt/g5fin"           # throwaway worktree
OUT="$ROOT/agents/orch-b-recon/live-g5-finance-results"
STATE="/private/tmp/g5fin-auth-state.json"

# --- isolation: own project name + offset ports (avoid 5432/5433/6379/3000/5173)
export COMPOSE_PROJECT_NAME="juneflow-g5fin"
export POSTGRES_PORT=5434 REDIS_PORT=6381 API_PORT=3101 WEB_PORT=5273
API="http://localhost:${API_PORT}"
WEB="http://localhost:${WEB_PORT}"
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${WT}/infra/docker-compose.yml"

# --- seed login (central seed — packages/db) : MD/Director sees every screen
SEED_EMAIL="wipha@rungrueang.co.th"
SEED_PASSWORD="juneflow-dev"
TOKEN_KEY="juneflow-token"                        # apps/web/src/auth-token.ts

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

echo "== 1b. install worktree host deps (git worktree add does NOT install → playwright CLI) =="
( cd "$WT" && pnpm install --frozen-lockfile --prefer-offline )
( cd "$WT" && pnpm --dir tests exec playwright install chromium ) 2>/dev/null || true

echo "== 2. inject 7 finance rows into screens.manifest.json (merge, not replace) =="
python3 - "$WT" <<'PY'
import json, sys, pathlib
wt = sys.argv[1]
p = pathlib.Path(wt) / "tests/visual/screens.manifest.json"
d = json.loads(p.read_text(encoding="utf-8"))
rows = [
  ("gl.coa",      "gallery/g5/08-s.jpg"),
  ("gl.jv",       "gallery/g2/02-s.jpg"),
  ("ap.billing",  "gallery/g2/07-s.jpg"),
  ("ap.pv",       "gallery/g2/08-s.jpg"),
  ("bank.cheque", "gallery/g2/14-s.jpg"),
  ("bank.recon",  "gallery/g2/15-s.jpg"),
  ("bank.export", "gallery/g2/16-s.jpg"),
]
have = {s["screen"] for s in d["screens"]}
for route, ref in rows:
    if route not in have:
        d["screens"].append({"screen": route, "route": route, "ref": ref,
                             "masks": ["sidebar-logo-b044"]})
p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
print("manifest screens:", [s["screen"] for s in d["screens"]])
PY

echo "== 3. patch throwaway visual config to read storageState from env (throwaway only) =="
python3 - "$WT" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / "tests/visual/playwright.visual.config.ts"
s = p.read_text(encoding="utf-8")
needle = 'baseURL: process.env.VISUAL_BASE_URL ?? "http://localhost:5173",'
add = needle + '\n    storageState: process.env.VISUAL_STORAGE_STATE || undefined,'
if "VISUAL_STORAGE_STATE" not in s:
    s = s.replace(needle, add, 1)
    p.write_text(s, encoding="utf-8")
print("config patched:", "VISUAL_STORAGE_STATE" in s)
PY

echo "== 4. build + bring up ISOLATED stack (--wait = the B-095 boot gate) =="
# If api never becomes healthy here, B-095 is NOT fixed on ${DEV_REF} — abort.
$COMPOSE up -d --build --wait

echo "== 5. login seed user -> bearer token -> storageState (localStorage ${TOKEN_KEY}) =="
TOKEN=$(curl -s -X POST "${API}/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${SEED_EMAIL}\",\"password\":\"${SEED_PASSWORD}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')
if [ -z "$TOKEN" ]; then echo "FATAL: login failed (seed/stack broken)"; exit 1; fi
python3 - "$STATE" "$WEB" "$TOKEN_KEY" "$TOKEN" <<'PY'
import json, sys
state_path, web, key, token = sys.argv[1:5]
state = {"cookies": [], "origins": [
  {"origin": web, "localStorage": [{"name": key, "value": token}]}
]}
open(state_path, "w").write(json.dumps(state))
print("storageState written for", web)
PY

echo "== 6. run visual gate (capture mode) on the 7 finance screens =="
cd "$WT"
VISUAL_BASE_URL="$WEB" VISUAL_STORAGE_STATE="$STATE" \
  pnpm --dir tests run test:visual || echo "(gate returned non-zero — expected if any screen FAILs; see report)"

echo "== 7. collect results (diff PNGs + per-screen report) =="
rm -rf "$OUT"; mkdir -p "$OUT"
cp -R "$WT/tests/visual/.results/." "$OUT/" 2>/dev/null || true
echo "results -> $OUT"
echo "== done (teardown on exit) =="
