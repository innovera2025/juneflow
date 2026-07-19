// GET /analytics/* — tenant-wide executive analytics (group-C Wave-2, B-101).
// The cross-project rollup of pototype/exec-audit.jsx (ExecDashboard), an
// aggregate over the EXISTING seed business tables — no new table, no migration.
//
// Contract (openapi.yaml, B-101 sacred batch 6533f44): 1 GET op, Entity-opaque
// JSON. Returns the object directly (EntityOk), is tenant-scoped through
// request.db (the TenantDb doors) and 401s without a tenant (fail closed),
// exactly like dashboard.ts / counts.ts.
//
// C10 DISCIPLINE (critical): every number derives from a live query over the
// seed — the mock's per-project `roll` literals (budget/actual/progress/health/
// sold) are FORBIDDEN and NONE are reproduced. budget/actual come from
// cbs_budget (mirroring dashboard.ts summary/alerts), progress from the phase-
// progress built% source, health from the exec mock's own utilisation threshold
// (exec-audit.jsx:89 `over = actual > budget * 0.9`), sold% from sales_unit.
// Where source data is genuinely absent (a project with no sales units), the
// handler returns an HONEST null rather than fabricating a number.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  boqDocs,
  boqGroups,
  cbsBudgets,
  projectNodes,
  projects,
  projectTypes,
  salesUnits,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";

type ProjectRow = typeof projects.$inferSelect;
type NodeRow = typeof projectNodes.$inferSelect;

/** Sale stages that count a unit as SOLD (sales_unit.stage) — same as dashboard.ts. */
const SOLD_STAGES = new Set(["sold", "soldBuilt"]);
/** Sale stages that count a unit as physically BUILT (distinct real metric). */
const BUILT_STAGES = new Set(["built", "soldBuilt"]);

// Health labels — the exec mock's exact Thai values (exec-audit.jsx:14-20).
const HEALTH_OK = "ดี";
const HEALTH_WATCH = "เฝ้าระวัง";

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

