// Sales / After-Sales Service handlers — Program-3 SV-1 (sales-service.jsx
// AfterSalesService). The SACRED openapi round (7 ops) is already declared by the
// orchestrator (B-159); this file is handlers + wiring only (NO openapi / generated
// type / migration / schema / seed edits).
//
// Contract (openapi.yaml — opaque Entity; every row/body is the snake_case wire of
// the REAL service_ticket columns, no hand-written model):
//   GET  /sales/service                  → EntityList    — the ticket register
//   GET  /sales/service/:id              → EntityOk      — one ticket detail (404)
//   POST /sales/service                  → EntityCreated — receive + assign a ticket
//   POST /sales/service/:id/schedule     → ActionOk      — received  → scheduled
//   POST /sales/service/:id/start        → ActionOk      — scheduled → fixing
//   POST /sales/service/:id/fix          → ActionOk      — fixing    → fixed
//   POST /sales/service/:id/close        → ActionOk      — fixed     → closed (terminal)
//
// MONEY = NONE (SV-1): a service ticket posts no money — service_ticket has no money
// column, and the prototype's "ราคาประเมิน" is free text in a non-persisted progress
// note. So NONE of these handlers finance-gate; they gate on the resolved tenant only
// (a flat 401 when request.db is absent, mirroring land-sales.ts's Wave-0 reads).
//
// STATUS MACHINE (SV-3 · action-ops-not-PUT · B-149 optimistic guard): the ONLY
// status path is received →[schedule]→ scheduled →[start]→ fixing →[fix]→ fixed
// →[close]→ closed. Each action is valid ONLY from its immediate predecessor. Every
// flip folds the predecessor state into the UPDATE WHERE (never a read-then-write for
// the write decision), so a concurrent flip matches 0 rows → 409. A scoped
// existence-select runs first to distinguish a 404 (not in this tenant) from a 409
// (wrong / already-advanced state) — mirrors inventory.ts approveStockTransfer.
//
// WARRANTY = DERIVED, NOT STORED (SV-2): warranty_months_remaining is computed at
// read time = max(0, 12 − months_elapsed_since(transfer_at)), where transfer_at comes
// from the sold unit's sales_unit row (service_ticket.unit_id === sales_unit.unit_id,
// both FK project_node, within the tenant). No transfer_at / no sales_unit → null
// (honest "—", not an error). The existing service_ticket.warranty boolean stays a
// covered/expired flag and is serialized as-is; no warranty column is added.
//
// Tenant scope (fail closed): service_ticket + sales_unit both carry company_id → the
// scoped TenantDb.select()/insert()/update() doors. Without a resolved tenant,
// request.db is absent and every handler answers a flat 401.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { salesUnits, serviceTickets } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { pick, str } from "./procurement.js";
import { listEnvelope } from "./list-envelope.js";
import { byNewestThenId } from "./list-order.js";

type ServiceTicketRow = typeof serviceTickets.$inferSelect;
type SalesUnitRow = typeof salesUnits.$inferSelect;
/** Update payload for service_ticket, company_id excluded (the door force-binds it). */
type TicketUpdate = Partial<Omit<typeof serviceTickets.$inferInsert, "companyId">>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A new-home warranty runs 12 months from the ownership-transfer date (SV-2). */
const WARRANTY_MONTHS = 12;

/** The linear service-ticket status machine (SV-3). `received` is the create start
 *  state; `closed` is terminal. Each action moves predecessor → next only. */
const RECEIVED = "received";
const SCHEDULED = "scheduled";
const FIXING = "fixing";
const FIXED = "fixed";
const CLOSED = "closed";

// ---------------------------------------------------------------------------
// Reply helpers (flat contract Error shape {code,message})
// ---------------------------------------------------------------------------

/** Flat 401 (fail closed) when no tenant was resolved onto the request. */
function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Flat 400 VALIDATION error. */
function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ code: "VALIDATION", message });
}

/** Flat 404 NOT_FOUND error. */
function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ code: "NOT_FOUND", message });
}

/** Flat 409 INVALID_STATE error. */
function conflict(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(409).send({ code: "INVALID_STATE", message });
}

// ---------------------------------------------------------------------------
// SV-2 warranty derivation (read-time, never stored)
// ---------------------------------------------------------------------------

/**
 * warranty_months_remaining = max(0, 12 − months_elapsed_since(transfer_at)). UTC
 * getters keep the month arithmetic deterministic regardless of the server timezone
 * (transfer_at is a plain `YYYY-MM-DD` date). A null/unparseable transfer_at → null.
 */
