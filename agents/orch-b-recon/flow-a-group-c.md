<!-- orch-B recon artifact · references-only · 2026-07-16 23:07 · for future group-C backend wave -->
<!-- Scope: FLOW-A group-C analytics/reporting (reports + dashboard + EVM). Non-overlapping with orch-A group-A (migrations 0018-0023). -->

# FLOW-A Group-C Recon Packet (orch-B, 2026-07-16 23:07)

## Summary
Group-C is the "analytics & reporting" slice of Flow-A, spanning three domains: BOQ Reports (boq.reports screen, 5 report cards), the project Dashboard (dashboard.jsx, ~10 widgets), and cross-project EVM/executive analytics (exec-audit.jsx, plus the dashboard S-curve). The honest verdict is that group-C is roughly 60% already-built-or-pure-aggregation and 40% genuinely-new-store work. The Dashboard domain is ~70% shipped already (7 live, tenant-scoped, C10-clean endpoints in apps/api/src/routes/dashboard.ts from B-049) — a recon-driven agent should CONFIRM+REUSE, not rebuild. The only genuinely-unstarted, pure-aggregation net-new work is: the Activity Feed (implement the existing GET /audit-log openapi stub), the RPT-003 cost-type (M/S/L) breakdown, the RPT-001 BOQ-vs-Non-BOQ summary, and the cross-project /analytics/portfolio + /analytics/cost-variance rollups — all derivable from existing tables with no migration. The slower, schema-bearing work collapses to ONE real new store: evm_snapshot (a periodic per-project PV/EV/AC time-series), which powers both the dashboard budget-vs-actual S-curve (backfilling existing honest-empty contract arrays — handler-only, no sacred edit) and RPT-005 EVM. RPT-004 variance needs either that same snapshot store or a small boq_report_period table plus a real time-bucketed actual-cost source that does not exist today. A large fraction of the "make analytics light up" work is SEED tuning (spreading audit_log.at timestamps, tripping over-budget cbs rows, populating ap_billing.due_date and evm_snapshot rows), not code. Backend effort estimate: ~2-3 days of pure-aggregation endpoint work that can ship immediately, plus ~1 migration + worker/seed cycle for the time-series store, gated on Wei rulings.

## Overlap check vs orch-A group-A
ZERO overlap between group-C's build surface and group-A's in-flight migrations 0018-0023, with these explicit reconciliations and flags:

