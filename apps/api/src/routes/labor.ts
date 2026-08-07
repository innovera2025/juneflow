// Labor handlers — Program-2 Op-Core (labor read surface + write/calc slice B-140).
// Wires the labor.jsx Worker / Attendance / Payroll registers: list the tenant's
// workers, their daily attendance, and their payroll runs (Wave-0 reads), PLUS the
// create ops and the payroll → JV posting (B-140). The schema (finance.ts worker /
// attendance / payroll — Worker → Attendance → Payroll labor-cost chain, superset
// columns added by migration 0040) and the contract paths (openapi.yaml §finance —
// opaque EntityList/EntityCreated/ActionOk) ALL pre-exist. This file wires the
// handlers and is registered in app.ts (registerLaborRoute) by the orchestrator.
//
// Contract (openapi.yaml §finance — opaque Entity, NO openapi edit this slice):
//   GET  /labor/workers          → EntityList    — workers        (listLaborWorkers)
//   GET  /labor/attendance       → EntityList    — attendance     (listLaborAttendance)
//   GET  /labor/payroll          → EntityList    — payroll runs   (listLaborPayroll)
//   POST /labor/workers          → EntityCreated — add a worker    (createLaborWorker)
//   POST /labor/attendance       → EntityCreated — record a day    (createLaborAttendance)
//   POST /labor/payroll          → EntityCreated — run payroll     (createLaborPayroll)
//   POST /labor/payroll/{id}/post→ ActionOk      — post to the GL   (postLaborPayroll)
// Each row/body is the opaque Entity (snake_case wire of the REAL columns). A
// read/POST on an opaque endpoint needs no contract change (FLOW-A opaque-Entity).
//
// MONEY = SERVER AUTHORITY (gate-4.5 hard rule, B-140 RG-3): a payroll `amount` is
// NEVER a client value — it is COMPUTED server-side by summing, over the worker's
// attendance rows in the period, day_rate × day_fraction + ot × (day_rate/8) × 1.5
// (the 1.5× OT multiplier on the hourly rate = day_rate/8). Likewise
// attendance.day_fraction is SERVER-DERIVED from `status` ({full:1, half:0.5,
// absent:0}), never trusted from the body. The payroll → GL post reads the STORED
// payroll.amount inside the same transaction (never a re-trusted client figure).
//
// DIRECTION (labor-is-WIP): posting a payroll capitalises the labor into
// work-in-progress and pays it from the bank — Dr 1140 งานระหว่างก่อสร้าง (WIP/CIP)
// / Cr 1020 bank = amount, carrying the payroll's cost-center on both legs. 1140 is
// a real COA_SEED code (resolved per-tenant at post time — never invented, C-177).
//
// Tenant scope (fail closed): worker / attendance / payroll all carry company_id →
// the scoped TenantDb.select()/insert() doors bind company_id by construction. A
// supplied worker_id is re-verified against the tenant (scoped select → 400 for a
// foreign id). jv_line hangs off jv (no company_id) → written through insertThrough
// (re-proves this tenant owns the just-created parent jv). cc_id is an optional
// cost-dimension pointer stored as-is (the register wire already emits it raw;
// cost_center scopes through project and is not re-joined here — honest note). A
// read needs only a resolved tenant; without one, request.db is absent → flat 401.
//
// Financial authorization (B-082 F1 lineage): a create is a financial mutation →
// finance.create; posting a payroll LOCKS money to the GL → finance.approve
// (loadCaller/permAllowed) — fail-closed 403 for an unattributable caller or one
// lacking the perm. Reads gate on the resolved tenant only. AuditLog fires
// automatically (middleware) on a 2xx.
//
// HONEST notes (C10 — flagged, never fabricated):
//   - a payroll with no attendance in the period computes amount 0 (honest, not an
//     error) — the register then simply shows a zero run.
//   - the payroll → GL post is idempotent: source_doc `payroll:<id>` is unique
//     under the jv_source_doc_uq index (migration 0037), so a double-post trips
//     23505 → 409 (the pre-check + the DB constraint are both enforced).
//   - B-308 (money): that per-ROW guard does NOT stop a duplicate RUN — two runs mint
//     two ids and both post legitimately. The CREATE is therefore idempotent on its
//     own natural key unique(worker_id, period) (migration 0058): a second run replays
//     the ORIGINAL row's 201. Cost of the ruling: `amount` is frozen at create, so
//     attendance corrected AFTER a run can no longer be picked up through the API.
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { attendances, jvLines, jvs, payrolls, workers } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { has, pick, readIdempotencyKey, str, toNum } from "./procurement.js";
import { loadCaller, permAllowed } from "./authz.js";
import { listEnvelope } from "./list-envelope.js";
import { byIdAsc, newestFirst } from "./list-order.js";
import {
  ACCT,
  allocJvNo,
  docNoExhausted,
  DocNoExhaustedError,
  isUniqueViolation,
  resolveAccountIds,
  violatedConstraint,
  withDocNoRetry,
} from "./gl-post.js";