function warrantyRemaining(transferAt: string | null): number | null {
  if (!transferAt) return null;
  const transfer = new Date(transferAt);
  if (Number.isNaN(transfer.getTime())) return null;
  const now = new Date();
  let elapsed =
    (now.getUTCFullYear() - transfer.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - transfer.getUTCMonth());
  // Not yet a full month into the current month → drop the partial month.
  if (now.getUTCDate() < transfer.getUTCDate()) elapsed -= 1;
  if (elapsed < 0) elapsed = 0;
  return Math.max(0, WARRANTY_MONTHS - elapsed);
}

/**
 * Map each sold unit (sales_unit.unit_id) → its transfer_at, for the list read's
 * warranty derivation in ONE scoped fetch (no per-ticket N+1). When two sales_unit
 * rows share a unit_id, a non-null transfer_at wins.
 */
function transferByUnit(units: readonly SalesUnitRow[]): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const u of units) {
    if (!u.unitId) continue;
    const existing = m.get(u.unitId);
    if (!m.has(u.unitId) || (existing == null && u.transferAt != null)) {
      m.set(u.unitId, u.transferAt ?? null);
    }
  }
  return m;
}

/** The sold unit's transfer_at for a single ticket (scoped lookup — detail/create). */
async function transferAtForUnit(db: TenantDb, unitId: string | null): Promise<string | null> {
  if (!unitId) return null;
  const units = (await db.select(salesUnits, eq(salesUnits.unitId, unitId))) as SalesUnitRow[];
  const withTransfer = units.find((u) => u.transferAt != null) ?? units[0];
  return withTransfer?.transferAt ?? null;
}

// ---------------------------------------------------------------------------
// Wire serializer (snake_case wire of the REAL columns + derived warranty)
// ---------------------------------------------------------------------------

function ticketWire(
  t: ServiceTicketRow,
  warrantyMonthsRemaining: number | null,
): Record<string, unknown> {
  return {
    id: t.id,
    no: t.no,
    unit_id: t.unitId,
    customer_id: t.customerId,
    channel: t.channel,
    category: t.category,
    title: t.title,
    priority: t.priority,
    status: t.status,
    assignee_user_id: t.assigneeUserId,
    opened_date: t.openedDate,
    scheduled_date: t.scheduledDate,
    warranty: t.warranty, // the covered/expired boolean flag (SV-2)
    warranty_months_remaining: warrantyMonthsRemaining, // derived, read-time (SV-2)
    created_at: t.createdAt,
  };
}

/** Newest-first, matching the sibling land/sales reads (created_at desc). */
type CreatedRow = { createdAt: Date | null; id?: string };
function byCreatedDesc(a: CreatedRow, b: CreatedRow): number {
  // B-323: delegates to the shared TOTAL order — the local version returned 0 for
  // any two rows sharing an instant, which left their order to the DB.
  return byNewestThenId(a, b);
}

// ---------------------------------------------------------------------------
// Doc-number allocator — SR-<year>-<NNNN> (mirror inventory.ts allocTransferNo /
// gl-post.ts allocJvNo; tenant-scoped, one past the tenant's max SR suffix).
// ---------------------------------------------------------------------------

