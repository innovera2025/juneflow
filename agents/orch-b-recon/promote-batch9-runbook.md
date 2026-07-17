# Promote batch-9 → main — Wei runbook

> Run in **Wei's own terminal** (main is Wei-only via the block-main-commit hook).
> **Pin = the live-verified SHA** = **`f648af0`** (batch-9 code P2-BE-20..23 + orch-B references 4ca6ffa/0d7a325 — all ⊆ this SHA). orch-B ran the full live verify on exactly this tree.
> Optional bump: dev tip `497f675` = `f648af0` + one verify-neutral doc (`batch9-migrate-verify.sh`). Pinning `497f675` instead just also ships that script; the code/schema is identical. Either is safe.

## Preconditions (all hold ✅)
1. **api unit/integration = 555 green** + **drizzle clean** (orch-A).
2. **Adversarial skeptic 6/6 SOUND · 0 bypass** (orch-A) — gl locked-period · bank reverse-unique · pr/po/wo reject-authz · bank reconcile/import gate · PV SoD · net-match: all fail-closed, tenant-scoped, session-trusted, runs-before-write.
3. **reconcile/import authz gate** (P2-BE-22) = applied exactly per `b084-reconcile-fix-spec.md` (orch-B static re-verify — mirrors ap.ts PV gate).
4. **LIVE migrate+seed+boot on real PG16 = CLEAN** (orch-B, `batch9-migrate-verify.sh` on f648af0): `migrate-seed` exited 0 · **30 migrations applied (0000-0029)** · **0028 partial-unique did NOT fail** (seed has no dup pv/cheque/rv) · **0029 `pv.created_by` present** · **api HEALTHY** `/health {"ok":true}` (prod `node dist` boots — B-095 holds).
5. **Working tree clean** — only `agents/orch-b-recon/*` may be uncommitted references; they do not enter the squash of a pinned SHA.

## Promote (copy-paste into Wei's terminal, one block — no `#` comments)
```
cd ~/Documents/juneflow
PIN=f648af0
git merge-base --is-ancestor $PIN dev || echo "ABORT: $PIN not on dev"
git checkout main
git merge --squash -X theirs $PIN
git commit -m "promote: batch 9 to main — Wave-2 bank import/reconcile (P2-BE-20) + MVP-B hardening: B-094 3/3 (gl.jv locked-period 409 · bank reverse-unique mig 0028 · PV self-approve SoD mig 0029) + B-084 reject(pr/po/wo)+bank reconcile/import authz gates · audited GO (555 api + skeptic 6/6 SOUND + reconcile-gate static + live migrate 0000-0029/seed/boot on PG16 · api HEALTHY)"
git checkout dev
```
> If `git merge-base` prints ABORT, stop — the pin isn't on dev.

## Verify 0-drift (must be EMPTY)
```
git diff --stat f648af0 main
```
EMPTY = main tree byte-identical to the verified SHA (0 drift). Non-empty = investigate before announcing.

## After promote
- **orch-A** (board = its zone): flip batch-9 review rows → done + clear the batch-9 REVIEW-QUEUE rows.
- **orch-B**: post final batch-9 verdict lines for the REVIEW-QUEUE record.
- Deploy note: 0028+0029 apply clean on a fresh DB (proven on live PG16); the prod image boots.

## What batch-9 contains (pin f648af0)
- **P2-BE-20** — bank `POST /bank/statements/import` (file→lines→F-BANK1 auto-match, single-candidate no-guess) + `POST /bank/reconcile` (real period lock; back-dated match → 409).
- **P2-BE-21** — B-094-1 (gl.jv post to locked accounting_period → 409) · B-094-2 (bank reverse-uniqueness, **migration 0028** partial-unique pv/cheque/rv) · B-084-reject (reject pr/po/wo gated on the same amount-tiered approval authority as approve).
- **P2-BE-22** — B-084-ext: `POST /bank/reconcile` gated on finance `approve`, `POST /bank/statements/import` on finance `create` (orch-B spec).
- **P2-BE-23** — B-094-3 PV self-approve **SoD** (approver ≠ creator → 403; **migration 0029** `pv.created_by`) → B-094 3/3 complete.
- **orch-B references** (docs, ride-along): batch-8 verify pack + B-084 reconcile fix-spec.
- **Held for batch-10** (NOT in this pin): P2-BE-24 / B-096 bank hygiene.

## Not covered (by design, non-blocking)
- **live-G5 on bank.recon** (Import/Confirm buttons now wired) — blocked on the live-G5 harness debt (lossy-jpg threshold + g5 per-screen viewport, see `live-g5-harness-notes.md`); the screen passed structural-G5 in batch-8. Not a promote gate.
- **finance-path E2E** on the new authz paths — the 555 unit tests + 6/6 adversarial skeptic cover the logic; the live boot proves node-dist. A dedicated E2E can be added later (the committed `finance-flow.spec.ts` lives on `feature/qa` whose base has diverged from dev; extract the two files rather than merging that branch).