// ---------------------------------------------------------------------------
// GET /analytics/portfolio — executive per-project rollup + totals + type-mix
// ---------------------------------------------------------------------------
// Real sources, all tenant-scoped, ONE query each (no N+1 over projects):
//   - projects            : db.select (company-scoped)             → the roster
//   - project_type        : selectGlobalOrOwned (global OR own)    → type_key
//   - cbs_budget/group/doc: selectThrough group→doc→project        → budget/actual
//   - project_node        : selectThrough node→project             → progress
//   - sales_unit          : db.select (company-scoped)             → sold%
// Per project: budget = Σ cbs.budget, actual = Σ cbs.used (the real "ใช้จริง",
// matching dashboard summary.actual_total); progress_pct = avg over the project's
// phase nodes of built% (the physical-progress source dashboard phaseProgress
// derives — #built units / #total units per phase); health = the exec mock's own
// utilisation rule (actual > budget × 0.9 → "เฝ้าระวัง" else "ดี",
// exec-audit.jsx:89, values verbatim); sold_pct = round(100 × sold units / total
// units) or HONEST null when the project has no sales units. at_risk_count = #
// projects with health "เฝ้าระวัง". type_mix = Σ budget grouped by project_type.key
// (zero-sum types dropped, mirroring the mock's `if (!sum) return null`).
async function portfolio(db: TenantDb): Promise<Result> {
  const [projectRows, types, cbs, groups, docs, nodes, sales] =
    await Promise.all([
      db.select(projects) as Promise<ProjectRow[]>,
      db.selectGlobalOrOwned(projectTypes),
      // cbs → group → doc → project: cbs rows carry only groupId, so the
      // group/doc rows below re-map each cbs to its owning project.
      db.selectThrough(cbsBudgets, [
        { fk: cbsBudgets.groupId, parent: boqGroups },
        { fk: boqGroups.boqId, parent: boqDocs },
        { fk: boqDocs.projectId, parent: projects },
      ]),
      db.selectThrough(boqGroups, [
        { fk: boqGroups.boqId, parent: boqDocs },
        { fk: boqDocs.projectId, parent: projects },
      ]),
      db.selectThrough(boqDocs, [{ fk: boqDocs.projectId, parent: projects }]),
      db.selectThrough(projectNodes, [
        { fk: projectNodes.projectId, parent: projects },
      ]) as Promise<NodeRow[]>,
      db.select(salesUnits),
    ]);

  const keyByType = new Map(
    types.map((t) => [t.id as string, t.key as string]),
  );

  // Re-map each cbs row to its owning project through the group→doc chain.
  const projectByDoc = new Map(
    docs.map((d) => [d.id as string, d.projectId as string]),
  );
  const projectByGroup = new Map(
    groups.map((g) => [
      g.id as string,
      projectByDoc.get(g.boqId as string) ?? null,
    ]),
  );
  const budgetByProject = new Map<string, number>();
  const actualByProject = new Map<string, number>();
  for (const c of cbs) {
    const projectId = projectByGroup.get(c.groupId as string);
    if (projectId == null) continue;
    budgetByProject.set(
      projectId,
      (budgetByProject.get(projectId) ?? 0) + num(c.budget),
    );
    actualByProject.set(
      projectId,
      (actualByProject.get(projectId) ?? 0) + num(c.used),
    );
  }

  // project_node tree indexes (built once for every project).
  const nodesByProject = new Map<string, NodeRow[]>();
  const childrenByParent = new Map<string, NodeRow[]>();
  for (const n of nodes) {
    const list = nodesByProject.get(n.projectId);
    if (list) list.push(n);
    else nodesByProject.set(n.projectId, [n]);
    if (n.parentId) {
      const kids = childrenByParent.get(n.parentId);
      if (kids) kids.push(n);
      else childrenByParent.set(n.parentId, [n]);
    }
  }
  const stageByUnit = new Map<string, string | null>();
  for (const s of sales) if (s.unitId) stageByUnit.set(s.unitId, s.stage);

  const collectUnitIds = (id: string, out: string[]): string[] => {
    for (const child of childrenByParent.get(id) ?? []) {
      if (child.kind === "unit") out.push(child.id);
      collectUnitIds(child.id, out);
    }
    return out;
  };

  const projectViews = projectRows.map((p) => {
    const budget = round2(budgetByProject.get(p.id) ?? 0);
    const actual = round2(actualByProject.get(p.id) ?? 0);
    // Utilisation health — the exec mock's own rule (exec-audit.jsx:89).
    const health = actual > budget * 0.9 ? HEALTH_WATCH : HEALTH_OK;

    // progress_pct = avg over the project's phase nodes of built% (physical).
    const projNodes = nodesByProject.get(p.id) ?? [];
    const phases = projNodes.filter((n) => n.kind === "phase");
    const phaseBuilt = phases.map((ph) => {
      const unitIds = collectUnitIds(ph.id, []);
      const total = unitIds.length;
      if (total === 0) return 0;
      const built = unitIds.filter((id) => {
        const st = stageByUnit.get(id);
        return st != null && BUILT_STAGES.has(st);
      }).length;
      return Math.round((100 * built) / total);
    });
    const progressPct =
      phaseBuilt.length > 0
        ? Math.round(phaseBuilt.reduce((s, v) => s + v, 0) / phaseBuilt.length)
        : 0;

    // sold_pct over the project's unit nodes; HONEST null when no sales units.
    const unitIds = projNodes.filter((n) => n.kind === "unit").map((n) => n.id);
    const unitsWithSale = unitIds.filter((id) => stageByUnit.has(id));
    let soldPct: number | null = null;
    if (unitsWithSale.length > 0 && unitIds.length > 0) {
      const sold = unitIds.filter((id) => {
        const st = stageByUnit.get(id);
        return st != null && SOLD_STAGES.has(st);
      }).length;
      soldPct = Math.round((100 * sold) / unitIds.length);
    }

    return {
      project_id: p.id,
      name: p.name,
      type_key: keyByType.get(p.typeId) ?? null,
      budget,
      actual,
      progress_pct: progressPct,
      health,
      sold_pct: soldPct,
    };
  });

  // type_mix = Σ budget grouped by project_type.key (drop zero-sum types).
  const budgetByType = new Map<string, number>();
  for (const v of projectViews) {
    if (v.type_key == null) continue;
    budgetByType.set(v.type_key, (budgetByType.get(v.type_key) ?? 0) + v.budget);
  }
  const typeMix = [...budgetByType.entries()]
    .filter(([, sum]) => sum > 0)
    .map(([typeKey, sum]) => ({ type_key: typeKey, budget_sum: round2(sum) }));

  const budgetTotal = round2(projectViews.reduce((s, v) => s + v.budget, 0));
  const actualTotal = round2(projectViews.reduce((s, v) => s + v.actual, 0));
  const avgProgress =
    projectViews.length > 0
      ? Math.round(
          projectViews.reduce((s, v) => s + v.progress_pct, 0) /
            projectViews.length,
        )
      : 0;
  const atRiskCount = projectViews.filter(
    (v) => v.health === HEALTH_WATCH,
  ).length;
  // Cross-project total — the tenant's first project currency (seed is all THB);
  // mixed-currency portfolios are out of scope for this MVP rollup.
  const currencyCode = projectRows[0]?.currencyCode ?? "THB";

  return {
    status: 200,
    body: {
      totals: {
        budget_total: budgetTotal,
        actual_total: actualTotal,
        avg_progress: avgProgress,
        at_risk_count: atRiskCount,
        currency_code: currencyCode,
      },
      projects: projectViews,
      type_mix: typeMix,
    },
  };
}

/** Uniform handler result so the wrapper can send any status. */
interface Result {
  status: number;
  body: unknown;
}

/** Register the GET /analytics/portfolio route on the /api/v1-prefixed scope. */
export function registerAnalyticsRoute(app: FastifyInstance): void {
  const withTenant =
    (run: (db: TenantDb) => Promise<Result>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      const result = await run(db);
      return reply.code(result.status).send(result.body);
    };

  app.get("/analytics/portfolio", withTenant(portfolio));
}
