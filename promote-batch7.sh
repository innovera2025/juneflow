#!/usr/bin/env bash
# promote-batch7.sh — Promote AUDITED batch-7 (+overnight delta) dev → main. Run in Wei's OWN terminal (main is Wei-only).
# AUDITS: batch-7 core (244912c..145dcb8) = 8-lane GO · overnight delta (145dcb8..407419a) = 4-lane delta re-audit GO (0 blocker).
# BATCH: 12 web ports + FLOW-A data-completeness (0018-0023 + handlers) + B-082 security F1-F4 + migration 0024 FK-indexes
#        + 0025 TOCTOU + B-085 hardening + B-087 web-crash guards + B-084 CRITICAL money-mutation authz + drizzle-orm 0.45.2 (HIGH vuln cleared).
# GATES GREEN: api 467/467 · web build 305 · drizzle check clean · drizzle GHSA-gpj5-g38j-94v9 CLEARED.
# NOTE: after promote, when you next apply migrations to a DB, 0025's UNIQUE(doc_id,version,action) needs no pre-existing
#       dup rows in boq_version_history (seed is already clean — proven on live PG). New DBs are fine.
set -euo pipefail
cd ~/Documents/juneflow
PIN=407419a
git merge-base --is-ancestor $PIN dev || { echo "ABORT: $PIN not on dev"; exit 1; }
git checkout main
git merge --squash -X theirs $PIN
git commit -m 'promote: batch 7 to main — 12 web ports + FLOW-A data-completeness + B-082/B-084 security + 0024/0025 perf/TOCTOU + B-085/B-087 hardening + drizzle 0.45.2 · audited (8-lane core + 4-lane delta) 0 blockers'
git checkout dev
echo
echo "DONE. main == $PIN (batch-7). Verify tree identical: git diff --stat $PIN main (should be EMPTY)."
