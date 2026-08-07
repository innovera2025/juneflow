#!/usr/bin/env bash
# b323-baseline-impact.sh — MEASURE which app-baseline PNGs the B-323 fix moves.
#
# This is the STOP-line deliverable, not a re-baseline. It runs the REAL visual gate
# against a stack built from the FIXED tree and compares against the CURRENT committed
# references (captured under B-322 on the pre-fix seed). Every row that differs is a
# baseline the fix moves — measured, not guessed.
#
# It writes NOTHING under tests/visual/reference/** and does not touch the manifest.
# The gate's own .results/ directory is gitignored.
#
# Assumes a stack is already up (see b323-two-seed-proof.sh for the compose vars).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/agents/orch-b-recon/b323-proof/baseline-impact"
: "${API_PORT:=3143}" "${WEB_PORT:=5313}"
PROXY_PORT="${PROXY_PORT:-5314}"
API="http://localhost:${API_PORT}/api/v1"
BASE="http://localhost:${PROXY_PORT}"
SEED_EMAIL="wipha@rungrueang.co.th"
SEED_PASSWORD="juneflow-dev"

# The playwright storageState carries a REAL bearer token in localStorage. This used to
# be written to "$OUT/state.json" — inside a git-TRACKED evidence directory — so a
# credential got committed as a side effect of running the measurement. Nobody decided
# to put it there; the output path just happened to be tracked.
#
# It now goes to a private temp file, 0600, deleted on exit. Every sibling script in
# this directory already writes its state file to /tmp or a scratch dir; this one was
# the outlier. (.gitignore also ignores the *state.json SHAPE, so a future script that
# forgets cannot commit one either.)
STATE="$(mktemp -t b323-state)"
chmod 600 "$STATE"

PROXY_PID=""
cleanup() {
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null
  rm -f "$STATE"
}
trap cleanup EXIT

# --- guard: never destroy committed evidence -----------------------------------
# This line used to be `rm -rf "$OUT"`, and $OUT is a git-TRACKED directory —
# report.json / moved.json / report.md are committed as this round's evidence. So
# re-running the measurement DELETED the artifacts the script exists to produce, and if
# the gate then failed before the `cp`s below, the old evidence was gone with nothing to
# replace it.
#
# Outputs are overwritten in place instead: git keeps the previous version, so a
# re-measurement is a reviewable, revertible diff rather than a destructive act, and
# any tracked file this run does not regenerate survives instead of vanishing.
# Untracked leftovers from an earlier run are still cleared.
mkdir -p "$OUT"
git -C "$ROOT" ls-files --others --exclude-standard -z -- "$OUT" \
  | while IFS= read -r -d '' f; do rm -f "$ROOT/$f"; done

# --- guard: the pack must be the one on disk, unmodified -----------------------
DIRTY=$(git -C "$ROOT" status --porcelain -- tests/visual/reference tests/visual/screens.manifest.json)
[ -z "$DIRTY" ] || { echo "REFUSING: tests/visual/reference or the manifest is already modified:"; echo "$DIRTY"; exit 1; }

echo "== login =="
TOKEN=$(curl -s -X POST "${API}/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"${SEED_EMAIL}\",\"password\":\"${SEED_PASSWORD}\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
[ -n "$TOKEN" ] || { echo "LOGIN-FAIL"; exit 1; }
python3 - "$STATE" "$TOKEN" "$BASE" <<'PY'
import sys, json
path, token, origin = sys.argv[1:4]
json.dump({"cookies": [], "origins": [
    {"origin": origin, "localStorage": [{"name": "juneflow-token", "value": token}]}]},
    open(path, "w"))
PY

echo "== micro-proxy :${PROXY_PORT} (/api -> api · else -> web) =="
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
python3 -c 'import time; time.sleep(2)'
# B-304: refuse to run if /api/v1 does not answer JSON through the gate's OWN origin —
# a proxy-less run makes every API call return index.html with 200 and the whole sweep
# reads as "the pack is stale" (the false reading that cost a round).
CT=$(curl -s -o /dev/null -w '%{content_type}' -H "authorization: Bearer ${TOKEN}" "${BASE}/api/v1/projects")
echo "  proxy->api content-type: $CT"
case "$CT" in application/json*) ;; *) echo "PROXY-NOT-SERVING-API — aborting"; exit 1;; esac

echo ""
echo "== REAL gate vs the COMMITTED references (fixed stack) =="
( cd "$ROOT" && VISUAL_BASE_URL="$BASE" VISUAL_STORAGE_STATE="$STATE" \
    pnpm --filter @juneflow/tests test:visual -- --workers=1 2>&1 | tail -30 ) | tee "$OUT/gate.log"
cp "$ROOT/tests/visual/.results/visual-report.json" "$OUT/report.json" 2>/dev/null
cp "$ROOT/tests/visual/.results/visual-report.md"   "$OUT/report.md"   2>/dev/null

echo ""
echo "== BASELINES THE FIX MOVES =="
python3 - "$OUT" <<'PY'
import json, pathlib, sys
out = pathlib.Path(sys.argv[1])
p = out / "report.json"
if not p.exists():
    print("  !! no report.json — the gate did not produce one"); raise SystemExit(1)
rows = [r for r in json.loads(p.read_text(encoding="utf-8"))["results"] if r["kind"] == "capture"]
moved = sorted((r for r in rows if r.get("diffPixels")), key=lambda r: -r["diffPixels"])
fails = [r for r in moved if r.get("verdict") != "PASS"]
maskonly = sorted((r for r in rows if not r.get("diffPixels") and r.get("maskedDiffPixels")),
                  key=lambda r: -r["maskedDiffPixels"])
print(f"  rows compared: {len(rows)} · byte-identical: {len(rows)-len(moved)} · MOVED: {len(moved)}"
      f" · of those FAILING the gate: {len(fails)}")
print("")
print(f"  {'screen':<26}  {'diffPx':>9} {'ratio':>9}  verdict")
for r in moved:
    # Read the gate's OWN verdict field. The first version of this script asked for a
    # `pass` key that the report does not have, so `.get("pass", True)` was always True
    # and every one of these rows printed "within-threshold" — including the ten the
    # gate had just FAILED. A measurement that cannot report a failure is the same
    # defect as a test that cannot fail.
    print(f"  {r['screen']:<26} {r['diffPixels']:>9} "
          f"{r.get('diffRatio', 0):>9.5f}  {r.get('verdict', '?')}")
print("")
print(f"  changed ONLY inside a Wei-approved mask (0 unmasked px -> gate PASS): {len(maskonly)}")
for r in maskonly:
    print(f"    {r['screen']:<24} {r['maskedDiffPixels']:>8} masked px")
(out / "moved.json").write_text(json.dumps(moved, ensure_ascii=False, indent=2), encoding="utf-8")
PY

echo ""
echo "== scope assert — nothing under reference/ or the manifest was touched =="
git -C "$ROOT" status --porcelain -- tests/visual/reference tests/visual/screens.manifest.json \
  | sed 's/^/  CHANGED: /' || true
[ -z "$(git -C "$ROOT" status --porcelain -- tests/visual/reference tests/visual/screens.manifest.json)" ] \
  && echo "  clean — reference/ and the manifest are untouched"
echo ""
echo "artifacts: $OUT"