type WorkerRow = typeof workers.$inferSelect;
type AttendanceRow = typeof attendances.$inferSelect;
type PayrollRow = typeof payrolls.$inferSelect;
type JvRow = typeof jvs.$inferSelect;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The perms-matrix module (seed MODULE_IDS) that governs finance mutations. */
const FINANCE_MODULE = "finance";

/**
 * The WIP/CIP account labor capitalises into — 1140 งานระหว่างก่อสร้าง (a real
 * COA_SEED code, NOT a named ACCT const in gl-post.ts). Resolved per-tenant at post
 * time via resolveAccountIds; a tenant whose COA lacks it → honest 409 (C-177).
 */
const WIP_LABOR = "1140";

/** The valid attendance statuses (labor.jsx AttendanceForm — มา/ครึ่งวัน/ขาด). */
const ATTENDANCE_STATUSES = new Set(["full", "half", "absent"]);

/**
 * status → day_fraction (the pay factor). SERVER-DERIVED, never a client value
 * (B-140 RG-2): a full day pays 1, half day 0.5, an absence 0. Stored as the
 * numeric-column string.
 */
const DAY_FRACTION: Record<string, string> = {
  full: "1",
  half: "0.5",
  absent: "0",
};

/** The OT premium on the hourly rate (1.5× time-and-a-half, B-140 RG-3). */
const OT_MULTIPLIER = 1.5;

/** Standard hours per work day — the divisor that derives the hourly rate. */
const HOURS_PER_DAY = 8;

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

