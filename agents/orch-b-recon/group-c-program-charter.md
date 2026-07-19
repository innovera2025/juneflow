# group-C Dashboard/Analytics — PROGRAM CHARTER (orch-B prep · 2026-07-19)

Long-runway execution plan (~5-8 working days) for orch-A. Prepped by a 3-scout + adversarial-charter workflow against main `a1421bf` (post batch-12+B-100 promote). Field-level derivation detail lives in `agents/orch-b-recon/flow-a-group-c.md` §1-§8 — read the relevant § at each wave (recon-first). Wave-1 is separately spec'd in `group-c-wave1-spec.md`.

> Note: the dedicated Wave-2 scout hit a schema-validation cap and returned null, but the sequencing + charter agents read recon §1/§2 directly, so Wave-2 IS covered below. For Wave-2 field-level detail, orch-A reads flow-a-group-c.md §1 (Reports) + §2 (Dashboard-analytics) at Wave-2 time.

## The one move that paces the whole program
**During autonomous Wave-1, file ONE consolidated `BLOCKERS.md` submission** carrying every sacred/decision ask at once:
- **SR-1** — openapi.yaml BATCH amendment (all net-new read ops)
- **SR-2** — activity-feed i18n keys
- **3 Wei decision-gates** — (1) Non-BOQ definition, (2) evm_snapshot store-vs-on-the-fly approval, (3) RPT-004 variance period-model

→ Wei's **single answer round unblocks Wave-2 AND Wave-3 at once** instead of three serial stalls. This is the biggest sequencing lever; do it day 1.

## Waves

