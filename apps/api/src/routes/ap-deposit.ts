// AP vendor-deposit handlers — Phase-3 Finance (P2-BE-54 · ap.jsx APDeposit).
// A vendor deposit is money PAID to a supplier before goods/work are received
// ("มัดจำจ่ายให้ผู้ขาย · Vendor Deposit"). Paying it is an ASSET (an advance to the
// supplier, COA 1160) funded from cash — so CREATE posts a balanced JV in the SAME
// transaction as the deposit row (the prototype's "ลง GL: Dr มัดจำจ่าย, Cr เงินสด").
// It offsets back against the vendor's AP as goods/work are billed (`used` grows
// toward `amount`; balance = amount − used, SERVER-computed, never stored).
// Registered in app.ts (registerApDepositRoute) by the orchestrator — this file
// wires the handlers only (NO app.ts / openapi / migration / gl-post.ts edits).
//
// Contract (openapi.yaml §finance — declared opaque, NO openapi edit this task):
//   GET  /ap/deposit → EntityList    — the vendor-deposit register (listApDeposit)
//   POST /ap/deposit → EntityCreated — create a deposit + post its JV (createApDeposit)
// Each row/body is the opaque Entity (snake_case wire of REAL columns + honest
// derivations). A read/POST on an opaque endpoint needs no contract change.
//
// MONEY = SERVER AUTHORITY (gate-4.5 hard rule): the posted JV amount reads the
// STORED ap_deposit.amount INSIDE the same transaction (never a re-trusted client
// value). `amount` IS an accepted input (the prototype's required "จำนวนเงินมัดจำ" —
// APDepositForm's pct and amount are INDEPENDENT fields with no linkage, and the
// "อ้างถึง PO/WO" ref is a free-text input with no PO-value lookup, so amount is a
// user-typed cost like an asset cost, not a pct×PO derivation). It is validated
// (finite, > 0) + round2-normalised before storage; `used` and `balance` are
// server-owned (used defaults 0; balance = amount − used is computed, never stored).
// `pct` is stored as a label only — it NEVER drives amount. `no` (DP-YYYY-NNNN) is
// SERVER-allocated (the form field is readOnly auto; openapi's create body carries
// no `no`), not a client value.
//
// DIRECTION (deposit-is-an-asset): Dr 1160 advance-to-supplier (increase the asset)
// / Cr 1010 cash (decrease cash) = amount — byte-for-byte the prototype's GL note.
//
// Tenant scope (fail closed): ap_deposit + vendor + jv carry company_id → the
// scoped TenantDb.select()/insert() doors. po / wo carry NO company_id — they
// anchor through pr → project, so a supplied po_id/wo_id is tenant-verified via
// selectThrough (a foreign id resolves to nothing → 400). jv_line hangs off jv (no
// company_id) → written through insertThrough (re-verifies this tenant owns the
// just-created parent jv). Without a resolved tenant, request.db is absent → 401.
//
// Financial authorization (B-082 F1 lineage): creating a deposit PAYS cash = a
// financial mutation → it gates `finance.create` (loadCaller/permAllowed) —
// fail-closed 403 for an unattributable caller or one lacking the perm. The
// register read gates on the resolved tenant only (401 else). AuditLog fires
// automatically (middleware) on a 2xx.
//
// HONEST notes (C10 — flagged, never fabricated):
//   - `balance` is SERVER-computed (amount − used), never a stored column; the
//     prototype's หักครบ/ค้างหัก badge is DERIVED client-side from balance === 0,
//     so the response ships the stored status + the computed balance and lets web
//     render the badge (never a Thai UI string in the wire).
//   - `vendor_name` / `ref` (po.no ?? wo.no) are JOINED (scoped), null when the ref
//     is null / the seed dropped the joined `no` — honest, not fabricated.
//   - a deposit posts its JV EXACTLY ONCE at create (the deposit id is fresh), so
//     there is no idempotency pre-check to make; the source_doc `dep:<id>` UNIQUE
//     index (migration 0039) is the mandatory race backstop (23505 → 409).
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import {
  apDeposits,
  jvLines,
  jvs,
  pos,
  projects,
  prs,
  vendors,
  wos,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { has, pick, str, toNum } from "./procurement.js";
import { loadCaller, permAllowed } from "./authz.js";
import { listEnvelope } from "./list-envelope.js";
import { ACCT, allocJvNo, isUniqueViolation, resolveAccountIds } from "./gl-post.js";

type ApDepositRow = typeof apDeposits.$inferSelect;
type VendorRow = typeof vendors.$inferSelect;
type PoRow = typeof pos.$inferSelect;
type WoRow = typeof wos.$inferSelect;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The perms-matrix module (seed MODULE_IDS) that governs finance mutations. */
const FINANCE_MODULE = "finance";

// po / wo scope through pr → project (mirror ap.ts / po.ts / wo.ts). A supplied
// po_id / wo_id is tenant-verified via selectThrough — a foreign id resolves to
// nothing through these hops (fail closed).
const PO_HOPS = [
  { fk: pos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const WO_HOPS = [
  { fk: wos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];

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

/** Flat 409 INVALID_STATE error. */
function conflict(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(409).send({ code: "INVALID_STATE", message });
}

// ---------------------------------------------------------------------------
// Money + parse helpers
// ---------------------------------------------------------------------------

/** A computed 2-dp money magnitude as the numeric-column string ("380400.00"). */
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

// ---------------------------------------------------------------------------
// Financial-authz gate (B-082 F1 model — invents no new policy)
// ---------------------------------------------------------------------------

/**
 * Fail-closed gate for the create: the caller must be attributable AND carry the
 * `finance.create` perm (paying a deposit spends cash). Sends the 403 and returns
 * false on failure. Mirrors ar.ts requireFinanceCreate.
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

// ---------------------------------------------------------------------------
// Doc-number allocator — DP-<year>-<NNNN> (mirror gl-post.ts allocJvNo)
// ---------------------------------------------------------------------------

/**
 * Allocate the next deposit number for this tenant — DP-<current-year>-<NNNN>, one
 * past the max numeric suffix among the tenant's existing deposit numbers for that
 * year prefix. Company-scoped read (fail closed). SERVER-allocated because the
 * prototype's `no` field is readOnly auto and openapi's create body carries no
 * `no` (unlike ar_invoice.no, which is a client body field). Deterministic given
 * the current deposit set; the caller writes it inside the same create transaction.
 */
async function allocDepositNo(db: TenantDb): Promise<string> {
  const rows = (await db.select(apDeposits)) as ApDepositRow[];
  const year = new Date().getFullYear();
  const prefix = `DP-${year}-`;
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
// Wire serializer (snake_case wire of the REAL columns + honest derivations)
// ---------------------------------------------------------------------------
// Per-row register wire (ap.jsx APDeposit table, L406-445). STORED columns +
// joined vendor_name / ref + SERVER-computed balance. The หักครบ/ค้างหัก badge is
// DERIVED client-side from balance === 0 — the wire ships stored `status` +
// `balance`, never a Thai UI string.
function registerWire(
  d: ApDepositRow,
  vendorName: string | null,
  ref: string | null,
): Record<string, unknown> {
  const amount = num(d.amount);
  const used = num(d.used);
  // SERVER-computed outstanding — never stored, never a client value.
  const balance = round2(amount - used);
  return {
    // STORED (straight from ap_deposit).
    id: d.id,
    no: d.no,
    vendor_id: d.vendorId,
    po_id: d.poId,
    wo_id: d.woId,
    reason: d.reason,
    pct: d.pct == null ? null : num(d.pct),
    amount,
    used,
    currency_code: d.currencyCode,
    status: d.status,
    created_at: d.createdAt,
    // HONEST-JOINED (nullable — null when the ref is null/unresolved).
    vendor_name: vendorName,
    ref,
    // SERVER-COMPUTED.
    balance,
  };
}

// ---------------------------------------------------------------------------
// GET /ap/deposit — the vendor-deposit register (ap.jsx APDeposit)
// ---------------------------------------------------------------------------
// Authenticated (openapi declares only 401). Reads the tenant's ap_deposit
// (company-scoped), joins vendor_name (scoped vendor) + ref (po.no ?? wo.no,
// scoped THROUGH pr → project since po/wo carry no company_id), and per row emits
// STORED columns + server-computed balance. Full tenant set as one page (B-014
// listEnvelope, mirrors retention.ts / ap.ts). Newest-first.
async function listRegister(db: TenantDb): Promise<Record<string, unknown>[]> {
  const [deposits, vendorRows, poRows, woRows] = await Promise.all([
    db.select(apDeposits) as Promise<ApDepositRow[]>,
    db.select(vendors) as Promise<VendorRow[]>,
    // po / wo carry no company_id — scoped THROUGH pr → project (fail closed).
    db.selectThrough(pos, PO_HOPS) as Promise<PoRow[]>,
    db.selectThrough(wos, WO_HOPS) as Promise<WoRow[]>,
  ]);
  const vendorName = new Map(vendorRows.map((v) => [v.id, v.name]));
  const poNo = new Map(poRows.map((p) => [p.id, p.no]));
  const woNo = new Map(woRows.map((w) => [w.id, w.no]));
  return newestFirst(deposits).map((d) => {
    const ref =
      (d.poId ? poNo.get(d.poId) ?? null : null) ??
      (d.woId ? woNo.get(d.woId) ?? null : null) ??
      null;
    return registerWire(
      d,
      d.vendorId ? vendorName.get(d.vendorId) ?? null : null,
      ref,
    );
  });
}

// ---------------------------------------------------------------------------
// POST /ap/deposit — create a deposit + post its JV (ap.jsx APDepositForm)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { vendor_id, po_id?, wo_id?, amount, pct?, reason? }.
// Enforced fail-closed, IN ORDER (mirrors ap.ts createBilling + ar.ts create):
//   1. authz: finance.create (paying cash) → 403.
//   2. vendor_id required → 400.
//   3. amount required + finite + > 0 → 400.
//   4. vendor must be THIS tenant's (scoped select → 400).
//   5. po_id / wo_id, when supplied, must resolve to THIS tenant via selectThrough
//      (a foreign / cross-tenant id resolves to nothing → 400, fail closed).
//   6. accounts: resolve 1160 + 1010 in THIS tenant's COA; a missing code → 409
//      honest (never invent an account — gl-post.ts C-177).
// Then, in ONE db.transaction (money=SERVER — the JV reads the STORED amount):
// allocate DP-no + insert ap_deposit {company_id force-set, no, vendorId, poId,
// woId, reason, pct(nullable), amount, used='0', currency THB, status='approved'}
// + post the balanced JV (Dr 1160 / Cr 1010 = amount, source_doc dep:<depositId>,
// jv_line via insertThrough). Race-safe: the source_doc is unique under the 0039
// index → a duplicate post trips 23505 → isUniqueViolation → 409 (never a 500,
// never a double post). Returns 201 with the created row's register wire.
async function createDeposit(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  // 1. authz — paying a deposit spends cash → finance.create (fail-closed 403).
  if (!(await requireFinanceCreate(request, reply))) return reply;

  // 2. vendor_id required.
  const vendorId = str(pick(body, "vendor_id", "vendorId")).trim();
  if (!vendorId) return badRequest(reply, "vendor_id is required");

  // 3. amount required + finite + > 0 (accepted input — see header money note).
  const rawAmount = toNum(pick(body, "amount"));
  if (rawAmount == null || rawAmount <= 0) {
    return badRequest(reply, "amount is required and must be greater than zero");
  }
  const amount = round2(rawAmount);

  const poId = str(pick(body, "po_id", "poId")).trim() || null;
  const woId = str(pick(body, "wo_id", "woId")).trim() || null;
  const reason = has(body, "reason")
    ? str(pick(body, "reason")).trim() || null
    : null;
  // pct is a stored label only — it NEVER drives amount. Stored 2-dp, else null.
  const pctRaw = toNum(pick(body, "pct"));
  const pct = pctRaw != null ? pctRaw.toFixed(2) : null;

  // 4. vendor must belong to this tenant (scoped select — no cross-tenant leak).
  const [vendor] = (await db.select(
    vendors,
    eq(vendors.id, vendorId),
  )) as VendorRow[];
  if (!vendor) return badRequest(reply, "vendor not found in this tenant");

  // 5. each supplied po/wo ref must resolve to this tenant (fail closed).
  let refNo: string | null = null;
  if (poId) {
    const [po] = (await db.selectThrough(
      pos,
      PO_HOPS,
      eq(pos.id, poId),
    )) as PoRow[];
    if (!po) return badRequest(reply, "po_id not found in this tenant");
    refNo = po.no ?? null;
  }
  if (woId) {
    const [wo] = (await db.selectThrough(
      wos,
      WO_HOPS,
      eq(wos.id, woId),
    )) as WoRow[];
    if (!wo) return badRequest(reply, "wo_id not found in this tenant");
    refNo = refNo ?? wo.no ?? null;
  }

  // 6. accounts — resolve the posting COA codes in THIS tenant; a missing code is
  // an honest 409 (never post against an invented account — C-177).
  const acctIds = await resolveAccountIds(db, [ACCT.advanceToSupplier, ACCT.cash]);
  const advanceId = acctIds.get(ACCT.advanceToSupplier);
  const cashId = acctIds.get(ACCT.cash);
  if (!advanceId || !cashId) {
    return conflict(
      reply,
      "the tenant chart of accounts is missing a required posting account (advance-to-supplier / cash)",
    );
  }

  // Pre-resolve the ids so source_doc dep:<depositId> references the row, and the
  // JV number, before the transaction (deterministic reads outside the write block).
  const depositId = randomUUID();
  const no = await allocDepositNo(db);
  const jvNo = await allocJvNo(db);
  const jvId = randomUUID();
  // The prototype form has no currency selector — a deposit is THB (the ap_deposit
  // schema default); the JV inherits the deposit's currency (== THB).
  const currencyCode = "THB";
  const moneyAmount = moneyStr(amount);
  // Balanced double entry: Dr 1160 advance-to-supplier / Cr 1010 cash = amount.
  const lineRows: (typeof jvLines.$inferInsert)[] = [
    { jvId, accountId: advanceId, dr: moneyAmount, cr: moneyStr(0), currencyCode },
    { jvId, accountId: cashId, dr: moneyStr(0), cr: moneyAmount, currencyCode },
  ];

  // ONE transaction (mirror ar.ts createArInvoice + approveCn): the ap_deposit row,
  // the jv header + its lines are all-or-nothing. The JV amount reads the value
  // just stored on the deposit (money=SERVER). insertThrough re-proves this tenant
  // owns the just-created parent jv (jv_line has no company_id).
  let created: ApDepositRow;
  try {
    created = await db.transaction(async (tx) => {
      const [deposit] = (await tx
        .insert(apDeposits, {
          id: depositId,
          no,
          vendorId,
          poId,
          woId,
          reason,
          pct,
          amount: moneyAmount,
          used: "0",
          currencyCode,
          status: "approved",
        })
        .returning()) as ApDepositRow[];
      await tx
        .insert(jvs, {
          id: jvId,
          no: jvNo,
          sourceDoc: `dep:${depositId}`,
          memo: `vendor-deposit ${no}`,
        })
        .returning();
      await tx.insertThrough(jvLines, jvs, jvId, lineRows);
      return deposit!;
    });
  } catch (err) {
    // A concurrent/duplicate post trips the 0039 source_doc UNIQUE index — map it
    // to a 409 (never a 500, never a double post). Mirrors ar.ts approveCn.
    if (isUniqueViolation(err)) {
      return conflict(reply, `vendor deposit ${no} already posted`);
    }
    throw err;
  }

  return reply
    .code(201)
    .send(registerWire(created, vendor.name, refNo));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the AP vendor-deposit routes on the given (/api/v1-prefixed) scope. */
export function registerApDepositRoute(app: FastifyInstance): void {
  app.get("/ap/deposit", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return reply.code(200).send(listEnvelope(await listRegister(db)));
  });

  app.post("/ap/deposit", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createDeposit(
      db,
      request,
      (request.body ?? {}) as Record<string, unknown>,
      reply,
    );
  });
}
