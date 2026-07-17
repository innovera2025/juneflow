# Perf re-audit — finance/Wave-2 tables FK-index coverage (main 2051e40)

> orch-B · 2026-07-17 · follow-up to the batch-7 `perf-audit.md` (migration 0024 added ~22 FK indexes to the **procurement** tables). Migration 0024 predates the finance tables (they landed in 0026-0027, batch-8), so the Wave-2 finance schema was never swept for the same "FK column = scoped-JOIN key but no index → seq-scan" class.

## Method
Read `packages/db/src/schema/finance.ts` (FK columns + declared `index()`), the finance route `selectThrough`/JOIN keys (gl.ts / ap.ts / bank.ts), and migrations 0024/0026-0029. A FK column is a **hot key** when it is a `selectThrough` hop (scopes a `company_id`-less child) or a per-read JOIN.

## Coverage — mostly good
Indexed already: `company_id` on every scoped root (gl_account via unique, accounting_period via unique, ap_billing/pv/jv/cheque/bank_statement/reconcile `*_company_idx`) · ap_billing `po_idx`/`gr_idx`/`wo_idx` · cheque `pv_idx` · bank_statement_line `statement_idx` + the 0028 partial-uniques on `pv_id`/`cheque_id`/`rv_id` (double as FK indexes).

## Gaps — FK hot keys with NO index (seq-scan)
| # | table.column | why it's a hot key | sev |
|---|---|---|---|
| **P1** | **`jv_line.jv_id`** | **`jv_line` has no `company_id`** — it is scoped THROUGH `jv` via `selectThrough(jvLines, [{fk: jvId, parent: jvs}])` (gl.ts:131). Every JV detail read JOINs jv_line→jv on `jv_id`; with no index that is a **seq-scan of the whole jv_line table per JV read** — the finance analog of the 0024 finding. | **high** |
| P2 | `reconcile.statement_id`, `reconcile.period_id` | reconcile rows looked up by statement / period; both FK, neither indexed | med |
| P3 | `jv.period_id` | "JVs in period N" + the B-094-1 locked-period path; FK to accounting_period, no index | med |
| P4 | `ap_billing.vendor_id` | billing→vendor display JOIN; FK, no index (po/gr/wo ARE indexed, vendor was missed) | med |
| P5 | `jv_line.account_id`, `jv_line.cc_id`, `jv_line.project_id` | GL analytics / cost-center / project roll-ups over jv_line | low |
| P6 | `gl_account.parent_id` | COA self-tree traversal (small table → low impact) | low |

**Deferred (not a live concern — routes not mounted):** `ar_invoice.customer_id`/`project_id`, `rv.invoice_id` — AR is contract-only. Index when AR handlers land.

## Recommendation — additive index migration 0030 (mirror 0024)
Pure DDL, zero app-code change, seed-safe (plain btree, not unique), one migration removes the finance seq-scans:
```sql
CREATE INDEX "jv_line_jv_idx"            ON "jv_line"      ("jv_id");        -- P1 (priority — selectThrough hop)
CREATE INDEX "reconcile_statement_idx"   ON "reconcile"    ("statement_id"); -- P2
CREATE INDEX "reconcile_period_idx"      ON "reconcile"    ("period_id");    -- P2
CREATE INDEX "jv_period_idx"             ON "jv"           ("period_id");    -- P3
CREATE INDEX "ap_billing_vendor_idx"     ON "ap_billing"   ("vendor_id");    -- P4
-- optional (analytics, low): jv_line account_id / cc_id / project_id · gl_account parent_id
```
- Zone: **backend/devops** (schema/finance.ts index() decls + `pnpm --filter @juneflow/db generate` → 0030 + snapshot) — orch-A owns. Sacred migration (Wei).
- Verify: additive-only, applies clean on any DB (orch-B can live-migrate-verify like 0028/0029). No unique → no seed-dup risk.
- Priority: **P1 (`jv_line.jv_id`) alone** is the meaningful quick-win — it's the only one on a guaranteed-per-read hot path (every JV/JV-list read). P2-P4 are cheap to fold in the same migration.

## Net
Finance-table index coverage is ~85% (company_id + most FK covered). The one true hot-path gap is **`jv_line.jv_id`** (the selectThrough hop) — a clean additive-index quick-win. This closes the 0024-class sweep for the Wave-2 finance schema.
