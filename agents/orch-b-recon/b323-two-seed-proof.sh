#!/usr/bin/env bash
# b323-two-seed-proof.sh — prove the seed is byte-reproducible across FRESH stacks.
#
# THE CLAIM UNDER TEST
#   With SEED_FROZEN_NOW set, two stacks seeded independently — different wall-clock
#   instants, a destroyed-and-recreated volume in between — write IDENTICAL
#   created_at/updated_at on every row, and GET /gr returns the SAME id order.
#
# WHY THE TEARDOWN MATTERS
#   `docker compose down -v` destroys the pgdata volume, so run 2 is a genuinely new
#   database: fresh migrations, fresh INSERTs, fresh heap, fresh planner statistics.
#   Re-seeding the SAME database would prove nothing (the seed TRUNCATEs and re-INSERTs
#   into an already-analyzed heap).
#
# WHY THE WALL-CLOCK GAP MATTERS
#   The defect is `defaultNow()`. If both seeds ran in the same second, a broken build
#   could pass. The script MEASURES the gap between the two seeds (Postgres `now()` at
#   dump time) and FAILS if it is under MIN_GAP_S, so the test cannot pass vacuously.
#
# WHAT THIS PROVES, AND WHAT IT DOES NOT
#   This script is the VALUES half and ONLY the values half. Round 1 let it stand as the
#   whole proof, and the round-2 gate was right to reject that: its `order-*.txt` files
#   printed `id created_at`, so timestamp drift alone produced "DIFFERS" and no ORDER
#   signal was ever isolated. The ORDER half now lives in b323-order-proof.sh, which
#   FORCES the join plan to change instead of hoping two fresh stacks disagree.
#
# WHAT IS DUMPED
#   1. stamps.csv — EVERY `.defaultNow()` timestamp column on every public table with an
#      `id`, ordered BY ID. The column list is discovered from pg_attrdef, not from the
#      names created_at/updated_at: `evm_snapshot.captured_at` is a third column of that
#      shape (it was drifting on the wall clock while created_at was frozen) and
#      `stock_ledger.moved_at` is a fourth. A name-based dump reports the NEXT such
#      column as fixed when it is not. Ordering by id makes this a test of VALUES only,
#      independent of physical row order.
#   2. order-<ep>.ids — the id SEQUENCE alone, timestamps stripped, per endpoint.
#      Carried as a cross-stack sanity band; the DISCRIMINATING order experiment is
#      b323-order-proof.sh.
#   Endpoints that return 0 rows, too few rows, or are not lists at all are labelled
#   VACUOUS and excluded — never recorded as "IDENTICAL". Round 1 probed /ar/tax and
#   /dms/documents, which are not routes at all: the api answered 404, the extractor
#   produced an empty file, and `diff` called two 404s identical coverage.
#
# Usage:  bash agents/orch-b-recon/b323-two-seed-proof.sh [label]
# Output: agents/orch-b-recon/b323-proof/<label>/{run1,run2}/… + diff.txt
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="${1:-fixed}"
OUT="$ROOT/agents/orch-b-recon/b323-proof/$LABEL"
MIN_GAP_S="${MIN_GAP_S:-60}"

export SEED_FROZEN_NOW="${SEED_FROZEN_NOW:-2026-07-20T09:00:00Z}"
export COMPOSE_PROJECT_NAME="juneflow-b323"
export POSTGRES_PORT=5433 REDIS_PORT=6433 API_PORT=3143 WEB_PORT=5313
COMPOSE="docker compose -p ${COMPOSE_PROJECT_NAME} -f ${ROOT}/infra/docker-compose.yml"
API="http://localhost:${API_PORT}/api/v1"
# -q so psql's "SET" / "CREATE FUNCTION" command tags do not land in the CSV as
# pseudo-rows (harmless — identical in both runs — but they pollute the column census
# the widening guard reads).
PGC() { $COMPOSE exec -T postgres psql -q -U juneflow -d juneflow -v ON_ERROR_STOP=1 "$@"; }

SEED_EMAIL="wipha@rungrueang.co.th"
SEED_PASSWORD="juneflow-dev"

