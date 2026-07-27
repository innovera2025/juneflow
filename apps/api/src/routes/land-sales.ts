// Land / Sales handlers — Program-3 Wave-0 (land + sales read surface). Wires the
// land.jsx / sales.jsx registers: list the tenant's sales leads and land plots.
// The schema (extensions.ts lead, misc.ts land_plot) and the contract paths
// (openapi.yaml — the two opaque EntityList GETs, declared) ALL pre-exist. This
// file wires the reads and is registered in app.ts (registerLandSalesRoute) by the
// orchestrator; the route was previously UNMOUNTED.
//
// Contract (openapi.yaml — declared opaque):
//   GET /sales/leads → EntityList  — sales leads   (listSalesLeads)
//   GET /land/plots  → EntityList  — land plots     (listLandPlots)
// Each row is the opaque Entity (snake_case wire of the REAL columns). Reads on an
// opaque endpoint need no contract change (FLOW-A opaque-Entity finding).
//
// Tenant scope (fail closed): lead + land_plot both carry company_id → the scoped
// TenantDb.select() door is company-scoped by construction (no cross-tenant leak).
// Reads need only a resolved tenant (no perm gate), mirroring the sibling master-
// data GETs; without one, request.db is absent and every handler answers flat 401.
//
// Wave-0 is READ-ONLY: writes + the AR/sale posting flow are deferred pending the
// B-144/B-145 rulings — NOT here.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { leads } from "@juneflow/db/schema";
import { landPlots } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";

type LeadRow = typeof leads.$inferSelect;
type LandPlotRow = typeof landPlots.$inferSelect;

/** Flat 401 (fail closed) when no tenant was resolved onto the request. */
function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Coerce a drizzle numeric (string) / number / null to a finite number, else null. */
function num(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// GET /sales/leads — the sales lead register (sales.jsx). Wire = REAL columns.
// Ordered newest-first (created_at desc). hot flags a priority lead.
function leadWire(l: LeadRow): Record<string, unknown> {
  return {
    id: l.id,
    name: l.name,
    phone: l.phone,
    source: l.source,
    interest: l.interest,
    stage: l.stage, // 5-stage CRM funnel (lead/visit/quote/booking/contract) — the kanban axis
    hot: l.hot,
    last_contact_at: l.lastContactAt,
    note: l.note,
    owner_user_id: l.ownerUserId,
    days: l.days,
    created_at: l.createdAt,
  };
}

// GET /land/plots — the land-plot register (land.jsx). price_per_rai is money →
// currency_code. area_sqm is the plot area. Ordered newest-first.
function plotWire(p: LandPlotRow): Record<string, unknown> {
  return {
    id: p.id,
    project_id: p.projectId,
    deed_no: p.deedNo,
    area_sqm: num(p.areaSqm),
    gps: p.gps,
    price_per_rai: num(p.pricePerRai),
    currency_code: p.currencyCode,
    stage: p.stage,
    tenure: p.tenure,
    created_at: p.createdAt,
  };
}

function byCreatedDesc(a: { createdAt: Date | null }, b: { createdAt: Date | null }): number {
  const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return bt - at;
}

async function listLeads(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(leads)) as LeadRow[];
  return [...rows].sort(byCreatedDesc).map(leadWire);
}

async function listPlots(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(landPlots)) as LandPlotRow[];
  return [...rows].sort(byCreatedDesc).map(plotWire);
}

/** Register the land/sales read routes on the given (/api/v1-prefixed) scope. */
export function registerLandSalesRoute(app: FastifyInstance): void {
  const withTenantList =
    (run: (db: TenantDb) => Promise<Record<string, unknown>[]>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      return reply.code(200).send(listEnvelope(await run(db)));
    };

  app.get("/sales/leads", withTenantList(listLeads));
  app.get("/land/plots", withTenantList(listPlots));
}
