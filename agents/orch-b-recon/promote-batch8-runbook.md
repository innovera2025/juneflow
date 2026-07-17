# Promote batch-8 → main — Wei runbook (post-B-095)

> Run in **Wei's own terminal** (main is Wei-only via the block-main-commit hook). orch-A/orch-B cannot promote.
> **Pin = the SHA that orch-B's verify confirmed** (batch-7 pattern: pin the audited/verified SHA, NOT the branch tip).
> Concrete pin as of B-095 fix: **`192f978`** (Wave-2 finance + B-084/B-082 security + perf + **B-095 packaging fix** · api boots HEALTHY). If dev advances with only verify-neutral commits (bookkeeping/tests) after verify passes, bump the pin to that tip and re-check the drift line.

## Preconditions (all must hold before promoting)
1. **orch-B full batch-8 live-G5 sweep = GREEN on the on-main screens** — no dashboard/master*/boq.list/users regression. (Review-screen body diffs = tracked data-wire gaps, not blockers.)
2. **B-095 static re-audit = APPLIED CORRECTLY** (orch-B C-092, 36/36) **and** api container **HEALTHY** on `docker compose up --wait` (orch-A C-093).
3. **finance E2E** logic proven (7/7) + boot proven (HEALTHY) — the two together = the finance chain runs on `node dist`.
4. **gate-4.5 diff-reviewer = PASS** on the B-095 change (orch-A C-093: exact @juneflow/db mirror · 0 sacred · 0 logic).
5. **Working tree clean** — `git -C ~/Documents/juneflow status --short` shows nothing to stash. (orch-B's `agents/orch-b-recon/*` are untracked references; either commit them on dev first or leave them — they do not enter the squash of a pinned SHA.)

## Promote (copy-paste into Wei's terminal, one block)
```
cd ~/Documents/juneflow
git fetch --all 2>/dev/null
PIN=192f978
git merge-base --is-ancestor $PIN dev || echo "ABORT: $PIN not on dev"
git checkout main
git merge --squash -X theirs $PIN
git commit -m "promote: batch 8 to main — Wave-2 finance (GL/AP/bank) + B-095 packaging fix (tax-engine/bank-file/notifications ship dist · prod boot restored) + B-082/B-084 security + 0024/0025 perf/TOCTOU · audited GO (static 8-dim + finance E2E 7/7 + live-G5 sweep + B-095 static-reaudit 36/36 + api HEALTHY)"
git checkout dev
```
> No `#` comments inside the block (zsh interactive treats a pasted `#` line oddly). If `git merge-base` prints ABORT, stop — the pin isn't on dev.

## Verify 0-drift (must be EMPTY)
```
git diff --stat 192f978 main
```
EMPTY output = main tree is byte-identical to the verified dev SHA (0 drift). Non-empty = investigate before announcing (do not proceed).

## After promote
- main == `192f978` (batch-8). orch-A flips the batch-8 review rows → done + clears REVIEW-QUEUE (board write = orch-A zone).
- orch-B posts the final live-G5 sweep verdicts to the channel for the REVIEW-QUEUE record.
- Deploy note: the prod image now boots (B-095) — a real `docker compose up` on the VPS will start the API instead of crash-looping.

## What batch-8 contains (for the record)
- **Wave-2 finance:** GL (coa/jv/posting-inbox · double-entry guard) · AP (billing/pv · WHT via tax-engine · PV approval ladder) · bank (statements/cheque/recon/export · migration 0026-0027).
- **B-095 packaging fix:** `@juneflow/{tax-engine,bank-file,notifications}` now ship `dist` (conditional exports + build + Dockerfile) → `node dist/index.js` boots (was `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).
- **Carried from the batch-7→dev delta already on this line:** B-082 F1-F4 security · B-084 money-mutation authz · 0024 FK indexes · 0025 TOCTOU · i18n Wave-1/2 rounds.
- **Still open (non-blocking, next batch):** B-084 remaining FLOW-A mutation authz (3 options) · F5 prod AUTH_SECRET env (devops) · i18n translation round · a11y round · FLOW-A group-C dashboard analytics.