async function allocServiceNo(db: TenantDb): Promise<string> {
  const rows = (await db.select(serviceTickets)) as ServiceTicketRow[];
  const prefix = `SR-${new Date().getFullYear()}-`;
  let max = 0;
  for (const r of rows) {
    const no = r.no ?? "";
    if (!no.startsWith(prefix)) continue;
    const m = /-(\d+)$/.exec(no);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// GET /sales/service — the tenant's service-ticket register, newest-first, each row
// the opaque columns + the derived warranty-months-remaining (one sales_unit fetch).
async function listServiceTickets(db: TenantDb): Promise<Record<string, unknown>[]> {
  const [tickets, units] = await Promise.all([
    db.select(serviceTickets) as Promise<ServiceTicketRow[]>,
    db.select(salesUnits) as Promise<SalesUnitRow[]>,
  ]);
  const transfers = transferByUnit(units);
  return [...tickets].sort(byCreatedDesc).map((t) => {
    const transferAt = t.unitId ? transfers.get(t.unitId) ?? null : null;
    return ticketWire(t, warrantyRemaining(transferAt));
  });
}

// GET /sales/service/:id — one ticket (404 if not in this tenant) + derived warranty.
async function getServiceTicket(
  db: TenantDb,
  id: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [ticket] = (await db.select(serviceTickets, eq(serviceTickets.id, id))) as ServiceTicketRow[];
  if (!ticket) return notFound(reply, `service ticket ${id} not found`);
  const transferAt = await transferAtForUnit(db, ticket.unitId);
  return reply.code(200).send(ticketWire(ticket, warrantyRemaining(transferAt)));
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

// POST /sales/service — receive + assign a ticket (NewTicketForm). title required
// (400 else). status defaults 'received' (the start state); `no` (SR-YYYY-####) is
// server-allocated; opened_date is stamped to today (the intake/received date). The
// `note` field is NOT persisted (no column — free-text progress note per SV-1) and
// warranty months are DERIVED, never a client input. company_id force-set.
async function createServiceTicket(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const title = str(pick(body, "title")).trim();
  if (!title) return badRequest(reply, "title is required");

  const no = await allocServiceNo(db);
  const values: Omit<typeof serviceTickets.$inferInsert, "companyId"> = {
    no,
    title,
    unitId: str(pick(body, "unit_id", "unitId")).trim() || null,
    customerId: str(pick(body, "customer_id", "customerId")).trim() || null,
    channel: str(pick(body, "channel")).trim() || null,
    category: str(pick(body, "category")).trim() || null,
    priority: str(pick(body, "priority")).trim() || null,
    assigneeUserId: str(pick(body, "assignee_user_id", "assigneeUserId")).trim() || null,
    scheduledDate: str(pick(body, "scheduled_date", "scheduledDate")).trim() || null,
    status: RECEIVED,
    openedDate: new Date().toISOString().slice(0, 10),
  };

  const [created] = (await db.insert(serviceTickets, values).returning()) as ServiceTicketRow[];
  const transferAt = await transferAtForUnit(db, created!.unitId);
  return reply.code(201).send(ticketWire(created!, warrantyRemaining(transferAt)));
}

// ---------------------------------------------------------------------------
// Status actions (SV-3 · B-149 optimistic guard)
// ---------------------------------------------------------------------------

/**
 * One linear status flip. A scoped existence-select first distinguishes a 404 (not in
 * this tenant) from a 409 (wrong/already-advanced state). The write then folds the
 * predecessor state into the UPDATE WHERE (the door AND-s company_id), so a concurrent
 * flip that slipped between the read and the write matches 0 rows → 409 (race-safe, no
 * TOCTOU). Any `extra` columns (schedule's assignee/date) are set in the SAME update.
 */
async function transition(
  db: TenantDb,
  id: string,
  predecessor: string,
  next: string,
  extra: TicketUpdate,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [ticket] = (await db.select(serviceTickets, eq(serviceTickets.id, id))) as ServiceTicketRow[];
  if (!ticket) return notFound(reply, `service ticket ${id} not found`);
  if (ticket.status !== predecessor) {
    return conflict(
      reply,
      `service ticket ${id} cannot move to ${next} from status ${ticket.status ?? "—"}`,
    );
  }

  const set: TicketUpdate = { status: next, ...extra };
  const updated = (await db
    .update(
      serviceTickets,
      set,
      and(eq(serviceTickets.id, id), eq(serviceTickets.status, predecessor)),
    )
    .returning()) as ServiceTicketRow[];
  if (updated.length === 0) {
    // A concurrent flip advanced the ticket after the existence-select — no TOCTOU.
    return conflict(reply, `service ticket ${id} is no longer in status ${predecessor}`);
  }
  return reply.code(200).send({ id, status: next });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the sales after-sales-service routes on the /api/v1-prefixed scope. */
export function registerSalesServiceRoute(app: FastifyInstance): void {
  const body = (request: FastifyRequest): Record<string, unknown> =>
    (request.body ?? {}) as Record<string, unknown>;
  const idParam = (request: FastifyRequest): string =>
    (request.params as { id?: string }).id ?? "";

  // --- reads ----------------------------------------------------------------
  app.get("/sales/service", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return reply.code(200).send(listEnvelope(await listServiceTickets(db)));
  });

  app.get("/sales/service/:id", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return getServiceTicket(db, idParam(request), reply);
  });

  // --- create ---------------------------------------------------------------
  app.post("/sales/service", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createServiceTicket(db, body(request), reply);
  });

  // --- status actions (received → scheduled → fixing → fixed → closed) ------
  app.post("/sales/service/:id/schedule", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const b = body(request);
    const extra: TicketUpdate = {};
    const assignee = str(pick(b, "assignee_user_id", "assigneeUserId")).trim();
    if (assignee) extra.assigneeUserId = assignee;
    const scheduled = str(pick(b, "scheduled_date", "scheduledDate")).trim();
    if (scheduled) extra.scheduledDate = scheduled;
    return transition(db, idParam(request), RECEIVED, SCHEDULED, extra, reply);
  });

  app.post("/sales/service/:id/start", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return transition(db, idParam(request), SCHEDULED, FIXING, {}, reply);
  });

  app.post("/sales/service/:id/fix", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return transition(db, idParam(request), FIXING, FIXED, {}, reply);
  });

  // `close` is terminal. An optional {rating?} body is IGNORED — service_ticket has
  // no rating column and this round does NOT invent one (SV-1: derive-not-fabricate).
  app.post("/sales/service/:id/close", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return transition(db, idParam(request), FIXED, CLOSED, {}, reply);
  });
}