CONFIRMED NON-OVERLAP (group-C reads group-A's aggregates, never re-touches their new columns):
- version-history (B-081, migration 0021): group-C does NOT create boq_version_history or its endpoint. RPT-002 Revise report is entirely group-A's — explicitly EXCLUDED from group-C (Wei-approved 2026-07-16, migration 0021 'ปลดล็อก RPT-002'). Listed in this packet for completeness only, marked OUT OF SCOPE.
- BOM endpoint / boq archive columns / boq_item.detail: not needed for any group-C analytics. group-C aggregates boq_item.qty×price and boq_item.cat only (existing columns).
- gr_item / ap_billing / wo work_period: group-C's dashboard contractors widget already CONSUMES work_period.status='passed' read-only (no re-touch needed). group-C proposes NO schema/seed change to ap_billing or work_period.
- notifications route: group-A owns it. group-C's dashboard alerts widget is cbs/ap-derived, NOT notification-table-derived — no read, no overlap.
- procurement wire: group-C only reads pr/po/wo aggregates for the approvals-inbox (already built) and BOQ funnel — no procurement schema work.

GROUP-C's ONLY new DDL — evm_snapshot (and optional deferred cost_baseline) — uses NEW names with NO name collision against group-A. BUT the migration NUMBER must claim 0024+ because group-A is consuming 0018-0023 RIGHT NOW; the exact free number must be CLAIMed via agents/channel.md at write time to avoid a numbering clash. This is a sequencing coordination point, not a content overlap.

TWO CROSS-CUTTING DEPENDENCIES ON GROUP-A (flagged, not owned by group-C):
1. ap_billing.due_date SEED — group-C's dashboard cashflow-forecast (payables leg) and overdue-payable alert auto-fill once group-A adds+seeds ap_billing.due_date. group-C must NOT propose ap_billing schema/seed; it DEPENDS on group-A. Zero dashboard code change once they land it. Coordinate the seed, do not double-own.
2. RPT-002 (above) — group-A's boq_version_history is the backing store; group-C must not duplicate.

ITEMS THAT TURNED OUT NOT TO BE GROUP-A's (safely group-C's): audit_log read route (GET /audit-log — write-side plugin exists, read route unimplemented, no migration — audit_log is read-only for group-C), all /dashboard/* endpoints (already built under B-049, group-C confirms+reuses), and the evm_snapshot store itself.

NET: group-C build surface = 1 new table (evm_snapshot, mig 0024+) + ~5-7 aggregation endpoints + seed tuning. No collision with group-A content; the only shared touchpoints are the migration-number sequence (coordinate via channel) and the ap_billing.due_date seed (depend on group-A).

## Open decisions for Wei
- EVM snapshot store vs on-the-fly: approve the ONE new table `evm_snapshot` (project_id-keyed, migration 0024+) as the backing store for the dashboard budget-vs-actual S-curve AND RPT-005 EVM AND RPT-004 variance? The time-series genuinely cannot be reconstructed on-the-fly (no time-phased table; past EV/AC lost after variation_order/boq-revise overwrite balances). Confirm this is not deferred as honest-empty.
- evm_snapshot population: a real BullMQ worker/cron that writes a snapshot at each period-close, or a seed-only demo store for the MVP? (Wave 3 can ship seed-only and add the worker later.)
- PV baseline source: time-phase the BAC evenly across the project schedule, or drive planned-value periods from timeline_task.plan_start/plan_end + milestone.milestone_date? (Only matters if the forward/future PV curve must be drawn; evm_snapshot.pv covers captured periods regardless.)
- RPT-001 / cost-variance Non-BOQ definition — pick ONE (covers both /boq/reports/boq-vs-nonboq and /analytics/cost-variance): (a) variation_order add−cut attributed via po→pr→pr_item→boq_item→group; (b) cbs_budget overage max(0,used+committed−budget) per group; (c) non-BOQ pr_items (boq_item_id IS NULL, unattributable to a group). pr_item.boq_item_id IS NULL is the only clean cost-side hook.
- RPT-004 period model — accept the recommendation to serve variance from evm_snapshot (plan=budget, actual=ac) and DROP the separate boq_report_period table? Or do you want a dedicated boq_report_period table? (And confirm there is no other source for per-period 'Actual' today.)
- Reconcile the two CVR endpoints: build only /boq/reports/boq-vs-nonboq (in-zone, RPT-001) and drop /analytics/cost-variance, OR keep /analytics/cost-variance as a distinct tenant-wide Reports-Hub flavor?
- Activity feed routing: implement the existing GET /audit-log stub (dms tag, no sacred edit — recommended) or mint a dedicated GET /dashboard/activity alias (requires an openapi edit)?
- Lighting-up empty widgets via SEED (alerts/cashflow/time-series) in scope for group-C now, or defer the ap_billing-dependent legs until group-A's ap_billing.due_date seed lands? (ap_billing seed is group-A's territory — need a coordination call.)
- Optional inbox enhancement columns (pr.title/pr.requester_id, po.title, wo.title, a priority column) — worth a small migration for the approval-inbox title/requester/'ด่วน' badge, or keep the C10 honest-nulls? The numbers already work without them.
- Endpoint namespace: confirm /boq/reports/* (in boq tag/zone) for the five report cards rather than extending the DMS /reports/* family? And approve batching all new /boq/reports/* + /analytics/* ops into ONE openapi.yaml amendment (one sacred round) via SACRED_OVERRIDE.
- Design-fidelity check: confirm we do NOT build formal CPI/SPI/EAC/VAC EVM indices anywhere except RPT-005 (the only prototype screen that renders SPI/CPI) — the dashboard/exec mocks render none, so /analytics/evm stays a forward option only.
- Confirm RPT-002 Revise report endpoint is group-A's to build (with B-081 boq_version_history, migration 0021) so group-C does NOT duplicate it.
- Is PM planned-vs-done (pm.jsx compliance% + PM cost YTD) inside group-C analytics scope, or a separate maintenance-analytics slice? And is the exec 'roll' per-project actual derived from Σcbs_budget.used (consistent with /dashboard/summary) rather than a portfolio snapshot — confirm?

---

# Flow-A Group-C Recon Packet — Analytics & Reporting

> Durable references artifact for the future group-C backend wave.
> Synthesized from three domain recons: **Reports**, **Dashboard-Analytics**, **EVM**.
> Scope guard: group-C = analytics/reporting read-side. Group-A (migrations 0018-0023) owns version-history, BOM endpoint, archive, procurement wire, gr/ap_billing/wo work_period, boq_item.detail, notifications — see the Overlap Check at the end.

---

## 0. Executive Read — how big is this, really?

| Bucket | Items | Effort | Blocker |
|---|---|---|---|
| **Already built — confirm + reuse** | 7 dashboard endpoints (summary, budget-actual, approvals-inbox, phase-progress, alerts, cashflow-forecast, contractors) | ~0.5d verification | none — live in `dashboard.ts`, B-049, tests green |
| **Pure aggregation — ship now, no migration** | Activity Feed (GET /audit-log), RPT-003 cost-type M/S/L, RPT-001 BOQ-vs-Non-BOQ, /analytics/portfolio, /analytics/cost-variance | ~2-3d | RPT-001/cost-variance need ONE Wei ruling (Non-BOQ definition); analytics/* need a sacred openapi amendment |
| **New store required — slower** | `evm_snapshot` (dashboard S-curve + RPT-005 EVM), optional `boq_report_period` (RPT-004) | ~1 migration + seed/worker | Wei ruling: snapshot store vs on-the-fly; migration must claim 0024+ |
| **Mostly SEED, not code** | audit_log timestamp spread, over-budget cbs row, ap_billing.due_date, evm_snapshot demo rows | ~0.5d | ap_billing seed is group-A's territory — coordinate |
| **Excluded — group-A's** | RPT-002 Revise report (B-081 boq_version_history, migration 0021) | — | do not build |

**Central finding:** point-in-time analytics (BAC, AC, committed, remaining, %complete, health, cost-category, contractor EV) is **derivable on-the-fly and largely already implemented**. The **time-series / S-curve (PV/EV/AC over week/month/quarter/year)** is the *one* piece that genuinely needs a new store, because no existing table is time-phased (`cbs_budget` is flat, `jv_line`/`ap_billing` carry `created_at` but the seed collapses all rows to one instant), and past-date EV/AC cannot be reconstructed after `variation_order`/boq-revise overwrite balances.

---

## 1. REPORTS domain (boq.reports screen)

**Screen:** `boq.reports` (NAV-ROUTES.md L28 → `BOQReports` → boq.jsx). One screen hosts all five report cards. Reference gallery g1/14.

### 1.1 Field → mock → derivation

| Report / Field | Mock source | Derivation | Status |
|---|---|---|---|
| **RPT-001** category label (หมวดงาน) | boq.jsx:1701-1706 / 1746-1751 `l`; rendered 1713,1756 | `boq_group.name` per group under project's boq_doc (path group→doc→project). Name carries code prefix e.g. `02 งานโครงสร้าง`. 6 seeded groups = mock's 6 rows. | ✅ aggregate |
| RPT-001 BOQ (planned in-BOQ value) | boq.jsx:1746-1751 `boq:`; footer 12,400,000 @1774 | Per group `Σ(boq_item.qty × boq_item.price)` in group scope. Alt: `cbs_budget.budget` per group. Pure aggregation. | ✅ aggregate |
| RPT-001 Non-BOQ (over-plan spend) | boq.jsx:1746-1751 `non:`; footer +880,000 @1775 | **AMBIGUOUS — needs Wei ruling.** Candidates (all existing tables): (a) `Σ variation_order.amount` add−cut attributed via po→pr→pr_item→boq_item→group; (b) `cbs_budget` overage `max(0, used+committed−budget)` per group; (c) `pr_item` with `boq_item_id` NULL (expense/advance PRs — no group, land in an 'unattributed' bucket). Seed has only 2 VOs so most groups honestly show 0. | ⚠️ ruling |
| RPT-001 รวมใช้จริง (total actual) | boq.jsx:1759; footer 13,280,000 @1776 | Computed = BOQ + Non-BOQ. No independent source. | ✅ computed |
| RPT-001 % เกิน (% over) | boq.jsx:1753 `pct=(non/boq)*100`; badge 1760-1766; footer +7.1% @1777 | Computed ratio ×100. Threshold colouring (>10 danger/>5 warn) is presentational (FE). | ✅ computed |
| **RPT-003** category label | boq-extra.jsx:324-328 `l`; cell 351 | `boq_group.name` (same 6 groups). Mock shows 5 rows (drops '01 Site Work') — real handler returns all groups that have items. | ✅ aggregate |
| RPT-003 Material | boq-extra.jsx:324-328 `m`; footer tM @330,362 | `Σ(qty×price) WHERE boq_item.cat='M'` grouped by group. Pure aggregation. | ✅ aggregate |
| RPT-003 Subcon | boq-extra.jsx:324-328 `s`; footer tS @330,363 | `Σ(qty×price) WHERE boq_item.cat='S'` per group. **Mapping note:** schema `boqItemCat 'S'` = lump-sum/เหมา (data-dictionary 'S เหมา') → mock labels it 'Subcon'. Same column. | ✅ aggregate |
| RPT-003 Labor | boq-extra.jsx:324-328 `lb`; footer tL @330,364 | `Σ(qty×price) WHERE boq_item.cat='L'` per group. | ✅ aggregate |
| RPT-003 row/grand total, M%·S%·L% ratio | boq-extra.jsx:355,331,365,336-338 | Computed sums; ratio = component/grand ×100. No source. | ✅ computed |
| **RPT-004** งวดงาน (period label) | boq-extra.jsx:376-380 `p`; cell 400 | **DATA GAP** — no project-level construction-period/installment table. Mock periods are project phases, not subcon work_periods. Closest existing: `project_node kind='phase'` (names only). Needs new table OR honest-empty. | ❌ schema gap |
| RPT-004 Plan (BOQ) | boq-extra.jsx:376-380 `plan`; cell 401 | **GAP** — no per-period BOQ plan allocation stored. Same gap dashboard.phaseProgress flagged (no phase↔budget link). | ❌ schema gap |
| RPT-004 Actual | boq-extra.jsx:376-380 `actual`; cell 402 | **GAP** — no time-bucketed actual-cost table. jv_line/ap_billing carry no period axis (dashboard.budgetActual returns empty for exactly this reason). | ❌ schema gap |
| RPT-004 Variance / %Dev / status | boq-extra.jsx:395-396,403-406,408 | Computed from Plan/Actual (both gapped). status = pending/done — no schedule column to derive honestly. | ❌ depends |
| **RPT-005** PV / EV / AC time-series | boq-extra.jsx:420-426 (P array, 5 periods); chart 446-449 | **DEEPEST GAP** — Earned Value needs a time-bucketed baseline. None exist. Needs `evm_snapshot` store (see §3). | ❌ schema gap |
| RPT-005 SPI / CPI | boq-extra.jsx:428 `spi=ev/pv`; 429 `cpi=ev/ac`; tiles 458-467 | Computed from last period's EV/PV/AC (all gapped). good=value≥1 (presentational). **Design-fidelity note:** RPT-005 IS the one screen in the prototype that renders SPI/CPI — unlike the dashboard, so these labels are legitimate here. | ❌ depends |

### 1.2 Proposed endpoints (Reports)

All follow the `dashboard.ts` precedent: `request.db` TenantDb, `selectThrough` door-chains (group→doc→project), optional `project_id` via `ownedProject()` (foreign id→404), 401 fail-closed, C10 discipline (no fabricated numbers; honest empty/null with a code comment naming the gap).

| Path | Purpose | Response shape | Deliverable? |
|---|---|---|---|
| `GET /boq/reports/cost-type?project_id&boq_id` | RPT-003 M/S/L by work-category | EntityOk `{rows:[{group_id,category_label,material,subcon,labor,total,currency_code}], totals:{material,subcon,labor,grand}, ratio:{material_pct,subcon_pct,labor_pct}, currency_code}` | ✅ **ship first** |
| `GET /boq/reports/boq-vs-nonboq?project_id&boq_id&from&to&category` | RPT-001 BOQ vs Non-BOQ + %over | EntityOk `{rows:[{group_id,category_label,boq,non_boq,total_actual,pct_over}], totals:{...}, currency_code}` | ⚠️ pending Non-BOQ ruling |
| `GET /boq/reports/variance?project_id&boq_id` | RPT-004 Plan-vs-Actual by period | EntityOk `{rows:[{period_label,plan,actual,variance,pct_dev,status}], currency_code}` — honest-empty until period+actual source exists | ❌ needs schema |
| `GET /boq/reports/evm?project_id&boq_id` | RPT-005 PV/EV/AC + SPI/CPI | EntityOk `{series:[{period_label,pv,ev,ac}], spi, cpi, currency_code}` — honest-empty + null SPI/CPI until snapshots exist | ❌ needs `evm_snapshot` |
| ~~`GET /boq/reports/revise`~~ | RPT-002 Revise report | — | 🚫 **OUT OF SCOPE — group-A B-081** |

> **Namespace recommendation:** keep report endpoints under `/boq/reports/*` (stays in the boq tag/zone) rather than extending the DMS `/reports/*` family. The generic report hub/export (`/reports/hub`, `/reports/{id}/export`, openapi.yaml L2822-2858) already exists for filter/print/export chrome (boq.jsx:1953-2075) — that is not analytics scope.

### 1.3 Reports — DDL (only where genuinely needed)

RPT-001 and RPT-003 need **no new schema** — pure aggregation over `boq_item` (+price), `variation_order`, `po`, `pr`, `pr_item`, `cbs_budget`.

RPT-004 needs a store **only if** the variance report must be non-empty. Two options for Wei:
- **Option A (small dedicated table):**
  ```sql
  CREATE TABLE boq_report_period (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    boq_id uuid NOT NULL REFERENCES boq_doc(id) ON DELETE CASCADE,
    seq int NOT NULL,
    label text NOT NULL,
    plan numeric(16,2) NOT NULL DEFAULT 0,
    actual numeric(16,2) NOT NULL DEFAULT 0,
    status text,
    currency_code text NOT NULL DEFAULT 'THB',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(boq_id, seq)
  );
  ```
  Still requires a real actual-cost source (currently absent).
- **Option B (recommended — reuse `evm_snapshot`):** RPT-004's period/plan/actual axis is a strict subset of `evm_snapshot`'s `period`/`budget(=plan)`/`ac(=actual)`. If `evm_snapshot` is built for §3, serve RPT-004 variance from it (`plan=budget`, `actual=ac`, `variance=ac−budget`) and **do not add `boq_report_period`**. This collapses two schema asks into one store.

RPT-005 needs `evm_snapshot` — **the same store as §3 EVM.** Do not mint a separate boq-scoped snapshot table; key it on `project_id` (see §3 reconciliation).

### 1.4 Reports — seed plan

Existing seed (`packages/db/src/seed/index.ts`): 6 boq_groups (L365), 21 boq_items cat M/L/S (L376-398), 6 cbs_budgets (L1024), PR/PO/WO/GR, 2 variation_orders (L1072-1075).
- **RPT-003** works TODAY against this seed (M/S/L all present).
- **RPT-001** renders but Non-BOQ ≈ 0 (only 2 VOs on po:0/po:1). To demonstrate the %over story: seed a few more `variation_order(dir=add)` spanning several groups' POs, OR a couple of non-BOQ (`boq_item_id` NULL) expense pr_items — depends on the Non-BOQ ruling.
- **RPT-004** needs ~5 period rows (plan+actual) against boqdoc:0 (or the `evm_snapshot` rows if Option B).
- **RPT-005** needs ~5 `evm_snapshot` rows (pv/ev/ac ascending — mock's 2.8→12.4 PV / 2.7→11.6 EV / 2.72→12.3 AC → SPI≈0.94 CPI≈0.94). All tied to project:rjp / boqdoc:0.

---

## 2. DASHBOARD-ANALYTICS domain (dashboard.jsx)

**Screen:** P1-WEB-07 Dashboard (route `dashboard`, default landing, NAV-ROUTES.md:14, gallery g1/01).
**BIG FINDING:** ~70% ALREADY BUILT. 7 of ~10 widgets have live, tenant-scoped, C10-clean endpoints in `apps/api/src/routes/dashboard.ts` (commits 9a02941 P1-BE-15 ×7, e88af1e project_id scope, abbdea5 P2-BE-07 approvals-inbox), all in openapi.yaml §Dashboard(B-049) lines 2962-3095, wired app.ts:151, tests in dashboard.test.ts. B-049 was "deferred" as a WEB screen but the BACKEND landed. **Confirm + reuse, do not rebuild.**

### 2.1 Field → mock → derivation

| Widget / Field | Mock source | Derivation | Status |
|---|---|---|---|
| KPI budget/actual/committed/remaining (+deltas) | dashboard.jsx:12-39, render 316-345 | `cbs_budget` aggregated group→doc→project: Σbudget, Σused, Σcommitted, budget−used−committed. Deltas are presentational i18n keys, NOT derived. | ✅ **built** (summary) |
| KPI solar variant (MWp/MWh/PR/revenue/payback) | dashboard.jsx:300-306 | `solar_inverter` (Σkw, mean perf) + `ppa_invoice` (Σmwh). Revenue/payback/IRR = honest gap (no table). | ✅/gap |
| KPI civil/service variant | dashboard.jsx:307-313, avgProgress 217 | `cbs_budget` totals + avg of `project_node` phase sold%. Next-milestone gap (no schedule table). | ✅/gap |
| Budget-vs-Actual time-series (budget/actual/plan bars) | dashboard.jsx:4-41, chart 43-73 | **GAP** — no time-bucketed cost-posting table. jv_line has project_id+cc_id+created_at but seed collapses created_at → series EMPTY (dashboard.ts:364). **This is the EVM S-curve — see §3.** | ❌ needs `evm_snapshot` |
| Cost-category breakdown (label · actual/plan · tone) | dashboard.jsx:373-390 | per-`boq_group` cbs_budget: label=group.name, actual=used, plan=budget. WORKS today (dashboard.ts:353). | ✅ **built** |
| Approval inbox row (kind · doc_no · title · requester · amount · age · urgent) | dashboard.jsx:118-155, 229-235 | UNION pending pr+po+wo filtered by caller approval tier. amount: PR=Σqty×price, PO=po.total, WO=wo.value. **Honest-null:** title, requester, urgent (no such columns). | ✅ **built** (approvals-inbox) |
| Approval badge count + tier subtitle | dashboard.jsx:399-404 | total from approvals-inbox envelope; tier = caller `role.approvalLevel`. | ✅ **built** |
| Phase progress (name · units · built% · sold% · budgetUsed% · status) | dashboard.jsx:158-190, 237-242 | `project_node kind=phase`: units=count unit descendants, sold%/built% from `sales_unit.stage`. **Honest-null:** budget_used (no per-phase budget link), status (no per-phase schedule). Mock's built=sold & round(sold×0.92) are **FORBIDDEN (C10)**. | ✅ **built** (nulls honest) |
| Alerts (over-budget / price-rise / overdue-PO) | dashboard.jsx:244-248, 440-461 | Rule1 cbs used+committed>budget; Rule2 ap_billing overdue. Both trip NOTHING on current seed → EMPTY. Price-rise has no data source (gap). | ✅ **built** (empty on seed) |
| Health donut (value% + label) | dashboard.jsx:463-474, value 71 | `health_score = 100×remaining/budget` (single utilisation ratio). Mock's opaque '5-indicator 71' NOT reproduced (honest single indicator). | ✅ **built** |
| Cashflow 7-day (net + rows) | dashboard.jsx:482-506, 489-493 | ap_billing payables (due_date in [today,+7d], neg) + ar_invoice receivables (created_at+credit_term, pos). EMPTY on seed (due_date null, ar term=30d). Mock -18.4M NOT reproduced. | ✅ **built** (empty on seed) |
| Contractors (vendor · scope · progress% · retention) | dashboard.jsx:508-529, 515-518 | `subcon_contract` (active) + vendor.name; progress=Σ(work_period.amount passed)/value×100; retention=value×retention_pct/100. **Honest-null:** work_scope (no column). | ✅ **built** (partial) |
| Contractors header count | dashboard.jsx:510-513 | count of active subcon_contract rows (envelope total). | ✅ **built** |
| **Activity feed (who · action · doc · time-ago · dot-color)** | dashboard.jsx:531-550, 534-539 | `audit_log`: user_id→who, action→what, entity→doc, at→time-ago. **NO ENDPOINT EXISTS — genuinely-unstarted (widget #10).** audit_log IS seeded (AUDIT_ENTRIES, seed/index.ts:1363). | ❌ **net-new (the one)** |
| Header meta (project · phase · as_of · status · sync) | dashboard.jsx:266-275 | summary: project.name, first phase, live server time, project.status→FE label. 'Sync SAP/REM online' is presentational. | ✅ **built** (summary) |

### 2.2 Proposed endpoints (Dashboard)

**The one genuinely-unstarted analytics data source:**

| Path | Purpose | Response shape | Notes |
|---|---|---|---|
| `GET /audit-log?entity=&user=&action=&page=` **(or new `GET /dashboard/activity`)** | ACTIVITY FEED (widget #10). Newest audit_log → who/what/doc/time-ago. | B-014 EntityList `{data:[{user_id,user_name,action,entity,at}], page, page_size, total}`. Dashboard slices top ~5. | Already specced in **openapi.yaml:2795** (tag dms, operationId `listAuditLog`) but has **NO route implementation** — only write-side `audit-log.ts` exists. **Cleanest path: implement the existing contract op** (no sacred openapi edit). Tenant: `request.db` company-scoped over audit_log, join users for name; 401 fail-closed like counts.ts. |

**Already built — confirm + reuse (no change):** `GET /dashboard/summary` (dashboard.ts:195), `/dashboard/budget-actual` (321, time-series honest-empty), `/dashboard/approvals-inbox` (400), `/dashboard/phase-progress` (545), `/dashboard/alerts` (624), `/dashboard/cashflow-forecast` (690), `/dashboard/contractors` (755).

### 2.3 Dashboard — schema

**No new table for dashboard** (dashboard.ts header confirms "no new table, no migration"). Activity feed is fully derivable from existing `audit_log`.

**Optional enhancement columns (honest-null today per C10 — NOT required to ship, flag for Wei):**
- `pr.title` + `pr.requester_id`, `po.title`, `wo.title` — approval-inbox title/requester
- a `priority`/`urgency` column on pr/po/wo — inbox 'ด่วน' badge

These are cosmetic; the numbers already work.

### 2.4 Dashboard — seed plan (mostly SEED, not code)

The "analytics lights up" work here is largely seed:
1. **Activity feed** — audit_log IS seeded but every row uses `defaultNow()` for `at` → all timestamps collapse to one instant. **Spread `at` across the last few hours/days** for a realistic feed.
2. **Alerts** — add ≥1 `cbs_budget` row where used+committed>budget to trip OVER_BUDGET_CATEGORY.
3. **Cashflow + overdue alert** — set some `ap_billing.due_date` within [today,+7d]/past, and give a few `ar_invoice` a short credit_term. ⚠️ **`ap_billing` is group-A's territory — coordinate the due_date seed, do not double-own.**
4. **Time-series** — spread `jv_line.created_at` across months so budget-actual bars can bucket (OR use `evm_snapshot` — see §3).

Reference gallery g1/01 shows all widgets populated; seed must demonstrate at least alerts + activity + cashflow non-empty.

---

## 3. EVM domain (the S-curve — the ONE real new store)

**Screens:** Dashboard S-curve (dashboard.jsx), Executive Dashboard (exec-audit.jsx, route `exec`, no endpoint yet), BOQ Reports CVR (boq.jsx:1637), BOQ Overview waterfall (boq.jsx), Reports Hub CVR catalog, Subcon Progress (covered by /dashboard/contractors), PM Dashboard (pm.jsx — adjacent maintenance analytics, confirm scope).

### 3.1 Field → mock → derivation

| Field | Mock source | Derivation | Status |
|---|---|---|---|
| **Budget-vs-Actual S-curve** (budget bars / actual bars / plan dashed-line) over w/m/q/y | dashboard.jsx:4-41,43-73 | **CORE EVM.** plan[]=PV curve, budget[]=time-phased BAC, actual[]=AC curve. **NOT derivable on-the-fly** — no time-phased store. Requires `evm_snapshot`. NOTE: `/dashboard/budget-actual` ALREADY returns `period_label[]/budget_amount[]/actual_amount[]/plan_amount[]` as HONEST-EMPTY arrays (dashboard.ts:364-368, documented DATA GAP) — a snapshot store **backfills these existing fields with NO contract change.** | ❌ needs `evm_snapshot` |
| KPI budget/actual/committed/remaining (+% budget, MoM delta) | dashboard.jsx:315-346 | Point-in-time, **already implemented** (dashboard.ts:285-289) via `/dashboard/summary`. MoM delta needs the snapshot store to compute honestly. | ✅ built (delta gap) |
| Cost-category breakdown (actual vs plan) | dashboard.jsx:374-389 | per boq_group cbs_budget. **Already served** as `cost_categories[]` in `/dashboard/budget-actual` (dashboard.ts:353-357) — the real, non-empty part of that widget. | ✅ built |
| Phase progress (built%/sold%/budgetUsed%/status) | dashboard.jsx:158-190,237-242 | built%/sold% from project_node + sales_unit (dashboard.ts:545-609). budget_used%/status HONEST NULL. Mock's built=sold & round(sold×0.92) **FORBIDDEN (C10)**. | ✅ built (nulls honest) |
| Project health donut (mock=71) | dashboard.jsx:468 | ONE real utilisation ratio `100×remaining/budget` = `health_score` in summary (dashboard.ts:290-293). Mock's '5-indicator 71' NOT reproduced. | ✅ built |
| Cashflow 7-day forecast | dashboard.jsx:483-505 | ap_billing.due_date + ar_invoice term in 7-day window (dashboard.ts:690-742). Empty on seed. Adjacent to EVM, not core. | ✅ built (empty) |
| Contractors %complete + retention (EV per contract) | dashboard.jsx:515-518; subcon.jsx:14-19,88-91 | progress=Σ(work_period.amount passed)/value×100; retention=value×retention_pct/100 (dashboard.ts:755-802). work_scope honest-null. | ✅ built |
| **Exec portfolio rollup** (per-project budget/actual/progress/health/sold + totals + type-mix) | exec-audit.jsx:13-21,23-26,39-43,87-113,122-134 | Cross-project aggregation, **NO endpoint yet.** budget/actual per project from cbs_budget (looped over owned projects); progress from phase-progress avg; health from utilisation; sold from sales_unit; type-mix=Σbudget by project_type.key. Point-in-time derivable. Mock 'roll' hardcodes are **C10-forbidden**. | ⚠️ new aggregate endpoint |
| **BOQ budget-flow waterfall** (BOQ→PR→PO/WO→GR + used% + committed-pending-GR) | boq.jsx:57-61,102-105,120-134 | Point-in-time derivable: BOQ=Σqty×price; PR opened=Σ pr_item price; PO/WO=Σ pos.total+wos.value approved; GR=Σ received-valued; used%=GR/BOQ. Multi-stage funnel = new aggregation (overlaps boq zone). No time axis. | ⚠️ new aggregate (optional) |
| **CVR / BOQ-vs-Non-BOQ variance** (per-category plan vs Non-BOQ overage vs %เกิน) | boq.jsx:1700-1780 | BOQ(plan)=cbs_budget.budget per group. Non-BOQ overage = actual NOT traceable to a BOQ item — `pr_item.boq_item_id IS NULL` is the clean hook. %variance=non/boq×100. **Same concept as Reports RPT-001** — reconcile (see §3.2). | ⚠️ ruling (Non-BOQ) |
| Reports-Hub CVR entries | extra-screens.jsx:53 | Catalog served by `GET /reports/hub` (openapi.yaml:2822). Bodies map to cost-variance derivation; 'Cost Center รายเดือน' needs jv_line grouped by cc_id+month (real posting_date, seed-collapsed). | partial |
| PM planned-vs-done + Compliance% + PM cost YTD | pm.jsx:40-44,111,114 | Adjacent maintenance analytics (schedule adherence, not cost-EVM). plan/done from pm_workorder counts by month; compliance=done/planned; cost YTD=Σ pm cost. **Separate from construction EVM — confirm scope.** | ⚠️ scope Q |

### 3.2 Cross-domain reconciliation (important — avoid building twice)

Three of these recon items are the **same work under different names**. Reconcile before executing:

1. **`evm_snapshot` appears twice** — Reports RPT-005 sketched it `boq_id`-keyed; EVM sketched it `project_id`-keyed with full pv/ev/ac/budget/bac. **Build ONE table, keyed on `project_id`** (the EVM version — matches the schema convention for project-anchored docs and serves both the dashboard S-curve and RPT-005). RPT-005's boq-scoped view is `evm_snapshot` filtered/joined via the project's boq_doc.
2. **CVR / cost-variance appears twice** — Reports `GET /boq/reports/boq-vs-nonboq` (RPT-001) and EVM `GET /analytics/cost-variance` are the same BOQ-vs-Non-BOQ derivation. **Recommendation:** build the per-project version as `/boq/reports/boq-vs-nonboq` (in-zone, RPT-001), and expose `/analytics/cost-variance` only if the Reports-Hub needs a tenant-wide/multi-category flavor. One Non-BOQ ruling covers both.
3. **RPT-004 variance** can be served from `evm_snapshot` rather than a separate `boq_report_period` table (§1.3 Option B).

### 3.3 Proposed endpoints (EVM / analytics)

| Path | Purpose | Response shape | Sacred? |
|---|---|---|---|
| **(NO new path)** backfill `GET /dashboard/budget-actual` series fields | Fill the existing honest-empty `period_label[]/budget_amount[]/actual_amount[]/plan_amount[]` from `evm_snapshot`. **HANDLER-ONLY, no contract edit, no sacred override — cleanest path to close the EVM time-series gap.** | unchanged contract; arrays populated from evm_snapshot filtered by range granularity | ✅ no |
| `GET /analytics/portfolio` | Executive Dashboard rollup — per-project budget/actual/progress/health/sold + totals + type-mix. No endpoint today. | `{totals:{budget_total,actual_total,avg_progress,at_risk_count,currency_code}, projects:[{project_id,name,type_key,budget,actual,progress_pct,health,sold_pct}], type_mix:[{type_key,budget_sum}]}` | ⚠️ **sacred openapi amendment** |
| `GET /analytics/cost-variance` | Reports-Hub 'วิเคราะห์ส่วนต่างต้นทุน' — tenant/multi-category CVR (only if distinct from RPT-001). | `{categories:[{category_label,boq_plan,non_boq_actual,total_actual,variance_pct}], totals:{...}, currency_code}` | ⚠️ sacred (or fold into /boq/reports/boq-vs-nonboq — no edit) |
| `GET /analytics/evm` **(OPTIONAL)** | Formal EVM series + CPI/SPI/EAC/VAC. **Design-fidelity guard §0: the dashboard/exec prototype does NOT render CPI/SPI/EAC/VAC** (only RPT-005 renders SPI/CPI). Do NOT build metrics the mock lacks. Prefer backfilling /dashboard/budget-actual for MVP; RPT-005 uses `/boq/reports/evm`. | `{period_label:[],pv:[],ev:[],ac:[],bac,cpi,spi,eac,vac,currency_code}` | forward option only |

**Tenant scope for all:** tenant+project via project root door (company_id on projects); cross-project endpoints loop over ALL owned projects reading each through its own project root — no cross-tenant leakage. `evm_snapshot` reads join the project root the same way as boq_doc/subcon_contract.

### 3.4 EVM — DDL (the one genuinely-needed new store)

```sql
-- migration 0024+ — MUST avoid collision with group-A's in-flight 0018-0023;
-- claim the next free number via agents/channel.md CLAIM at write time.
CREATE TABLE evm_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  period text NOT NULL,                     -- 'YYYY-MM' (or ISO week) bucket key
  period_end date NOT NULL,                 -- snapshot as-at date (the time axis)
  pv numeric(16,2) NOT NULL DEFAULT 0,      -- Planned Value (time-phased baseline, cumulative)
  ev numeric(16,2) NOT NULL DEFAULT 0,      -- Earned Value (%complete × BAC, cumulative)
  ac numeric(16,2) NOT NULL DEFAULT 0,      -- Actual Cost to date (cumulative)
  budget numeric(16,2) NOT NULL DEFAULT 0,  -- period BAC allocation (mock 'budget' bars)
  bac numeric(16,2) NOT NULL DEFAULT 0,     -- Budget At Completion (total)
  currency_code text NOT NULL DEFAULT 'THB',
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, period)
);
CREATE INDEX evm_snapshot_project_idx ON evm_snapshot(project_id);
-- Company scope flows through project_id → project.company_id (same door pattern as
-- boq_doc/subcon_contract; NO direct company_id column, matching the project-anchored
-- doc convention). Every money col carries currency_code; all timestamps UTC (PLAN.md §4).
```

**Why a snapshot table, not a materialized view:** a MV can only reflect CURRENT state — it cannot reconstruct past PV/EV/AC after budget revisions via `variation_order` / boq-revise overwrite balances. A snapshot table preserves as-at history, which the S-curve fundamentally requires. This matches dashboard.ts:319-320's own documented DATA GAP.

**Optional secondary — `cost_baseline`** (time-phased planned budget) only if the FORWARD PV curve (future periods with no snapshot yet) must be drawn. `evm_snapshot.pv` already carries the planned curve for captured periods, so `cost_baseline` is **deferrable for MVP**. Sketch: `cost_baseline(id, project_id FK, period text, planned_value numeric(16,2), currency_code, ...) UNIQUE(project_id, period)`.

**NOT new schema (pure aggregation):** portfolio rollup (cbs_budget + project_node + sales_unit), cost-variance/CVR (cbs_budget + pr_item.boq_item_id + jv_line), BOQ funnel (boq_item/pr/po/wo/gr), all point-in-time KPIs.

### 3.5 EVM — seed plan

- ~12 monthly `evm_snapshot` rows per hero project (project:rjp) tracing an honest S-curve **derived from that project's real cbs_budget BAC** (not the mock's literal 26.4/22.2), including a couple of `ac>budget` periods to render the danger bars + over-budget alert.
- 1-2 non-BOQ `pr_item` rows (`boq_item_id` NULL) for the CVR Non-BOQ bucket (depends on Non-BOQ ruling).
- Point-in-time KPIs need no new seed (existing cbs_budget suffices).

---

## 4. Proposed endpoint list (consolidated)

| # | Endpoint | Domain | New/reuse | Migration? | Sacred openapi? |
|---|---|---|---|---|---|
| 1 | `GET /audit-log` (implement existing stub) | Dashboard | new impl of existing contract op | no | no (op already specced) |
| 2 | `GET /boq/reports/cost-type` | Reports RPT-003 | new | no | yes (new op) |
| 3 | `GET /boq/reports/boq-vs-nonboq` | Reports RPT-001 / CVR | new | no | yes (new op) |
| 4 | `GET /boq/reports/variance` | Reports RPT-004 | new | Option B: no (reuse evm_snapshot) | yes (new op) |
| 5 | `GET /boq/reports/evm` | Reports RPT-005 | new | **yes — evm_snapshot** | yes (new op) |
| 6 | backfill `GET /dashboard/budget-actual` series | EVM S-curve | handler-only | **yes — evm_snapshot** | **no** |
| 7 | `GET /analytics/portfolio` | Exec rollup | new | no | yes (new op) |
| 8 | `GET /analytics/cost-variance` | Reports-Hub CVR | new (or fold into #3) | no | yes (new op) |
| — | 7 existing `/dashboard/*` | Dashboard | reuse | no | no |
| — | `GET /boq/reports/revise` | RPT-002 | 🚫 group-A B-081 | — | — |

> **Sacred-file note:** every new `/boq/reports/*` and `/analytics/*` op is a `packages/contracts/openapi.yaml` amendment → route through `BLOCKERS.md` + `SACRED_OVERRIDE=wei-approved:B-xxx` (a 'dashboard' tag precedent exists from B-049). Batch all new ops into ONE openapi amendment to minimize sacred rounds. The `/audit-log` implementation and the `/dashboard/budget-actual` backfill need NO openapi edit — sequence those first to make progress without a sacred round.

## 5. Proposed migration DDL (only where genuinely needed)

Only **ONE** new table is genuinely required for group-C: **`evm_snapshot`** (§3.4), claiming migration **0024+** (coordinate the exact free number via agents/channel.md — group-A is consuming 0018-0023 NOW). Optional deferrable `cost_baseline`. `boq_report_period` is **not recommended** (fold RPT-004 into evm_snapshot). Everything else is pure aggregation over existing tables — no migration.

## 6. Consolidated seed plan

| Seed item | For | Owner note |
|---|---|---|
| Spread `audit_log.at` across last hours/days | Activity feed | group-C |
| ≥1 `cbs_budget` row used+committed>budget | Alerts over-budget + EVM danger bars | group-C |
| A few `variation_order(dir=add)` or non-BOQ pr_items | RPT-001/CVR Non-BOQ story | group-C (pending ruling) |
| `ap_billing.due_date` within window + short ar_invoice terms | Cashflow + overdue alert | ⚠️ **coordinate with group-A** (ap_billing is theirs) |
| Spread `jv_line.created_at` OR ~12 `evm_snapshot` rows/project | Budget-actual S-curve | group-C (prefer evm_snapshot) |
| ~5 evm_snapshot/period rows on boqdoc:0/project:rjp | RPT-004 + RPT-005 | group-C |

## 7. Sequencing recommendation

**Wave 1 — pure aggregation, no sacred round, immediate (ship first):**
1. Implement `GET /audit-log` (existing contract op → activity feed). No openapi edit.
2. Seed tuning: spread audit_log.at; add over-budget cbs row. Lights up activity + alerts widgets.
3. Verify + reuse the 7 existing `/dashboard/*` endpoints (no code).

**Wave 2 — new aggregation endpoints (one batched sacred openapi amendment):**
4. Queue ONE openapi amendment for: `/boq/reports/cost-type`, `/boq/reports/boq-vs-nonboq`, `/analytics/portfolio` (+ `/analytics/cost-variance` if kept distinct) → BLOCKERS.md for Wei.
5. Implement `/boq/reports/cost-type` (RPT-003) — fully deliverable today.
6. Implement `/boq/reports/boq-vs-nonboq` (RPT-001) + `/analytics/portfolio` after Non-BOQ ruling.

**Wave 3 — the one new store (migration + worker/seed, gated on Wei):**
7. Claim migration 0024+ via channel; create `evm_snapshot`.
8. Seed ~12 evm_snapshot rows/hero project (honest S-curve from real BAC).
9. Backfill `/dashboard/budget-actual` series (handler-only) → dashboard S-curve lights up.
10. Implement `/boq/reports/evm` (RPT-005) + `/boq/reports/variance` (RPT-004 via evm_snapshot).
11. (Deferred/optional) evm_snapshot population worker (BullMQ/cron at period-close) if not seed-only; `cost_baseline` forward curve; `/analytics/evm`; PM planned-vs-done slice.

**Dependencies on group-A (do not block Wave 1-2):** dashboard overdue-alert + cashflow payables auto-fill once group-A adds/seeds `ap_billing.due_date` — zero dashboard code change. RPT-002 is entirely group-A's (B-081).

## 8. Pattern to mirror

`apps/api/src/routes/dashboard.ts` is the exact precedent for every group-C endpoint: TenantDb `selectThrough` door-chains (group→doc→project), optional `project_id` via `ownedProject()` (foreign id→404), 401 fail-closed, C10 discipline (NO fabricated numbers; honest empty/null where source data is absent, with a code comment naming the gap). RPT-004/RPT-005 and the budget-actual S-curve must follow `dashboard.budgetActual`'s honest-empty-series precedent rather than fabricating. i18n: dashboard keys already applied (P1-PLAT-06); exec/reports-hub/boq.reports CVR + RPT-001…005 labels ('BOQ'/'Non-BOQ'/'Material'/'Subcon'/'Labor'/'Plan'/'Actual'/'Variance'/'PV'/'EV'/'AC'/'SPI'/'CPI') must resolve to existing `docs/extract/i18n-full.json` keys before FE port — missing key → BLOCKERS.md.

---

## RECON REFRESH — 2026-07-18 (orch-B · validated vs main `eb88544` · post batch-8/9/10/11)
Re-checked the 2026-07-16 recon against current main. **Recon holds; 2 assumptions updated:**

| Assumption (2026-07-16) | Status now | Impact |
|---|---|---|
| 7 `/dashboard/*` endpoints built (70% reuse) | ✅ **CONFIRMED** — all 7 still in dashboard.ts on dev/main | reuse claim holds · Wave-1 verify-only unchanged |
| `evm_snapshot` migration "0024+" | 🔄 **UPDATE → 0031** — 0024(FK-idx)/0025(TOCTOU)/0026-0029(finance/SoD) are USED; **batch-12 claims 0030** (perf FK-index) → evm_snapshot = **migration 0031** (CLAIM via channel at write time) | Wave-3 DDL header must say 0031, not 0024 |
| ap_billing.due_date "depends on group-A, don't own" | 🔄 **RESOLVED — column LANDED** (finance.ts:177/404 · batch-8/9 AP work) | **cross-cutting dependency #1 GONE.** dashboard cashflow-forecast + overdue-payable alert now need ONLY a SEED populate (spread due_date), NO schema wait, NO group-A coordination. Wave-1 can light these up directly. |
| GET /audit-log unimplemented (activity feed net-new) | ✅ still net-new (no route on dev) | Wave-1 item #1 unchanged |
| evm_snapshot / cost_baseline net-new | ✅ still absent from schema | the one new store still the only DDL |
| B-049 board blocker | ✅ still recorded BLOCKED (P1-WEB-07 dashboard) — the group-C wave lights up its honest-empty widgets to close it | wave goal unchanged |

**Net after refresh:** the plan is execution-ready. Wave-1 (audit-log + reuse verify + seed) is now BIGGER-value than before (ap_billing.due_date seed is unblocked → cashflow/overdue widgets light up in Wave-1, not deferred). Wave-3 evm_snapshot = **migration 0031**. Everything else in §0-§8 stands.