/** Flat 403 FORBIDDEN error. */
function forbidden(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(403).send({ code: "FORBIDDEN", message });
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
// Parse + money helpers
// ---------------------------------------------------------------------------

/** Coerce a drizzle numeric (string) / number / null to a finite number, else 0. */
function num(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A computed 2-dp money magnitude as the numeric-column string ("618.75"). */
function moneyStr(n: number): string {
  return round2(n).toFixed(2);
}

/** Coerce an opaque flag to a boolean, else the default (accepts bool / "true"/"false"). */
function boolOr(value: unknown, dflt: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return dflt;
}

/** An optional trimmed text field: the trimmed body value, or null when absent/empty. */
function optText(body: Record<string, unknown>, ...keys: string[]): string | null {
  if (!has(body, ...keys)) return null;
  return str(pick(body, ...keys)).trim() || null;
}

// ---------------------------------------------------------------------------
// Financial-authz gates (B-082 F1 model — invents no new policy)
// ---------------------------------------------------------------------------

/**
 * Fail-closed gate for the create ops: the caller must be attributable AND carry
 * `finance.create`. Sends the 403 and returns false on failure. Mirrors ar.ts /
 * ap-deposit.ts requireFinanceCreate.
 */
async function requireFinanceCreate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const caller = await loadCaller(request);
  if (!caller) {
    forbidden(reply, "caller cannot be attributed");
    return false;
  }
  if (!permAllowed(caller.perms, FINANCE_MODULE, "create")) {
    forbidden(reply, "this action requires the finance create permission");
    return false;
  }
  return true;
}

/**
 * Fail-closed gate for the payroll → GL post: the caller must be attributable AND
 * carry `finance.approve` (posting locks money to the ledger). Mirrors retention.ts
 * requireFinanceApprove.
 */
async function requireFinanceApprove(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const caller = await loadCaller(request);
  if (!caller) {
    forbidden(reply, "caller cannot be attributed");
    return false;
  }
  if (!permAllowed(caller.perms, FINANCE_MODULE, "approve")) {
    forbidden(reply, "this action requires the finance approve permission");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Wire serializers (snake_case wire of the REAL columns — C10, no fabrication)
// ---------------------------------------------------------------------------

// GET/POST /labor/workers — labor master (labor.jsx WORKERS_SEED + WorkerForm
// superset: code/team/supervisor/skill/pay_type/active). day_rate is money →
// currency_code. Ordered by name (the register's deterministic worker list).
function workerWire(w: WorkerRow): Record<string, unknown> {
  return {
    id: w.id,
    name: w.name,
    day_rate: w.dayRate != null ? num(w.dayRate) : null,
    currency_code: w.currencyCode,
    code: w.code,
    team: w.team,
    supervisor: w.supervisor,
    skill: w.skill,
    pay_type: w.payType,
    active: w.active,
    created_at: w.createdAt,
  };
}

// GET/POST /labor/attendance — a worker's daily time record. ot in hours; status
// (full/half/absent) drives the SERVER-DERIVED day_fraction pay factor; cc_id
// charges the day to a cost center. Ordered newest-first (day desc).
function attendanceWire(a: AttendanceRow): Record<string, unknown> {
  return {
    id: a.id,
    worker_id: a.workerId,
    day: a.day,
    ot: num(a.ot),
    status: a.status,
    day_fraction: num(a.dayFraction),
    cc_id: a.ccId,
    created_at: a.createdAt,
  };
}

// GET/POST /labor/payroll — a worker's payout for a period. amount is money →
// currency_code (SERVER-computed at create); period is a 'YYYY-MM' key. Ordered
// newest-first (created_at desc).
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

// ---------------------------------------------------------------------------
// Reads (company-scoped list envelopes — mirror the sibling master-data GETs)
// ---------------------------------------------------------------------------

async function listWorkers(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(workers)) as WorkerRow[];
  return [...rows]
    // B-323: worker.name has no unique constraint — two สมชาย tied and the join plan
    // decided which came first.
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || byIdAsc(a, b))
    .map(workerWire);
}

async function listAttendance(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(attendances)) as AttendanceRow[];
  return [...rows]
    // B-323: `day` is a DATE, and an attendance register's whole purpose is many
    // workers on one date — so this comparator returned 0 for the NORMAL case, not an
    // edge, six lines above the payroll sort that round 3 fixed. It survived three
    // reviews because the seed emits zero attendance rows (seed/index.ts): no baseline
    // moves, no gate sees it. labor.test.ts pins it without the seed — both the same-day
    // tie and the day-DESC-ahead-of-the-floor clause order.
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0) || byIdAsc(a, b))
    .map(attendanceWire);
}

async function listPayroll(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(payrolls)) as PayrollRow[];
  // B-323: was a tie-blind inline created_at comparator — the shared newestFirst is
  // TOTAL (created_at DESC, then id ASC).
  return newestFirst(rows).map(payrollWire);
}

// ---------------------------------------------------------------------------
// POST /labor/workers — add a worker (labor.jsx WorkerForm)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { name, day_rate?, code?, team?, supervisor?, skill?,
// pay_type?, active? }. Gated finance.create (fail-closed 403); name required
// (→ 400). The superset columns are stored verbatim (nullable text; active
// defaults true). company_id is force-set by the scoped insert door. Returns 201.
async function createLaborWorker(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinanceCreate(request, reply))) return reply;

  const name = str(pick(body, "name")).trim();
  if (!name) return badRequest(reply, "name is required");

  const dayRateRaw = toNum(pick(body, "day_rate", "dayRate"));
  const dayRate = dayRateRaw != null ? moneyStr(dayRateRaw) : null;
  const active = has(body, "active") ? boolOr(pick(body, "active"), true) : true;

  const [worker] = (await db
    .insert(workers, {
      name,
      dayRate,
      currencyCode: "THB",
      code: optText(body, "code"),
      team: optText(body, "team"),
      supervisor: optText(body, "supervisor"),
      skill: optText(body, "skill"),
      payType: optText(body, "pay_type", "payType"),
      active,
    })
    .returning()) as WorkerRow[];

  return reply.code(201).send(workerWire(worker!));
}

// ---------------------------------------------------------------------------
// POST /labor/attendance — B-307 idempotency (client key + partial index + replay)
// ---------------------------------------------------------------------------

/** The partial unique index the B-307 replay branch gates on BY NAME (B-263). */
const ATTENDANCE_IDEMPOTENCY_CONSTRAINT = "attendance_idempotency_uq";

