// apps/api/src/routes/solar.ts
// Solar Wave-0 read-only op-groups (B-174). Tenant-scoped, Entity-opaque list
// GETs over the 6 EXISTING solar tables. NO writes, NO money-posting. Mirrors
// the land-sales.ts read pattern verbatim. R1 = read-only (Wei). ppa/roi surface
// money values + currency_code on read (like plotWire.price_per_rai) — no JV.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ppaInvoices, // ppa_invoice
  solarInverters, // solar_inverter
  solarOmTickets, // solar_om_ticket
  solarPermitSteps, // solar_permit_step
  solarRois, // solar_roi
  solarWarranties, // solar_warranty
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";

type SolarInverterRow = typeof solarInverters.$inferSelect;
type SolarOmTicketRow = typeof solarOmTickets.$inferSelect;
type PpaInvoiceRow = typeof ppaInvoices.$inferSelect;
type SolarRoiRow = typeof solarRois.$inferSelect;
type SolarPermitStepRow = typeof solarPermitSteps.$inferSelect;
type SolarWarrantyRow = typeof solarWarranties.$inferSelect;

// --- helpers (mirror land-sales.ts) ----------------------------------------
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

function byCreatedDesc(
  a: { createdAt: Date | null },
  b: { createdAt: Date | null },
): number {
  const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return bt - at;
}

// --- Entity-opaque wire mappers (snake_case of the REAL columns) ------------

// GET /solar/inverters — inverter telemetry grid (solar.monitor). No money.
function inverterWire(r: SolarInverterRow): Record<string, unknown> {
  return {
    id: r.id,
    project_id: r.projectId,
    zone: r.zone,
    kw: num(r.kw),
    output_kw: num(r.outputKw),
    perf: num(r.perf),
    temp: num(r.temp),
    status: r.status,
    created_at: r.createdAt,
  };
}

// GET /solar/om-tickets — O&M ticket list (solar.monitor). Links to inverter,
// NOT project (inverter_id FK). No money.
function omTicketWire(r: SolarOmTicketRow): Record<string, unknown> {
  return {
    id: r.id,
    inverter_id: r.inverterId,
    no: r.no,
    title: r.title,
    priority: r.priority,
    assignee_user_id: r.assigneeUserId,
    status: r.status,
    created_at: r.createdAt,
  };
}

// GET /solar/ppa-invoices — PPA billing (solar.ppa). amount + rate are money →
// currency_code carried per row (column-currency rule). Read-only, no JV.
function ppaInvoiceWire(r: PpaInvoiceRow): Record<string, unknown> {
  return {
    id: r.id,
    project_id: r.projectId,
    month: r.month,
    mwh: num(r.mwh),
    rate: num(r.rate),
    amount: num(r.amount),
    currency_code: r.currencyCode,
    status: r.status,
    created_at: r.createdAt,
  };
}

// GET /solar/roi — ROI table (solar.roi). revenue/opex/cumulative are money →
// currency_code per row. No status column. Read-only, no JV.
function roiWire(r: SolarRoiRow): Record<string, unknown> {
  return {
    id: r.id,
    project_id: r.projectId,
    year: r.year,
    revenue: num(r.revenue),
    opex: num(r.opex),
    cumulative: num(r.cumulative),
    currency_code: r.currencyCode,
    created_at: r.createdAt,
  };
}

// GET /solar/permit-steps — permit workflow (solar.permit). step_date is a plain
// date. No money.
function permitStepWire(r: SolarPermitStepRow): Record<string, unknown> {
  return {
    id: r.id,
    project_id: r.projectId,
    name: r.name,
    org: r.org,
    status: r.status,
    step_date: r.stepDate,
    created_at: r.createdAt,
  };
}

// GET /solar/warranties — warranty register (solar.warranty). No money.
function warrantyWire(r: SolarWarrantyRow): Record<string, unknown> {
  return {
    id: r.id,
    project_id: r.projectId,
    item: r.item,
    brand: r.brand,
    qty: r.qty,
    perf: num(r.perf),
    prod_date: r.prodDate,
    expiry_date: r.expiryDate,
    status: r.status,
    created_at: r.createdAt,
  };
}

// --- list handlers (a single tenant-scoped select + sort + wire map each) ----

async function listInverters(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(solarInverters)) as SolarInverterRow[];
  return [...rows].sort(byCreatedDesc).map(inverterWire);
}

async function listOmTickets(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(solarOmTickets)) as SolarOmTicketRow[];
  return [...rows].sort(byCreatedDesc).map(omTicketWire);
}

async function listPpaInvoices(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(ppaInvoices)) as PpaInvoiceRow[];
  return [...rows].sort(byCreatedDesc).map(ppaInvoiceWire);
}

async function listRoi(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(solarRois)) as SolarRoiRow[];
  return [...rows].sort(byCreatedDesc).map(roiWire);
}

async function listPermitSteps(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(solarPermitSteps)) as SolarPermitStepRow[];
  return [...rows].sort(byCreatedDesc).map(permitStepWire);
}

async function listWarranties(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(solarWarranties)) as SolarWarrantyRow[];
  return [...rows].sort(byCreatedDesc).map(warrantyWire);
}

/** Register the read-only solar routes on the given (/api/v1-prefixed) scope. */
export function registerSolarRoute(app: FastifyInstance): void {
  const withTenantList =
    (run: (db: TenantDb) => Promise<Record<string, unknown>[]>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      return reply.code(200).send(listEnvelope(await run(db)));
    };

  // --- reads (tenant-scope is the complete guard; money-free, R1=read-only) --
  app.get("/solar/inverters", withTenantList(listInverters)); // monitor
  app.get("/solar/om-tickets", withTenantList(listOmTickets)); // monitor
  app.get("/solar/ppa-invoices", withTenantList(listPpaInvoices)); // ppa
  app.get("/solar/roi", withTenantList(listRoi)); // roi
  app.get("/solar/permit-steps", withTenantList(listPermitSteps)); // permit
  app.get("/solar/warranties", withTenantList(listWarranties)); // warranty
}
