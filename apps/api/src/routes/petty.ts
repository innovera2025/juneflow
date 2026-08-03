// Petty cash (B-233, Wei=ก claim-MVP) — the petty-cash CLAIM handlers
// (petty-alloc.jsx PettyClaimForm). Handler-only: the schema (extensions.ts
// petty_cash_txn — B-233 added project_id, migration 0054), the contract paths
// (openapi.yaml §finance /petty, opaque EntityList / EntityCreated), and the GL
// posting map (gl-post.ts POSTING_MAP.petty) pre-exist this file; it wires the
// list + create reads/writes and is registered in app.ts (registerPettyRoute).
//
// Contract (openapi.yaml §finance):
//   GET  /petty   → EntityList    — list petty-cash txns (filters type/status/period)
//   POST /petty   → EntityCreated — create a petty-cash claim (caps ≤ 10,000)
// Each row is the opaque Entity (snake_case wire of REAL columns + FK-resolved
// display names). A read on an opaque endpoint needs no contract change.
//
// Tenant scope (fail closed): petty_cash_txn carries company_id → the scoped
// TenantDb.select() door. project_id / by_user_id are FK ids validated / resolved
// against tenant-scoped reads; cost_center is resolved THROUGH its project root
// (no company_id of its own). Without a resolved tenant the handler answers 401.
//
// money=SERVER (Wei C-177): a claim posts NO JV on create — it lands `pending`
// and surfaces in the shared GL posting inbox (gl-posting.ts), where /gl/post
// posts the balanced JV Dr 5100 admin-expense / Cr 1010 cash-on-hand (the ONLY
// existing COA accounts; the prototype's 52xx/1102 are NOT in COA_SEED). The
// ≤ 10,000 ฿ per-claim cap is the prototype's Petty scope rule ("ยอดเกิน 10,000
// ฿ ต้องเป็น PR"): a larger spend must go through the normal PR flow, not here.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import {
  costCenters,
  pettyCashTxns,
  projects,
  users,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { listEnvelope } from "./list-envelope.js";
import { has, pick, str, toNum } from "./procurement.js";
import { type CallerAuthz, loadCaller, permAllowed } from "./authz.js";

type PettyRow = typeof pettyCashTxns.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type UserRow = typeof users.$inferSelect;
type CostCenterRow = typeof costCenters.$inferSelect;

/** The perms-matrix module (seed MODULE_IDS) that governs finance mutations. */
const FINANCE_MODULE = "finance";

/** A petty-cash CLAIM caps at 10,000 ฿ per the prototype's Petty scope rule. */
const PETTY_CLAIM_CAP = 10_000;

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

// ---------------------------------------------------------------------------
// Money + parse + sort helpers (mirror ar.ts)
// ---------------------------------------------------------------------------

/** A computed 2-dp money magnitude as the numeric-column string ("184500.00"). */
function moneyStr(n: number): string {
  return round2(n).toFixed(2);
}

/** Coerce a drizzle numeric (string) / number / null to a finite number, else 0. */
function num(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Epoch ms of a stored timestamp/date, else 0 (a malformed value sorts last). */
function msOf(ts: unknown): number {
  if (ts == null) return 0;
  const t = new Date(ts as string | Date).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Sort a set of rows carrying `createdAt` newest-first (mock list order). */
function newestFirst<T extends { createdAt?: unknown }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt));
}

/**
 * The CE 'YYYY-MM' month key of a stored UTC timestamp (times are stored UTC,
 * PLAN.md §4) — the `period` list filter compares against this. Null for a
 * missing/malformed value (never matches a period).
 */
