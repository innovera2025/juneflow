// apps/api/src/routes/solar.ts
// Solar Wave-0 read-only op-groups (B-174) + Wave-1a workflow writes (B-212/B-215).
// Tenant-scoped, Entity-opaque over the 6 EXISTING solar tables. Reads: money-free
// (ppa/roi surface money values on read like plotWire, no JV). Wave-1a writes:
// O&M create+close · permit add · warranty add — ALL money=NONE (no JV/cost, Wei
// B-212). No migration (all fields exist; status = text). PPA (money=AR) is Wave-1b.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, ne } from "drizzle-orm";
import {
  ppaInvoices, // ppa_invoice
  projects,
  solarInverters, // solar_inverter
  solarOmTickets, // solar_om_ticket
  solarPermitSteps, // solar_permit_step
  solarRois, // solar_roi
  solarWarranties, // solar_warranty
  users,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";
import { pick, str, toNum } from "./procurement.js";

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

/** Flat 400 BAD_REQUEST (client-input error). */
function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ code: "BAD_REQUEST", message });
}

/** Flat 404 NOT_FOUND (opaque; a foreign FK or an unknown id). */
function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ code: "NOT_FOUND", message });
}

/** Flat 409 INVALID_STATE (idempotent already-in-target-state). */
function conflict(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(409).send({ code: "INVALID_STATE", message });
}

/**
 * Server-generated running O&M number OM-<CE-year>-<NNNN> (§0 rule-3: the mock's
 * "OM-2026-019" is a mock literal — never copied). Mirrors allocJvNo: one past the
 * max numeric suffix among this tenant's OM numbers for the year prefix. A display
 * running number (like jv.no) — not an idempotency key, so no unique constraint.
 */
