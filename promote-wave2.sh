#!/usr/bin/env bash
# promote-wave2.sh — Promote AUDITED Wave-2 (batch-8) dev → main. Run in Wei's OWN terminal.
# main ALREADY has batch-7 (1b7fbca). This adds ONLY the Wave-2 finance delta (GL/AP/bank).
# AUDITS GO: orch-A 5-lane (407419a..dev) 0 blockers + orch-B batch8-audit.md (in flight). Gates: api 527 · web 485 · i18n 19/19 · drizzle clean.
# Recommend: wait for orch-B's batch-8 audit + Wave-2 E2E/live-G5 to land first (extra confidence).
set -euo pipefail
cd ~/Documents/juneflow
PIN=9bd2a9a
git merge-base --is-ancestor $PIN dev || { echo "ABORT: $PIN not on dev"; exit 1; }
git checkout main
git merge --squash -X theirs $PIN
git commit -m 'promote: batch 8 (Wave-2 finance) to main — GL(coa/jv/inbox) + AP(billing/pv/approve·WHT) + bank(recon/cheque/export) · migrations 0026/0027 · 145-key i18n · audited 0 blockers'
git checkout dev
echo "DONE. main == $PIN. Verify: git diff --stat $PIN main (should be EMPTY)."
