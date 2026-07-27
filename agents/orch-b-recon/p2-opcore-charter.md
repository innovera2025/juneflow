# Program-2 Operational Core — CHARTER (orch-B recon wf_83be279a · 2026-07-26 · main 88029af)
Road-to-100 P2. 4-lane recon (inv·labor·timeline·petty) — petty scout hit a transient classifier fail (re-running). Full lane detail in workflow journal.

## Headline & recommendation
**Anchor on LABOR** (only lane shipping backend value day-1 · 6 CRUD ops already declared · tables migrated · 8 workers seeded). **Scope P2 = LABOR + INVENTORY. DEFER TIMELINE** (greenfield · 9 rulings · NULL-seeded Gantt → empty render · no project date anchor). All 3 prototypes exist (no can't-port blocker). All 3 i18n namespaces EMPTY (0/2389).

## Lane readiness
| lane | prototype | contract | schema | verdict |
|---|---|---|---|---|
| **LABOR** | labor.jsx ✓ (259L · 3 scr) | 6 CRUD declared + 1 missing (payroll-post JV) | worker/attendance/payroll tables · superset gaps | **ANCHOR · Wave-0 reads START-NOW** |
| **INVENTORY** | inventory.jsx ✓ (664L · 4 scr + 6 forms) | **0 ops** (sacred round needed) | 4 tables migrated (0005) BUT no per-warehouse balance/ledger | 2nd · after sacred contract + stock-model ruling |
| **TIMELINE** | timeline.jsx ✓ (525L) | 0 ops + 2 declared node-reads | project_node ✓ but NO date anchor · timeline_task NULL-seeded | **DEFER** (greenfield) |
| **PETTY** | petty-alloc.jsx ✓ (PETTY_TX seed) | recon pending (classifier re-run) | petty_tx? TBD | recon incomplete |

## Wave plan
- **Wave-0 START-NOW (orch-A · ZERO ruling):** register labor route in app.ts (unmounted · mirror registerApDepositRoute) + GET /labor/workers|attendance|payroll (3 reads · Entity-opaque · tenant-scoped · seeded shapes) + G2 tests. NO write/calc until Bundle-A rulings.
- **Wave-0 PREP (orch-B · references-only):** i18n manifests draft (inv ~170 · labor ~78 · timeline ~90 = ~338) · openapi op-spec drafts (inventory ~13 ops · labor payroll-post · timeline 4) · migration proposals (labor superset · inventory stock_balance/ledger + line tables) · visual ref shots.
- **Wave-1:** after Bundle-A → labor attendance/payroll compute + POST /labor/payroll/:id/post (JV) → labor web ports (needs i18n). After Bundle-B + inventory sacred contract → inventory backend → web.

## Wei ruling bundles (file as BLOCKERS B-140/141/142)
- **B-140 = Bundle A LABOR** (8Q · RG-1..8): worker superset cols · attendance status/day-fraction col · OT calc (1.5x/8h fixed vs config) · payroll granularity (monthly vs weekly) · payroll breakdown store-vs-compute · payroll→JV (Dr 1140 WIP-labor/Cr bank + cc_id · authorize POST /labor/payroll/:id/post) · attendance/payroll honest-empty.
- **B-141 = Bundle B INVENTORY** (7Q): stock valuation (standard-cost confirm · no FIFO) · per-warehouse modeling (stock_balance/ledger table) · transfer/issue line persistence (line tables) · transfer state-machine (pending→approved atomic dual-warehouse · B-097 txn) · issue→cost-to-BOQ posting (like GR→AP) · negative-stock 409 guard · **B7 SACRED: authorize full inventory openapi contract round (~13 ops)**.
- **B-142 = Bundle C TIMELINE (DEFER)** (9Q · R1-9): Gantt source · project date anchor · NULL-seed · WO-progress %-source (B-107c class) · S-curve source · KPI deltas · related-docs linkage · milestone dates. — recommend defer to a later program.

## Sacred rounds queued
Contract: inventory full (~13 · B7) · timeline (~4 · deferred) · labor payroll-post (1 · after RG-6). i18n: front-load ~338 (or labor+inv 248 if timeline defers) — orch-B compiles, Wei approves per round.

## orch-B verify (per wave)
labor money skeptic (OT/payroll server-computed · Dr1140/Cr bank) · inventory stock-ledger atomicity (transfer dual-warehouse txn · negative-stock 409) · sacred additive · gate-4.5 + G5 fleet · every sacred round Wei-approved BEFORE apply (governance rule from B-138).
