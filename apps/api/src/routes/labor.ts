// Labor handlers — Program-2 Op-Core Wave-0 (labor read surface). Wires the
// labor.jsx Worker / Attendance / Payroll registers: list the tenant's workers,
// their daily attendance, and their payroll runs. The schema (finance.ts worker /
// attendance / payroll — Worker → Attendance → Payroll labor-cost chain) and the
// contract paths (openapi.yaml §finance — the three opaque EntityList GETs,
// declared) ALL pre-exist. This file wires the reads and is registered in app.ts
// (registerLaborRoute) by the orchestrator; the route was previously UNMOUNTED.
//
// Contract (openapi.yaml §finance):
//   GET /labor/workers      → EntityList  — workers        (listLaborWorkers)
//   GET /labor/attendance   → EntityList  — attendance     (listLaborAttendance)
//   GET /labor/payroll      → EntityList  — payroll runs   (listLaborPayroll)
// Each row is the opaque Entity (snake_case wire of the REAL columns). Reads on an
// opaque endpoint need no contract change (FLOW-A opaque-Entity finding).
//
// Tenant scope (fail closed): worker / attendance / payroll all carry company_id →
// the scoped TenantDb.select() door is company-scoped by construction (no
// cross-tenant leak). Reads need only a resolved tenant (no perm gate), mirroring
// the sibling master-data GETs; without a resolved tenant, request.db is absent
// and every handler answers a flat 401.
//
// Wave-0 is READ-ONLY: the create ops (createLaborWorker/Attendance/Payroll) and
// the payroll → JV posting (B-140) are the post-Wave-0 write/calc slice — NOT here.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { workers, attendances, payrolls } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";

type WorkerRow = typeof workers.$inferSelect;
type AttendanceRow = typeof attendances.$inferSelect;
type PayrollRow = typeof payrolls.$inferSelect;

/** Flat 401 (fail closed) when no tenant was resolved onto the request. */
function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Coerce a drizzle numeric (string) / number / null to a finite number, else 0. */
function num(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Wire serializers (snake_case wire of the REAL columns — C10, no fabrication)
// ---------------------------------------------------------------------------

// GET /labor/workers — labor master (labor.jsx WORKERS_SEED). day_rate is money →
// currency_code. Ordered by name (the register's deterministic worker list).
function workerWire(w: WorkerRow): Record<string, unknown> {
  return {
    id: w.id,
    name: w.name,
    day_rate: w.dayRate != null ? num(w.dayRate) : null,
    currency_code: w.currencyCode,
    created_at: w.createdAt,
  };
}

// GET /labor/attendance — a worker's daily time record. ot in hours; cc_id charges
// the day to a cost center. Ordered newest-first (day desc).
function attendanceWire(a: AttendanceRow): Record<string, unknown> {
  return {
    id: a.id,
    worker_id: a.workerId,
    day: a.day,
    ot: num(a.ot),
    cc_id: a.ccId,
    created_at: a.createdAt,
  };
}

// GET /labor/payroll — a worker's payout for a period. amount is money →
// currency_code; period is a 'YYYY-MM' key. Ordered newest-first (created_at desc).
function payrollWire(p: PayrollRow): Record<string, unknown> {
  return {
    id: p.id,
    worker_id: p.workerId,
    period: p.period,
    amount: num(p.amount),
    currency_code: p.currencyCode,
    cc_id: p.ccId,
    created_at: p.createdAt,
  };
}

async function listWorkers(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(workers)) as WorkerRow[];
  return [...rows]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(workerWire);
}

async function listAttendance(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(attendances)) as AttendanceRow[];
  return [...rows]
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .map(attendanceWire);
}

async function listPayroll(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(payrolls)) as PayrollRow[];
  return [...rows]
    .sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    })
    .map(payrollWire);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the labor read routes on the given (/api/v1-prefixed) scope. */
export function registerLaborRoute(app: FastifyInstance): void {
  const withTenantList =
    (run: (db: TenantDb) => Promise<Record<string, unknown>[]>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      return reply.code(200).send(listEnvelope(await run(db)));
    };

  app.get("/labor/workers", withTenantList(listWorkers));
  app.get("/labor/attendance", withTenantList(listAttendance));
  app.get("/labor/payroll", withTenantList(listPayroll));
}
