# B-095 hand-off — orch-A executes, orch-B verifies (parallel work-order)

> **From:** orch-B · **For:** orch-A (backend/devops) · **2026-07-17**
> One packet to close batch-8. Everything is pre-analyzed; this is execution + a convergence handshake.

## TL;DR
batch-8 (Wave-2 finance) is **verified GO on logic + static** (my audit 8/8 PASS · finance E2E 7/7 logic PASS). It is blocked **only** by **B-095** — a packaging bug that stops the prod API from booting. Fix is copy-paste-ready. The two lanes below run **in parallel** and converge on a single Wei promote.

---

## Lane A — orch-A (execute now)

### A1. Apply the B-095 fix — `agents/orch-b-recon/b095-fix-spec.md`
- `packages/tax-engine/package.json` — conditional `exports` (dev→src / types→dist.d.ts / default→dist.js) for `.`/`./thailand`/`./config`; add `build` script; drop `main`/`types`.
- `packages/tax-engine/tsconfig.build.json` — NEW (verbatim in spec).
- `packages/bank-file/package.json` — same for `.`/`./kbank-direct`/`./config`.
- `packages/bank-file/tsconfig.build.json` — NEW.
- `apps/api/Dockerfile` — add the two `pnpm --filter … build` lines **before** the api build.

### A2. (Recommended) fold notifications — `agents/orch-b-recon/type-stripping-scan.md`
- `packages/notifications/package.json` + `tsconfig.build.json` + one more Dockerfile line. Proactive, zero-risk (consumed by nothing today), pre-checked. Skip only if you want the minimal batch-8.

### A3. Prove the boot locally (the actual gate)
```
docker compose -f infra/docker-compose.yml up -d --build --wait api
```
Must reach healthy (was exit 1). Also confirm `pnpm --filter @juneflow/api test` still green (dev condition → src, unchanged — expect 527).

### A4. Land + board
- Commit on the backend branch → gate-4.5 (diff-reviewer) → merge dev.
- BLOCKERS.md: create **B-095** (backend/devops · not sacred · deploy blocker · fixed) — the id is grep-fresh (last was B-094; `B-256` in the file is a typo, not the max).
- REVIEW-QUEUE.md: add the B-095 fix row to batch-8.

### A5. Handshake → orch-B
Post to channel: **"B-095 applied · fixed-dev-SHA = `<sha>` · stack idle"**. That single line fires my convergence lane.

---

## Lane B — orch-B (in parallel, already staged — fires on A5)

- **live-G5 finance round** — `agents/orch-b-recon/live-g5-finance.sh <fixed-sha>` (7 finance screens, refs+auth+isolated stack staged; `up --wait` re-confirms boot independently).
- **finance E2E re-verify via compose** — re-run `tests/e2e/finance-flow.spec.ts` (`E2E_LIVE=1`) against the **real compose** (previously the E2E agent had to run the api via `tsx` to dodge the crash; post-fix it runs on `node dist` = boot+logic proven together).
- **static re-audit of the B-095 diff** — I can verify the fix diff (exports shape, Dockerfile order, dist emitted) **without** waiting for your build, the moment you commit — flag any deviation from the spec early.

Both verify jobs share one isolated stack (project `juneflow-g5fin`, ports 5434/6381/3101/5273) → **no collision with your zone or a dev stack.**

---

## Convergence → promote
1. orch-B: live-G5 chrome/layout **PASS** on live stack + finance E2E **green on compose** → post the verified SHA + per-screen verdicts to channel.
2. orch-A: record verdicts in REVIEW-QUEUE.md; batch-8 is now **deployable**.
3. Wei: promote the **verified SHA** as one bundle — `git merge --squash -X theirs <verified-sha>` (batch-7 pattern; pin the audited/verified SHA, not the branch tip) → `git diff --stat <sha> main` must be EMPTY.

## Parallel split (no collision)
| | orch-A (Lane A) | orch-B (Lane B) |
|---|---|---|
| Files | `packages/{tax-engine,bank-file,notifications}` · `apps/api/Dockerfile` · BLOCKERS/TASKS/REVIEW-QUEUE | `tests/**` (E2E) · `agents/orch-b-recon/**` · throwaway worktree |
| Stack | your own build/boot check | isolated `juneflow-g5fin` (offset ports) |
| Board | writes (CLAIM) | read-only (supplies verdict lines) |
| Blocks on | nothing — fix is ready | your A5 ping (needs the booting SHA) |

## Open decisions for Wei (non-blocking)
- Fold notifications into B-095 now (A2) or defer to when the worker wires it? (orch-B recommends now — cheap insurance.)
- B-084 remaining FLOW-A mutation authz (3 options in `b084-fix-spec.md`) — separate from B-095, can ride the same batch or the next.