/**
 * Resolve the ORIGINAL attendance row behind a client idempotency_key. THREE filters,
 * all load-bearing:
 *   - the TENANT scope — `attendance` carries company_id directly, so it is a plain
 *     TenantTable and db.select() AND-binds company_id by construction (NO
 *     selectThrough / zero hops, unlike gr which has no company_id and must walk
 *     po/wo → pr → project). Without it a key-only lookup could resolve ANOTHER
 *     company's row: attendance_idempotency_uq is a GLOBAL partial index on the key
 *     alone, so a cross-tenant key clash is physically possible;
 *   - the ANCHOR worker_id — the same key replayed for a DIFFERENT worker must not
 *     hand back the first worker's day (that would understate the second worker's pay
 *     while looking like a success);
 *   - the ANCHOR day — likewise a key reused across days must not confirm a day that
 *     was never recorded.
 * A non-matching anchor deliberately resolves to null: the caller falls through to the
 * insert, trips the global index, and the catch answers the honest 409
 * "idempotency_key already used". Handing back someone else's record is worse than a
 * 409. Used by BOTH the pre-check and the 23505 catch — ONE resolver, so the two paths
 * can never diverge on what counts as "the client's own row".
 */
async function findAttendanceByIdempotencyKey(
  db: TenantDb,
  args: { idempotencyKey: string; workerId: string; day: string },
): Promise<AttendanceRow | null> {
  const { idempotencyKey, workerId, day } = args;
  const [existing] = (await db.select(
    attendances,
    and(
      eq(attendances.idempotencyKey, idempotencyKey),
      eq(attendances.workerId, workerId),
      eq(attendances.day, day),
    ),
  )) as AttendanceRow[];
  return existing ?? null;
}

/**
 * Send the 201 create body for an ALREADY-PERSISTED attendance row — same id, same
 * SERVER-DERIVED day_fraction, never a second write. The ONLY place a replay 201 is
 * produced (both the pre-check and the 23505 catch call it), so a replayed POST is
 * byte-identical to the original create BY CONSTRUCTION rather than by two hand-built
 * shapes happening to agree today. attendanceWire is a pure function of the one row,
 * so byte-identity needs no envelope re-derivation (unlike sendExistingGr).
 */
function sendExistingAttendance(
  reply: FastifyReply,
  existing: AttendanceRow,
): FastifyReply {
  return reply.code(201).send(attendanceWire(existing));
}

/**
 * B-307 idempotency REPLAY, reached from the 23505 CATCH. The insert tripped
 * attendance_idempotency_uq: a POST carrying a previously-seen idempotency_key is the
 * mobile SyncProcessor's at-least-once retry, NOT a second day worked. This is the
 * CONCURRENCY BACKSTOP for the pre-check — the pre-check read nothing, then a racing
 * replay of the same key committed before our insert. Kept deliberately: an app-level
 * pre-check is NOT a substitute for the unique index + catch (money-post-idempotency
 * lesson). A key that collided at the DB layer but resolves to nothing in THIS
 * tenant/worker/day is a 409 — never a leak, never a fabricated record.
 */
async function replayExistingAttendance(
  db: TenantDb,
  reply: FastifyReply,
  args: { idempotencyKey: string; workerId: string; day: string },
): Promise<FastifyReply> {
  const existing = await findAttendanceByIdempotencyKey(db, args);
  if (!existing) return conflict(reply, "idempotency_key already used");
  return sendExistingAttendance(reply, existing);
}

