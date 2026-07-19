# Phase-4 Subcon + PM — EXECUTION CHARTER (orch-B prep · 2026-07-19)

3-chat parallel program. Recon-first deep-prep (4-lane scout + charter synth). Field detail: read the source prototype .jsx + the frozen openapi paths per lane at wave time. Wei launched ("go Phase-4") + answered 4 rulings.

## Topology (3 execute chats + verify + Wei)
| Chat | Role | Lanes | Worktree |
|---|---|---|---|
| **chat-1 · orch-A** | execute backend | B-BE subcon · C-BE pm | agents/subcon-be · agents/pm-be |
| **chat-3 · web** | execute web | B-WEB subcon+accept · C-WEB pm | web-subcon · web-pm |
| **chat-2 · orch-B (me)** | verify | all lanes on merge | qa · compose 5433 |
| **mobile** | DEFERRED (Wei ruling) | — | — |
| **Wei** | Wave-2 rulings + promote | — | — |

## Wei rulings (answered 2026-07-19)
- **i18n R1 (subcon+accept ~200-240 keys) + R2 (pm ~130-160 keys) APPROVED** → SACRED_OVERRIDE = **wei-approved:B-105** (subcon) · **wei-approved:B-106** (pm). Both dicts byte-identical, verbatim from prototype, glyph-exact. Front-load BEFORE any port.
- **Mobile = DEFER** (B-109 offline ruling tracked · file, don't start).
- **Subcon approve-payment = SERVER-COMPUTED** (server is money authority · per-basis formula server-side · client sends only trigger · retention auto-deduct → ap_billing).
- **PM contract mode = ma | per_visit** (ma=on-call no-autogen · per_visit=spread visits_per_year into N periods+WO, anchor=start_date · map prototype "scheduled"→per_visit · fits DB enum, no migration).

## Key facts
- **Contract FROZEN:** all 9 subcon + 9 pm ops already declared opaque in openapi.yaml (subcon L1626-1820, pm L1817-2072). **NO sacred openapi round needed** for the handlers. (One gap: no POST period-create op — periods seed via POST /subcon-contracts embedded body.)
- **Schema landed:** subcon (subcon_contract/work_period/acceptance/defect + wo.contract_id + retention_ledger + ap_billing.retention/wo_id) and pm (pm_contract/pm_asset/pm_workorder/checklist_template/pm_quote) all migrated. **START-NOW handlers need NO migration.**
- **Migration 0033 = next free.** Only needed for: subcon work_period distance/unit autosplit columns (Wave-2, B-107) · pm cert/status column if close needs it (Wave-2, B-108). Coordinate the ONE number via channel CLAIM (B-BE vs C-BE).
- **i18n:** ZERO subcon.*/accept.*/pm.* keys exist. Two front-loadable sacred rounds gate ALL web ports.

## Waves

### Wave 0 — Front-load (day-0 · ZERO code ruling)
Runs in ALL 4 lanes at once:
- **B-BE START-NOW** (chat-1): GET /subcon-contracts · GET /{id}/periods · POST /subcon-contracts (core create, no autosplit) · POST /periods/{id}/deliver · POST /periods/{id}/inspect (pass/reject+defect, no %-gate) · POST /defects/{id}/fix · /recheck · GET /acceptance-center (period slice, counts.ts C3 reuse). Tenant-door + AuditLog + pm.test/subcon.test.
- **C-BE START-NOW** (chat-1): scaffold routes/pm.ts + register + mount · GET+POST /pm/assets · /pm/checklist-templates · /pm/workorders (create+list, items snapshot from template) · /pm/workorders/{id}/checkin · PUT /{id}/checklist · doors + AuditLog + pm.test.
- **i18n rounds** (chat-3): recon + DRAFT both key sets now (read prototype .jsx only — zero cost); APPLY via SACRED_OVERRIDE=wei-approved:B-105/B-106 (byte-exact both dicts, i18n test 19/19).
- **Gate:** per-handler G2 contract-live + G3 unit (tenant-scope, state-machine C3 guards).

### Wave 1 — Light web ports (fire as each START-NOW list handler merges)
- B-WEB: subcon.contracts (list-only, needs listSubconContracts + R1) → subcon.handover (read accepted periods).
- C-WEB: pm.assets (needs listPmAssets + R2) → pm.contracts (create path; GET /projects live).
- Gate: per-screen G3 + G5 vs tests/visual/reference.

### Wave 2 — Wei-gated backend + heavy web (after B-107/B-108 rulings)
- B-BE: approve-payment (server-computed money · retention → ap_billing · cross-lane) · embedded period autosplit (migration 0033 distance/unit cols) · percent-basis acceptance gate.
- C-BE: /pm/contracts w/ per_visit schedule+WO autogen · close→cert+LINE stub · quote create+decide+LINE.
- Web: subcon.accept (งวดงาน payment) · pm.wo · pm.schedule.

### Wave 3 — Fan-in, dashboards, promote (last)
- acceptance-center gr/house/pm slices (B-107 fan-in ruling) · accept (AcceptanceCenter inbox) · pm.dashboard (KPI ruling).
- Full-suite live-G5 sweep (one compose stack) · Wei promote dev→main (0-drift).

## Open Wave-2 blockers (filed for async Wei answering)
- **B-107 subcon Wave-2 bundle:** money=server ✓ + OPEN: distance/unit autosplit columns (migration 0033) · percent-basis gate (server-enforced vs advisory + progress source) · retention release ownership (accounting lane) · acceptance-center fan-in type (add 'pm'? handover=='house'?) · accept NAV badge (static vs live count).
- **B-108 pm Wave-2 bundle:** mode=per_visit ✓ + OPEN: pm.schedule source (derive vs new /pm/schedule) · close cert+LINE stub scope (+ status/cert column?) · quote LINE stub + missing GET /pm/quotes list op · pm.dashboard KPI sources (honest-empty vs derive vs new op) · checklist-template seed (5 client defaults vs honest-empty).
- **B-109 mobile:** offline-first level (PLAN §11 Q5 ก/ข) — DEFERRED, answer when mobile lane starts.

## orch-B verify (per wave)
Wave 0: contract-live + tenant-door skeptic + state-machine unit. Wave 1/3: live-G5 vs reference (recon-first should make first-try green). Wave 2: money-authority skeptic (approve-payment server-computed, no client-trust) + cross-lane ap_billing write correctness + migration 0033 additive live-proof. Every merge: gate-4.5 before push. Full-suite live-E2E + promote 0-drift runbook at end.
