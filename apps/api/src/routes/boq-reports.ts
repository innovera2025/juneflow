// GET /boq/reports/* — tenant-scoped BOQ analytics reports (group-C Wave-2,
// B-101). Two read-only aggregation cards of pototype/boq-extra.jsx +
// pototype/boq.jsx, each an aggregate over the EXISTING seed business tables —
// no new table, no migration.
//
// Contract (openapi.yaml, B-101 sacred batch 6533f44): 2 GET ops, Entity-opaque
// JSON. Both return the object directly (EntityOk), are tenant-scoped through
// request.db (the TenantDb doors) and 401 without a tenant (fail closed),
// exactly like dashboard.ts / counts.ts.
//
// SCOPE — the ?project_id (uuid) + ?boq_id (uuid) params: the reports follow the
// active project / a chosen BOQ doc. Both are OPTIONAL and TENANT-VERIFIED by
// construction — every read is a selectThrough door that AND-s company_id on the
// project root (group → boq_doc → project), so a foreign/absent id resolves to
// nothing (never another tenant's data). When OMITTED the aggregate spans every
// BOQ the tenant owns.
//
// C10 DISCIPLINE (critical): every number derives from a live query over the
// seed — NONE of the mock's hardcoded values (the RPT-003 M/S/L literals, the
// RPT-001 +880,000 / +7.1% over) are reproduced. Where a report's SOURCE DATA
// genuinely does not exist in the schema/seed, the handler returns an HONEST
// null/empty/zero with a code comment naming the gap (see the DATA GAP note on
// boq-vs-nonboq's Non-BOQ column) rather than fabricating a number to match the
// mock.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gte, lte, type SQL } from "drizzle-orm";
import {
  boqDocs,
  boqGroups,
  boqItems,
  prItems,
  projects,
  prs,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";

type GroupRow = typeof boqGroups.$inferSelect;
type ItemRow = typeof boqItems.$inferSelect;
type PrItemRow = typeof prItems.$inferSelect;

/** Per-request scope parsed off the query string. */
interface ReportCtx {
  /** BOQ-doc-owning project (uuid) or null (tenant-wide). */
  projectId: string | null;
  /** A specific BOQ doc (uuid) or null (every doc in scope). */
  boqId: string | null;
  /** Inclusive PR-created-at lower bound (RPT-001 from) or null. */
  from: Date | null;
  /** Inclusive PR-created-at upper bound (RPT-001 to) or null. */
  to: Date | null;
  /** Exact work-category label filter (RPT-001 category) or null. */
  category: string | null;
}

/** Uniform handler result so the wrapper can send any status. */
interface Result {
  status: number;
  body: unknown;
}

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

/** AND a list of predicates (0 → undefined, 1 → itself, N → and()). */
function allOf(filters: SQL[]): SQL | undefined {
  if (filters.length === 0) return undefined;
  if (filters.length === 1) return filters[0];
  return and(...filters) as SQL;
}

/**
 * The BOQ-scope predicate shared by boq_group / boq_item / cbs reads: it filters
 * the JOINED boq_doc columns (project_id + the specific doc id) that every
 * selectThrough chain in this file passes through. The tenant company_id is
 * AND-ed automatically by selectThrough on the project root.
 */
function boqScope(ctx: ReportCtx): SQL | undefined {
  const filters: SQL[] = [];
  if (ctx.projectId) filters.push(eq(boqDocs.projectId, ctx.projectId));
  if (ctx.boqId) filters.push(eq(boqDocs.id, ctx.boqId));
  return allOf(filters);
}

/** boq_group rows scoped doc → project, filtered to the request's BOQ scope. */
function groupsScoped(db: TenantDb, ctx: ReportCtx) {
  return db.selectThrough(
    boqGroups,
    [
      { fk: boqGroups.boqId, parent: boqDocs },
      { fk: boqDocs.projectId, parent: projects },
    ],
    boqScope(ctx),
  ) as Promise<GroupRow[]>;
}

/** boq_item rows scoped group → doc → project, filtered to the request's BOQ scope. */
function itemsScoped(db: TenantDb, ctx: ReportCtx) {
  return db.selectThrough(
    boqItems,
    [
      { fk: boqItems.groupId, parent: boqGroups },
      { fk: boqGroups.boqId, parent: boqDocs },
      { fk: boqDocs.projectId, parent: projects },
    ],
    boqScope(ctx),
  ) as Promise<ItemRow[]>;
}

// ---------------------------------------------------------------------------
// 1. GET /boq/reports/cost-type — RPT-003 Material/Subcon/Labor by work category
// ---------------------------------------------------------------------------
// Real source: boq_item.cat is the REAL M/L/S discriminator (data-dictionary
// "cat: M วัสดุ | L ค่าแรง | S เหมา"; schema boqItemCat enum), so the split is
// fully derivable — Material = Σ(qty × price) WHERE cat='M', Subcon = cat='S'
// (schema 'S' = lump-sum/เหมา → mock "Subcon", same column), Labor = cat='L' —
// grouped per boq_group. NO fabrication and NO honest-0 gap here: every cell is
// a live sum. Rows cover only groups that have ≥1 item (the mock drops empty
// groups). ratio percentages are integer-rounded from the real grand total; when
// grand=0 the ratio is all-null (honest — no ratio without spend).
async function costType(db: TenantDb, ctx: ReportCtx): Promise<Result> {
  const [groups, items] = await Promise.all([
    groupsScoped(db, ctx),
    itemsScoped(db, ctx),
  ]);
  const nameByGroup = new Map(groups.map((g) => [g.id, g.name]));

  // Accumulate M/S/L per group from the real cat column.
  interface Acc {
    material: number;
    subcon: number;
    labor: number;
    currency: string | null;
  }
  const byGroup = new Map<string, Acc>();
  for (const it of items) {
    const amount = num(it.qty) * num(it.price);
    const acc = byGroup.get(it.groupId) ?? {
      material: 0,
      subcon: 0,
      labor: 0,
      currency: it.currencyCode ?? null,
    };
    if (it.cat === "M") acc.material += amount;
    else if (it.cat === "S") acc.subcon += amount;
    else if (it.cat === "L") acc.labor += amount;
    byGroup.set(it.groupId, acc);
  }

  const rows = [...byGroup.entries()].map(([groupId, acc]) => {
    const total = acc.material + acc.subcon + acc.labor;
    return {
      group_id: groupId,
      category_label: nameByGroup.get(groupId) ?? null,
      material: round2(acc.material),
      subcon: round2(acc.subcon),
      labor: round2(acc.labor),
      total: round2(total),
      currency_code: acc.currency ?? "THB",
    };
  });

  const tM = rows.reduce((s, r) => s + r.material, 0);
  const tS = rows.reduce((s, r) => s + r.subcon, 0);
  const tL = rows.reduce((s, r) => s + r.labor, 0);
  const grand = tM + tS + tL;

  return {
    status: 200,
    body: {
      rows,
      totals: {
        material: round2(tM),
        subcon: round2(tS),
        labor: round2(tL),
        grand: round2(grand),
      },
      // Integer percentages from the real grand total; honest-null when grand=0.
      ratio:
        grand > 0
          ? {
              material_pct: Math.round((100 * tM) / grand),
              subcon_pct: Math.round((100 * tS) / grand),
              labor_pct: Math.round((100 * tL) / grand),
            }
          : { material_pct: null, subcon_pct: null, labor_pct: null },
      currency_code: "THB",
    },
  };
}

// ---------------------------------------------------------------------------
// 2. GET /boq/reports/boq-vs-nonboq — RPT-001 BOQ vs Non-BOQ cost (Wei D1)
// ---------------------------------------------------------------------------
// The mock's `boq` column is the planned in-BOQ value ("BOQ (ตามแผน)",
// boq.jsx:1725) and `non_boq` the over-plan spend. Under Wei ruling B-101 D1 (=ค):
//   - `boq` per work-category group = the BOQ PLAN = Σ(boq_item.qty × price) in
//     that group (recon §1.1 — pure aggregation, matches the "ตามแผน" label).
//   - Non-BOQ = pr_item rows with boq_item_id IS NULL (unattributable to any
//     group). A pr_item WITH a boq_item_id is BOQ-attributed — it belongs to its
//     item's group (already inside the plan) and is NOT counted as Non-BOQ.
//   - Because Non-BOQ lines are unattributable to a group, they aggregate into a
//     SINGLE synthetic row (group_id null, category_label null — no fabricated
//     category), exactly as the contract shape specifies.
//
// DATA GAP (C10, PLAN.md §0 rule 4): a Non-BOQ pr_item references NO boq_item, and
// pr_item carries no price/amount column of its own (schema: id, pr_id,
// boq_item_id, qty). Its monetary value is therefore NOT derivable — exactly the
// gap dashboard.ts approvalsInbox hits (`if (!px) continue`). So the synthetic
// row's non_boq is an HONEST 0 (NOT the mock's fabricated +880,000); the row is
// emitted only to surface the PRESENCE of unattributed lines, never to invent
// their cost. pct_over is round(non_boq/boq×100), null when boq=0.
//
// Tenant scope: pr_item has no company_id column → it is read THROUGH the PR door
// (pr → project), so company_id anchors on the project root. from/to filter the
// PR's created_at (string dates) IN the WHERE; category filters group rows by
// exact label match.
async function boqVsNonboq(db: TenantDb, ctx: ReportCtx): Promise<Result> {
  const prFilters: SQL[] = [];
  if (ctx.projectId) prFilters.push(eq(prs.projectId, ctx.projectId));
  if (ctx.from) prFilters.push(gte(prs.createdAt, ctx.from));
  if (ctx.to) prFilters.push(lte(prs.createdAt, ctx.to));

  const [groups, items, prLines] = await Promise.all([
    groupsScoped(db, ctx),
    itemsScoped(db, ctx),
    // pr_item scoped pr → project; date/project filters ride on the joined pr row.
    // Loaded to classify Non-BOQ (boq_item_id NULL) lines for the synthetic row.
    db.selectThrough(
      prItems,
      [
        { fk: prItems.prId, parent: prs },
        { fk: prs.projectId, parent: projects },
      ],
      allOf(prFilters),
    ) as Promise<PrItemRow[]>,
  ]);

  const nameByGroup = new Map(groups.map((g) => [g.id, g.name]));

  // BOQ PLAN per group = Σ(boq_item.qty × price) — the real "ตามแผน" value.
  const planByGroup = new Map<string, number>();
  for (const g of groups) planByGroup.set(g.id, 0);
  for (const it of items) {
    planByGroup.set(
      it.groupId,
      (planByGroup.get(it.groupId) ?? 0) + num(it.qty) * num(it.price),
    );
  }

  // Non-BOQ = pr_items with boq_item_id NULL (BOQ-attributed lines are within the
  // plan and never counted here). Their monetary cost is unpriceable (DATA GAP).
  let nonBoqCount = 0;
  const nonBoqSum = 0; // honest 0 — non-BOQ pr_items are unpriceable (see DATA GAP).
  for (const line of prLines) {
    if (line.boqItemId == null) nonBoqCount += 1;
  }

  interface Row {
    group_id: string | null;
    category_label: string | null;
    boq: number;
    non_boq: number;
    total_actual: number;
    pct_over: number | null;
  }
  let rows: Row[] = groups.map((g) => {
    const boq = round2(planByGroup.get(g.id) ?? 0);
    return {
      group_id: g.id,
      category_label: nameByGroup.get(g.id) ?? null,
      boq,
      non_boq: 0, // group rows never carry Non-BOQ (it is unattributable).
      total_actual: boq,
      pct_over: boq > 0 ? 0 : null,
    };
  });

  // Exact-match category filter on the work-category label (drops the synthetic
  // Non-BOQ row too — it has no category).
  if (ctx.category) {
    rows = rows.filter((r) => r.category_label === ctx.category);
  } else if (nonBoqCount > 0) {
    const nonBoq = round2(nonBoqSum);
    rows.push({
      group_id: null,
      category_label: null,
      boq: 0,
      non_boq: nonBoq,
      total_actual: nonBoq,
      pct_over: null, // boq=0 → no ratio.
    });
  }

  const totBoq = round2(rows.reduce((s, r) => s + r.boq, 0));
  const totNonBoq = round2(rows.reduce((s, r) => s + r.non_boq, 0));
  return {
    status: 200,
    body: {
      rows,
      totals: {
        boq: totBoq,
        non_boq: totNonBoq,
        total_actual: round2(totBoq + totNonBoq),
        pct_over: totBoq > 0 ? Math.round((100 * totNonBoq) / totBoq) : null,
      },
      currency_code: "THB",
    },
  };
}

/** Parse ?project_id / ?boq_id (uuid scope params); null when absent/blank. */
function parseUuid(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length > 0 ? s : null;
}

/** Parse a ?from / ?to string date; null when absent/blank/unparseable. */
function parseDate(raw: unknown): Date | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s.length === 0) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse ?category exact-match label filter; null when absent/blank. */
function parseCategory(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length > 0 ? s : null;
}

/** Register the 2 GET /boq/reports/* routes on the /api/v1-prefixed scope. */
export function registerBoqReportsRoute(app: FastifyInstance): void {
  const withTenant =
    (run: (db: TenantDb, ctx: ReportCtx) => Promise<Result>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      const q = (request.query ?? {}) as {
        project_id?: unknown;
        boq_id?: unknown;
        from?: unknown;
        to?: unknown;
        category?: unknown;
      };
      const ctx: ReportCtx = {
        projectId: parseUuid(q.project_id),
        boqId: parseUuid(q.boq_id),
        from: parseDate(q.from),
        to: parseDate(q.to),
        category: parseCategory(q.category),
      };
      const result = await run(db, ctx);
      return reply.code(result.status).send(result.body);
    };

  app.get("/boq/reports/cost-type", withTenant(costType));
  app.get("/boq/reports/boq-vs-nonboq", withTenant(boqVsNonboq));
}
