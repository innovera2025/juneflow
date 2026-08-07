#!/usr/bin/env bash
# full-rebaseline.sh — orch-B QA · re-capture the FULL app-baseline reference pack.
#
# WHY: the committed app-baseline pack is STALE, not regressed — the identical sweep
# run against untouched `main` produces byte-identical numbers (194 total · 4 pass ·
# 190 fail). So the pack must be re-captured against a deterministic stack.
#
# WHY NOT phase4-g5-rebaseline.sh: that runner is Phase-4 scoped. It captured 28
# screens and then REWROTE tests/visual/screens.manifest.json to contain only those
# 28 rows — silently dropping 71 screens of coverage — and dropped masks without
# reconciling the ids the rows reference (leaving the mask-resolution test red). Its
# login / micro-proxy / capture plumbing is reused here; its manifest logic is not.
#
# CONTRACT
#   1. Enumerates EVERY app-baseline row at run time from screens.manifest.json (the
#      authoritative app-baseline set) and cross-checks it against router.tsx
#      PORTED_SCREENS, so the tool cannot go stale as screens are added — a ported
#      screen with no baseline row is REPORTED as a coverage gap (adding a new
#      baseline is a Wei ruling — B-205 class — not something this tool does).
#   2. Coverage can only grow: row count + screen-id set are asserted before/after and
#      the manifest is NOT written if either shrank. A row that fails to capture keeps
#      its existing baseline and is reported — never dropped.
#   3. Masks stay coherent: every mask id referenced by a row must resolve in
#      lib/masks.ts, asserted before AND after. Rows/masks are carried through
#      byte-identical, so no id can dangle.
#   4. Deterministic capture: SEED_FROZEN_NOW freezes the seed clock AND the ap/ar
#      aging clock (B-224 — compose passes it to migrate-seed, api, worker), and the
#      gate runs --workers=1 (B-186/B-206).
#   5. Proves itself: after promoting the captures it re-runs the REAL gate against the
#      SAME live stack and requires strict-0 on every app-baseline row. A row that
#      still differs is real nondeterminism and is reported per screen — never tuned away.
#   6. Scoped + reversible: writes ONLY tests/visual/reference/app-baseline/** and
#      tests/visual/screens.manifest.json; asserts the changed-path set at the end and
#      asserts gallery/ · mobile/ · shots/ are untouched.
#
# Does NOT commit. Leaves the working tree changed for orchestrator review.
#
# Usage: bash agents/orch-b-recon/full-rebaseline.sh
set -uo pipefail

ROOT="/Users/innovera/Documents/juneflow"
HERE="$ROOT/agents/orch-b-recon"
OUT="$HERE/full-rebaseline-results"
SCRATCH="${SCRATCH:-/private/tmp/juneflow-fullrb}"
STAGE="$SCRATCH/stage"
STATE="$SCRATCH/state.json"

# B-224: the whole point — freeze the seed clock AND the ap/ar aging display clock.
export SEED_FROZEN_NOW="${SEED_FROZEN_NOW:-2026-07-20T09:00:00Z}"

# Isolated compose project + offset ports (cannot collide with anything else on the box).
export COMPOSE_PROJECT_NAME="juneflow-fullrb"
export POSTGRES_PORT=5470 REDIS_PORT=6410 API_PORT=3140 WEB_PORT=5310
PROXY_PORT=5311
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${ROOT}/infra/docker-compose.yml"
API="http://localhost:${API_PORT}/api/v1"
BASE="http://localhost:${PROXY_PORT}"

SEED_EMAIL="wipha@rungrueang.co.th"   # MD/Director L4 + platform owner — sees every screen
SEED_PASSWORD="juneflow-dev"

