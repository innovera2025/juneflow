#!/usr/bin/env bash
# b323-order-proof.sh — prove ROW ORDER is a property of the CODE, not of the join plan.
#
# WHY THIS SCRIPT EXISTS (round-2 gate finding 2)
# ----------------------------------------------
# Round 1 shipped ONE artifact — `order-*.txt`, printing `id created_at` per row — and
# read "DIFFERS" as an ordering signal. It is not: timestamp drift alone produces
# "DIFFERS", so the values half of the fix could account for every line. Strip the
# timestamps and the id sequence was IDENTICAL on all 8 endpoints in the round's own
# `reverted/` artifacts. The headline experiment passed with the ordering fix AND
# would have passed without it — it never varied what it claimed to test.
#
# Two things have to be true for an order experiment to mean anything:
#
#   1. it compares the ID SEQUENCE ALONE, with every timestamp stripped, so an order
#      flip cannot hide behind a value diff and a value diff cannot masquerade as one;
#   2. it can actually FAIL. Two freshly seeded stacks do not reliably pick different
#      join plans — round 1 proved that by accident — so "two stacks agreed" is not
#      evidence of anything. This script FORCES the flip instead of hoping for it.
#
# THE MECHANISM
# -------------
# `selectThrough()` emits INNER JOINs with no ORDER BY. Postgres is free to return a
# join's rows in whatever order the chosen plan produces, and the plan changes with
# statistics, autovacuum timing and cost settings. `ALTER DATABASE ... SET
# enable_hashjoin/enable_nestloop/enable_mergejoin` pins the choice, and a restart of
# the api container forces its pool to open fresh connections that inherit it. So the
# SAME code is asked the SAME question under three different plans.
#
# Measured on the seeded stack, the raw PO chain (three INNER JOINs, no ORDER BY):
#   default   -> PO-2026-0291 0290 0289 0288 0287 0286
#   mergejoin -> PO-2026-0287 0291 0286 0288 0290 0289
# That is the whole defect, on demand, on a screen with a committed baseline.
#
# THE CONTROL
# -----------
# The endpoint set is filtered to JOINED lists that actually return rows. An endpoint
# below MIN_ROWS is reported as SKIPPED — never as "IDENTICAL". Round 1 counted
# /ar/tax and /dms/documents (0 rows) and /notifications (2 rows) as passing coverage;
# an empty list is identical to another empty list no matter how broken the code is.
# The run ABORTS if fewer than MIN_CONTROLS joined endpoints qualify, because at that
# point the experiment can no longer fail and must not be allowed to report PASS.
#
# NEGATIVE CONTROL
#   bash agents/orch-b-recon/b323-order-proof.sh fixed      # expect ORDER-STABLE
#   git stash / revert the sort in po.ts …
#   bash agents/orch-b-recon/b323-order-proof.sh reverted   # expect ORDER-FLIPPED
# If `reverted` does NOT flip, the ordering fix is not doing what this round claims and
# the right response is to say so — not to adjust the test until it agrees.
#
# Usage:  bash agents/orch-b-recon/b323-order-proof.sh [label] [--keep-stack]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="${1:-fixed}"
KEEP="${2:-}"
OUT="$ROOT/agents/orch-b-recon/b323-proof/order-$LABEL"
MIN_ROWS="${MIN_ROWS:-3}"      # below this an "identical" verdict is vacuous
MIN_CONTROLS="${MIN_CONTROLS:-8}"

export SEED_FROZEN_NOW="${SEED_FROZEN_NOW:-2026-07-20T09:00:00Z}"
export COMPOSE_PROJECT_NAME="juneflow-b323"
export POSTGRES_PORT=5433 REDIS_PORT=6433 API_PORT=3143 WEB_PORT=5313
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${ROOT}/infra/docker-compose.yml"
API="http://localhost:${API_PORT}/api/v1"
PGC() { $COMPOSE exec -T postgres psql -U juneflow -d juneflow -At "$@"; }

SEED_EMAIL="wipha@rungrueang.co.th"
SEED_PASSWORD="juneflow-dev"

# Every list endpoint worth probing. JOINED ones (selectThrough → INNER JOIN, the only
# shape whose order a plan can change) are marked `J`; the rest are carried as a
# sanity band. `subcon-accept` is probed on its three explicit slices.
ENDPOINTS=(
  "J po" "J pr" "J wo" "J gr" "J boq" "J projects" "J cost-centers"
  "J subcon-contracts" "J acceptance-center?type=period" "J acceptance-center?type=gr"
  "J acceptance-center?type=house"
  "J pm/contracts" "J pm/assets" "J pm/workorders" "J pm/checklist-templates"
  "J pm/quotes" "J bank/statements" "J bank/cheque"
  "J dashboard/phase-progress" "J dashboard/alerts" "J dashboard/contractors"
  "- models" "- petty" "- notifications" "- gl/posting-inbox" "- documents"
  "- ap/pv" "- ar/tax-register"
)
# NB the paths. Round 1 probed `/ar/tax` and `/dms/documents`, which are not routes at
# all — the api answered 404 and the extractor produced an empty file, so `diff` called
# two 404s "IDENTICAL" and they were counted as coverage. The real register is
# `/ar/tax-register`; there is no /dms list endpoint, so it is not claimed.