// ---------------------------------------------------------------------------
// POST /labor/attendance — record a worker's day (labor.jsx AttendanceForm)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { worker_id, day, ot?, status?, cc_id?, idempotency_key? }.
// Gated finance.create; worker_id + day required; worker_id must be THIS tenant's
// (scoped select → 400). status defaults 'full' and must be full/half/absent
// (→ 400). day_fraction is SERVER-DERIVED from status ({full:1, half:0.5,
// absent:0}) — never a client value. Returns 201.
//
// B-307 (money): POST /labor/payroll pays by SUMMING attendance ROWS in the period —
// not DISTINCT days — so a duplicate row is a DOUBLE PAYMENT, and the downstream
// jv_source_doc_uq guard cannot see it (the inflated amount posts as one clean
// balanced JV). A client idempotency_key collapses the mobile SyncProcessor's
// at-least-once replay onto the ORIGINAL row.
async function createLaborAttendance(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinanceCreate(request, reply))) return reply;

  const workerId = str(pick(body, "worker_id", "workerId")).trim();
  if (!workerId) return badRequest(reply, "worker_id is required");
  const day = str(pick(body, "day")).trim();
  if (!day) return badRequest(reply, "day is required");

  const status = has(body, "status")
    ? str(pick(body, "status")).trim() || "full"
    : "full";
  if (!ATTENDANCE_STATUSES.has(status)) {
    return badRequest(reply, "status must be one of full, half, absent");
  }
  const otRaw = toNum(pick(body, "ot"));
  const ot = otRaw != null && otRaw > 0 ? otRaw : 0;
  const ccId = str(pick(body, "cc_id", "ccId")).trim() || null;
  // B-307: the client's replay key. Absent / explicit null / blank / whitespace-only →
  // null, so the web bulk-save is unchanged and no dedup path fires without a key. A
  // null NEVER enters the replay branch and never matches a stored null — the index is
  // PARTIAL (WHERE idempotency_key IS NOT NULL) and SQL NULL is not equal to itself, so
  // both layers refuse it independently.
  // B-309: a PRESENT but non-string key is a 400 instead of being swallowed by str()
  // into that same null — a silent dedup-off double-pays this worker on replay. Shared
  // parser (readIdempotencyKey) with POST /gr so the two money-writes cannot drift.
  const idem = readIdempotencyKey(body);
  if (!idem.ok) return badRequest(reply, idem.message);
  const idempotencyKey = idem.key;

  // worker must belong to THIS tenant (scoped select — no cross-tenant leak).
  const [worker] = (await db.select(
    workers,
    eq(workers.id, workerId),
  )) as WorkerRow[];
  if (!worker) return badRequest(reply, "worker not found in this tenant");

  // B-307 PRE-CHECK: resolve the client's OWN row before writing. It sits BELOW all
  // validation on purpose — unlike POST /gr there is no state gate above the insert
  // that a legitimate replay could trip, so nothing is gained by hoisting it, and
  // keeping it here means a replay can never bypass the tenant / status-enum gates.
  // Not a substitute for the index + catch below: it only saves the round-trip in the
  // common (already-committed) case; a concurrent replay still races past it.
  if (idempotencyKey) {
    const existing = await findAttendanceByIdempotencyKey(db, {
      idempotencyKey,
      workerId,
      day,
    });
    if (existing) return sendExistingAttendance(reply, existing);
  }

  // B-307: the row carries the client key. A REPLAY (the SyncProcessor retrying a
  // create it never heard back on) trips attendance_idempotency_uq → 23505; we catch
  // it and return the ORIGINAL row instead of a duplicate the payroll would pay again.
  // Entering that branch needs ALL THREE of: a key present (the partial index exempts
  // nulls, so a key-less insert can never dedup), SQLSTATE 23505, and — B-263 — the
  // violated constraint being attendance_idempotency_uq BY NAME. The name check is the
  // load-bearing hardening: 23505 alone only says "SOME unique constraint", so a future
  // unique index on `attendance` (say the unique(worker_id, day) this deliberately did
  // NOT add) would otherwise silently inherit the replay path and answer a wrong row.
  // Anything else rethrows to the 500 handler — the safe failure for a money write (no
  // row written, client retries) rather than a confidently wrong answer.
  let attendance: AttendanceRow | undefined;
  try {
    [attendance] = (await db
      .insert(attendances, {
        workerId,
        day,
        ot: ot.toFixed(2),
        // SERVER-DERIVED from status — the client never supplies day_fraction.
        status,
        dayFraction: DAY_FRACTION[status]!,
        ccId,
        idempotencyKey,
      })
      .returning()) as AttendanceRow[];
  } catch (err) {
    if (
      idempotencyKey &&
      isUniqueViolation(err) &&
      violatedConstraint(err) === ATTENDANCE_IDEMPOTENCY_CONSTRAINT
    ) {
      return replayExistingAttendance(db, reply, { idempotencyKey, workerId, day });
    }
    throw err;
  }

  return reply.code(201).send(attendanceWire(attendance!));
}

// ---------------------------------------------------------------------------
// POST /labor/payroll — B-308 idempotency (natural key + unique index + replay)
// ---------------------------------------------------------------------------

/** The unique index the B-308 replay branch gates on BY NAME (B-263). */
const PAYROLL_PERIOD_CONSTRAINT = "payroll_worker_period_uq";

