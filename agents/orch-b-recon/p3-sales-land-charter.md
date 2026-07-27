# Program-3 Sales + Land — CHARTER (orch-B recon · 2026-07-27 · main 88029af)
Road-to-100 P3 (plan line 11). 8 screens: Sales FLOW-E ×5 (crm · process · down · loan · service · AR auto-link) + Land FLOW-D ×3 (bank · survey · dd). references-only · decides NOTHING. Sources cited inline; full readiness in the tables below.

## Headline & recommendation
The road-to-100 plan calls P3 "greenfield backend+web" — **recon overturns that.** The `land-sales` OpenAPI tag is **already declared (16 ops, frozen)** and **4 schema tables already exist AND are seeded** (`lead` · `land_plot` · `sales_unit` · `service_ticket`). P3 is **not greenfield** — it is the same **declared-opaque / unmounted-handler** shape that `customers.ts` (C-179) and `labor.ts` (P2 Wave-0) already shipped: register an unmounted route, wire the read over the real columns, no contract change.

**Anchor on SALES** (namesake, 5-screen spine, carries the AR/GL money core). **Wave-0 START-NOW = two zero-ruling reads, one per lane:** `GET /sales/leads` (sales.crm) + `GET /land/plots` (land.bank) — both have table + declared contract + live seed rows. **Scope P3 = all 8 screens, sequenced behind a rulings bundle.** **DEFER inside scope:** `sales.dashboard` is already out (plan scopes sales ×5 = crm/process/down/loan/service, not the dashboard) · **land.survey feasibility engine** ports read-only + client-derived (B-107c class — every feasibility number is client-computed, no stored source, no survey table) · **QO / quote list** ships honest-empty (no quote table, no `/sales/quotes` op). The one lane needing a **NEW contract path** is **sales.service** — its table exists but **no endpoint is declared** (verified: zero `/service` / `service_ticket` paths in openapi).

## Lane readiness
Legend: prototype exists? · declared contract? · schema table? → verdict.

### SALES ×5 (anchor)
| screen | prototype | contract (openapi `land-sales`) | schema (seeded) | verdict |
|---|---|---|---|---|
| **sales.crm** | sales-crm.jsx `SalesCRM` ✓ (5-stage kanban + LeadForm/LeadDetail) | `GET/POST /sales/leads` ✓ | `lead` ✓ (seed idx.708/1666) covers name/phone/source/interest/stage/hot/note/owner/days | **ANCHOR · Wave-0 read START-NOW** (mirror labor.ts). Superset: `hot` bool → 3-state warmth (SA-1). |
| **sales.process** | sales-process.jsx `SalesProcess` ✓ (unit grid + QO list + Quote/Booking/Contract forms) | `POST /sales/bookings` · `/sales/contracts` ✓ · **no `GET /sales/units`, no `/sales/quotes`** | `sales_unit` ✓ (seed idx.1804) booking/contract/loan money + down jsonb | **PARTIAL** — write-side declared; unit-status grid + QO list have no read op (SA-3/SA-4). |
| **sales.down** | sales-process.jsx `SalesDown` ✓ | `GET/POST /sales/downs` ✓ | `sales_unit.down` jsonb[] installment schedule | **PARTIAL** — read op declared; installment-payment model + RV/AR posting shape needs ruling (SA-5). |
| **sales.loan** | sales-process.jsx `SalesLoan` ✓ (bank/ask/approved/term/status per unit) | `GET/POST /sales/loans` ✓ · `POST /sales/units/{id}/transfer` ✓ | **gap** — `sales_unit.loan` = single money numeric only; **no loan-application entity** | **PARTIAL (heaviest schema gap)** — loan-app record (bank/ask/approved/dates/5-status) unmodeled (SA-6); transfer→GL posting (SA-7). |
| **sales.service** | sales-service.jsx `AfterSalesService` ✓ (tickets + status machine + warranty) | **NONE — no `/sales/service` op declared** (verified) | `service_ticket` ✓ (seed idx.1674) full ticket shape | **BLOCKED on contract** — table+seed ready, but needs a **NEW sacred round** to declare read/action ops (SV-1). |

