#!/usr/bin/env bash
# promote.sh — Promote AUDITED batch-7 + Wave-2 dev → main. Run in Wei's OWN terminal (main is Wei-only).
# AUDITS (all GO · 0 blockers): batch-7 core (244912c..145dcb8) 8-lane · batch-7 delta (145dcb8..407419a) 4-lane · Wave-2 delta (407419a..6fcbb37) 5-lane.
# CONTENTS: 12 web ports + FLOW-A data-completeness (0018-0023) + B-082/B-084 security + 0024/0025 perf/TOCTOU
#   + B-085/B-087 hardening + drizzle 0.45.2 (HIGH vuln cleared) + Wave-2 FINANCE (GL coa/jv/inbox · AP billing/pv/approve+WHT · bank recon/cheque/export · migrations 0026/0027 · 145-key i18n round).
# GATES GREEN: api 527 · web 485 · web build 332 · i18n 19/19 · drizzle check clean.
# NOTE: on the FIRST migrate to a fresh DB, migrations 0018-0027 apply cleanly (all additive · seed clean · live-pg16 proven).
set -euo pipefail
cd ~/Documents/juneflow
PIN=6fcbb37
git merge-base --is-ancestor $PIN dev || { echo "ABORT: $PIN not on dev"; exit 1; }
git checkout main
git merge --squash -X theirs $PIN
git commit -m 'promote: batch 7 + Wave-2 to main — 12 web ports + FLOW-A + security(B-082/084) + perf(0024/025) + hardening(B-085/087) + drizzle 0.45.2 + Wave-2 finance(GL/AP/bank · 0026/027 · i18n) · audited 0 blockers'
git checkout dev
echo
echo "DONE. main == $PIN. Verify tree identical: git diff --stat $PIN main (should be EMPTY)."