/**
 * Resolve the ORIGINAL payroll run for a worker+period. TWO filters, both load-bearing:
 *   - the TENANT scope — `payroll` carries company_id directly, so it is a plain
 *     TenantTable and db.select() AND-binds company_id by construction (NO
 *     selectThrough / zero hops, like attendance and unlike gr);
 *   - the NATURAL key itself (worker_id + period) — the exact pair the unique index
 *     enforces, so the row this hands back is BY DEFINITION the row that blocked the
 *     insert. Unlike B-307's client key there is no separate anchor to disagree with:
 *     the key IS the anchor.
 * Resolving to null is possible only if the colliding row lives in ANOTHER company
 * (worker_id FKs a tenant-owned worker, so that means corrupt data, not normal use);
 * the caller then answers an honest 409 rather than fabricating or leaking a row.
 * Used by BOTH the pre-check and the 23505 catch — ONE resolver, so the two paths
 * can never diverge on what counts as "the run that already exists".
 */
async function findPayrollByWorkerPeriod(
  db: TenantDb,
  args: { workerId: string; period: string },
): Promise<PayrollRow | null> {
  const [existing] = (await db.select(
    payrolls,
    and(eq(payrolls.workerId, args.workerId), eq(payrolls.period, args.period)),
  )) as PayrollRow[];
  return existing ?? null;
}

/**
 * Send the 201 create body for an ALREADY-PERSISTED payroll run — same id, same
 * SERVER-COMPUTED amount, never a second write and never a second postable row. The
 * ONLY place a replay 201 is produced (both the pre-check and the 23505 catch call
 * it), so a replayed POST is byte-identical to the original create BY CONSTRUCTION
 * rather than by two hand-built shapes happening to agree today. payrollWire is a
 * pure function of the one row, so byte-identity needs no envelope re-derivation.
 */
function sendPayrollCreated(
  reply: FastifyReply,
  existing: PayrollRow,
): FastifyReply {
  return reply.code(201).send(payrollWire(existing));
}

/**
 * B-308 REPLAY, reached from the 23505 CATCH. The insert tripped
 * payroll_worker_period_uq: this worker+period was ALREADY run. This is the
 * CONCURRENCY BACKSTOP for the pre-check — the pre-check read nothing, then a racing
 * double-click committed before our insert. Kept deliberately: an app-level pre-check
 * is NOT a substitute for the unique index + catch (money-post-idempotency lesson).
 * A collision that resolves to nothing in THIS tenant is a 409 — never a leak, never
 * a fabricated record.
 */
async function replayExistingPayroll(
  db: TenantDb,
  reply: FastifyReply,
  args: { workerId: string; period: string },
): Promise<FastifyReply> {
  const existing = await findPayrollByWorkerPeriod(db, args);
  if (!existing) return conflict(reply, "payroll already run for this worker and period");
  return sendPayrollCreated(reply, existing);
}

