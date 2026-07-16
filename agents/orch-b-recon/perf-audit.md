# Juneflow Backend Performance Audit — N+1 · Index Coverage · Pagination

**Author:** orch-B recon (read-only verify)
**Date:** 2026-07-16
**Scope:** `apps/api/src/routes/*.ts` · `apps/api/src/db/tenant-db.ts` · `packages/db/src/schema/*.ts`
**Status:** REPORT ONLY — no code touched. All fixes below are backend-route or **sacred-migration** work = orch-A / Wei zone. This document is spec-only.

Method: read every route + the tenant-scope doors + the full schema; mechanically scanned all routes for the `await db.*` inside `for` / `.map(async` / `while` pattern (the N+1 signature); cross-referenced every `selectThrough` JOIN key and every WHERE-filter column against the declared indexes.

---

## 0. Executive summary

- **Confirmed N+1: 1** unbounded (`boq.ts:680-688`), **1** bounded/minor (`boq.ts:616-639`).
- **Survey discrepancy:** the flagged `gr.ts:192` N+1 does **NOT reproduce** in the current code — the GR receipt-line loop is pure arithmetic with zero per-line queries (see §1.3). Likely already refactored since the survey.
- **Index coverage is the dominant problem, not N+1.** Every parent-FK-scoped table (boq_doc, boq_group, boq_item, cbs_budget, pr, pr_item, po, wo, gr, variation_order, project_node, subcon_contract, work_period, pm_*, …) has **zero index on its FK columns** — and those FK columns are exactly the JOIN keys every `selectThrough` read uses. Postgres does not auto-index FK referencing columns, so **every tenant-scoped JOIN in the app is currently a sequential scan.**
- **Highest-leverage single fix:** a **0024 additive index migration** (~23 FK + composite indexes). One pure-DDL migration removes seq-scans from every scoped read, and simultaneously defangs the `boq.ts` N+1 and the unbounded price-map scans (§1.4). Zero application-code change.

---

## 1. N+1 findings (ranked by severity)

### How the tenant-scope doors behave (prerequisite — answers the door question)
`tenant-db.ts` `selectThrough()` (L143-185) builds **one** SQL statement: it accumulates `innerJoin(parent, child.fk = parent.id)` for each hop and issues a single `where`. So a `selectThrough` **does NOT fire a query per hop** — it is one JOINed statement. Good.

The write doors are 2-query, though:
- `updateThroughChain()` (L300-326) = `selectThrough(...)` to resolve scoped ids **+** a second `UPDATE ... WHERE id IN (ids)` → **2 queries per call**.
- `insertThrough()` (L198-228) / `updateThrough()` (L247-280) = 1 ownership `SELECT` **+** 1 write → **2 queries per call**.

⇒ N+1 only appears when a route calls one of these **inside a loop**. Exactly one route does.

---

### 1.1 CONFIRMED · HOT × UNBOUNDED — `boq.ts:680-688` — generate-PR "cut-remain" loop
**Endpoint:** `POST /boq/:id/generate-pr`

```js
for (const l of lines) {                                   // L680
  const newRemain = Number(l.item.remainQty) - l.qty;
  await db.updateThroughChain(                              // L682
    boqItems, ITEM_HOPS, { remainQty: String(newRemain) }, eq(boqItems.id, l.item.id),
  );
}
```

