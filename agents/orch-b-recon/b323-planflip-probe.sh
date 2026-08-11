#!/usr/bin/env bash
# b323-planflip-probe.sh — show the MECHANISM behind the gr.list ordering flake.
#
# The blocker row observed the symptom (0 px on one fresh stack, 253,533 px on the
# next) but could not reproduce it on demand, because it depends on which join plan
# the Postgres planner happens to pick. This probe removes the chance: it runs the
# EXACT query GET /gr's PO chain emits (selectThrough(grs, GR_PO_HOPS) — three INNER
# JOINs, no ORDER BY) under two planner configurations and prints the row order each
# produces. If the two orders differ, the endpoint's output order was never a
# property of the code — it was a property of the plan.
#
# ROUND-2 CORRECTION (gate finding 3). The first version of this probe picked its
# tenant with `SELECT id FROM company ORDER BY id LIMIT 1` -> 07bff880…, but all five
# seeded GRs belong to ebbf8c45… . Every planner config therefore returned ZERO rows,
# identical output was guaranteed by construction, and a flip could never have appeared
# no matter how broken the code was. The MECHANISM is real — it is reproduced below on
# the correct tenant — but the old artifact did not show it.
#
# The tenant is now resolved FROM THE DATA (the company that actually owns the joined
# chain), and the probe ABORTS if the query returns fewer than MIN_ROWS rows, so a
# zero-row run can never again be mistaken for a stable one.
#
# Assumes a stack is already up on $POSTGRES_PORT (default 5433).
set -uo pipefail
MIN_ROWS="${MIN_ROWS:-3}"
PGPORT_="${POSTGRES_PORT:-5433}"
PROJ="${COMPOSE_PROJECT_NAME:-juneflow-b323}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="docker compose -p ${PROJ} -f ${ROOT}/infra/docker-compose.yml"
PGC() { $COMPOSE exec -T postgres psql -U juneflow -d juneflow -At "$@"; }

# The tenant that OWNS the chain — derived, not guessed.
CO=$(PGC -c "SELECT DISTINCT project.company_id FROM gr
               INNER JOIN po ON gr.po_id = po.id
               INNER JOIN pr ON po.pr_id = pr.id
               INNER JOIN project ON pr.project_id = project.id" | head -1)
[ -n "$CO" ] || { echo "NO-TENANT-OWNS-A-GR — nothing to probe"; exit 1; }
Q="SELECT gr.no FROM gr
     INNER JOIN po ON gr.po_id = po.id
     INNER JOIN pr ON po.pr_id = pr.id
     INNER JOIN project ON pr.project_id = project.id
   WHERE project.company_id = '${CO}'"

# NON-VACUITY GATE: refuse to report anything if the query is empty. This is the check
# whose absence made the round-1 artifact meaningless.
N=$(PGC -c "$Q" | grep -c .)
echo "  tenant: $CO"
echo "  rows the probe query returns: $N (minimum $MIN_ROWS)"
[ "$N" -ge "$MIN_ROWS" ] || {
  echo "VACUOUS — $N row(s). Identical output would be guaranteed by construction."
  echo "Refusing to print a comparison that cannot fail."; exit 2; }
echo ""

echo "== the query GET /gr's PO chain emits (no ORDER BY), under two planner configs =="
echo ""
for cfg in "SET enable_hashjoin=on;  SET enable_nestloop=on;  SET enable_mergejoin=on;" \
           "SET enable_hashjoin=off; SET enable_nestloop=on;  SET enable_mergejoin=off;" \
           "SET enable_hashjoin=off; SET enable_nestloop=off; SET enable_mergejoin=on;"; do
  echo "--- $cfg"
  PGC -c "$cfg $Q" | tr '\n' ' '
  echo ""
  PGC -c "$cfg EXPLAIN $Q" | grep -iE "join" | head -3
  echo ""
done

echo "== and the PO chain (GET /po — a manifest screen with a committed baseline) =="
QP="SELECT po.no FROM po
      INNER JOIN pr ON po.pr_id = pr.id
      INNER JOIN project ON pr.project_id = project.id
    WHERE project.company_id = '${CO}'"
for cfg in "SET enable_hashjoin=on;  SET enable_nestloop=on;  SET enable_mergejoin=on;" \
           "SET enable_hashjoin=off; SET enable_nestloop=off; SET enable_mergejoin=on;"; do
  echo "--- $cfg"
  PGC -c "$cfg $QP" | grep -v '^SET$' | tr '\n' ' '
  echo ""
done
