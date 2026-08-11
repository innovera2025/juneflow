# orch-A kickoff — BACKEND lane — 2026-08-04 (post-41st)

> First read `agents/orch-briefs/START-HERE.md` (state + protocol), then this.

## You are orch-A
Zone: `apps/api` + `packages/db` + `packages/contracts` (the **sole OpenAPI owner**). You own backend routes, Drizzle schema/migrations, and the GL/JV double-entry money engine (`apps/api/src/routes/gl-post.ts`). Backend is ~90% (239/262 openapi ops mounted, all 7 flow state-machines real).

## Your next work (roadmap priority order)
1. **P1 · Flow-E transferSalesUnit — `POST /sales/units/{id}/transfer` (ownership transfer → revenue recognition)** — THE spine gap: the only declared money endpoint with NO handler (openapi.yaml ~3739; a comment-only stub in gl-post.ts). This closes sales→transfer→revenue. **BLOCKED on a Wei ruling** for the JV recipe (clear 2040 advance accumulated from bookings+downs · recognize 4020 revenue + VAT · Dr 5010 COGS / Cr 1140 WIP · loan-disbursement cash) — booking/down/deal each got explicit rulings (B-159/B-161), so transfer needs one too. Write the ruling blocker first; build after Wei answers. money=SERVER · source_doc `transfer:<id>` · jv_source_doc_uq idempotency · balanced JV · live-E2E.
2. **P2 · apply the B-261 idempotency template to the mobile money-write endpoints** — `POST /labor/attendance` and the subcon/foreman progress write need a client `idempotency_key` column + PARTIAL unique index + 23505-catch-return-original (copy `apps/api/src/routes/gr.ts` + migration 0056 — the proven template). This UNBLOCKS orch-D's mobile money-write screens (attendance→payroll, progress→revenue). SACRED openapi field + migration → Wei-ratify each.
3. **P1 · auth production flows** — password-reset + email-verify (the `auth_verification` table exists but is unused) + prod secret provisioning (B-038, `BETTER_AUTH_SECRET`). Launch-blocking.
4. **P1 · Wave-4 SELECTIVE** — build only the declared-but-unmounted master-data ops that a WEB screen actually calls (GET/PUT `/cost-centers/{id}`, `/customers` CRUD, `/doc-numbering/{id}`). **Do NOT build `/reports/hub` or `/reports/{id}/export`** — recon proved the web ReportsHub deliberately uses static config + honest-toast (no consumer). Don't build unconsumed endpoints.

## Discipline
- Sacred (openapi + migrations): Wei-ratify the exact diff → apply with `SACRED_OVERRIDE=wei-approved:B-xxx`. Additive openapi fields on opaque-Entity responses need no contract bump.
- Every money path: balanced Dr/Cr · source_doc idempotency · a **live-E2E** (orch-B runs it — the money-skeptic proof a unit stub can't give).
- Push `feature/**` → orch-B verifies (gate-4.5 + money-skeptic) → dev. Never merge to main yourself.