### LAND ×3
| screen | prototype | contract (openapi `land-sales`) | schema (seeded) | verdict |
|---|---|---|---|---|
| **land.bank** | land.jsx `LandBank` ✓ (registry table + LandPlotForm) | `GET/POST /land/plots` ✓ | `land_plot` ✓ (seed idx.1658) deed/area_sqm/gps/price_per_rai/stage/tenure/dd jsonb | **2nd anchor · Wave-0 read START-NOW.** Superset: +title/tambon/amphoe/prov/owner cols (LA-2). |
| **land.survey** | land2.jsx `LandSurvey` ✓ (survey report + feasibility, type-aware solar/RE) | reads `GET /land/plots` ✓ · survey-form persists nowhere | `land_plot` only — **no survey/feasibility table** | **READ-ONLY + client-derive (DEFER persistence)** — feasibility = pure derivation (B-107c); survey form honest-disable (LA-3). |
| **land.dd** | land2.jsx `LandDueDiligence` ✓ (DD checklist + buy/lease deal + PV→AP) | `PUT /land/plots/{id}/dd` ✓ · `POST /land/plots/{id}/deal` ✓ · `POST /land/plots/{id}/advance-stage` ✓ | `land_plot.dd_checklist` jsonb ✓ | **STRONG (after LA rulings)** — checklist+deal declared; deal→PV posting + land-WIP COA needs authorize (LA-4). |

