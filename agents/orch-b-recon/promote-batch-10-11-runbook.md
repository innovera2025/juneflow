# Promote batch-10+11 → main — Wei runbook

> Run in **Wei's own terminal** (main is Wei-only). **Pin = dev tip `4c64ef7`** (batch-10 B-096 + batch-11 B-097/B-098 + orch-B audits/finance-E2E). Two batches promoted together.

## Preconditions (all hold ✅)
1. **batch-11 gate-4.5 diff-reviewer = PASS** (8/8 clean · transaction door adversarially checked = cannot widen tenant scope · 0 sacred · scope-invariant tested · api 561/561).
2. **batch-10 B-096** pre-verified GO (static): graceful import reverse-uniqueness (loadConsumedDocs, fail-closed selectThrough) + create-last ordering + matched-PV net.
3. **batch-11 B-097/B-098** verified GO (orch-B): TenantDb transaction door rebuilds the inner TenantDb with the SAME company_id (tx can't widen scope; raw tx never escapes; fail-closes on empty) — wires bank-import / boq-generate-PR / gl-jv atomic. api 561/561.
4. **0 sacred · NO new migration** in the delta (`f648af0..dev`, 19 commits). Schema is unchanged since batch-9 (0028/0029 already on main) → no live-migrate needed.
5. Working tree clean (only orch-b-recon references are docs; they ride this promote).

## Promote (copy-paste into Wei's terminal, one block — no `#` comments)
```
cd ~/Documents/juneflow
PIN=4c64ef7
git merge-base --is-ancestor $PIN dev || echo "ABORT: $PIN not on dev"
git checkout main
git merge --squash -X theirs $PIN
git commit -m "promote: batch 10+11 to main — B-096 bank hygiene (graceful import reverse-uniqueness + matched-PV net) + B-097 TenantDb transaction door (atomic multi-write bank-import/boq-generate-PR/gl-jv, scope-safe) + B-098 atomic generate-PR · audited GO (gate-4.5 PASS + api 561/561 + 0 sacred + no new migration)"
git checkout dev
```
> If `git merge-base` prints ABORT, stop.

## Verify 0-drift (must be EMPTY)
```
git diff --stat 4c64ef7 main
```
EMPTY = main tree byte-identical to the verified dev SHA (0 drift).

## After promote
- **orch-A** (board): flip batch-10/11 review rows → done + clear the batch-10/11 REVIEW-QUEUE rows.
- **orch-B**: post the promote confirmation + 0-drift.
- Deploy note: no schema change vs batch-9 (already-deployed migrations); the B-097 transaction door only affects runtime atomicity, no new DDL.

## What batch-10+11 contains (pin 4c64ef7)
- **P2-BE-24 / B-096** — bank import hygiene: filter already-consumed pv/cheque/rv from the auto-match pool (no 2nd-import 500 on the 0028 partial-unique) · create-last ordering · matched-PV shows net.
- **P2-BE-25 / B-097** — `TenantDb.transaction(fn)` door: atomic, same-tenant-scoped multi-write; wired bank-import (statement+lines), boq generate-PR, gl jv (header+lines). Closes the B-085-class "no transaction door" gap flagged in the B-096 review.
- **P2-BE-26 / B-098** — wrap createPrsFromBoq in the txn door (atomic PR-issue + remain-decrement).
- **orch-B references** (ride-along docs): authz-reaudit-2051e40 · perf-reaudit-finance · live-g5 harness fold + notes · finance-flow.spec E2E (E2E_LIVE-gated, default-skip) · promote runbooks.

## Not covered (non-blocking, follow-ups)
- **B-097 live BEGIN/COMMIT rollback proof** on real PG (finance-e2e-live.sh) — the unit tests cover the scope invariant + drizzle covers rollback; a live atomicity run is optional confidence, NOT a promote blocker.
- **F4 login rate-limiter** threshold (per-IP trips on ~4-5 legit finance logins) — Wei/security decision (per-user vs threshold vs test-bypass). Blocks the finance-E2E live-green only, not the promote.
- **2 authz gaps** (boq revise un-lock · bank match ungated) + **index 0030** (jv_line.jv_id) — fix-specs in orch-b-recon, for the next batch.