- **Per-row query:** one `updateThroughChain` per selected BOQ item. Each call internally = **1 `selectThrough` (a 3-table INNER JOIN boq_item→boq_group→boq_doc→project) + 1 UPDATE**.
- **Impact:** N selected items → **2·N queries**, and every JOIN runs on **unindexed** `boq_item.group_id` / `boq_group.boq_id` / `boq_doc.project_id`. `item_ids[]` is user-supplied and de-duped but **unbounded** — a generate-PR over a large approved BOQ (hundreds of lines) fires hundreds of unindexed 3-way JOINs + updates in series. This is the single worst hot-path N+1.
- **Fix (backend zone):** resolve ownership **once** with a single `selectThrough(boqItems, ITEM_HOPS, inArray(boqItems.id, ids))`, then apply the decrements in **one** bulk `UPDATE` using a `CASE`/`VALUES(id, newRemain)` map (each line has a distinct new remainder, so a single blanket SET won't do). Collapses **2N → 2**. A `TenantDb` helper like `updateThroughChainMany(rows)` would keep it fail-closed.

### 1.2 CONFIRMED · BOUNDED (≤2) — `boq.ts:616-639` — generate-PR bucket loop
**Endpoint:** `POST /boq/:id/generate-pr`

```js
for (const bucket of buckets) {                 // L616 — buckets ≤ 2 (material, subcon)
  const [pr] = await db.insertThrough(prs, projects, doc.projectId, [...]);        // L620
  const createdLines = await db.insertThrough(prItems, projects, doc.projectId, [...]); // L630
}
```

- **Per-row query:** per bucket, `insertThrough(prs)` (1 ownership SELECT + 1 INSERT) then `insertThrough(prItems)` (1 ownership SELECT + 1 INSERT).
- **Impact:** `PR_BUCKETS` is a fixed 2-element split (M vs S|L), so this is **bounded at ≤2 iterations × 4 queries = ≤8** — not classic unbounded N+1. The avoidable cost is the **2 redundant ownership SELECTs per bucket**: `doc.projectId` was already resolved/owned at L546, yet each `insertThrough` re-verifies it.
- **Fix (backend zone, low priority):** offer an `insert`-through variant that trusts an already-proven parent, or move the two inserts to trust the L546 resolution. Minor.

### 1.3 NOT REPRODUCED — `gr.ts:192` (survey claim "selectThrough per receipt line")
**Endpoint:** `POST /gr`

The survey flagged a per-receipt-line `selectThrough`. In the **current** code this does not exist:
- The receipt-line loop (`gr.ts:169-185`) is **pure arithmetic** — it sums `qty_ok`/`qty_rejected` and flattens `photos[]` into the single aggregated `gr` row. **Zero DB calls in the loop.** (Schema header confirms: "lines[] are AGGREGATED into the single gr row".)
- Line 192 is a **single** `selectThrough(pos, PO_HOPS, eq(pos.id, poId))` — the PO resolve, run **once per request**, independent of line count.
- `POST /gr` **is chatty** — ~8–10 sequential door calls per request (anchor resolve → PR resolve → `insertThrough` gr → optional `insertThrough` defect → `prOrderedQty` → anchor-GR re-read → optional `updateThroughChain` close). But every one is **constant per request**, not scaling with rows ⇒ **not N+1**. `findGr` (return/cancel) tries the PO chain then the WO chain = 2 bounded queries, also not N+1.

**Verdict:** treat as resolved. The only residual is the chattiness above (could be trimmed but is low value). Recommend confirming the survey wasn't reading a pre-refactor revision.

### 1.4 NOT N+1 but a real scaling hazard — unbounded per-request `boq_item` price-map scans
Not a loop, but flagged because the missing indexes make it expensive:
- `pr.ts` GET /pr (L301-305), `prAmount` (L254-257), `procurement.ts prLineAmount` (L132-135), and `dashboard.ts approvalsInbox` (L442-447) each load **all of the tenant's `boq_item` rows** via `BOQ_ITEM_HOPS` (no filter) just to build a `{boq_item_id → price}` map — **even to price a single PR**.
- That is a full 3-table **unindexed** JOIN over the entire tenant BOQ on every PR read/approve/inbox render. It dominates as BOQ data grows.
- **Fix:** either filter the `boq_item` read to the referenced `boq_item_id`s, or (cheaper, no code) rely on the §2 FK indexes so the JOIN is index-driven. Largely mitigated by the index migration; only pursue the code change if profiling still shows it hot.

---

## 2. Index-gap matrix

### 2.1 What exists today
~50 declared indexes, almost all a **single-column `<table>_company_idx` on `company_id`** for the company-scoped root/master tables (project, vendor, model, customer, bom, role, subscription, all of finance.ts, all of extensions.ts, misc.ts, checklist_template), plus auth FK indexes (`auth_session.user_id`, `auth_account.user_id`, `auth_user.company_id`) and a few composite **uniques** (`org_unit(company,code)`, `model(company,code)`, `cost_center(project,code)`, `project_type(company,key)`).

These cover the `db.select(table)` **tenant filter** (`WHERE company_id = ?`) well.

### 2.2 The gap
**Every parent-FK-scoped table has NO index on its FK columns** — and those FK columns are precisely the `innerJoin` keys `selectThrough` uses. Postgres indexes only the referenced PK, never the referencing column, so all of these are seq-scanned on every JOIN. This is the bulk of the perf debt.

Filter columns actually used (from the routes): `boq_doc.status`, `pr.status`, `po.status`, `wo.status`, `work_period.status`, `pm_workorder.customer_sign IS NULL`, plus the FK join keys below.

### 2.3 Proposed 0024 migration (spec only — applying = a Wei sacred migration claiming `0024`)
Next free number confirmed: latest on disk is `0023_boq_item_detail.sql`. Style matches existing migrations: `CREATE INDEX "name" ON "table" USING btree ("col"[, "col"]);`

**Tier 1 — hot procurement / BOQ / counts path (apply first, highest leverage):**

```sql
-- FK join keys on the hot chains (selectThrough hops)
CREATE INDEX "boq_doc_project_idx"       ON "boq_doc"        USING btree ("project_id");
CREATE INDEX "boq_group_boq_idx"         ON "boq_group"      USING btree ("boq_id");
CREATE INDEX "boq_item_group_idx"        ON "boq_item"       USING btree ("group_id");
CREATE INDEX "cbs_budget_group_idx"      ON "cbs_budget"     USING btree ("group_id");
CREATE INDEX "pr_project_idx"            ON "pr"             USING btree ("project_id");
CREATE INDEX "pr_item_pr_idx"            ON "pr_item"        USING btree ("pr_id");
CREATE INDEX "pr_item_boq_item_idx"      ON "pr_item"        USING btree ("boq_item_id");
CREATE INDEX "po_pr_idx"                 ON "po"             USING btree ("pr_id");
CREATE INDEX "wo_pr_idx"                 ON "wo"             USING btree ("pr_id");
CREATE INDEX "gr_po_idx"                 ON "gr"             USING btree ("po_id");
CREATE INDEX "gr_wo_idx"                 ON "gr"             USING btree ("wo_id");

-- Composite (fk, status) for the pending-filter scans (counts.ts + dashboard inbox).
-- These SUPERSEDE the plain fk index above for the status-filtered query; keep the
-- plain one only where an unfiltered join also runs (pr/boq_doc do both).
CREATE INDEX "boq_doc_project_status_idx" ON "boq_doc"      USING btree ("project_id","status");
CREATE INDEX "pr_project_status_idx"      ON "pr"           USING btree ("project_id","status");
CREATE INDEX "po_pr_status_idx"           ON "po"           USING btree ("pr_id","status");
CREATE INDEX "wo_pr_status_idx"           ON "wo"           USING btree ("pr_id","status");
CREATE INDEX "work_period_contract_status_idx" ON "work_period" USING btree ("contract_id","status");
```

**Tier 2 — completeness / lower-traffic reads & tree walks (apply with Tier 1 or shortly after):**

```sql
CREATE INDEX "variation_order_po_idx"    ON "variation_order" USING btree ("po_id");
CREATE INDEX "defect_report_gr_idx"      ON "defect_report"   USING btree ("gr_id");
CREATE INDEX "gr_item_gr_idx"            ON "gr_item"         USING btree ("gr_id");
CREATE INDEX "project_node_project_idx"  ON "project_node"    USING btree ("project_id");
CREATE INDEX "project_node_parent_idx"   ON "project_node"    USING btree ("parent_id");
CREATE INDEX "subcon_contract_project_idx" ON "subcon_contract" USING btree ("project_id");
CREATE INDEX "acceptance_period_idx"     ON "acceptance"      USING btree ("period_id");
CREATE INDEX "defect_acceptance_idx"     ON "defect"          USING btree ("acceptance_id");
CREATE INDEX "pm_contract_project_idx"   ON "pm_contract"     USING btree ("project_id");
CREATE INDEX "pm_asset_contract_idx"     ON "pm_asset"        USING btree ("asset_id" IS wrong -> "contract_id");
CREATE INDEX "pm_workorder_asset_idx"    ON "pm_workorder"    USING btree ("asset_id");
```
> Note on the `pm_asset` line: the correct column is `contract_id` (`pm_asset.contract_id → pm_contract.id`). Sketch typo marked inline; the real DDL is `ON "pm_asset" USING btree ("contract_id")`.

**Count:** 16 (Tier 1) + 11 (Tier 2) = **27 candidate statements**; a lean **~22** if you drop the plain `boq_doc_project_idx`/`pr_project_idx` in favour of their composite supersets and defer the coldest pm_/defect indexes. This lands in the requested 15–25 band.

**Also worth considering (not required):** the status-filtered company-scoped reads in extensions/finance (`service_ticket.status`, `ap_billing.due_date/status`) could take composite `(company_id, status)` indexes, but those lists are small and already company-indexed — leave for later.

### 2.4 Per-table summary

| Table | Existing index | FK / filter cols used by routes | Gap |
|---|---|---|---|
| boq_doc | — | project_id (JOIN), status (filter) | **project_id, (project_id,status)** |
| boq_group | — | boq_id (JOIN) | **boq_id** |
| boq_item | — | group_id (JOIN) | **group_id** |
| cbs_budget | — | group_id (JOIN) | **group_id** |
| pr | — | project_id (JOIN), status (filter) | **project_id, (project_id,status)** |
| pr_item | — | pr_id, boq_item_id (JOIN) | **pr_id, boq_item_id** |
| po | — | pr_id (JOIN), status (filter) | **pr_id, (pr_id,status)** |
| wo | — | pr_id (JOIN), status (filter) | **pr_id, (pr_id,status)** |
| gr | — | po_id, wo_id (JOIN) | **po_id, wo_id** |
| variation_order | — | po_id (JOIN) | **po_id** |
| defect_report / gr_item | — | gr_id (JOIN) | **gr_id** |
| project_node | — | project_id, parent_id | **project_id (parent_id in-mem today)** |
| subcon_contract | — | project_id (JOIN) | **project_id** |
| work_period | — | contract_id (JOIN), status (filter) | **contract_id, (contract_id,status)** |
| acceptance / defect | — | period_id / acceptance_id | **period_id / acceptance_id** |
| pm_contract / pm_asset / pm_workorder | — | project_id / contract_id / asset_id | **all three** |
| project, vendor, model, customer, finance.*, extensions.*, misc.* | `*_company_idx` | company_id | OK (tenant filter covered) |

---

## 3. Pagination assessment

**Mechanism:** `list-envelope.ts` `listEnvelope(rows)` (L32-39) always returns **the full tenant-scoped set as one page**: `page = 1`, `total = rows.length`, `page_size = max(rows.length, 50)`. The `filter` / `page` / `page_size` query params are **accepted but ignored** — a documented design choice ("the shell switchers consume every row").

**Endpoints returning unbounded tenant sets:** GET `/projects`, `/boq`, `/pr`, `/po`, `/wo`, `/gr`, `/vendors`, `/models`, `/cost-centers`, `/org-units`, `/project-types`, `/users`, `/roles`, `/doc-numbering`, plus the dashboard `EntityList` widgets (approvals-inbox, phase-progress, alerts, contractors).

**Assessment:**
- **Acceptable for MVP.** A single construction tenant's master/switcher lists (projects, vendors, models, org-units) are small and the shell genuinely needs the whole set — real pagination there would break the ProjectSwitcher/nav.
- **Two real risks as tenant data grows:**
  1. **Document lists** (`/pr`, `/po`, `/wo`, `/boq`, `/gr`) don't just return N rows — `/pr` and the inbox also run the **full-tenant `boq_item` JOIN per request** (§1.4). A tenant with thousands of BOQ lines × hundreds of PRs pays an O(all-items) cost on every list call.
  2. **Unbounded payload** — no row cap means response size/latency/memory scale with tenant history.
- **Recommendation (contract change → Wei zone, spec only):**
  - Keep MVP full-set behavior for master/switcher lists.
  - Before onboarding large tenants, wire **real limit/offset (or keyset) pagination** into `/pr`, `/po`, `/wo`, `/boq`, `/gr`. The envelope already carries `page`/`page_size`/`total`, so adding real slicing is **non-breaking** — clients that ignore paging still work.
  - Ship the §2 indexes first: they make the current full scans cheap and buy time before pagination is mandatory.

---

## 4. Prioritized backend-task list (by leverage)

| # | Task | Zone | Effort | Why it ranks here |
|---|---|---|---|---|
| **1** | **0024 index migration** (~22–27 FK + composite indexes, §2.3) | **Sacred migration → Wei** | Low (pure additive DDL, no code) | Removes seq-scans from **every** tenant-scoped JOIN (i.e. every read in the app), and defangs both the boq.ts N+1 (§1.1) and the price-map scans (§1.4). Highest bang/buck by far. |
| **2** | **Fix `boq.ts:680-688` cut-remain N+1** — one `selectThrough(inArray(ids))` ownership resolve + one bulk `CASE`/`VALUES` UPDATE (add a `updateThroughChainMany` door) | Backend routes + `tenant-db.ts` | Medium | Collapses 2N → 2 queries on the hottest write path; only true unbounded N+1. |
| **3** | **Bound the per-request `boq_item` price-map** (pr.ts / procurement.ts / dashboard §1.4) — filter to referenced ids | Backend routes | Low–Med | Removes full-tenant BOQ JOIN per PR read. Mostly mitigated by #1 — do only if profiling still shows it. |
| **4** | **Trim `boq.ts:616` bucket re-verifies** + GR POST chattiness (§1.2, §1.3) | Backend routes | Low | Minor query-count trims; correctness unaffected. |
| **5** | **Real pagination on document lists** (`/pr`,`/po`,`/wo`,`/boq`,`/gr`) — limit/offset into list-envelope + openapi | **Contract → Wei** | Medium | Non-breaking (envelope already shaped). Defer until pre-scale; #1 buys the runway. |

---

## Appendix — evidence index (file:line)

- Doors: `apps/api/src/db/tenant-db.ts` — `selectThrough` L143-185 (single JOINed stmt), `insertThrough` L198-228 (2q), `updateThrough` L247-280 (2q), `updateThroughChain` L300-326 (selectThrough + UPDATE = 2q).
- N+1: `apps/api/src/routes/boq.ts` L680-688 (unbounded), L616-639 (bounded ≤2).
- Not reproduced: `apps/api/src/routes/gr.ts` L169-185 (arithmetic-only line loop), L192 (single PO resolve), L101-106 (`findGr` 2 bounded queries).
- Price-map scans: `pr.ts` L254-257 / L301-305; `procurement.ts` L132-135; `dashboard.ts` L442-447.
- Envelope: `apps/api/src/routes/list-envelope.ts` L32-39.
- Schema (no FK indexes): `packages/db/src/schema/boq.ts` (boq_doc L101, boq_group L155, boq_item L178, cbs_budget L212, pr L237, pr_item L275, po L302, wo L335, variation_order L369, gr L408, gr_item L442, defect_report L472); `subcon.ts` (subcon_contract L83, work_period L114, acceptance L139, defect L160); `project.ts` (project_node L224); `pm.ts` (pm_contract L84, pm_asset L111, pm_workorder L153).
- Existing indexes: all `*_company_idx` single-column (grep in §2.1); migrations end at `packages/db/drizzle/0023_boq_item_detail.sql`.