function ceMonthKey(ts: unknown): string | null {
  if (ts == null) return null;
  const d = new Date(ts as string | Date);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Financial-authz gate (B-082 F1 model — invents no new policy)
// ---------------------------------------------------------------------------

/**
 * Fail-closed gate for a claim create: the caller must be attributable AND carry
 * the `finance.create` perm. On failure it sends the 403 and returns null; on
 * success it returns the caller (the created claim is attributed to caller.userId
 * as its `by_user_id`, the server-side "ผู้เบิก"). Mirrors ar.ts requireFinanceCreate.
 */
async function requireFinanceCreate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<CallerAuthz | null> {
  const caller = await loadCaller(request);
  if (!caller) {
    forbidden(reply, "caller cannot be attributed");
    return null;
  }
  if (!permAllowed(caller.perms, FINANCE_MODULE, "create")) {
    forbidden(reply, "this action requires the finance create permission");
    return null;
  }
  return caller;
}

// ---------------------------------------------------------------------------
// Doc-number allocator — PT-<CE-year>-<NNNN> (mirror gl-post.ts allocJvNo /
// solar.ts allocOmNo). §0 rule-3: the prototype's "PT-2026-0148" is a mock
// literal — never copied; the server always generates the running number.
// ---------------------------------------------------------------------------

/**
 * Allocate the next petty-cash number for this tenant — PT-<current-year>-<NNNN>,
 * one past the max numeric suffix among this tenant's PT numbers for the year
 * prefix. A display running number (like jv.no) — not an idempotency key, so no
 * unique constraint. Company-scoped read (fail closed).
 */
async function allocPettyNo(db: TenantDb): Promise<string> {
  const rows = (await db.select(pettyCashTxns)) as PettyRow[];
  const year = new Date().getFullYear();
  const prefix = `PT-${year}-`;
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
// FK-name resolvers — a display list never shows a raw uuid. by_user_id → user
// name, project_id → project name, cc_id → cost-center name. Each map is a
// single tenant-scoped read (cost_center THROUGH its project root — no
// company_id of its own).
// ---------------------------------------------------------------------------

interface NameMaps {
  userNames: Map<string, string>;
  projectNames: Map<string, string>;
  ccNames: Map<string, string>;
}

async function resolveNameMaps(db: TenantDb): Promise<NameMaps> {
  const [userRows, projectRows, ccRows] = await Promise.all([
    db.select(users) as Promise<UserRow[]>,
    db.select(projects) as Promise<ProjectRow[]>,
    // cost_center carries no company_id — scoped THROUGH its project root.
    db.selectThrough(costCenters, [
      { fk: costCenters.projectId, parent: projects },
    ]) as Promise<CostCenterRow[]>,
  ]);
  return {
    userNames: new Map(userRows.map((u) => [u.id, u.name])),
    projectNames: new Map(projectRows.map((p) => [p.id, p.name])),
    ccNames: new Map(ccRows.map((c) => [c.id, c.name])),
  };
}

/** Opaque wire (snake_case of the REAL columns + FK-resolved display names). */
function pettyWire(r: PettyRow, maps: NameMaps): Record<string, unknown> {
  return {
    id: r.id,
    no: r.no,
    type: r.type,
    label: r.label,
    value: num(r.value),
    currency_code: r.currencyCode,
    by_user_id: r.byUserId,
    by: r.byUserId ? maps.userNames.get(r.byUserId) ?? null : null,
    project_id: r.projectId,
    project_name: r.projectId ? maps.projectNames.get(r.projectId) ?? null : null,
    cc_id: r.ccId,
    cc_name: r.ccId ? maps.ccNames.get(r.ccId) ?? null : null,
    cat: r.cat,
    ref: r.ref,
    status: r.status,
    txn_date: r.txnDate,
    created_at: r.createdAt,
  };
}

// ---------------------------------------------------------------------------
// GET /petty — list petty-cash transactions (petty-alloc.jsx PettyCash table)
// ---------------------------------------------------------------------------
// Real source: petty_cash_txn (company-scoped). Optional in-memory filters:
//   ?type=   → the movement kind (claim/clear/topup)
//   ?status= → pending/approved/posted/...
//   ?period= → CE 'YYYY-MM' of created_at (times stored UTC, PLAN.md §4)
// Newest-first (created_at desc) matching the mock list order. FK ids are
// resolved to display names (never a raw uuid in a display field).
async function listPettyCash(
  db: TenantDb,
  query: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const [rows, maps] = await Promise.all([
    db.select(pettyCashTxns) as Promise<PettyRow[]>,
    resolveNameMaps(db),
  ]);

  const type = str(pick(query, "type")).trim();
  const status = str(pick(query, "status")).trim();
  const period = str(pick(query, "period")).trim();

  const filtered = rows.filter(
    (r) =>
      (!type || r.type === type) &&
      (!status || r.status === status) &&
      (!period || ceMonthKey(r.createdAt) === period),
  );

  return newestFirst(filtered).map((r) => pettyWire(r, maps));
}

// ---------------------------------------------------------------------------
// POST /petty — create a petty-cash claim (petty-alloc.jsx PettyClaimForm)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { category, amount, description, txn_date?, project_id? }.
// Enforced, in order:
//   - finance.create perm (403 fail-closed).
//   - category (→ cat) required (400); amount (→ value) required, finite, > 0
//     (400); description (→ label) required (400).
//   - amount ≤ 10,000 ฿ (400 else) — the prototype's per-claim Petty cap.
//   - project_id optional, and when given must be THIS tenant's project (scoped
//     select → 404 for a foreign id).
// Write (money=SERVER): a server-generated no (PT-YYYY-NNNN), type `claim`,
// status `pending`, value = the 2-dp claim magnitude, by_user_id = the caller
// (the server-side "ผู้เบิก"). company_id is force-set by the scoped insert. NO
// JV posts here — the pending claim posts through the GL inbox (Dr 5100/Cr 1010).
async function createPettyClaim(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const caller = await requireFinanceCreate(request, reply);
  if (!caller) return reply;

  const category = str(pick(body, "category", "cat")).trim();
  if (!category) return badRequest(reply, "category is required");

  const rawAmount = toNum(pick(body, "amount", "value"));
  if (rawAmount == null || rawAmount <= 0) {
    return badRequest(reply, "amount is required and must be greater than zero");
  }
  // Store/compare at 2-dp minor-unit precision (the same round2 the JV posts at)
  // so a sub-cent client value cannot slip past the cap or mis-post the ledger.
  const amount = round2(rawAmount);

  const description = str(pick(body, "description", "label")).trim();
  if (!description) return badRequest(reply, "description is required");

  if (amount > PETTY_CLAIM_CAP) {
    return badRequest(
      reply,
      `amount ${amount} exceeds the petty-cash cap of ${PETTY_CLAIM_CAP} — a larger spend must go through a PR`,
    );
  }

  // project_id is optional; when present it must belong to THIS tenant (a scoped
  // select returns nothing for a foreign id → 404, fail closed).
  const projectId = has(body, "project_id", "projectId")
    ? str(pick(body, "project_id", "projectId")).trim() || null
    : null;
  if (projectId) {
    const [project] = (await db.select(
      projects,
      eq(projects.id, projectId),
    )) as ProjectRow[];
    if (!project) return notFound(reply, `project ${projectId} not found`);
  }

  const txnDate = has(body, "txn_date", "txnDate")
    ? str(pick(body, "txn_date", "txnDate")).trim() || null
    : null;

  const no = await allocPettyNo(db); // server-generated running number (§0 rule-3)

  const [created] = (await db
    .insert(pettyCashTxns, {
      no,
      type: "claim",
      label: description,
      value: moneyStr(amount),
      currencyCode: "THB",
      byUserId: caller.userId,
      txnDate,
      status: "pending",
      cat: category,
      projectId,
    })
    .returning()) as PettyRow[];

  const maps = await resolveNameMaps(db);
  return reply.code(201).send(pettyWire(created!, maps));
}

/** Register the petty-cash routes on the given (already /api/v1-prefixed) scope. */
export function registerPettyRoute(app: FastifyInstance): void {
  app.get("/petty", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const query = (request.query ?? {}) as Record<string, unknown>;
    return reply.code(200).send(listEnvelope(await listPettyCash(db, query)));
  });

  app.post("/petty", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return createPettyClaim(db, request, body, reply);
  });
}