cleanup() { $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Guard: never destroy committed evidence. $OUT is git-TRACKED (fixed/ and reverted/
# carry 33 and 23 committed files), so the old `rm -rf "$OUT"` deleted the round's own
# artifacts on every re-run — and a stack that then failed to come up left nothing to
# replace them. Outputs are overwritten in place instead, so a re-run is a reviewable,
# revertible git diff; only untracked leftovers are cleared.
mkdir -p "$OUT/run1" "$OUT/run2"
git -C "$ROOT" ls-files --others --exclude-standard -z -- "$OUT" \
  | while IFS= read -r -d '' f; do rm -f "$ROOT/$f"; done
echo "======== B-323 TWO-SEED DETERMINISM PROOF ($LABEL) ========"
echo "  repo   : $ROOT ($(git -C "$ROOT" rev-parse --abbrev-ref HEAD) $(git -C "$ROOT" rev-parse --short HEAD))"
echo "  frozen : SEED_FROZEN_NOW=$SEED_FROZEN_NOW"
echo "  ports  : pg $POSTGRES_PORT · api $API_PORT"
echo ""

# The dump function lives in a temp schema so it never persists into the app DB.
read -r -d '' DUMP_SQL <<'SQL'
SET TIME ZONE 'UTC';
-- Discover EVERY wall-clock-defaulted timestamp column (a `now()` column default) and
-- dump all of them. Not a name list: created_at/updated_at are merely the two commonest
-- columns of this shape, and the whole point of the round-2 widening is that the next
-- one cannot be silently reported as fixed.
CREATE OR REPLACE FUNCTION pg_temp.dump_stamps()
RETURNS TABLE(t text, rid text, col text, val text) AS $fn$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tn, a.attname AS cn
      FROM pg_class c
      JOIN pg_namespace n  ON n.oid = c.relnamespace
      JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      JOIN pg_attrdef d    ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND format_type(a.atttypid, NULL) LIKE 'timestamp%'
       AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%now()%'
       AND EXISTS (SELECT 1 FROM pg_attribute i
                    WHERE i.attrelid = c.oid AND i.attname = 'id' AND i.attnum > 0)
     ORDER BY 1, 2
  LOOP
    RETURN QUERY EXECUTE format(
      'SELECT %L::text, id::text, %L::text, %I::text FROM public.%I ORDER BY id::text',
      r.tn, r.cn, r.cn, r.tn);
  END LOOP;
END $fn$ LANGUAGE plpgsql;
\copy (SELECT t, rid, col, val FROM pg_temp.dump_stamps()) TO STDOUT WITH CSV
SQL

run_once() {
  local dir="$1" n="$2"
  echo "== RUN $n: compose up (fresh volume) =="
  $COMPOSE up -d --build --wait >"$dir/compose-up.log" 2>&1 || {
    echo "COMPOSE-FAIL"; tail -30 "$dir/compose-up.log"; $COMPOSE logs migrate-seed | tail -30; return 1; }

  # Prove the container actually received the frozen clock (a silent empty value
  # would make both runs use new Date() and the whole test meaningless).
  local seen
  seen=$($COMPOSE exec -T api sh -c 'echo "$SEED_FROZEN_NOW"' 2>/dev/null | tr -d '\r')
  echo "  api SEED_FROZEN_NOW = '${seen}'"
  [ "$seen" = "$SEED_FROZEN_NOW" ] || { echo "FROZEN-CLOCK-NOT-PASSED"; return 1; }

  # Wall clock AT THIS SEED, from the DB itself — the gap between runs is the
  # margin by which a defaultNow() build would have differed.
  PGC -Atc "SELECT now() AT TIME ZONE 'UTC'" > "$dir/db-now.txt" 2>/dev/null
  echo "  db now() = $(cat "$dir/db-now.txt")"

  echo "  dumping stamps…"
  printf '%s\n' "$DUMP_SQL" | PGC > "$dir/stamps.csv" 2>"$dir/stamps.err" || {
    echo "DUMP-FAIL"; tail -20 "$dir/stamps.err"; return 1; }
  local nrows ntables ncols nextra
  nrows=$(wc -l < "$dir/stamps.csv"); ntables=$(cut -d, -f1 "$dir/stamps.csv" | sort -u | wc -l)
  ncols=$(cut -d, -f3 "$dir/stamps.csv" | sort -u | wc -l)
  nextra=$(cut -d, -f3 "$dir/stamps.csv" | sort -u | grep -vcE '^(created_at|updated_at)$')
  echo "  rows: $nrows · tables: $ntables · stamped columns: $ncols (beyond created/updated: $nextra)"
  # Guard against a vacuous pass: two EMPTY dumps are also "identical".
  [ "$nrows" -ge 700 ] && [ "$ntables" -ge 70 ] || { echo "DUMP-TOO-SMALL — seed did not run?"; return 1; }
  # Guard the WIDENING itself: if the discovery silently regressed to the two obvious
  # names, this proof goes blind to exactly the class of column it was widened for.
  [ "$nextra" -ge 1 ] || {
    echo "DUMP-NOT-WIDENED — only created_at/updated_at were dumped; evm_snapshot.captured_at"
    echo "  and stock_ledger.moved_at would be invisible. Refusing to report a pass."; return 1; }
  grep -q ',captured_at,' "$dir/stamps.csv" || {
    echo "DUMP-MISSING-captured_at — the known third defaultNow column is absent"; return 1; }

  echo "  reading id SEQUENCES (timestamps stripped — the order band, not the values test)…"
  local token
  token=$(curl -s -X POST "${API}/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"${SEED_EMAIL}\",\"password\":\"${SEED_PASSWORD}\"}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
  [ -n "$token" ] || { echo "LOGIN-FAIL"; $COMPOSE logs api | tail -20; return 1; }
  # Real routes, verified to exist and to carry rows. `ar/tax` and `dms/documents` are
  # NOT routes (round 1 probed them and diffed two 404s); the register is
  # `/ar/tax-register` and there is no /dms list endpoint, so none is claimed.
  for ep in gr po pr wo boq projects cost-centers pm/assets petty gl/posting-inbox documents ap/pv ar/tax-register; do
    local slug=${ep//\//-}
    curl -s -H "authorization: Bearer ${token}" "${API}/${ep}" \
      | python3 -c '
import sys, json
# The IDENTITY sequence and nothing else. A timestamp here is what made round 1s order
# artifact unreadable: value drift and order drift became the same diff.
try:
    b = json.load(sys.stdin)
except Exception:
    print("!NOT-JSON"); raise SystemExit
rows = b.get("data") if isinstance(b, dict) else b
if not isinstance(rows, list):
    print("!NOT-A-LIST"); raise SystemExit
for r in rows:
    print(r.get("id", ""))
' > "$dir/order-${slug}.ids" 2>/dev/null
    local n; n=$(grep -cv '^!' "$dir/order-${slug}.ids" 2>/dev/null || echo 0)
    if grep -q '^!' "$dir/order-${slug}.ids" 2>/dev/null; then
      echo "    /${ep}: VACUOUS ($(head -1 "$dir/order-${slug}.ids")) — excluded"
    elif [ "$n" -lt 3 ]; then
      echo "    /${ep}: VACUOUS (${n} rows) — excluded"
    else
      echo "    /${ep}: ${n} rows"
    fi
  done

  echo "== RUN $n: destroying the stack AND its volume =="
  $COMPOSE down -v --remove-orphans >"$dir/compose-down.log" 2>&1
  echo ""
}

run_once "$OUT/run1" 1 || exit 1
# Force a wall-clock separation well past a second: a defaultNow() build MUST differ
# visibly across the two runs, otherwise this whole comparison proves nothing.
echo "== waiting ${WAIT_S:-95}s so the two seeds are far apart on the wall clock =="
python3 -c 'import time,os; time.sleep(int(os.environ.get("WAIT_S","95")))'
run_once "$OUT/run2" 2 || exit 1

# --- wall-clock gap: the test is vacuous if the two seeds ran in the same second ---
GAP=$(python3 - "$OUT/run1/db-now.txt" "$OUT/run2/db-now.txt" <<'PY'
import sys, datetime
def rd(p):
    raw = open(p).read().strip()
    date, _, rest = raw.partition(" ")
    hms, _, frac = rest.partition(".")
    micro = int((frac + "000000")[:6]) if frac else 0
    d = datetime.datetime.strptime(date + " " + hms, "%Y-%m-%d %H:%M:%S")
    return d + datetime.timedelta(microseconds=micro)
print(int((rd(sys.argv[2]) - rd(sys.argv[1])).total_seconds()))
PY
)
echo "======== RESULT ========"
echo "wall-clock gap between the two seeds: ${GAP}s (minimum required: ${MIN_GAP_S}s)"
if [ "$GAP" -lt "$MIN_GAP_S" ]; then
  echo "GAP-TOO-SMALL — a defaultNow() build might not have differed visibly. Test is INCONCLUSIVE."
  exit 2
fi

STATUS=0
{
  echo "=== ARTIFACT 1 of 2 — VALUES ==============================================="
  echo "### stamps.csv (EVERY defaultNow() column, ordered by id — order-independent)"
  diff -u "$OUT/run1/stamps.csv" "$OUT/run2/stamps.csv" && echo "IDENTICAL"
  echo ""
  echo "=== ARTIFACT 2 of 2 — ORDER (id sequences, timestamps stripped) ============"
  echo "NB the discriminating order experiment is b323-order-proof.sh, which FORCES a"
  echo "plan change. Two fresh stacks do not reliably pick different plans, so agreement"
  echo "here is a sanity band, not proof."
  for f in "$OUT/run1"/order-*.ids; do
    b=$(basename "$f")
    n=$(grep -cv '^!' "$f" 2>/dev/null || echo 0)
    echo ""
    if grep -q '^!' "$f" 2>/dev/null || [ "$n" -lt 3 ]; then
      echo "### $b — VACUOUS (${n} usable rows): NOT COMPARED, NOT counted as identical"
      continue
    fi
    echo "### $b (${n} rows — id sequence only)"
    diff -u "$f" "$OUT/run2/$b" && echo "IDENTICAL"
  done
} > "$OUT/diff.txt" 2>&1

if grep -q '^[+-][^+-]' "$OUT/diff.txt"; then
  echo "DIFFERS — see $OUT/diff.txt"
  echo "  differing lines: $(grep -c '^[+-][^+-]' "$OUT/diff.txt")"
  head -40 "$OUT/diff.txt"
  STATUS=1
else
  echo "BYTE-IDENTICAL across two freshly seeded stacks."
  grep '^###\|^IDENTICAL' "$OUT/diff.txt"
fi
echo ""
echo "artifacts: $OUT"
exit $STATUS
