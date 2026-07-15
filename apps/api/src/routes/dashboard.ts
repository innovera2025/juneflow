// GET /dashboard/* — tenant-scoped dashboard aggregation handlers (P1-BE-15,
// B-049). The 7 read-only widgets of pototype/dashboard.jsx, each an aggregate
// over the EXISTING seed business tables — no new table, no migration.
//
// Contract (openapi.yaml §10 "Dashboard (B-049)"): 7 GET ops, Entity-opaque
// JSON. EntityOk ops return the object; EntityList ops return the B-014
// envelope {data, page, page_size, total} (listEnvelope). Every op is
// tenant-scoped through request.db (the TenantDb doors) and 401s without a
// tenant (fail closed), exactly like counts.ts / projects.ts.
//
// DESIGN — "which project?": the mock dashboard is scoped to the ProjectSwitcher
// active project, but the contract carries NO project_id param (only ?range /
// ?period). So the per-project widgets (summary, budget-actual) resolve a single
// PRIMARY project = the tenant's first project ordered by (created_at ASC, id
// ASC) — deterministic per seed. The list widgets (approvals, phase-progress,
// alerts, contractors) aggregate TENANT-WIDE across all projects.
//
// C10 DISCIPLINE (critical): every number here derives from a live query over
// the seed — NONE of the mock's hardcoded values (17 pending, 24 contracts, 3
// alerts, health 71, committed 38/18/12/4) are reproduced, and the mock's
// forbidden formulas (built = sold, budget_used = round(sold * 0.92)) are NOT
// ported. Where a widget's SOURCE DATA genuinely does not exist in the schema/
// seed, the handler returns an HONEST null/empty/zero with a code comment naming
// the gap (see the DATA GAPS notes on each handler) rather than fabricating a
// number to match the mock.
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, type SQL } from "drizzle-orm";
import {
  apBillings,
  arInvoices,
  boqDocs,
  boqGroups,
  boqItems,
  cbsBudgets,
  ppaInvoices,
  prItems,
  projectNodes,
  projects,
  projectTypes,
  prs,
  salesUnits,
  solarInverters,
  subconContracts,
  vendors,
  workPeriods,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";

type ProjectRow = typeof projects.$inferSelect;
type NodeRow = typeof projectNodes.$inferSelect;

/** Sale stages that count a unit as SOLD (sales_unit.stage) — same as projects.ts. */
const SOLD_STAGES = new Set(["sold", "soldBuilt"]);
/** Sale stages that count a unit as physically BUILT (distinct real metric, NOT
 * the mock's built = sold). soldBuilt = sold AND built; built = built only. */
const BUILT_STAGES = new Set(["built", "soldBuilt"]);

/** Coerce a drizzle numeric (string) / number / null to a finite number, else 0. */
function num(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals (money) without float dust. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Flat 401 (fail closed) when no tenant was resolved onto the request. */
function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/**
 * The tenant's PRIMARY project (see module header): first by (created_at ASC,
 * id ASC), deterministic. undefined when the tenant has no projects.
 */
async function resolvePrimaryProject(
  db: TenantDb,
): Promise<ProjectRow | undefined> {
  const rows = (await db.select(projects)) as ProjectRow[];
  return [...rows].sort((a, b) => {
    const at = new Date(a.createdAt as unknown as string).getTime();
    const bt = new Date(b.createdAt as unknown as string).getTime();
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

/** cbs_budget rows for ONE project, scoped group → boq_doc → project. */
function cbsForProject(db: TenantDb, projectId: string) {
  return db.selectThrough(
    cbsBudgets,
    [
      { fk: cbsBudgets.groupId, parent: boqGroups },
      { fk: boqGroups.boqId, parent: boqDocs },
      { fk: boqDocs.projectId, parent: projects },
    ],
    eq(boqDocs.projectId, projectId),
  );
}

// ---------------------------------------------------------------------------
// 1. GET /dashboard/summary — header meta + type-aware KPIs + health donut
// ---------------------------------------------------------------------------
// Real sources: project + project_type (hybrid door) + project_node (phase) +
// cbs_budget (budget/used/committed) OR solar_inverter/ppa_invoice for solar.
// DATA GAPS: as_of is the live server time (the mock's fixed 25 พ.ค. is a mock
// constant); status_label is the raw project.status (FE maps to a display label
// — the mock's Thai STATUS_LABEL is presentational i18n). health_score is a
// single real budget-utilisation ratio, NOT the mock's opaque "5-indicator" 71.
async function summary(db: TenantDb, range: string) {
  const primary = await resolvePrimaryProject(db);
  const asOf = new Date().toISOString();
  if (!primary) {
    return {
      project_id: null,
      project_name: null,
      project_type: null,
      active_phase_label: null,
      as_of: asOf,
      status_label: null,
      kpi_kind: "budget",
      budget_total: 0,
      actual_total: 0,
      committed_total: 0,
      remaining_total: 0,
      currency_code: null,
      health_score: 0,
      range,
    };
  }

  // project_type key via the B-065 hybrid door (global defaults OR own custom).
  const types = await db.selectGlobalOrOwned(projectTypes);
  const typeKey =
    types.find((t) => t.id === primary.typeId)?.key ?? null;

  // active_phase_label = first phase node of the project (project_node has no
  // company_id — scoped through its project root).
  const nodes = (await db.selectThrough(
    projectNodes,
    [{ fk: projectNodes.projectId, parent: projects }],
    eq(projectNodes.projectId, primary.id),
  )) as NodeRow[];
  const activePhase = nodes.find((n) => n.kind === "phase");

  const header = {
    project_id: primary.id,
    project_name: primary.name,
    project_type: typeKey,
    active_phase_label: activePhase?.name ?? null,
    as_of: asOf,
    status_label: primary.status,
    range,
  };

  // Solar KPI branch — ONLY when the project is solar AND real solar data exists
  // (project:slr in seed). Otherwise fall through to the budget branch (honest
  // zeros for a solar project with no inverters/ppa yet).
  if (typeKey === "solar") {
    const [inverters, ppa] = await Promise.all([
      db.select(solarInverters, eq(solarInverters.projectId, primary.id)),
      db.select(ppaInvoices, eq(ppaInvoices.projectId, primary.id)),
    ]);
    if (inverters.length > 0 || ppa.length > 0) {
      const installedCapacity = inverters.reduce((s, r) => s + num(r.kw), 0);
      const energyYtd = ppa.reduce((s, r) => s + num(r.mwh), 0);
      const perfSum = inverters.reduce((s, r) => s + num(r.perf), 0);
      const perfRatio =
        inverters.length > 0 ? round2(perfSum / inverters.length) : 0;
      return {
        ...header,
        kpi_kind: "solar",
        installed_capacity: round2(installedCapacity),
        energy_ytd: round2(energyYtd),
        performance_ratio: perfRatio,
        currency_code: primary.currencyCode,
        // Solar health = mean performance ratio (a single real indicator).
        health_score: Math.min(100, Math.max(0, Math.round(perfRatio))),
      };
    }
  }

  // Budget KPI branch (realestate / civil / service, and solar-without-data):
  // the cbs_budget control totals for this project.
  const cbs = await cbsForProject(db, primary.id);
  const budgetTotal = cbs.reduce((s, r) => s + num(r.budget), 0);
  const actualTotal = cbs.reduce((s, r) => s + num(r.used), 0);
  const committedTotal = cbs.reduce((s, r) => s + num(r.committed), 0);
  const remainingTotal = budgetTotal - actualTotal - committedTotal;
  const healthScore =
    budgetTotal > 0
      ? Math.min(100, Math.max(0, Math.round((100 * remainingTotal) / budgetTotal)))
      : 0;

  return {
    ...header,
    kpi_kind: "budget",
    budget_total: round2(budgetTotal),
    actual_total: round2(actualTotal),
    committed_total: round2(committedTotal),
    remaining_total: round2(remainingTotal),
    currency_code: primary.currencyCode,
    health_score: healthScore,
  };
}

// ---------------------------------------------------------------------------
// 2. GET /dashboard/budget-actual — time-series + cost-category breakdown
// ---------------------------------------------------------------------------
// Real source: cost_categories = per-boq_group cbs_budget (category_label =
// group name, actual_value = used, plan_value = budget) for the PRIMARY project.
// DATA GAP: the period time-series (per week/month/quarter/year bars) has NO
// backing data — there is no time-bucketed cost-posting table (jv_line rows all
// carry the seed's single created_at, cbs_budget has no time axis). Returning
// fabricated bars would violate C10, so the series is honestly EMPTY; the real,
// non-fabricated part of the widget is the cost_categories breakdown.
async function budgetActual(db: TenantDb, range: string) {
  const primary = await resolvePrimaryProject(db);
  if (!primary) {
    return {
      range,
      range_label: range,
      period_label: [],
      budget_amount: [],
      actual_amount: [],
      plan_amount: [],
      cost_categories: [],
      currency_code: null,
    };
  }

  const [cbs, groups] = await Promise.all([
    cbsForProject(db, primary.id),
    db.selectThrough(
      boqGroups,
      [
        { fk: boqGroups.boqId, parent: boqDocs },
        { fk: boqDocs.projectId, parent: projects },
      ],
      eq(boqDocs.projectId, primary.id),
    ),
  ]);
  const nameByGroup = new Map(groups.map((g) => [g.id, g.name]));

  const costCategories = cbs.map((c) => ({
    category_label: nameByGroup.get(c.groupId) ?? null,
    actual_value: round2(num(c.used)),
    plan_value: round2(num(c.budget)),
  }));

  return {
    range,
    range_label: range,
    // GAP: no time-bucketed cost data in seed → honest empty series.
    period_label: [],
    budget_amount: [],
    actual_amount: [],
    plan_amount: [],
    cost_categories: costCategories,
    currency_code: primary.currencyCode,
  };
}

// ---------------------------------------------------------------------------
// 3. GET /dashboard/approvals-inbox — pending PR approvals (EntityList)
// ---------------------------------------------------------------------------
// Real source: pr rows with status = 'pending' (the only procurement doc with an
// approval state machine — counts.ts uses the same pending semantics), amount
// derived from the PR's lines (pr_item.qty × boq_item.price).
// DATA GAPS: (a) po/wo carry NO status column and NO doc-number column, so they
// have no "pending approval" state to filter on and are honestly EXCLUDED — the
// mock's PO/WO inbox rows have no schema backing. (b) pr has no title / requester
// (created_by) / urgency column, so those are null (NOT fabricated). amount is a
// real derived line total (null when a PR has no priced BOQ lines).
async function approvalsInbox(db: TenantDb) {
  const [pending, prLines, boqAll] = await Promise.all([
    db.selectThrough(
      prs,
      [{ fk: prs.projectId, parent: projects }],
      eq(prs.status, "pending"),
    ),
    // pr_item scoped pr → project; boq_item scoped group → doc → project.
    db.selectThrough(prItems, [
      { fk: prItems.prId, parent: prs },
      { fk: prs.projectId, parent: projects },
    ]),
    db.selectThrough(boqItems, [
      { fk: boqItems.groupId, parent: boqGroups },
      { fk: boqGroups.boqId, parent: boqDocs },
      { fk: boqDocs.projectId, parent: projects },
    ]),
  ]);

  const priceByItem = new Map(
    boqAll.map((b) => [b.id, { price: num(b.price), ccy: b.currencyCode }]),
  );
  // Sum each PR's derived amount from its priced lines.
  const amountByPr = new Map<string, { amount: number; ccy: string | null }>();
  for (const line of prLines) {
    const px = line.boqItemId ? priceByItem.get(line.boqItemId) : undefined;
    if (!px) continue;
    const prev = amountByPr.get(line.prId) ?? { amount: 0, ccy: px.ccy };
    prev.amount += num(line.qty) * px.price;
    amountByPr.set(line.prId, prev);
  }

  const rows = pending.map((pr) => {
    const derived = amountByPr.get(pr.id);
    return {
      kind: "PR",
      doc_no: pr.no,
      title: null, // GAP: pr has no title/name column.
      requester: null, // GAP: pr has no requester/created_by column.
      amount: derived ? round2(derived.amount) : null,
      currency_code: derived ? derived.ccy : null,
      created_at: pr.createdAt,
      urgent: false, // GAP: no priority/age column to derive urgency honestly.
    };
  });
  return listEnvelope(rows);
}

// ---------------------------------------------------------------------------
// 4. GET /dashboard/phase-progress — per-phase built/sold % (EntityList)
// ---------------------------------------------------------------------------
// Real source: every project_node kind='phase' across the tenant; units = count
// of unit descendants (parent_id tree, same walk as projects.ts derivePhases);
// sold% and built% from the distinct sales_unit.stage sets.
// DATA GAPS: budget_used has no per-phase budget link (cost_center attaches to
// the project, cbs_budget to boq_group — neither to a phase node) → null (NOT the
// mock's forbidden round(sold*0.92)). status has no per-phase schedule → null.
async function phaseProgress(db: TenantDb) {
  const [nodes, sales] = await Promise.all([
    db.selectThrough(projectNodes, [
      { fk: projectNodes.projectId, parent: projects },
    ]) as Promise<NodeRow[]>,
    db.select(salesUnits),
  ]);

  const stageByUnit = new Map<string, string | null>();
  for (const s of sales) if (s.unitId) stageByUnit.set(s.unitId, s.stage);

  const childrenByParent = new Map<string, NodeRow[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = childrenByParent.get(n.parentId);
    if (list) list.push(n);
    else childrenByParent.set(n.parentId, [n]);
  }
  const collectUnitIds = (id: string, out: string[]): string[] => {
    for (const child of childrenByParent.get(id) ?? []) {
      if (child.kind === "unit") out.push(child.id);
      collectUnitIds(child.id, out);
    }
    return out;
  };

  const rows = nodes
    .filter((n) => n.kind === "phase")
    .map((phase) => {
      const unitIds = collectUnitIds(phase.id, []);
      const total = unitIds.length;
      const soldPct =
        total === 0
          ? 0
          : Math.round(
              (100 *
                unitIds.filter((id) => {
                  const st = stageByUnit.get(id);
                  return st != null && SOLD_STAGES.has(st);
                }).length) /
                total,
            );
      const builtPct =
        total === 0
          ? 0
          : Math.round(
              (100 *
                unitIds.filter((id) => {
                  const st = stageByUnit.get(id);
                  return st != null && BUILT_STAGES.has(st);
                }).length) /
                total,
            );
      return {
        name: phase.name,
        units: total,
        sold: soldPct,
        built: builtPct,
        budget_used: null, // GAP: no per-phase budget link in the schema.
        status: null, // GAP: no per-phase schedule/status data.
      };
    });
  return listEnvelope(rows);
}

// ---------------------------------------------------------------------------
// 5. GET /dashboard/alerts — rule-derived risk alerts (EntityList)
// ---------------------------------------------------------------------------
// Two real rules computed over seed:
//   - over-budget category: cbs_budget where used + committed > budget
//   - overdue payable: ap_billing with a due_date in the past, not yet settled
// On the current seed NEITHER trips (cbs used+committed always < budget;
// ap_billing.due_date is null for every row), so the list is honestly EMPTY —
// the mock's 3 hardcoded alerts are NOT reproduced.
async function alerts(db: TenantDb) {
  const [cbs, groups, bills] = await Promise.all([
    db.selectThrough(cbsBudgets, [
      { fk: cbsBudgets.groupId, parent: boqGroups },
      { fk: boqGroups.boqId, parent: boqDocs },
      { fk: boqDocs.projectId, parent: projects },
    ]),
    db.selectThrough(boqGroups, [
      { fk: boqGroups.boqId, parent: boqDocs },
      { fk: boqDocs.projectId, parent: projects },
    ]),
    db.select(apBillings),
  ]);
  const nameByGroup = new Map(groups.map((g) => [g.id, g.name]));

  const out: {
    tone: string;
    code: string;
    title: string | null;
    sub: string;
    action: null;
  }[] = [];

  // Rule 1 — over-budget cost category (used + committed exceed the group budget).
  for (const c of cbs) {
    const budget = num(c.budget);
    const spent = num(c.used) + num(c.committed);
    if (budget > 0 && spent > budget) {
      out.push({
        tone: "danger",
        code: "OVER_BUDGET_CATEGORY",
        title: nameByGroup.get(c.groupId) ?? null,
        sub: `budget=${round2(budget)} used+committed=${round2(spent)}`,
        action: null,
      });
    }
  }

  // Rule 2 — overdue payable (due_date in the past, not settled/paid).
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const b of bills) {
    if (!b.dueDate) continue; // GAP: seed ap_billing.due_date is null → no trip.
    const settled = b.status === "paid" || b.status === "settled";
    if (settled) continue;
    if (new Date(b.dueDate as unknown as string) < today) {
      out.push({
        tone: "warn",
        code: "OVERDUE_PAYABLE",
        title: b.invoiceNo ?? null,
        sub: `due=${String(b.dueDate)} amount=${round2(num(b.amount))}`,
        action: null,
      });
    }
  }

  return listEnvelope(out);
}

// ---------------------------------------------------------------------------
// 6. GET /dashboard/cashflow-forecast — next 7 days net + line items (EntityOk)
// ---------------------------------------------------------------------------
// Real sources: ap_billing (payables, negative) with a due_date in [today,
// today+7d]; ar_invoice (receivables, positive) whose due = created_at +
// credit_term days falls in the same window.
// DATA GAP: on the current seed the window catches nothing — ap_billing.due_date
// is null for every row, and every ar_invoice due date is created_at + 30d (well
// outside 7 days) — so rows is honestly EMPTY and net_total = 0 rather than the
// mock's hardcoded -18.4M.
async function cashflowForecast(db: TenantDb) {
  const [bills, invoices] = await Promise.all([
    db.select(apBillings),
    db.select(arInvoices),
  ]);

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  const inWindow = (d: Date): boolean => d >= start && d <= end;

  const rows: { due_date: string; label: string | null; amount: number }[] = [];

  // Payables (money out) — ap_billing carries an explicit due_date.
  for (const b of bills) {
    if (!b.dueDate) continue; // GAP: null in seed.
    const due = new Date(b.dueDate as unknown as string);
    if (!inWindow(due)) continue;
    rows.push({
      due_date: String(b.dueDate),
      label: b.invoiceNo ?? null,
      amount: -round2(num(b.amount) + num(b.vat)),
    });
  }

  // Receivables (money in) — due date derived from created_at + credit_term.
  for (const inv of invoices) {
    const term = inv.creditTerm;
    if (term == null || !inv.createdAt) continue;
    const due = new Date(inv.createdAt as unknown as string);
    due.setUTCDate(due.getUTCDate() + term);
    if (!inWindow(due)) continue;
    rows.push({
      due_date: due.toISOString().slice(0, 10),
      label: inv.no,
      amount: round2(num(inv.amount)),
    });
  }

  rows.sort((a, b) => a.due_date.localeCompare(b.due_date));
  const netTotal = round2(rows.reduce((s, r) => s + r.amount, 0));
  return { net_total: netTotal, currency_code: "THB", rows };
}

// ---------------------------------------------------------------------------
// 7. GET /dashboard/contractors — active subcontracts + progress (EntityList)
// ---------------------------------------------------------------------------
// Real sources: subcon_contract (scoped project), vendor name (company master),
// progress = Σ(work_period.amount where status='passed') / contract.value ×100,
// retention_amount = contract.value × retention_pct / 100.
// DATA GAP: subcon_contract has NO work-scope column (the mock's "งานโครงสร้าง
// B-1..B-24" text is not stored) → work_scope is null. "active" is by end-date
// (>= today) since subcon_contract has no status column. (retention_ledger.scope
// / .withheld exist as an alternative real source — noted for review.)
async function contractors(db: TenantDb) {
  const [contracts, periods, vendorRows] = await Promise.all([
    db.selectThrough(subconContracts, [
      { fk: subconContracts.projectId, parent: projects },
    ]),
    db.selectThrough(workPeriods, [
      { fk: workPeriods.contractId, parent: subconContracts },
      { fk: subconContracts.projectId, parent: projects },
    ]),
    db.select(vendors),
  ]);
  const nameByVendor = new Map(vendorRows.map((v) => [v.id, v.name]));

  // Σ passed amount per contract → progress numerator.
  const passedByContract = new Map<string, number>();
  for (const p of periods) {
    if (p.status !== "passed") continue;
    passedByContract.set(
      p.contractId,
      (passedByContract.get(p.contractId) ?? 0) + num(p.amount),
    );
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const rows = contracts
    .filter((c) => !c.end || new Date(c.end as unknown as string) >= today)
    .map((c) => {
      const value = num(c.value);
      const passed = passedByContract.get(c.id) ?? 0;
      const progressPct = value > 0 ? Math.round((100 * passed) / value) : 0;
      const retention = round2((value * num(c.retentionPct)) / 100);
      return {
        vendor_name: nameByVendor.get(c.vendorId) ?? null,
        work_scope: null, // GAP: subcon_contract has no scope column.
        progress_pct: progressPct,
        retention_amount: retention,
        currency_code: c.currencyCode,
      };
    });
  return listEnvelope(rows);
}

/** Parse ?range / ?period (contract Period param); default 'year'. */
function parseRange(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length > 0 ? s : "year";
}

/** Register the 7 GET /dashboard/* routes on the /api/v1-prefixed scope. */
export function registerDashboardRoute(app: FastifyInstance): void {
  const withTenant =
    (run: (db: TenantDb, range: string) => Promise<unknown>) =>
    async (
      request: { db?: TenantDb; query?: unknown },
      reply: FastifyReply,
    ) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      const q = (request.query ?? {}) as { range?: unknown; period?: unknown };
      const range = parseRange(q.range ?? q.period);
      return reply.code(200).send(await run(db, range));
    };

  app.get("/dashboard/summary", withTenant((db, range) => summary(db, range)));
  app.get(
    "/dashboard/budget-actual",
    withTenant((db, range) => budgetActual(db, range)),
  );
  app.get("/dashboard/approvals-inbox", withTenant((db) => approvalsInbox(db)));
  app.get("/dashboard/phase-progress", withTenant((db) => phaseProgress(db)));
  app.get("/dashboard/alerts", withTenant((db) => alerts(db)));
  app.get(
    "/dashboard/cashflow-forecast",
    withTenant((db) => cashflowForecast(db)),
  );
  app.get("/dashboard/contractors", withTenant((db) => contractors(db)));
}