async function allocOmNo(db: TenantDb): Promise<string> {
  const rows = (await db.select(solarOmTickets)) as SolarOmTicketRow[];
  const year = new Date().getFullYear();
  const prefix = `OM-${year}-`;
  let max = 0;
  for (const r of rows) {
    const no = r.no ?? "";
    if (!no.startsWith(prefix)) continue;
    const m = /-(\d+)$/.exec(no);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
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
    team: r.team,
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
    years: r.years,
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

// --- Wave-1a workflow writes (B-212/B-215 · money=NONE · tenant-scoped) -------
// Every insert goes through the TenantDb door (force-sets company_id · a client
// id/company_id is never trusted). Optional FK links are validated in-tenant → 404
// (never a raw 23503/500, never a cross-tenant reference). NO JV/cost posted.

/** POST /solar/om-tickets — open an O&M ticket (server-gen running no · status=open). */
async function createSolarOmTicket(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const title = str(pick(body, "title")).trim();
  if (!title) return badRequest(reply, "title is required");
  const inverterId = str(pick(body, "inverter_id", "inverterId")).trim() || null;
  if (inverterId) {
    const [inv] = (await db.select(solarInverters, eq(solarInverters.id, inverterId))) as SolarInverterRow[];
    if (!inv) return notFound(reply, `inverter ${inverterId} not found`);
  }
  const assigneeUserId = str(pick(body, "assignee_user_id", "assigneeUserId")).trim() || null;
  if (assigneeUserId) {
    const [u] = (await db.select(users, eq(users.id, assigneeUserId))) as (typeof users.$inferSelect)[];
    if (!u) return notFound(reply, `user ${assigneeUserId} not found`);
  }
  const no = await allocOmNo(db); // server-generated running number (§0 rule-3)
  const [created] = (await db
    .insert(solarOmTickets, {
      no,
      inverterId,
      title,
      priority: str(pick(body, "priority")).trim() || null,
      assigneeUserId,
      team: str(pick(body, "team")).trim() || null, // B-223: responsible O&M team (RF2OMForm)
      status: "open", // initial state — server-set (the mock create form has no status field; close moves it to 'closed')
    })
    .returning()) as SolarOmTicketRow[];
  return reply.code(201).send(omTicketWire(created));
}

/** POST /solar/om-tickets/{id}/close — idempotent close. */
async function closeSolarOmTicket(
  db: TenantDb,
  id: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [ticket] = (await db.select(solarOmTickets, eq(solarOmTickets.id, id))) as SolarOmTicketRow[];
  if (!ticket) return notFound(reply, `O&M ticket ${id} not found`);
  if (ticket.status === "closed") return conflict(reply, "O&M ticket is already closed");
  // Atomic guard on the FINAL update (verify-chain-atomicity lesson): a concurrent
  // close between the read and here re-matches status != 'closed' → 0 rows → 409.
  const updated = (await db
    .update(
      solarOmTickets,
      { status: "closed" },
      and(eq(solarOmTickets.id, id), ne(solarOmTickets.status, "closed")),
    )
    .returning()) as SolarOmTicketRow[];
  if (updated.length === 0) return conflict(reply, "O&M ticket is already closed");
  return reply.code(200).send(omTicketWire(updated[0]!));
}

/** POST /solar/permit-steps — add a permit step (status default 'pending'). */
async function createSolarPermitStep(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const name = str(pick(body, "name")).trim();
  if (!name) return badRequest(reply, "name is required");
  const projectId = str(pick(body, "project_id", "projectId")).trim() || null;
  if (projectId) {
    const [p] = (await db.select(projects, eq(projects.id, projectId))) as (typeof projects.$inferSelect)[];
    if (!p) return notFound(reply, `project ${projectId} not found`);
  }
  const [created] = (await db
    .insert(solarPermitSteps, {
      projectId,
      name,
      org: str(pick(body, "org")).trim() || null,
      status: "pending", // initial state — server-set (the mock add form has no status field; no advance-step, B-212)
      stepDate: str(pick(body, "step_date", "stepDate")).trim() || null,
    })
    .returning()) as SolarPermitStepRow[];
  return reply.code(201).send(permitStepWire(created));
}

/** POST /solar/warranties — add a warranty registry item (status default 'active'). */
async function createSolarWarranty(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const item = str(pick(body, "item")).trim();
  if (!item) return badRequest(reply, "item is required");
  const projectId = str(pick(body, "project_id", "projectId")).trim() || null;
  if (projectId) {
    const [p] = (await db.select(projects, eq(projects.id, projectId))) as (typeof projects.$inferSelect)[];
    if (!p) return notFound(reply, `project ${projectId} not found`);
  }
  const qtyRaw = toNum(pick(body, "qty"));
  const yearsRaw = toNum(pick(body, "years")); // B-219: product-warranty duration (years)
  const [created] = (await db
    .insert(solarWarranties, {
      projectId,
      item,
      brand: str(pick(body, "brand")).trim() || null,
      qty: qtyRaw == null ? null : Math.trunc(qtyRaw),
      years: yearsRaw == null ? null : Math.trunc(yearsRaw),
      perf: str(pick(body, "perf")).trim() || null,
      prodDate: str(pick(body, "prod_date", "prodDate")).trim() || null,
      expiryDate: str(pick(body, "expiry_date", "expiryDate")).trim() || null,
      status: "active", // initial state — server-set (the mock add form has no status field)
    })
    .returning()) as SolarWarrantyRow[];
  return reply.code(201).send(warrantyWire(created));
}

/** Register the read-only + Wave-1a write solar routes on the (/api/v1-prefixed) scope. */
export function registerSolarRoute(app: FastifyInstance): void {
  const withTenantList =
    (run: (db: TenantDb) => Promise<Record<string, unknown>[]>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      return reply.code(200).send(listEnvelope(await run(db)));
    };

  const body = (request: FastifyRequest): Record<string, unknown> =>
    (request.body ?? {}) as Record<string, unknown>;
  const idParam = (request: FastifyRequest): string =>
    (request.params as { id?: string }).id ?? "";

  // --- reads (tenant-scope is the complete guard; money-free, R1=read-only) --
  app.get("/solar/inverters", withTenantList(listInverters)); // monitor
  app.get("/solar/om-tickets", withTenantList(listOmTickets)); // monitor
  app.get("/solar/ppa-invoices", withTenantList(listPpaInvoices)); // ppa
  app.get("/solar/roi", withTenantList(listRoi)); // roi
  app.get("/solar/permit-steps", withTenantList(listPermitSteps)); // permit
  app.get("/solar/warranties", withTenantList(listWarranties)); // warranty

  // --- Wave-1a workflow writes (B-212/B-215 · money=NONE) -------------------
  app.post("/solar/om-tickets", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createSolarOmTicket(db, body(request), reply);
  });
  app.post("/solar/om-tickets/:id/close", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return closeSolarOmTicket(db, idParam(request), reply);
  });
  app.post("/solar/permit-steps", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createSolarPermitStep(db, body(request), reply);
  });
  app.post("/solar/warranties", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createSolarWarranty(db, body(request), reply);
  });
}