// ---------------------------------------------------------------------------
// POST /labor/payroll — run a worker's payroll for a period (labor.jsx Payroll)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { worker_id, period, cc_id? }. Gated finance.create;
// worker_id + period required; worker_id tenant-scoped (→ 400); period is a
// 'YYYY-MM' key (→ 400 otherwise). amount is SERVER-COMPUTED (money=SERVER, B-140
// RG-3) — a client `amount` in the body is IGNORED. It sums, over the worker's
// attendance rows whose `day` falls in the period, day_rate × day_fraction +
// ot × (day_rate/8) × 1.5 (day_rate from the worker; day_fraction + ot per row),
// round2'd. No attendance in the period → amount 0 (honest). Returns 201.
//
// B-308 (money · Wei = ก): the SAME worker+period can only be run ONCE. Two runs mint
// two ids, and the downstream GL guard keys on `source_doc = payroll:<id>`
// (jv_source_doc_uq) — so BOTH posted as clean balanced JVs and paid the work twice
// (reproduced live: JV-2026-0419 + JV-2026-0420, 687.50 each). The natural key
// unique(worker_id, period) closes it at the DB; a second POST replays the ORIGINAL
// row as its original 201 instead of creating a second postable run.
//
// CONSEQUENCE, stated plainly (not a defect — the cost of the ruling): `amount` is
// frozen at create time and nothing recomputes it. Once a period is run, attendance
// added or corrected afterwards can NO LONGER be picked up through the API — the
// re-run WAS the only recompute path, and it is exactly the path that double-paid.
// A replay therefore returns the FIRST run's (possibly stale) amount with no signal
// that a recalculation was refused. A correction/recompute endpoint is a separate,
// unallocated follow-up.
async function createLaborPayroll(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinanceCreate(request, reply))) return reply;

  const workerId = str(pick(body, "worker_id", "workerId")).trim();
  if (!workerId) return badRequest(reply, "worker_id is required");
  const period = str(pick(body, "period")).trim();
  if (!period) return badRequest(reply, "period is required");
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return badRequest(reply, "period must be a YYYY-MM key");
  }
  const ccId = str(pick(body, "cc_id", "ccId")).trim() || null;

  // worker must belong to THIS tenant (scoped select → 400 for a foreign id).
  const [worker] = (await db.select(
    workers,
    eq(workers.id, workerId),
  )) as WorkerRow[];
  if (!worker) return badRequest(reply, "worker not found in this tenant");

  // B-308 PRE-CHECK: this worker+period already run? It sits BELOW all validation on
  // purpose, so a replay can never bypass the tenant / period-format gates. Not a
  // substitute for the index + catch below: it only saves the amount re-computation in
  // the common (already-committed) case; a concurrent double-click still races past it.
  const prior = await findPayrollByWorkerPeriod(db, { workerId, period });
  if (prior) return sendPayrollCreated(reply, prior);

  // amount = SERVER-COMPUTED (money=SERVER · B-140 RG-3): sum the worker's
  // in-period attendance of day_rate × day_fraction + ot × (day_rate/8) × 1.5.
  const dayRate = num(worker.dayRate);
  const hourlyRate = dayRate / HOURS_PER_DAY;
  const periodRows = (
    (await db.select(
      attendances,
      eq(attendances.workerId, workerId),
    )) as AttendanceRow[]
  ).filter((a) => String(a.day).slice(0, 7) === period);

  let total = 0;
  for (const a of periodRows) {
    total += dayRate * num(a.dayFraction) + num(a.ot) * hourlyRate * OT_MULTIPLIER;
  }
  const amount = round2(total); // 0 when there is no attendance in the period.

  // B-308: a DOUBLE-CLICK (or any second run) trips payroll_worker_period_uq → 23505;
  // we catch it and return the ORIGINAL run instead of a second row the GL would post
  // as its own clean balanced JV. Entering that branch needs BOTH SQLSTATE 23505 and —
  // B-263 — the violated constraint being payroll_worker_period_uq BY NAME. The name
  // check is the load-bearing hardening: 23505 alone only says "SOME unique
  // constraint", so a future unique index on `payroll` would otherwise silently
  // inherit the replay path and answer a wrong row. Anything else rethrows to the 500
  // handler — the safe failure for a money write (no row written, client retries)
  // rather than a confidently wrong answer.
  let payroll: PayrollRow | undefined;
  try {
    [payroll] = (await db
      .insert(payrolls, {
        workerId,
        period,
        amount: moneyStr(amount),
        currencyCode: "THB",
        ccId,
      })
      .returning()) as PayrollRow[];
  } catch (err) {
    if (
      isUniqueViolation(err) &&
      violatedConstraint(err) === PAYROLL_PERIOD_CONSTRAINT
    ) {
      return replayExistingPayroll(db, reply, { workerId, period });
    }
    throw err;
  }

  return sendPayrollCreated(reply, payroll!);
}