### Wave 1 — Autonomous backend + seed (SHIP FIRST · zero Wei/sacred)
All 3 Wei rulings already resolved (2026-07-19: raw entity · dynamic-G5 · payables-only cashflow); audit-log op pre-specced (openapi.yaml:2974); due_date column exists (finance.ts:177). Detail: `group-c-wave1-spec.md`.
- **C-SEED-DUEDATE** (data · CLAIM seed/index.ts via channel — shared w/ group-A, never `git add -A`) — populate ap_billing.due_date (≥1 PAST non-paid/settled → overdue alert; ≥1 in [today,today+7d] → cashflow payables). seedToday UTC-floor; clock-relative asserts. Gates G3+G4.
- **C-BE-AUDITLOG** (backend · new audit-log.ts · parallel) — GET /audit-log (op declared openapi:2974, mirror dashboard withTenant+listEnvelope, null-user→'ระบบ', raw entity). Gates G2+G3.
- **C-BE-DASHVERIFY** (backend/QA · after seed) — verify-not-rebuild all 7 /dashboard/* handlers. Gates G2-live+G4.

### W1-SACRED-BATCH (parallel with Wave-1, off critical path)
File the ONE consolidated BLOCKERS.md (SR-1 + SR-2 + 3 decision-gates). Not code — the gating submission that unblocks Waves 2-3.

### Wave 1b — FE activity widget (gated: SR-2 only)
- **C-WEB-ACTIVITY** (web · dashboard.tsx) — wire activity-feed widget to GET /audit-log (generated client; other 6 widgets already wired). Raw-entity ruling → no display-mapping. dep: C-BE-AUDITLOG + SR-2 i18n.

### Wave 2 — New aggregation endpoints (pure aggregation, NO migration; gated: SR-1)
- **C-BE-COSTTYPE** (backend) — GET /boq/reports/cost-type (RPT-003 Material/Subcon/Labor). Needs ONLY SR-1 (no ruling). dep: SR-1.
- **C-BE-NONBOQ** (backend) — GET /boq/reports/boq-vs-nonboq (RPT-001) + GET /analytics/portfolio (+/analytics/cost-variance if Wei keeps it). dep: SR-1 + Non-BOQ ruling.

### Wave 2b — FE reports port (gated: W2 + SR-3 conditional)
- **C-WEB-REPORTS-1** (web · boq.reports gallery g1/14 + exec-audit.jsx route exec) — port RPT-001 + RPT-003 cards + Executive portfolio rollup, data-wire via generated client. dep: C-BE-COSTTYPE + C-BE-NONBOQ + SR-3 (conditional grep — EVM/variance keys already present, only RPT-001/003 label deltas).

### Wave 3 — evm_snapshot store (the ONE new DDL of the whole program; gated: SR-4 + Wei store approval)
- **C-DB-EVM-MIG** (backend/db) — evm_snapshot schema + migration **0031** (CLAIM number via channel at write; 0030 is highest merged). §3.4 DDL: project_id FK CASCADE, period text, period_end date, pv/ev/ac/budget/bac numeric(16,2), currency_code, timestamps, UNIQUE(project_id,period), index on project_id, **NO company_id** (scope via project.company_id door). Gates G1 schema + live-PG.
- **C-SEED-EVM** (data) — ~12 monthly rows/hero project (project:rjp) tracing an honest S-curve **derived from real cbs_budget BAC (NOT mock literals 26.4/22.2 — C10)**, incl 1-2 ac>budget danger periods. dep: C-DB-EVM-MIG.
- **C-BE-BUDGETACTUAL-BACKFILL** (backend) — HANDLER-ONLY backfill of GET /dashboard/budget-actual arrays from evm_snapshot. **No sacred, no Wei** (contract already specs the empty arrays). dep: C-SEED-EVM.

### Wave 3b — EVM/variance endpoints + FE (gated: SR-1 evm ops + RPT-004 ruling; i18n=NONE, all keys present)
- **C-BE-EVM-ENDPOINTS** (backend) — GET /boq/reports/evm (RPT-005 PV/EV/AC + SPI/CPI) + GET /boq/reports/variance (RPT-004, served from SAME evm_snapshot: plan=budget, actual=ac). **Reuse the C-BE-BUDGETACTUAL-BACKFILL aggregation helper — build-once.** dep: C-BE-BUDGETACTUAL-BACKFILL (shared helper) + SR-1.
- **C-WEB-EVM** (web · boq-reports RPT-004/005 cards + dashboard BudgetActualChart) — data-wire (NOT fresh port; chart primitive + i18n ready). dep: C-BE-EVM-ENDPOINTS.

### Wave 4 — Deferred / post-MVP (do NOT build during core program)
evm_snapshot population worker (BullMQ/cron at period-close, if store must self-populate beyond seed) · cost_baseline forward PV curve · /analytics/evm formal EAC/VAC indices (**FORBIDDEN for MVP — §0, the mock renders no such indices**). Needs fresh Wei scope.

## Sacred rounds (Wei-gated checkpoints)
- **SR-1** openapi.yaml BATCH (SACRED_OVERRIDE=wei-approved:B-xxx): GET /boq/reports/{cost-type,boq-vs-nonboq,variance,evm} + /analytics/portfolio (+cost-variance if kept). Batch ALL into ONE amendment (dashboard-tag precedent B-049). Filed during Wave-1, off critical path.
- **SR-2** i18n activity keys (CONFIRMED ABSENT): dashboard.activityTitle='กิจกรรมล่าสุด' · action verb→label map · time-ago suffix. Gates Wave-1b widget only.
- **SR-3** i18n reports labels — SHRUNK to RPT-001/003 deltas (BOQ/Non-BOQ/Material/Subcon/Labor/Plan/Actual/Variance/%เกิน); EVM/variance keys already present. CONDITIONAL grep at port time.
- **SR-4** migration 0031 evm_snapshot (drizzle/** hook-protected). New file, not an edit to a merged one — CLAIM the live-free number via channel at write.

## Critical constraints (do NOT violate)
1. **BUILD-ONCE (§3.2):** evm_snapshot appears 3× (RPT-005 boq-scoped · RPT-004 variance · dashboard budget-actual S-curve). Build the aggregation ONCE (project_id-keyed shared helper), consumed by all three. Never build the same S-curve twice.
2. **DESIGN-FIDELITY §0:** SPI/CPI only on RPT-005 (the sole screen rendering them). NO /analytics/evm or CPI/SPI/EAC/VAC on the dashboard/exec screens — the mock lacks them.
3. **C10 honest data:** seed EVM from the hero project's REAL cbs_budget BAC, never mock literals. Series stay honest-EMPTY until snapshots exist.
4. **Tenant scope:** evm_snapshot has NO company_id — scope via project_id → project.company_id (boq_doc/subcon_contract door). A direct company_id would break the project-anchored convention.
5. **Determinism:** ONE UTC-floored seedToday; all dates relative to it; E2E/unit asserts clock-relative, NEVER hardcode 2026-07 literals.
6. **Seed file shared with group-A:** CLAIM via channel; sweep iCloud junk ('name 2.ext') before add; never `git add -A`.

## Runway & first action
- **~5-8 working days.** Wave-1 ≈1-1.5d (autonomous) · Wave-1b ≈0.5d (after SR-2) · Wave-2+2b ≈1.5-2d (after SR-1) · Wave-3 ≈1.5-2d (hardest) · Wave-3b ≈1d. Single Wei answer round (filed day 1) is the only critical-path gate.
- **FIRST ACTION:** CLAIM packages/db/src/seed/index.ts via channel, then start C-SEED-DUEDATE (seedToday UTC-floor + due_date rows) ‖ C-BE-AUDITLOG, and SIMULTANEOUSLY file the consolidated W1-SACRED-BATCH BLOCKERS.md.

## orch-B (verify lane) per wave
Wave-1: clock-relative E2E + audit-log tenant-isolation skeptic · Wave-2/3 backend: contract-live + C10-honest-aggregation skeptic + live-migrate 0031 proof · every FE wave: live-G5 render (real vs honest-empty) · each merge: gate-4.5 before push.