cleanup() { [ "$KEEP" = "--keep-stack" ] || $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Guard: never destroy committed evidence. $OUT is git-TRACKED (order-fixed and
# order-reverted carry 86 committed files each), so the old `rm -rf "$OUT"` deleted the
# round's own artifacts on every re-run — and if the stack then failed to come up, they
# were gone with nothing to replace them. Outputs are overwritten in place instead, so
# a re-run is a reviewable, revertible git diff; only untracked leftovers are cleared.
mkdir -p "$OUT"
git -C "$ROOT" ls-files --others --exclude-standard -z -- "$OUT" \
  | while IFS= read -r -d '' f; do rm -f "$ROOT/$f"; done
echo "======== B-323 ORDER PROOF ($LABEL) ========"
echo "  repo   : $ROOT ($(git -C "$ROOT" rev-parse --abbrev-ref HEAD) $(git -C "$ROOT" rev-parse --short HEAD))"
echo "  method : same stack, same seed — the JOIN PLAN is what varies"
echo ""

echo "== compose up (fresh volume) =="
$COMPOSE down -v --remove-orphans >/dev/null 2>&1
$COMPOSE up -d --build --wait >"$OUT/compose-up.log" 2>&1 || {
  echo "COMPOSE-FAIL"; tail -30 "$OUT/compose-up.log"; exit 1; }

# The tenant that actually owns the procurement chain — resolved from the DATA, never
# assumed. (Round 1's probe took `ORDER BY id LIMIT 1`, which is a different company,
# so every one of its queries returned zero rows and "identical" was guaranteed.)
CO=$(PGC -c "SELECT DISTINCT project.company_id FROM gr
               INNER JOIN po ON gr.po_id = po.id
               INNER JOIN pr ON po.pr_id = pr.id
               INNER JOIN project ON pr.project_id = project.id" | head -1)
echo "  GR-owning tenant: $CO"
[ -n "$CO" ] || { echo "NO-TENANT — the seed did not produce a joined GR chain"; exit 1; }

# Corroborating evidence at the DB level: the raw chain, no ORDER BY, under two plans.
RAW_Q="SELECT po.no FROM po
         INNER JOIN pr ON po.pr_id = pr.id
         INNER JOIN project ON pr.project_id = project.id
       WHERE project.company_id = '${CO}'"
{
  echo "### the raw PO chain (selectThrough's SQL, no ORDER BY) under two planner configs"
  echo "--- default"
  PGC -c "$RAW_Q" | tr '\n' ' '; echo
  echo "--- enable_mergejoin only"
  PGC -c "SET enable_hashjoin=off; SET enable_nestloop=off; SET enable_mergejoin=on; $RAW_Q" \
    | grep -v '^SET$' | tr '\n' ' '; echo
} | tee "$OUT/raw-chain.txt"
echo ""

login() {
  curl -s -X POST "${API}/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"${SEED_EMAIL}\",\"password\":\"${SEED_PASSWORD}\"}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null
}

# Extract the row IDENTITY sequence — and NOTHING else. No created_at, no amounts, no
# status. If a value moves, this artifact must not notice; if the order moves, it must.
EXTRACT='
import sys, json
# Identity keys only, in preference order. Deliberately EXCLUDES every date/amount/
# status field: this artifact answers "in what ORDER", never "with what VALUES".
KEYS = ("id", "no", "code", "name", "vendor_name", "title")
try:
    b = json.load(sys.stdin)
except Exception:
    print("!NOT-JSON"); raise SystemExit
rows = b.get("data") if isinstance(b, dict) else b
if not isinstance(rows, list):
    print("!NOT-A-LIST"); raise SystemExit
if not rows:
    raise SystemExit                      # zero rows -> empty file -> reported SKIPPED
key = next((k for k in KEYS if k in rows[0] and rows[0][k] is not None), None)
if key is None:
    print("!NO-IDENTITY-KEY"); raise SystemExit
for r in rows:
    print(r.get(key, ""))
'

capture() {                                     # capture <dir> <regime-label>
  local dir="$1" regime="$2" token
  mkdir -p "$dir"
  token=$(login)
  [ -n "$token" ] || { echo "LOGIN-FAIL ($regime)"; $COMPOSE logs api | tail -20; return 1; }
  for entry in "${ENDPOINTS[@]}"; do
    local ep="${entry#* }"
    local slug="${ep//\//-}"; slug="${slug//\?/_}"; slug="${slug//=/-}"
    curl -s -H "authorization: Bearer ${token}" "${API}/${ep}" \
      | python3 -c "$EXTRACT" > "$dir/${slug}.ids" 2>/dev/null
  done
}

set_regime() {                                  # set_regime <sql>
  PGC -c "$1" >/dev/null 2>&1
  $COMPOSE restart api >/dev/null 2>&1
  python3 -c 'import time; time.sleep(10)'
}

echo "== regime A: the planner's own choice =="
set_regime "ALTER DATABASE juneflow RESET enable_hashjoin;
            ALTER DATABASE juneflow RESET enable_nestloop;
            ALTER DATABASE juneflow RESET enable_mergejoin;"
capture "$OUT/A-default" "default" || exit 1

echo "== regime B: merge join forced (the plan that scrambles the PO chain) =="
set_regime "ALTER DATABASE juneflow SET enable_hashjoin=off;
            ALTER DATABASE juneflow SET enable_nestloop=off;
            ALTER DATABASE juneflow SET enable_mergejoin=on;"
capture "$OUT/B-mergejoin" "mergejoin" || exit 1

echo "== regime C: nested loop forced =="
set_regime "ALTER DATABASE juneflow SET enable_hashjoin=off;
            ALTER DATABASE juneflow SET enable_nestloop=on;
            ALTER DATABASE juneflow SET enable_mergejoin=off;"
capture "$OUT/C-nestloop" "nestloop" || exit 1

PGC -c "ALTER DATABASE juneflow RESET enable_hashjoin;
        ALTER DATABASE juneflow RESET enable_nestloop;
        ALTER DATABASE juneflow RESET enable_mergejoin;" >/dev/null 2>&1

echo ""
echo "======== RESULT ========"
python3 - "$OUT" "$MIN_ROWS" "$MIN_CONTROLS" "${ENDPOINTS[@]}" <<'PY'
import sys, pathlib
out = pathlib.Path(sys.argv[1]); min_rows = int(sys.argv[2]); min_ctl = int(sys.argv[3])
entries = sys.argv[4:]
regimes = ["A-default", "B-mergejoin", "C-nestloop"]

def slug(ep): return ep.replace("/", "-").replace("?", "_").replace("=", "-")

rows, flipped, controls, skipped = [], [], 0, []
for entry in entries:
    joined, ep = entry.split(" ", 1)
    seqs = []
    for r in regimes:
        p = out / r / f"{slug(ep)}.ids"
        seqs.append(p.read_text().splitlines() if p.exists() else ["!MISSING"])
    n = len(seqs[0])
    bad = [s for s in seqs[0] if s.startswith("!")]
    if bad or n < min_rows:
        why = bad[0] if bad else f"only {n} row(s)"
        skipped.append((ep, why))
        continue
    same = all(s == seqs[0] for s in seqs[1:])
    rows.append((ep, joined, n, same))
    if joined == "J":
        controls += 1
    if not same:
        flipped.append((ep, seqs))

print(f"  endpoints compared : {len(rows)}  (joined controls: {controls})")
print(f"  SKIPPED as vacuous : {len(skipped)}")
for ep, why in skipped:
    print(f"      - {ep:<32} {why}  (NOT counted as identical)")
print("")
print(f"  {'endpoint':<32} {'kind':<5} {'rows':>5}  id-sequence across 3 join plans")
for ep, joined, n, same in rows:
    kind = "JOIN" if joined == "J" else "-"
    print(f"  {ep:<32} {kind:<5} {n:>5}  {'STABLE' if same else '*** FLIPPED ***'}")

status = 0
print("")
if controls < min_ctl:
    print(f"INCONCLUSIVE — only {controls} joined endpoints carried >= {min_rows} rows "
          f"(need {min_ctl}). The experiment could not have failed; refusing to call it a pass.")
    status = 2
elif flipped:
    print(f"ORDER-FLIPPED on {len(flipped)} endpoint(s) — row order is a JOIN-PLAN artefact:")
    for ep, seqs in flipped:
        print(f"  --- {ep}")
        for name, s in zip(regimes, seqs):
            print(f"      {name:<12} {' '.join(s)}")
    status = 1
else:
    print(f"ORDER-STABLE — every one of {len(rows)} endpoints returned the IDENTICAL id "
          f"sequence under all three join plans ({controls} of them joined lists).")
(out / "verdict.txt").write_text(
    f"controls={controls} compared={len(rows)} skipped={len(skipped)} flipped={len(flipped)} status={status}\n")
raise SystemExit(status)
PY
STATUS=$?
echo ""
echo "artifacts: $OUT"
exit $STATUS