// ---------------------------------------------------------------------------
// POST /labor/payroll/{id}/post — post a payroll run to the GL (labor.jsx)
// ---------------------------------------------------------------------------
// Gated finance.approve (posting locks money). Loads the payroll (scoped → 404).
// Balanced double entry: Dr 1140 WIP-labor / Cr 1020 bank = the STORED amount
// (money=SERVER — never a re-trusted client value), carrying the payroll's cc_id on
// both legs. IDEMPOTENT + race-safe: source_doc `payroll:<id>` is unique under the
// jv_source_doc_uq index (0037) — a pre-check + the 23505 catch both map a
// double-post to 409. A missing 1140/1020 in the tenant COA → honest 409 (never
// invents an account). Returns 200 ActionOk { id, jv_no, amount }.
async function postLaborPayroll(
  db: TenantDb,
  request: FastifyRequest,
  payrollId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  // 1. authz — posting a payroll locks money to the GL → finance.approve.
  if (!(await requireFinanceApprove(request, reply))) return reply;

  // 2. tenant door — the payroll must belong to THIS tenant (scoped → 404).
  const [payroll] = (await db.select(
    payrolls,
    eq(payrolls.id, payrollId),
  )) as PayrollRow[];
  if (!payroll) return notFound(reply, `payroll ${payrollId} not found`);

  // 3. money — the JV posts the STORED amount (money=SERVER). A zero run has
  // nothing to post (honest 409, never a degenerate 0/0 JV).
  const amount = round2(num(payroll.amount));
  if (amount <= 0) {
    return conflict(reply, "payroll has no amount to post");
  }

  // 4. idempotency pre-check — a JV already carrying this source_doc → 409 (the
  // 23505 catch below is the mandatory race backstop).
  const sourceDoc = `payroll:${payrollId}`;
  const priorJv = (await db.select(
    jvs,
    eq(jvs.sourceDoc, sourceDoc),
  )) as JvRow[];
  if (priorJv.length > 0) {
    return conflict(reply, `payroll ${payrollId} already posted`);
  }

  // 5. accounts — resolve 1140 WIP-labor + 1020 bank in THIS tenant's COA; a
  // missing code is an honest 409 (never post against an invented account · C-177).
  const acctIds = await resolveAccountIds(db, [WIP_LABOR, ACCT.bank]);
  const wipLaborId = acctIds.get(WIP_LABOR);
  const bankId = acctIds.get(ACCT.bank);
  if (!wipLaborId || !bankId) {
    return conflict(
      reply,
      "the tenant chart of accounts is missing a required posting account (WIP-labor / bank)",
    );
  }

  // B-318: assigned INSIDE allocThenPost below (a retry must re-read the max).
  let jvNo = "";
  const jvId = randomUUID();
  const currencyCode = payroll.currencyCode ?? "THB";
  const ccId = payroll.ccId;
  // Balanced double entry: Dr 1140 WIP-labor / Cr 1020 bank = amount, cc on both.
  const lineRows: (typeof jvLines.$inferInsert)[] = [
    { jvId, accountId: wipLaborId, dr: moneyStr(amount), cr: moneyStr(0), currencyCode, ccId },
    { jvId, accountId: bankId, dr: moneyStr(0), cr: moneyStr(amount), currencyCode, ccId },
  ];

  // ONE transaction (mirror ar.ts approveCn + retention.ts release): the jv header
  // + its lines are all-or-nothing. insertThrough re-proves this tenant owns the
  // just-created parent jv (jv_line has no company_id).
  // B-318: allocate + post is ONE retryable unit (see withDocNoRetry).
  const allocThenPost = async (): Promise<void> => {
    jvNo = await allocJvNo(db);
    await db.transaction(async (tx) => {
      await tx
        .insert(jvs, {
          id: jvId,
          no: jvNo,
          sourceDoc,
          memo: `payroll ${payroll.period}`,
        })
        .returning();
      await tx.insertThrough(jvLines, jvs, jvId, lineRows);
    });
  };
  try {
    await withDocNoRetry(allocThenPost);
  } catch (err) {
    // B-318 FIRST: JV-number allocation lost the race to exhaustion. Nothing
    // committed — a 409 here would falsely claim the payroll was already posted.
    if (err instanceof DocNoExhaustedError) return docNoExhausted(reply);
    // A concurrent/duplicate post trips the 0037 source_doc UNIQUE index — map it
    // to the same 409 as the pre-check (never a 500, never a double post).
    if (isUniqueViolation(err)) {
      return conflict(reply, `payroll ${payrollId} already posted`);
    }
    throw err;
  }

  return reply.code(200).send({ id: payrollId, jv_no: jvNo, amount });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the labor read + write routes on the given (/api/v1-prefixed) scope. */
export function registerLaborRoute(app: FastifyInstance): void {
  const withTenantList =
    (run: (db: TenantDb) => Promise<Record<string, unknown>[]>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      return reply.code(200).send(listEnvelope(await run(db)));
    };

  const body = (request: FastifyRequest): Record<string, unknown> =>
    (request.body ?? {}) as Record<string, unknown>;

  app.get("/labor/workers", withTenantList(listWorkers));
  app.get("/labor/attendance", withTenantList(listAttendance));
  app.get("/labor/payroll", withTenantList(listPayroll));

  app.post("/labor/workers", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createLaborWorker(db, request, body(request), reply);
  });

  app.post("/labor/attendance", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createLaborAttendance(db, request, body(request), reply);
  });

  app.post("/labor/payroll", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createLaborPayroll(db, request, body(request), reply);
  });

  app.post("/labor/payroll/:id/post", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const { id } = request.params as { id: string };
    return postLaborPayroll(db, request, id, reply);
  });
}