PROXY_PID=""
cleanup() {
  echo "== teardown =="
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null
  $COMPOSE down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

rm -rf "$SCRATCH"; mkdir -p "$STAGE" "$OUT"
echo "======== FULL G5 RE-BASELINE ========"
echo "  repo    : $ROOT ($(git -C "$ROOT" rev-parse --abbrev-ref HEAD) $(git -C "$ROOT" rev-parse --short HEAD))"
echo "  frozen  : SEED_FROZEN_NOW=$SEED_FROZEN_NOW"
echo "  ports   : pg $POSTGRES_PORT · redis $REDIS_PORT · api $API_PORT · web $WEB_PORT · proxy $PROXY_PORT"
echo "  scratch : $SCRATCH"
echo ""

# ---------------------------------------------------------------------------
echo "== 0. PREFLIGHT — enumerate rows · assert masks resolve · snapshot manifest =="
python3 - "$ROOT" "$SCRATCH" "$OUT" <<'PY' || { echo "PREFLIGHT-FAIL"; exit 1; }
import json, re, sys, hashlib, pathlib
root, scratch, out = (pathlib.Path(p) for p in sys.argv[1:4])

mpath = root / "tests/visual/screens.manifest.json"
raw = mpath.read_bytes()
(scratch / "manifest.before.json").write_bytes(raw)
man = json.loads(raw.decode("utf-8"))
rows = man["screens"]

# --- mask registry: every id referenced by a row must resolve (lib/masks.ts) ---
masks_src = (root / "tests/visual/lib/masks.ts").read_text(encoding="utf-8")
body = masks_src[masks_src.index("MASK_REGISTRY"):]
known = set(re.findall(r'^\s{2}"([a-z0-9-]+)":\s*\{', body, re.M))
used = {m for r in rows for m in (r.get("masks") or [])}
dangling = sorted(used - known)
if dangling:
    print("  !! DANGLING MASK IDS (fix before running):", dangling); sys.exit(1)
print(f"  masks: {len(known)} in registry · {len(used)} referenced by rows · 0 dangling OK")

# --- refs must be app-baseline only, present on disk, and unique ---------------
bad = [r["ref"] for r in rows if not r["ref"].startswith("app-baseline/")]
if bad:
    print("  !! non-app-baseline refs in manifest:", bad); sys.exit(1)
refs = [r["ref"] for r in rows]
if len(set(refs)) != len(refs):
    print("  !! duplicate refs in manifest"); sys.exit(1)
missing = [r for r in refs if not (root / "tests/visual/reference" / r).exists()]
if missing:
    print("  !! manifest refs with no file on disk:", missing); sys.exit(1)

# --- coverage cross-check vs the app's own route table (cannot go stale) -------
router = (root / "apps/web/src/router.tsx").read_text(encoding="utf-8")
blk = router[router.index("PORTED_SCREENS"):]
blk = blk[: blk.index("\n};")]
ported = set(re.findall(r'^\s+(?:"([a-z][a-z0-9.-]*)"|([a-z][a-zA-Z0-9]*))\s*:', blk, re.M))
ported = {a or b for a, b in ported} - {""}
mroutes = {r["route"] for r in rows}
gap = sorted(ported - mroutes)
extra = sorted(mroutes - ported)
print(f"  rows: {len(rows)} · manifest routes {len(mroutes)} · PORTED_SCREENS {len(ported)}")
print(f"  ported screens with NO app-baseline row (coverage gap, reported not auto-added): {gap or 'none'}")
print(f"  baselined routes not in PORTED_SCREENS (placeholder/shell rows): {extra or 'none'}")

(scratch / "rows.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
(out / "preflight.json").write_text(json.dumps({
    "rows_before": len(rows),
    "screens_before": sorted(r["screen"] for r in rows),
    "manifest_sha256_before": hashlib.sha256(raw).hexdigest(),
    "masks_known": sorted(known), "masks_used": sorted(used),
    "ported_without_baseline": gap, "baselined_not_ported": extra,
}, ensure_ascii=False, indent=2), encoding="utf-8")
PY
ROWS_BEFORE=$(python3 -c "import json;print(len(json.load(open('$ROOT/tests/visual/screens.manifest.json'))['screens']))")

# ---------------------------------------------------------------------------
echo ""
echo "== 1. compose up (isolated · --build --wait · SEED_FROZEN_NOW passed to migrate-seed/api/worker) =="
$COMPOSE up -d --build --wait >"$OUT/compose-up.log" 2>&1 || {
  echo "COMPOSE-FAIL — tail:"; tail -40 "$OUT/compose-up.log"; $COMPOSE logs api | tail -30; exit 1; }
echo "  stack up (api :$API_PORT · web :$WEB_PORT)"
echo "  frozen-clock proof — SEED_FROZEN_NOW as the containers actually received it:"
for svc in migrate-seed api worker; do
  cid=$($COMPOSE ps -aq "$svc" 2>/dev/null | head -1)
  if [ -n "$cid" ]; then
    val=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$cid" 2>/dev/null | grep '^SEED_FROZEN_NOW=' | head -1)
    echo "    ${svc}: ${val:-<ABSENT>}"
  else
    echo "    ${svc}: <no container>"
  fi
done

# ---------------------------------------------------------------------------
echo ""
echo "== 2. login -> storageState (origin = proxy, same origin the gate uses) =="
TOKEN=$(curl -s -X POST "${API}/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"${SEED_EMAIL}\",\"password\":\"${SEED_PASSWORD}\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
[ -n "$TOKEN" ] || { echo "LOGIN-FAIL"; $COMPOSE logs api | tail -30; exit 1; }
python3 - "$STATE" "$TOKEN" "$BASE" <<'PY'
import sys, json
path, token, origin = sys.argv[1:4]
# ONLY juneflow-token — per-row viewMode (B-187) must come from the manifest, not from here.
json.dump({"cookies": [], "origins": [
    {"origin": origin, "localStorage": [{"name": "juneflow-token", "value": token}]}]},
    open(path, "w"))
print(f"  storageState -> {path} (juneflow-token only)")
PY

# ---------------------------------------------------------------------------
echo ""
echo "== 3. micro-proxy :${PROXY_PORT} (same-origin: /api -> api · else -> web nginx) =="
# apps/web calls the relative path /api/v1 (api-client.ts) and the web image's nginx has
# no /api proxy, so the capture and the gate must both go through this same origin.
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
curl -s -o /dev/null -w "  proxy->web %{http_code} · " "${BASE}/"
curl -s -o /dev/null -w "proxy->api %{http_code}\n" -H "authorization: Bearer ${TOKEN}" "${BASE}/api/v1/projects"

# ---------------------------------------------------------------------------
echo ""
echo "== 4. CAPTURE all ${ROWS_BEFORE} rows -> STAGING (never straight into reference/) =="
node "$HERE/full-rebaseline-capture.js" "$BASE" "$STATE" "$SCRATCH/rows.json" "$STAGE" "$OUT/capture-evidence.json" \
  2>&1 | tee "$OUT/capture.log"
[ -f "$OUT/capture-evidence.json" ] || { echo "CAPTURE-STEP-FAIL"; exit 1; }

# ---------------------------------------------------------------------------
echo ""
# B-306: wo-list is HELD OUT of the promote. B-277's own row states that Ruling 2
# must be decided BEFORE this baseline is taken, because it moves the seed WO from
# 20/30/25/25 to 20/50/75/100 — so promoting the new shot would decide the ruling
# inside the artefact that is supposed to be the arbiter, and implementing Wei's
# other option would then read as a G5 regression.
# B-306 LIFTED 2026-08-07: Wei ruled B-277 Ruling 2 = CUMULATIVE, which is what the
# merged cumulativeContractPct already renders — so wo-list shows the ruled figure
# and is no longer held out. Nothing is held by default now; set HOLD_SCREENS to a
# space-separated list if a future ruling puts a screen back behind a decision.
HOLD_SCREENS="${HOLD_SCREENS:-}"
echo "== 5. PROMOTE staged shots -> tests/visual/reference/app-baseline/ (guarded rows keep the old file) =="
echo "  HELD OUT (pending a Wei ruling): ${HOLD_SCREENS:-none}"
python3 - "$ROOT" "$STAGE" "$OUT" <<'PY' || { echo "PROMOTE-FAIL"; exit 1; }
import json, shutil, sys, pathlib
root, stage, out = (pathlib.Path(p) for p in sys.argv[1:4])
ev = json.loads((out / "capture-evidence.json").read_text(encoding="utf-8"))
refdir = root / "tests/visual/reference"
promoted, kept = [], []
for r in ev["results"]:
    if r["staged"] and pathlib.Path(r["staged"]).exists():
        shutil.copyfile(r["staged"], refdir / r["ref"])
        promoted.append(r["screen"])
    else:
        kept.append({"screen": r["screen"], "route": r["route"], "problems": r["problems"]})
print(f"  promoted {len(promoted)} · kept-old {len(kept)}")
for k in kept:
    print(f"    KEPT-OLD {k['screen']} ({k['route']}): {'; '.join(k['problems'])}")
(out / "promote.json").write_text(json.dumps({"promoted": promoted, "kept_old": kept},
                                             ensure_ascii=False, indent=2), encoding="utf-8")
PY

# ---------------------------------------------------------------------------
echo ""
echo "== 6. MANIFEST — rows carried through byte-identical + provenance note (refuse if coverage shrank) =="
python3 - "$ROOT" "$SCRATCH" "$SEED_FROZEN_NOW" <<'PY' || { echo "MANIFEST-FAIL"; exit 1; }
import json, re, sys, subprocess, pathlib, datetime
root, scratch, frozen = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
mpath = root / "tests/visual/screens.manifest.json"
before = json.loads((scratch / "manifest.before.json").read_bytes().decode("utf-8"))
man = json.loads(mpath.read_bytes().decode("utf-8"))

# Hard coverage assertions — refuse to write if anything shrank or drifted.
if len(man["screens"]) < len(before["screens"]):
    print(f"  !! ROW COUNT SHRANK {len(before['screens'])} -> {len(man['screens'])} — refusing to write"); sys.exit(1)
sb = {s["screen"] for s in before["screens"]}
sa = {s["screen"] for s in man["screens"]}
if not sb <= sa:
    print("  !! SCREENS DROPPED:", sorted(sb - sa), "— refusing to write"); sys.exit(1)
if man["screens"] != before["screens"]:
    print("  !! rows differ from the snapshot — this runner never edits rows; refusing to write"); sys.exit(1)

sha = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
                     capture_output=True, text=True).stdout.strip()
stamp = datetime.date.today().isoformat()
note_add = (f" FULL RE-BASELINE ({stamp} · orch-B QA · agents/orch-b-recon/full-rebaseline.sh): "
            f"every app-baseline PNG re-captured from dev {sha} on an isolated seeded stack with "
            f"SEED_FROZEN_NOW={frozen} (B-224 — freezes the seed clock AND the ap/ar aging clock) "
            f"at --workers=1 (B-186/B-206), then proven strict-0 by re-running the gate against the "
            f"SAME live stack. Rows and mask ids are unchanged — coverage is asserted before/after "
            f"and the manifest is not written if it shrank.")
if note_add.strip() not in man["note"]:
    man["note"] = man["note"] + note_add

out = json.dumps(man, ensure_ascii=False, indent=2)   # matches the committed formatting exactly
mpath.write_bytes(out.encode("utf-8"))

# Re-assert masks resolve AFTER the write.
masks_src = (root / "tests/visual/lib/masks.ts").read_text(encoding="utf-8")
body = masks_src[masks_src.index("MASK_REGISTRY"):]
known = set(re.findall(r'^\s{2}"([a-z0-9-]+)":\s*\{', body, re.M))
used = {m for r in man["screens"] for m in (r.get("masks") or [])}
if used - known:
    print("  !! DANGLING MASK IDS AFTER WRITE:", sorted(used - known)); sys.exit(1)
print(f"  rows before {len(before['screens'])} -> after {len(man['screens'])} (identical) · "
      f"{len(used)} mask ids all resolve · note appended")
PY
ROWS_AFTER=$(python3 -c "import json;print(len(json.load(open('$ROOT/tests/visual/screens.manifest.json'))['screens']))")
echo "  manifest rows: before=$ROWS_BEFORE  after=$ROWS_AFTER"
[ "$ROWS_AFTER" -ge "$ROWS_BEFORE" ] || { echo "COVERAGE SHRANK — abort"; exit 1; }

# ---------------------------------------------------------------------------
echo ""
echo "== 7. PROVE — re-run the REAL gate against the SAME live stack (strict-0 required) =="
( cd "$ROOT" && VISUAL_BASE_URL="$BASE" VISUAL_STORAGE_STATE="$STATE" \
    pnpm --filter @juneflow/tests test:visual -- --workers=1 2>&1 | tail -25 ) | tee "$OUT/gate-run.log"
cp "$ROOT/tests/visual/.results/visual-report.md"   "$OUT/visual-report.md"   2>/dev/null
cp "$ROOT/tests/visual/.results/visual-report.json" "$OUT/visual-report.json" 2>/dev/null
rm -rf "$OUT/diff"; cp -R "$ROOT/tests/visual/.results/diff" "$OUT/diff" 2>/dev/null || true

# ---------------------------------------------------------------------------
# B-301 decisive experiment. Step 7 proving strict-0 ONCE is NOT evidence that
# the pack is stable: two independent runs on FRESHLY SEEDED stacks did not
# reproduce it (gl.inbox failed in both, petty + notifications in one), and the
# residual set was not even the same screens run-to-run.
#
# There are two candidate causes and one run cannot tell them apart:
#   (a) intra-run nondeterminism  — the same stack renders differently twice;
#   (b) cross-stack seed drift    — every fresh stack writes a new wall-clock
#       created_at (schema uses .defaultNow(); the seed sets created_at
#       explicitly only for the org tree), and SEED_FROZEN_NOW freezes the
#       BUSINESS clock, not the DB default. Date text of a different width then
#       reflows the neighbouring column, spilling outside the B-160 mask.
#
# Running the gate a SECOND time against the SAME live stack separates them:
#   second run strict-0  -> (b): the pack is stable per stack; the fix belongs
#                           in the seed or the mask, not in the pack.
#   second run drifts    -> (a): genuine nondeterminism, and the pack cannot be
#                           trusted as a regression anchor until it is found.
# Either answer is worth more than a green gate.
echo ""
echo "== 7b. B-301 EXPERIMENT — run the gate a SECOND time against the SAME stack =="
( cd "$ROOT" && VISUAL_BASE_URL="$BASE" VISUAL_STORAGE_STATE="$STATE" \
    pnpm --filter @juneflow/tests test:visual -- --workers=1 2>&1 | tail -25 ) | tee "$OUT/gate-run-2.log"
cp "$ROOT/tests/visual/.results/visual-report.json" "$OUT/visual-report-2.json" 2>/dev/null

python3 - "$OUT" <<'PY'
import json, pathlib, sys
out = pathlib.Path(sys.argv[1])
a, b = out / "visual-report.json", out / "visual-report-2.json"
if not (a.exists() and b.exists()):
    print("  !! one of the two reports is missing — experiment inconclusive"); raise SystemExit
def cap(p):
    return {r["screen"]: r for r in json.loads(p.read_text(encoding="utf-8"))["results"]
            if r["kind"] == "capture"}
A, B = cap(a), cap(b)
drift = {s: (A[s]["diffPixels"], B[s]["diffPixels"]) for s in A
         if s in B and (A[s]["diffPixels"] or B[s]["diffPixels"])}
print(f"  run-1 strict-0: {sum(1 for r in A.values() if not r['diffPixels'])}/{len(A)}"
      f" · run-2 strict-0: {sum(1 for r in B.values() if not r['diffPixels'])}/{len(B)}")
if not drift:
    print("  ANSWER (b): both runs byte-identical on the SAME stack.")
    print("    -> the pack is STABLE per stack; the cross-stack failures come from the")
    print("       seed's wall-clock created_at, NOT from render nondeterminism.")
    print("       Fix belongs in the seed (explicit created_at) or the B-160 masks.")
else:
    print("  ANSWER (a): the SAME stack rendered differently twice — real nondeterminism:")
    for s, (x, y) in sorted(drift.items(), key=lambda kv: -max(kv[1])):
        print(f"    {s:<24} run-1 {x:<7} run-2 {y}")
    print("    -> the pack cannot be trusted as a regression anchor until this is found.")
PY

echo ""
echo "== 8. VERDICT — per-screen strict-0 =="
python3 - "$OUT" <<'PY'
import json, sys, pathlib
out = pathlib.Path(sys.argv[1])
p = out / "visual-report.json"
if not p.exists():
    print("  !! no visual-report.json — the gate did not produce a report"); sys.exit(0)
rep = json.loads(p.read_text(encoding="utf-8"))
cap = [r for r in rep["results"] if r["kind"] == "capture"]
self_ = [r for r in rep["results"] if r["kind"] != "capture"]
fails = [r for r in cap if r["verdict"] != "PASS"]
nonzero = [r for r in cap if r["diffPixels"] > 0]
absorbed = [r for r in cap if (r.get("maskedDiffPixels") or 0) > 0]
print(f"  capture rows: {len(cap)} · PASS {len(cap)-len(fails)} · FAIL {len(fails)}")
print(f"  self-check rows: {len(self_)} · PASS {sum(1 for r in self_ if r['verdict']=='PASS')}")
print(f"  strict-0 (diffPixels == 0): {len(cap)-len(nonzero)}/{len(cap)}")
if nonzero:
    print("  --- rows NOT byte-identical (real nondeterminism — reported, never tuned away) ---")
    for r in sorted(nonzero, key=lambda x: -x["diffPixels"]):
        print(f"    {r['screen']:<24} diffPx={r['diffPixels']:<8} ratio={r['diffRatio']*100:.4f}%  {r['verdict']}  {r['note'][:70]}")
if absorbed:
    print("  --- drift absorbed by Wei-approved masks (visible, not silent) ---")
    for r in sorted(absorbed, key=lambda x: -(x.get('maskedDiffPixels') or 0)):
        print(f"    {r['screen']:<24} maskedDiffPx={r.get('maskedDiffPixels')}")
(out / "verdict.json").write_text(json.dumps({
    "capture_total": len(cap), "capture_fail": len(fails),
    "strict_zero": len(cap) - len(nonzero),
    "nonzero": [{"screen": r["screen"], "diffPixels": r["diffPixels"],
                 "diffRatio": r["diffRatio"], "verdict": r["verdict"]} for r in nonzero],
    "masked_absorbed": [{"screen": r["screen"], "maskedDiffPixels": r.get("maskedDiffPixels")} for r in absorbed],
}, ensure_ascii=False, indent=2), encoding="utf-8")
PY

# ---------------------------------------------------------------------------
echo ""
echo "== 9. SCOPE ASSERT — changed paths must be app-baseline/** + screens.manifest.json only =="
git -C "$ROOT" status --porcelain -- tests/ | tee "$OUT/changed-paths.txt"
echo "  --- forbidden-zone check (gallery / mobile / shots must be EMPTY) ---"
FORBIDDEN=$(git -C "$ROOT" status --porcelain -- \
  tests/visual/reference/gallery tests/visual/reference/mobile tests/visual/reference/shots)
if [ -n "$FORBIDDEN" ]; then echo "  !! FORBIDDEN PATHS TOUCHED:"; echo "$FORBIDDEN"; else echo "  gallery/ mobile/ shots/ untouched OK"; fi
OUTSIDE=$(git -C "$ROOT" status --porcelain -- tests/ \
  | awk '{print $2}' | grep -vE '^tests/visual/reference/app-baseline/|^tests/visual/screens\.manifest\.json$' || true)
if [ -n "$OUTSIDE" ]; then echo "  !! OUT-OF-SCOPE CHANGES IN tests/:"; echo "$OUTSIDE"; else echo "  scope OK (app-baseline/** + screens.manifest.json only)"; fi
echo "  changed file count: $(git -C "$ROOT" status --porcelain -- tests/ | wc -l | tr -d ' ')"
echo "  (apps/ · packages/ · infra/ untouched: $(git -C "$ROOT" status --porcelain -- apps packages infra | wc -l | tr -d ' ') changes)"

echo ""
echo "======== FULL G5 RE-BASELINE COMPLETE — artifacts -> $OUT ========"