**Cross-lane facts:** all 8 prototypes exist (no can't-port blocker). AR/GL link targets live: `/ar/invoices` · `/ar/rv` · `/ar/cn` · `/ar/aging` · `/ar/tax-register` all declared. `land_plot.area_sqm` is stored in **square metres** (PLAN.md §4) — rai-ngan-wa is FE-display-derived (LA-1). All money columns already carry `currency_code` (server-owned).

## Wave plan
- **Wave-0 START-NOW (orch-A · ZERO ruling):** register a `land-sales` route in app.ts (unmounted · mirror `registerLaborRoute`/`registerCustomersRoute`) + `GET /sales/leads` (lead read) + `GET /land/plots` (plot read) — Entity-opaque, snake_case wire of REAL columns, tenant-scoped (`company_id` fail-closed), `currency_code` on `price_per_rai` + G2 contract-live tests. Both return seeded rows day-1. **NO writes / AR-posting / deal / transfer until the bundles land.**
- **Wave-0 PREP (orch-B · references-only):** i18n manifest drafts (sales ~310 · land ~175) · openapi op-spec drafts **for the contract GAPS only** (sales.service read+status ops · optional `GET /sales/units` unit-grid · optional `/sales/quotes`) · migration proposals (lead `hot`→warmth · land_plot +title/tambon/amphoe/prov/owner · loan-application table-or-jsonb · down installment model · service warranty-derivation) · visual reference shots for all 8 screens.
- **Wave-1 (after Bundle-A/B rulings):** sales.crm read port (needs i18n) → land.bank read port → land.survey/dd port (dd-checklist PUT · deal→PV after LA-4) → sales lifecycle writes (bookings/downs/loans/transfer + AR/GL JV after SA-7 authorize) → sales.process/down/loan ports.
- **Wave-2 (after Bundle-C sacred round):** sales.service — declare ops → service_ticket read + status action ops + warranty-derive → port.

## Wei ruling bundles (file as B-144 / B-145 / B-146 — grep BLOCKERS fresh before assigning; C-024 lesson · a stray `B-256` token was seen in the file, confirm it is not a live high-water mark. Decides NOTHING here — all rows are Wei-pending.)

- **B-144 = Bundle A · SALES lifecycle + AR/GL money core** (Wei-pending, SA-1..8):
  - **SA-1** lead `hot` boolean → 3-state warmth (hot/warm/cold — `HOT_TONE`): change col to text/enum vs add `warmth` col vs read-only-honest.
  - **SA-2** lead `last_contact_at` is `date`, prototype renders relative strings with times ("วันนี้ 10:30"/"2 วัน"): display-derive vs promote to timestamp.
  - **SA-3** sales.process **unit-status grid** (84 units · sold/booked/built/empty) source — derive from `project_node` + `sales_unit.stage`, or model unit-status + declare `GET /sales/units` (sacred) vs honest-empty.
  - **SA-4** **QO / Quote** entity (QO list + QuoteForm) — add quote table + `/sales/quotes` op (sacred) vs **defer QO-list honest-empty** (bookings/contracts still work).
  - **SA-5** sales.down **installment model** — `sales_unit.down` jsonb[] schedule vs a `down_payment_txn` child table (per-installment receipt · done/total · RV per installment); GET /sales/downs row shape.
  - **SA-6** sales.loan **loan-application entity** — no table today (`sales_unit.loan` = one money numeric); prototype needs bank/ask/approved/term/submit-date/result-date/5-status (submitted/approved/partial/rejected/transfer): new `loan_application` table vs `sales_unit` jsonb; GET /sales/loans shape.
  - **SA-7** **AR/GL auto-posting (money=SERVER, B-107a)** — authorize the JV posts + confirm COA: booking `Dr 1101 bank / Cr 2151 advance-booking` · down `Dr 1101 / Cr 2151 advance-down` · transfer `Dr 1101 bank + Dr 2151 advance-close / Cr 4101 house-sale revenue + Cr 2103 output-VAT 7%` (+ close AR + flip unit → delivered + start 12-mo warranty). Authorize `POST /sales/bookings` · `/sales/downs` · `POST /sales/units/{id}/transfer` to post (mirror GR→AP / labor payroll→JV · B-097 txn door).
  - **SA-8** honest-empty (C10) for every sales grid.

- **B-145 = Bundle B · LAND** (Wei-pending, LA-1..6):
  - **LA-1** `land_plot.area_sqm` (sqm) → confirm FE derives rai-ngan-wa (1 rai = 1600 sqm) + `price_per_rai` server-stored; wire returns area_sqm + price_per_rai, FE derives total.
  - **LA-2** land_plot **missing prototype columns** visible in Land Bank: `title` · `tambon` · `amphoe` · `prov` · `owner` (name) — add columns (superset · biggest land gap) vs jsonb vs read-only-honest em-dash.
  - **LA-3** land.survey **feasibility persistence** — all feasibility numbers (units-developable · MWp · annual-MWh · revenue · payback) are client-computed derivations, no stored source, no survey table (B-107c): **recommend port read + client-derive, survey-form honest-disable** vs add survey/feasibility table.
  - **LA-4** land.dd **deal → PV posting (money=SERVER)** — `POST /land/plots/{id}/deal` creates a PV into AP (`ap.pv`) `Dr <land-WIP account> / Cr ...`; confirm land-WIP COA account (prototype: "ที่ดิน-งานระหว่างพัฒนา (WIP)") + that deposit/lease-first-period post through AP.
  - **LA-5** `POST /land/plots/{id}/advance-stage` — confirm the 7-stage vocabulary (source→survey→feas→dd→nego→deal→close); note land.pipeline (the 4th land screen) is **out of P3 scope** (plan scopes land ×3) but the advance action is reused by the plot-detail modal.
  - **LA-6** honest-empty (C10) for land grids.

- **B-146 = Bundle C · SALES SERVICE (contract-gap · needs SACRED round)** (Wei-pending, SV-1..5):
  - **SV-1 SACRED:** `service_ticket` table+seed exist but **no openapi op declared** — authorize a sacred round to declare `GET /sales/service` (read) + `POST /sales/service` (create) + status action ops.
  - **SV-2** warranty — `service_ticket.warranty` is boolean; prototype shows warranty **months remaining** (12-mo window from unit transfer): derive from `sales_unit.transfer_at` + 12mo vs add `warranty_expiry`.
  - **SV-3** status machine (received→scheduled→fixing→fixed→closed) — action ops (assign/start/fix/close) per api-contract "status via action endpoint only," not PUT-status.
  - **SV-4** technician workload + category stats = derived aggregations (B-107c-ish) → honest-derive/empty.
  - **SV-5** "สร้างใบงานช่าง (PM)" cross-link — confirm it creates a `pm_workorder` from a ticket (cross-module → pm.wo).

## Sacred rounds queued
- **Contract (sacred):** sales.service ops (~4 · B-146 SV-1 — the ONLY new path; `land-sales` tag already declared). Conditional: `GET /sales/units` (SA-3) · `/sales/quotes` (SA-4) · `loan_application` shape (SA-6) — only if Wei chooses "model + declare" over derive/honest-empty.
- **Migrations (sacred-adjacent, additive):** lead warmth (SA-1) · land_plot +5 cols (LA-2) · loan-application table (SA-6, if chosen) · down installment table (SA-5, if chosen) · service warranty-expiry (SV-2, if chosen).
- **i18n:** front-load ~485 raw / ~410 actionable after reuse (sales.* ~310 = crm 70 + process 150 + service 90 · land.* ~175 = bank/pipeline 75 + survey/dd 100). Reuse pool: `customer.*` · `ar.*` · GL account names · common `btn.*`. orch-B compiles + verifies (glyph-exact ฿/·/en-dash), Wei approves per round. −~40 if land.survey feasibility defers.

## orch-B verify (per wave)
sales money skeptic (booking/down/transfer JV **server-computed** · Dr 1101 bank / Cr 2151 advance · transfer Dr bank + Dr advance-close / Cr 4101 revenue + Cr 2103 VAT-7% · AR close atomic · B-097 txn door) · land deal→PV posting (money=SERVER · land-WIP COA · into AP) · **sacred additive** (only sales.service is a new path — assert `land-sales` tag unchanged) · every table/row tenant-scoped (`company_id`, foreign-id → 404 no leak) · gate-4.5 + G5 fleet before web merge · **every sacred round Wei-approved BEFORE apply** (governance rule from B-138) · 0-drift promote · report branch+SHA only.
