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
// PROJECT SCOPE — the ?project_id (uuid) param (contract amendment, B-049): the
// mock dashboard follows the ProjectSwitcher active project, so every op takes
// an OPTIONAL project_id. When PROVIDED, the op's aggregation is scoped to that
// ONE project — and it is TENANT-VERIFIED: the project id is resolved through
// the company_id-scoped select door (a foreign/absent id resolves to nothing),
// and every downstream read anchors its tenant scope on the same project root,
// so a caller can NEVER read another tenant's project by passing its id. A
// foreign/absent id → 404 (EntityOk ops) or an empty envelope (EntityList ops).
// When OMITTED, behaviour is unchanged: summary/budget-actual resolve a PRIMARY
// project (first by created_at ASC, id ASC — deterministic) and the list ops
// aggregate TENANT-WIDE across every project.
//
// Two ops can only be PARTIALLY project-scoped by the data model — noted where
// they occur: ap_billing carries NO project_id column, so the alerts
// overdue-payable rule and the cashflow payables leg cannot be attributed to a
// project and are omitted when project_id is set (only project-attributable rows
// remain).
//
// C10 DISCIPLINE (critical): every number here derives from a live query over
// the seed — NONE of the mock's hardcoded values (17 pending, 24 contracts, 3
// alerts, health 71, committed 38/18/12/4) are reproduced, and the mock's
// forbidden formulas (built = sold, budget_used = round(sold * 0.92)) are NOT
// ported. Where a widget's SOURCE DATA genuinely does not exist in the schema/
// seed, the handler returns an HONEST null/empty/zero with a code comment naming
// the gap (see the DATA GAPS notes on each handler) rather than fabricating a
// number to match the mock.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, type SQL } from "drizzle-orm";
import {
  apBillings,
  arInvoices,
  boqDocs,
  boqGroups,
  boqItems,
  cbsBudgets,
  pos,
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
  wos,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";
// group-C Wave-3 (B-101): the shared EVM snapshot loader that backfills this
// handler's previously honest-empty budget-vs-actual time-series (the one store
// that closes the S-curve DATA GAP). Read through the projects hop — see below.
import { loadEvmSeries } from "./evm-series.js";
// Approver-tier authority reuse (P2-BE-07, B-070): the inbox filters each doc by
// the SAME tier gate its approve handler enforces, so the inbox and the write
// path can never drift. PR thresholds (500K/2M) live in pr.ts; PO/WO thresholds
// (1M/5M) live in procurement.ts — each is imported, never re-declared here.
import { requiredApprovalLevel as prRequiredLevel } from "./pr.js";
import {
  callerApprovalLevel,
  requiredApprovalLevel as poWoRequiredLevel,
} from "./procurement.js";

type ProjectRow = typeof projects.$inferSelect;
type NodeRow = typeof projectNodes.$inferSelect;

/** Per-request context parsed off the query string. */
interface DashCtx {
  range: string;
  /** Active-project scope (uuid) or null for the default (primary/tenant-wide). */
  projectId: string | null;
}

/** Uniform handler result so the wrapper can send any status (200 / 404). */
interface Result {
  status: number;
  body: unknown;
}

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

/** Flat 404 (contract Error shape) for a project the caller does not own. */
function projectNotFound(): Result {
  return {
    status: 404,
    body: { code: "NOT_FOUND", message: "Project not found" },
  };
}

/**
 * Resolve a project id THIS tenant owns, or null. The select door ANDs
 * company_id, so a foreign/absent id can never resolve — this is the ownership
 * gate for ?project_id (no cross-tenant read is possible).
 */
async function ownedProject(
  db: TenantDb,
  projectId: string,
): Promise<ProjectRow | null> {
  const rows = (await db.select(
    projects,
    eq(projects.id, projectId),
  )) as ProjectRow[];
  return rows[0] ?? null;
}

/**
 * The tenant's PRIMARY project (?project_id omitted default): first by
 * (created_at ASC, id ASC), deterministic. undefined when the tenant has no
 * projects.
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

/** AND `extra` onto `base` (either may be undefined). */
function both(base: SQL | undefined, extra: SQL | undefined): SQL | undefined {
  if (base && extra) return and(base, extra) as SQL;
  return base ?? extra;
}

/** cbs_budget rows scoped group → boq_doc → project, optionally to one project. */
function cbsScoped(db: TenantDb, projectId?: string | null) {
  return db.selectThrough(
    cbsBudgets,
    [
      { fk: cbsBudgets.groupId, parent: boqGroups },
      { fk: boqGroups.boqId, parent: boqDocs },
      { fk: boqDocs.projectId, parent: projects },
    ],
    projectId ? eq(boqDocs.projectId, projectId) : undefined,
  );
}

/** boq_group rows scoped doc → project, optionally to one project. */
function boqGroupsScoped(db: TenantDb, projectId?: string | null) {
  return db.selectThrough(
    boqGroups,
    [
      { fk: boqGroups.boqId, parent: boqDocs },
      { fk: boqDocs.projectId, parent: projects },
    ],
    projectId ? eq(boqDocs.projectId, projectId) : undefined,
  );
}

// ---------------------------------------------------------------------------
// 1. GET /dashboard/summary — header meta + type-aware KPIs + health donut
// ---------------------------------------------------------------------------
// Real sources: project + project_type (hybrid door) + project_node (phase) +
// cbs_budget (budget/used/committed) OR solar_inverter/ppa_invoice for solar.
// project_id → that project (404 if not owned); omitted → PRIMARY project.
// DATA GAPS: as_of is the live server time (the mock's fixed 25 พ.ค. is a mock
// constant); status_label is the raw project.status (FE maps to a display label
// — the mock's Thai STATUS_LABEL is presentational i18n). health_score is a
// single real budget-utilisation ratio, NOT the mock's opaque "5-indicator" 71.
async function summary(db: TenantDb, ctx: DashCtx): Promise<Result> {
  const asOf = new Date().toISOString();

  let target: ProjectRow | undefined;
  if (ctx.projectId) {
    const owned = await ownedProject(db, ctx.projectId);
    if (!owned) return projectNotFound();
    target = owned;
  } else {
    target = await resolvePrimaryProject(db);
  }

  if (!target) {
    // Tenant has no projects (only possible for the omitted/primary path).
    return {
      status: 200,
      body: {
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
        range: ctx.range,
      },
    };
  }

  // project_type key via the B-065 hybrid door (global defaults OR own custom).
  const types = await db.selectGlobalOrOwned(projectTypes);
  const typeKey = types.find((t) => t.id === target.typeId)?.key ?? null;

  // active_phase_label = first phase node of the project (project_node has no
  // company_id — scoped through its project root).
  const nodes = (await db.selectThrough(
    projectNodes,
    [{ fk: projectNodes.projectId, parent: projects }],
    eq(projectNodes.projectId, target.id),
  )) as NodeRow[];
  const activePhase = nodes.find((n) => n.kind === "phase");

  const header = {
    project_id: target.id,
    project_name: target.name,
    project_type: typeKey,
    active_phase_label: activePhase?.name ?? null,
    as_of: asOf,
    status_label: target.status,
    range: ctx.range,
  };

  // Solar KPI branch — ONLY when the project is solar AND real solar data exists
  // (project:slr in seed). Otherwise fall through to the budget branch (honest
  // zeros for a solar project with no inverters/ppa yet).
  if (typeKey === "solar") {
    const [inverters, ppa] = await Promise.all([
      db.select(solarInverters, eq(solarInverters.projectId, target.id)),
      db.select(ppaInvoices, eq(ppaInvoices.projectId, target.id)),
    ]);
    if (inverters.length > 0 || ppa.length > 0) {
      const installedCapacity = inverters.reduce((s, r) => s + num(r.kw), 0);
      const energyYtd = ppa.reduce((s, r) => s + num(r.mwh), 0);
      const perfSum = inverters.reduce((s, r) => s + num(r.perf), 0);
      const perfRatio =
        inverters.length > 0 ? round2(perfSum / inverters.length) : 0;
      return {
        status: 200,
        body: {
          ...header,
          kpi_kind: "solar",
          installed_capacity: round2(installedCapacity),
          energy_ytd: round2(energyYtd),
          performance_ratio: perfRatio,
          currency_code: target.currencyCode,
          // Solar health = mean performance ratio (a single real indicator).
          health_score: Math.min(100, Math.max(0, Math.round(perfRatio))),
        },
      };
    }
  }

  // Budget KPI branch (realestate / civil / service, and solar-without-data):
  // the cbs_budget control totals for this project.
  const cbs = await cbsScoped(db, target.id);
  const budgetTotal = cbs.reduce((s, r) => s + num(r.budget), 0);
  const actualTotal = cbs.reduce((s, r) => s + num(r.used), 0);
  const committedTotal = cbs.reduce((s, r) => s + num(r.committed), 0);
  const remainingTotal = budgetTotal - actualTotal - committedTotal;
  const healthScore =
    budgetTotal > 0
      ? Math.min(100, Math.max(0, Math.round((100 * remainingTotal) / budgetTotal)))
      : 0;

  return {
    status: 200,
    body: {
      ...header,
      kpi_kind: "budget",
      budget_total: round2(budgetTotal),
      actual_total: round2(actualTotal),
      committed_total: round2(committedTotal),
      remaining_total: round2(remainingTotal),
      currency_code: target.currencyCode,
      health_score: healthScore,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. GET /dashboard/budget-actual — time-series + cost-category breakdown
// ---------------------------------------------------------------------------
// Real source: cost_categories = per-boq_group cbs_budget (category_label =
// group name, actual_value = used, plan_value = budget). project_id → that
// project (404 if not owned); omitted → PRIMARY project.
// TIME-SERIES (group-C Wave-3, B-101): the period bars are now BACKFILLED from
// evm_snapshot (the new project-anchored EVM store) via loadEvmSeries — period_
// label = period, plan_amount = pv, budget_amount = budget, actual_amount = ac,
// ordered by period ASC. The contract shape is UNCHANGED (same keys as before —
// only the values that were the documented DATA GAP are now filled). C10 holds:
// the arrays stay honestly EMPTY when a tenant/project has no snapshots seeded,
// never fabricated. The real, non-time-phased part of the widget stays the
// cost_categories breakdown.
async function budgetActual(db: TenantDb, ctx: DashCtx): Promise<Result> {
  let target: ProjectRow | undefined;
  if (ctx.projectId) {
    const owned = await ownedProject(db, ctx.projectId);
    if (!owned) return projectNotFound();
    target = owned;
  } else {
    target = await resolvePrimaryProject(db);
  }

  if (!target) {
    return {
      status: 200,
      body: {
        range: ctx.range,
        range_label: ctx.range,
        period_label: [],
        budget_amount: [],
        actual_amount: [],
        plan_amount: [],
        cost_categories: [],
        currency_code: null,
      },
    };
  }

  const [cbs, groups, evmSeries] = await Promise.all([
    cbsScoped(db, target.id),
    boqGroupsScoped(db, target.id),
    // EVM snapshot S-curve for THIS project (group-C Wave-3, B-101). evm_snapshot
    // is project-anchored (no company_id) → read through the projects hop inside
    // loadEvmSeries; ordered period ASC. Empty when no snapshots exist (honest).
    loadEvmSeries(db, target.id),
  ]);
  const nameByGroup = new Map(groups.map((g) => [g.id, g.name]));

  const costCategories = cbs.map((c) => ({
    category_label: nameByGroup.get(c.groupId) ?? null,
    actual_value: round2(num(c.used)),
    plan_value: round2(num(c.budget)),
  }));

  return {
    status: 200,
    body: {
      range: ctx.range,
      range_label: ctx.range,
      // Backfilled from evm_snapshot (period ASC). Honestly EMPTY when a
      // project has no snapshots — the series source is then genuinely absent.
      period_label: evmSeries.map((s) => s.period),
      budget_amount: evmSeries.map((s) => round2(s.budget)),
      actual_amount: evmSeries.map((s) => round2(s.ac)),
      plan_amount: evmSeries.map((s) => round2(s.pv)),
      cost_categories: costCategories,
      // Unchanged: the project's currency (== the snapshots' currency); stays
      // non-null even when the series is empty.
      currency_code: target.currencyCode,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. GET /dashboard/approvals-inbox — the caller's pending approvals (EntityList)
// ---------------------------------------------------------------------------
// Real source: the UNION of PENDING pr + po + wo docs (all three now carry the
// B-070 status / approval_step state machine — pr.ts / po.ts / wo.ts) that THIS
// caller is a valid next-tier approver for. A row is INCLUDED when its doc is in
// `status = 'pending'` AND the caller's role.approvalLevel reaches the tier that
// doc's amount demands — EXACTLY the gate each doc's approve handler enforces
// (level >= requiredApprovalLevel(amount)), so the inbox shows precisely the docs
// the caller could actually approve. Amounts are real, per doc kind:
//   PR — Σ pr_item.qty × boq_item.price (derived; tier by pr.ts's 500K/2M matrix)
//   PO — the stored pos.total          (tier by procurement.ts's 1M/5M matrix)
//   WO — the stored wos.value          (tier by procurement.ts's 1M/5M matrix)
// project_id → only that project's pending docs (filtered on the project root the
// pr/po/wo scope-chain already joins); omitted → tenant-wide. Tenant scope: pr is
// anchored pr → project; po/wo are anchored pr_id → pr → project (their only
// tenant root), so no cross-tenant doc can appear. An unattributable caller (no
// session user / no role) or one below every tier (level < 2) gets an empty inbox.
// C10: `total` / `data` are the live pending-and-actionable docs from these
// queries — NEVER the mock's hardcoded 17; this count feeds the dashboard badge.
// DATA GAPS (honest null, NOT fabricated — PLAN.md §0 rule 4): pr/po/wo have no
// title, no requester/created_by, and no priority/urgency column → title,
// requester and urgent are null. PR amount/currency are null when a PR has no
// priced BOQ lines (its tier is then computed from a real 0). po.no / wo.no are
// nullable real columns, so doc_no may legitimately be null for a PO/WO.
async function approvalsInbox(
  db: TenantDb,
  ctx: DashCtx,
  request: FastifyRequest,
): Promise<Result> {
  // The caller's approval tier (null when unattributable). null / level 0 / 1
  // clears no tier (the lowest required level is 2), so the inbox stays empty.
  const level = await callerApprovalLevel(request);

  // Project filter, applied on the project ROOT each doc's scope-chain joins
  // (pr directly; po/wo via pr.project_id) so a PO/WO with no project_id column
  // is still scopable to one project.
  const projFilter = ctx.projectId ? eq(prs.projectId, ctx.projectId) : undefined;

  const [pendingPrs, pendingPos, pendingWos, prLines, boqAll] = await Promise.all([
    db.selectThrough(
      prs,
      [{ fk: prs.projectId, parent: projects }],
      both(eq(prs.status, "pending"), projFilter),
    ),
    db.selectThrough(
      pos,
      [
        { fk: pos.prId, parent: prs },
        { fk: prs.projectId, parent: projects },
      ],
      both(eq(pos.status, "pending"), projFilter),
    ),
    db.selectThrough(
      wos,
      [
        { fk: wos.prId, parent: prs },
        { fk: prs.projectId, parent: projects },
      ],
      both(eq(wos.status, "pending"), projFilter),
    ),
    // pr_item scoped pr → project; boq_item scoped group → doc → project. Kept
    // tenant-wide (they only feed the price/amount maps — a superset is harmless).
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
  // Sum each PR's derived amount from its priced lines (the same Σ pr.ts approve
  // uses to pick the PR's tier).
  const amountByPr = new Map<string, { amount: number; ccy: string | null }>();
  for (const line of prLines) {
    const px = line.boqItemId ? priceByItem.get(line.boqItemId) : undefined;
    if (!px) continue;
    const prev = amountByPr.get(line.prId) ?? { amount: 0, ccy: px.ccy };
    prev.amount += num(line.qty) * px.price;
    amountByPr.set(line.prId, prev);
  }

  /** The caller may act iff their level reaches the tier `amount` demands. */
  const canApprove = (amount: number, requiredLevel: (a: number) => number) =>
    level != null && level >= requiredLevel(amount);

  type InboxRow = {
    // The doc id — the mobile approvals inbox (B-259) navigates to the doc detail
    // (GET /pr/:id) with this; the web dashboard ignores the extra field. Opaque
    // Entity in openapi (no declared fields) → additive, no contract change.
    id: string;
    kind: string;
    doc_no: string | null;
    title: null;
    requester: null;
    amount: number | null;
    currency_code: string | null;
    created_at: unknown;
    urgent: null;
  };
  const rows: InboxRow[] = [];

  for (const pr of pendingPrs) {
    const derived = amountByPr.get(pr.id);
    // Tier is computed from the real derived amount (0 when the PR has no priced
    // lines) even though the displayed amount stays null in that case.
    if (!canApprove(derived?.amount ?? 0, prRequiredLevel)) continue;
    rows.push({
      id: pr.id,
      kind: "PR",
      doc_no: pr.no,
      title: null, // GAP: pr has no title/name column.
      requester: null, // GAP: pr has no requester/created_by column.
      amount: derived ? round2(derived.amount) : null,
      currency_code: derived ? derived.ccy : null,
      created_at: pr.createdAt,
      urgent: null, // GAP: no priority/age column to derive urgency honestly.
    });
  }

  for (const po of pendingPos) {
    const amount = num(po.total); // real stored total (po has no line table).
    if (!canApprove(amount, poWoRequiredLevel)) continue;
    rows.push({
      id: po.id,
      kind: "PO",
      doc_no: po.no, // real column, nullable → may be null (GAP-free honest null).
      title: null, // GAP: po has no title column.
      requester: null, // GAP: po has no requester/created_by column.
      amount: round2(amount),
      currency_code: po.currencyCode,
      created_at: po.createdAt,
      urgent: null, // GAP: no priority/urgency column.
    });
  }

  for (const wo of pendingWos) {
    const amount = num(wo.value); // real stored contract value.
    if (!canApprove(amount, poWoRequiredLevel)) continue;
    rows.push({
      id: wo.id,
      kind: "WO",
      doc_no: wo.no, // real column, nullable → may be null.
      title: null, // GAP: wo has no title column.
      requester: null, // GAP: wo has no requester/created_by column.
      amount: round2(amount),
      currency_code: wo.currencyCode,
      created_at: wo.createdAt,
      urgent: null, // GAP: no priority/urgency column.
    });
  }

  // Newest first; JS's stable sort keeps the PR→PO→WO grouping for equal times.
  rows.sort((a, b) => {
    const at = a.created_at ? new Date(a.created_at as string).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at as string).getTime() : 0;
    return bt - at;
  });
  return { status: 200, body: listEnvelope(rows) };
}

// ---------------------------------------------------------------------------
// 4. GET /dashboard/phase-progress — per-phase built/sold % (EntityList)
// ---------------------------------------------------------------------------
// Real source: every project_node kind='phase' (project_id → one project;
// omitted → tenant-wide); units = count of unit descendants (parent_id tree,
// same walk as projects.ts derivePhases); sold% and built% from the distinct
// sales_unit.stage sets.
// DATA GAPS: budget_used has no per-phase budget link (cost_center attaches to
// the project, cbs_budget to boq_group — neither to a phase node) → null (NOT the
// mock's forbidden round(sold*0.92)). status has no per-phase schedule → null.
async function phaseProgress(db: TenantDb, ctx: DashCtx): Promise<Result> {
  const [nodes, sales] = await Promise.all([
    db.selectThrough(
      projectNodes,
      [{ fk: projectNodes.projectId, parent: projects }],
      ctx.projectId ? eq(projectNodes.projectId, ctx.projectId) : undefined,
    ) as Promise<NodeRow[]>,
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
  return { status: 200, body: listEnvelope(rows) };
}

// ---------------------------------------------------------------------------
// 5. GET /dashboard/alerts — rule-derived risk alerts (EntityList)
// ---------------------------------------------------------------------------
// Two real rules computed over seed:
//   - over-budget category: cbs_budget where used + committed > budget
//   - overdue payable: ap_billing with a due_date in the past, not yet settled
// project_id → the over-budget rule is scoped to that project; the overdue-
// payable rule is OMITTED (ap_billing has no project_id column, so an alert can't
// be attributed to a project). omitted → both rules tenant-wide.
// On the current seed NEITHER trips (cbs used+committed always < budget;
// ap_billing.due_date is null for every row), so the list is honestly EMPTY —
// the mock's 3 hardcoded alerts are NOT reproduced.
async function alerts(db: TenantDb, ctx: DashCtx): Promise<Result> {
  const [cbs, groups, bills] = await Promise.all([
    cbsScoped(db, ctx.projectId),
    boqGroupsScoped(db, ctx.projectId),
    // ap_billing has no project_id column → only queried for the tenant-wide case.
    ctx.projectId ? Promise.resolve([]) : db.select(apBillings),
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

  // Rule 2 — overdue payable (due_date in the past, not settled/paid). Skipped
  // under project scope: ap_billing carries no project_id (GAP).
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

  return { status: 200, body: listEnvelope(out) };
}

// ---------------------------------------------------------------------------
// 6. GET /dashboard/cashflow-forecast — next 7 days net + line items (EntityOk)
// ---------------------------------------------------------------------------
// Real sources: ap_billing (payables, negative) with a due_date in [today,
// today+7d]; ar_invoice (receivables, positive) whose due = created_at +
// credit_term days falls in the same window. project_id → that project (404 if
// not owned): only ar_invoice.project_id is filtered — payables are OMITTED
// (ap_billing has no project_id column). omitted → both legs tenant-wide.
// DATA GAP: on the current seed the window catches nothing — ap_billing.due_date
// is null for every row, and every ar_invoice due date is created_at + 30d (well
// outside 7 days) — so rows is honestly EMPTY and net_total = 0 rather than the
// mock's hardcoded -18.4M.
async function cashflowForecast(db: TenantDb, ctx: DashCtx): Promise<Result> {
  if (ctx.projectId) {
    const owned = await ownedProject(db, ctx.projectId);
    if (!owned) return projectNotFound();
  }

  const [bills, invoices] = await Promise.all([
    // ap_billing has no project_id column → payables leg only in the tenant-wide case.
    ctx.projectId ? Promise.resolve([]) : db.select(apBillings),
    db.select(
      arInvoices,
      ctx.projectId ? eq(arInvoices.projectId, ctx.projectId) : undefined,
    ),
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
  return { status: 200, body: { net_total: netTotal, currency_code: "THB", rows } };
}

// ---------------------------------------------------------------------------
// 7. GET /dashboard/contractors — active subcontracts + progress (EntityList)
// ---------------------------------------------------------------------------
// Real sources: subcon_contract (scoped project; project_id → one project,
// omitted → tenant-wide), vendor name (company master), progress = Σ(work_period
// .amount where status='passed') / contract.value ×100, retention_amount =
// contract.value × retention_pct / 100.
// DATA GAP: subcon_contract has NO work-scope column (the mock's "งานโครงสร้าง
// B-1..B-24" text is not stored) → work_scope is null. "active" is by end-date
// (>= today) since subcon_contract has no status column. (retention_ledger.scope
// / .withheld exist as an alternative real source — noted for review.)
async function contractors(db: TenantDb, ctx: DashCtx): Promise<Result> {
  const [contracts, periods, vendorRows] = await Promise.all([
    db.selectThrough(
      subconContracts,
      [{ fk: subconContracts.projectId, parent: projects }],
      ctx.projectId ? eq(subconContracts.projectId, ctx.projectId) : undefined,
    ),
    db.selectThrough(
      workPeriods,
      [
        { fk: workPeriods.contractId, parent: subconContracts },
        { fk: subconContracts.projectId, parent: projects },
      ],
      ctx.projectId ? eq(subconContracts.projectId, ctx.projectId) : undefined,
    ),
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
  return { status: 200, body: listEnvelope(rows) };
}

/** Parse ?range / ?period (contract Period param); default 'year'. */
function parseRange(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length > 0 ? s : "year";
}

/** Parse ?project_id (contract uuid scope param); null when absent/blank. */
function parseProjectId(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length > 0 ? s : null;
}

/** Register the 7 GET /dashboard/* routes on the /api/v1-prefixed scope. */
export function registerDashboardRoute(app: FastifyInstance): void {
  const withTenant =
    (run: (db: TenantDb, ctx: DashCtx, request: FastifyRequest) => Promise<Result>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      const q = (request.query ?? {}) as {
        range?: unknown;
        period?: unknown;
        project_id?: unknown;
      };
      const ctx: DashCtx = {
        range: parseRange(q.range ?? q.period),
        projectId: parseProjectId(q.project_id),
      };
      // The request is forwarded so the approvals-inbox can resolve the caller's
      // approval tier (request.authUser → role); the other handlers ignore it.
      const result = await run(db, ctx, request);
      return reply.code(result.status).send(result.body);
    };

  app.get("/dashboard/summary", withTenant(summary));
  app.get("/dashboard/budget-actual", withTenant(budgetActual));
  app.get("/dashboard/approvals-inbox", withTenant(approvalsInbox));
  app.get("/dashboard/phase-progress", withTenant(phaseProgress));
  app.get("/dashboard/alerts", withTenant(alerts));
  app.get("/dashboard/cashflow-forecast", withTenant(cashflowForecast));
  app.get("/dashboard/contractors", withTenant(contractors));
}
