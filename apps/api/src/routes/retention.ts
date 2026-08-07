// Retention handlers — Phase-3 Finance (retention release, P2-BE-53 · B-125=ก).
// The retention register lists the retained-money ledgers held back from a
// subcon/vendor (accounting-extra2.jsx APRetention), and the release action pays
// the outstanding balance back to the vendor by posting a balanced JV. Registered
// in app.ts (registerRetentionRoute) by the orchestrator — this file wires the
// handlers only (NO app.ts / openapi / migration / gl-post.ts edits).
//
// Contract (openapi.yaml §finance — declared opaque, NO openapi edit this task):
//   GET  /retention          → EntityList  — the held-retention register
//   POST /retention/release  → ActionOk    — release the outstanding balance
// Each row/body is the opaque Entity (snake_case wire of REAL columns + honest
// derivations). A read/POST on an opaque endpoint needs no contract change.
//
// MONEY = SERVER AUTHORITY (gate-4.5 hard rule): the release amount is COMPUTED
// server-side from the stored withheld/returned columns — the body carries ONLY
// { ledger_id }, never an amount. One release pays the ENTIRE outstanding balance
// (round2(withheld − returned)); it does not accept or split a client tranche.
// The prototype's APRetention exposes exactly one "คืนเงิน" control that does
// `returned := withheld; status := 'done'` (a full one-shot), so Phase-3 collapses
// B-107d's 50%-handover/50%-warranty INTENT to ONE producible release: the
// warranty (12-month) tranche gated on held + due — there is no handover-tranche
// event producer in Phase-3 (subcon CheckRows are display-only), so it is never
// emitted early (open_questions A/B — the defensible reading implemented now).
//
// DIRECTION (vendor-retention-is-a-liability): retention_ledger carries wo_id +
// vendor_id → it is money we WITHHELD from a subcon (a liability, acct 2030);
// releasing it PAYS the vendor. So the release posts ONE balanced JV:
//   Dr 2030 retention-payable  (reduce the liability)  = balance
//   Cr 1020 bank               (reduce cash)           = balance
// (byte-for-byte the prototype note "Dr 2030 เจ้าหนี้เงินประกัน / Cr เงินฝากธนาคาร").
//
// C10 HONEST (flagged, never fabricated):
//   - due_date is DERIVED (dueDate ?? created_at + 12 months) because the seed
//     leaves the column null (B-125 "due-date visibility จาก created_at+12mo").
//   - vendor_name / contract_value are JOINED (scoped), null when unresolved —
//     the ledger stores no contract amount, so contract_value comes from the
//     subcon_contract.value column (the prototype's "มูลค่าสัญญา" column).
//   - remaining is SERVER-computed (withheld − returned), never stored.
//   - the display status is DERIVED from the real columns (the stored `status`
//     is a bare 'held' placeholder); the prototype's 'withholding' code has no
//     per-period deduction-progress source and is honestly folded into 'holding'.
//
// Tenant scope (fail closed): retention_ledger + vendor + jv carry company_id →
// the scoped TenantDb.select()/update() doors. subcon_contract carries no
// company_id (it anchors through project) → read via selectThrough. jv_line hangs
// off jv (no company_id) → written through insertThrough (re-verifies this tenant
// owns the just-created parent jv). Without a resolved tenant, request.db is
// absent → flat 401.
//
// Financial-authz (B-082 F1): releasing money gates the finance `approve` right
// (loadCaller/permAllowed) — fail-closed 403 for an unattributable caller or one
// lacking the perm. The register read gates on the resolved tenant only (401
// else). AuditLog fires automatically (middleware) on a 2xx.
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import {
  jvLines,
  jvs,
  projects,
  retentionLedgers,
  subconContracts,
  vendors,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { pick, str } from "./procurement.js";
import { loadCaller, permAllowed } from "./authz.js";
import { listEnvelope } from "./list-envelope.js";
import {
  ACCT,
  allocJvNo,
  docNoExhausted,
  DocNoExhaustedError,
  isUniqueViolation,
  resolveAccountIds,
  withDocNoRetry,
} from "./gl-post.js";

type RetentionLedgerRow = typeof retentionLedgers.$inferSelect;
type VendorRow = typeof vendors.$inferSelect;
type SubconContractRow = typeof subconContracts.$inferSelect;
type JvRow = typeof jvs.$inferSelect;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The perms-matrix module (seed MODULE_IDS) that governs finance mutations. */
const FINANCE_MODULE = "finance";

/** Milliseconds in a day — the days-until-due arithmetic. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The warranty period (months) after which a held retention becomes due when the
 * ledger stores no explicit due_date (B-125 "due-date visibility จาก
 * created_at+12mo"). The seed leaves due_date null on all 4 rows, so the effective
 * due is created_at + 12 months.
 */
const RETENTION_DUE_MONTHS = 12;

/** subcon_contract has no company_id — it anchors through project (its scoped root). */
const SUBCON_CONTRACT_HOPS = [
  { fk: subconContracts.projectId, parent: projects },
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

/** Flat 404 NOT_FOUND error. */
function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ code: "NOT_FOUND", message });
}

/** Flat 409 INVALID_STATE error. */
function conflict(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(409).send({ code: "INVALID_STATE", message });
}

// ---------------------------------------------------------------------------
// Money + parse helpers
// ---------------------------------------------------------------------------

/** A computed 2-dp money magnitude as the numeric-column string ("40000.00"). */
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
 * The effective due date as epoch ms (C10 — DERIVED whenever the stored column is
 * null): the stored due_date when present, else created_at + 12 months (B-125).
 * Null only when neither is resolvable (defensive — created_at is NOT NULL).
 */
function dueMsOf(ledger: {
  dueDate: string | null;
  createdAt: Date | null;
}): number | null {
  if (ledger.dueDate) {
    const t = new Date(ledger.dueDate).getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (ledger.createdAt) {
    const d = new Date(ledger.createdAt);
    d.setUTCMonth(d.getUTCMonth() + RETENTION_DUE_MONTHS);
    const t = d.getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** A due-ms rendered as the 'YYYY-MM-DD' date wire (UTC), or null. */
function isoDate(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString().slice(0, 10);
}

/**
 * The prototype-facing display status, DERIVED from the real columns (the stored
 * `status` is a bare 'held' placeholder). The 'withholding' prototype code has no
 * per-period deduction-progress source and is honestly folded into 'holding'.
 */
function deriveStatus(args: {
  withheld: number;
  returned: number;
  remaining: number;
  stored: string | null;
  dueMs: number | null;
  nowMs: number;
}): string {
  const { withheld, returned, remaining, stored, dueMs, nowMs } = args;
  if (stored === "released") return "done";
  if (withheld > 0 && returned >= withheld) return "done";
  if (returned > 0 && returned < withheld) return "partial";
  if (remaining > 0 && dueMs != null && nowMs >= dueMs) return "due";
  return "holding";
}

// ---------------------------------------------------------------------------
// Financial-authz gate (B-082 F1 model — invents no new policy)
// ---------------------------------------------------------------------------

/**
 * Fail-closed gate for the release: the caller must be attributable AND carry the
 * `finance.approve` perm (releasing money = an approval). Sends the 403 and
 * returns false on failure. Mirrors ar.ts requireFinanceApprove.
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
// GET /retention — the held-retention register (accounting-extra2.jsx APRetention)
// ---------------------------------------------------------------------------
// Authenticated (openapi declares only 401). Reads the tenant's retention_ledger
// (company-scoped), joins vendor_name (scoped vendor) + contract_value (scoped
// subcon_contract.value via selectThrough), and per row emits STORED columns +
// server-computed remaining + DERIVED due_date/status. Full tenant set as one page
// (B-014 listEnvelope, mirrors companies.ts/projects.ts). Newest-first.
function registerWire(
  ledger: RetentionLedgerRow,
  vendorName: string | null,
  contractValue: number | null,
  nowMs: number,
): Record<string, unknown> {
  const withheld = num(ledger.withheld);
  const returned = num(ledger.returned);
  // SERVER-computed outstanding — never stored, never a client value.
  const remaining = round2(withheld - returned);
  // DERIVED due (C10 — the stored column is null in the seed).
  const dueMs = dueMsOf(ledger);
  const dueDate = isoDate(dueMs);
  const daysUntilDue =
    dueMs == null ? null : Math.floor((dueMs - nowMs) / MS_PER_DAY);
  const status = deriveStatus({
    withheld,
    returned,
    remaining,
    stored: ledger.status,
    dueMs,
    nowMs,
  });
  return {
    // STORED (straight from retention_ledger).
    id: ledger.id,
    wo_id: ledger.woId,
    vendor_id: ledger.vendorId,
    contract_id: ledger.contractId,
    scope: ledger.scope,
    rate: ledger.rate == null ? null : num(ledger.rate),
    withheld,
    returned,
    currency_code: ledger.currencyCode,
    created_at: ledger.createdAt,
    // HONEST-JOINED (nullable — null when the ref is null/unresolved).
    vendor_name: vendorName,
    contract_value: contractValue,
    // SERVER-COMPUTED.
    remaining,
    // DERIVED (C10-honest).
    due_date: dueDate,
    days_until_due: daysUntilDue,
    status,
  };
}

async function listRegister(db: TenantDb): Promise<Record<string, unknown>[]> {
  const [ledgers, vendorRows, contractRows] = await Promise.all([
    db.select(retentionLedgers) as Promise<RetentionLedgerRow[]>,
    db.select(vendors) as Promise<VendorRow[]>,
    // subcon_contract has no company_id — scoped THROUGH project (its tenant root).
    db.selectThrough(
      subconContracts,
      SUBCON_CONTRACT_HOPS,
    ) as Promise<SubconContractRow[]>,
  ]);
  const vendorName = new Map(vendorRows.map((v) => [v.id, v.name]));
  const contractValue = new Map(contractRows.map((c) => [c.id, num(c.value)]));
  const nowMs = Date.now();
  return newestFirst(ledgers).map((l) =>
    registerWire(
      l,
      l.vendorId ? vendorName.get(l.vendorId) ?? null : null,
      l.contractId ? contractValue.get(l.contractId) ?? null : null,
      nowMs,
    ),
  );
}

// ---------------------------------------------------------------------------
// POST /retention/release — release the outstanding balance (APRetention "คืนเงิน")
// ---------------------------------------------------------------------------
// Body (opaque Entity): { ledger_id } ONLY — money=SERVER, no amount field. One
// call releases the ENTIRE outstanding balance (round2(withheld − returned)).
// Gated fail-closed, IN ORDER (mirrors ar.ts approveCn / requireFinanceApprove):
//   1. authz: finance.approve (releasing money) → 403.
//   2. validation: ledger_id required → 400.
//   3. tenant door: the ledger must be THIS tenant's (scoped select → 404).
//   4. outstanding: balance = round2(withheld − returned); ≤ 0 → 409 (nothing to
//      return / already fully released).
//   5. held + due-12mo (the core B-125 gate): stored status=='held' AND today ≥
//      (dueDate ?? created_at + 12mo) → else 409 (warranty period not elapsed).
//   6. accounts: resolve 2030 + 1020 in THIS tenant's COA; a missing code → 409
//      honest (never invent an account — gl-post.ts C-177).
// On success, ONE db.transaction: post a balanced JV (Dr 2030 / Cr 1020 = balance,
// source_doc `ret:<ledgerId>:<seq>`), and flip the ledger (returned := withheld,
// status := 'released' — the terminal 'done'). Idempotent + race-safe: the
// source_doc is unique under the 0038 index → a duplicate release trips 23505 →
// isUniqueViolation → 409 (never a 500, never a double PV). AuditLog on the 2xx.
async function releaseRetention(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  // 1. authz — releasing money requires finance.approve (fail-closed 403).
  if (!(await requireFinanceApprove(request, reply))) return reply;

  // 2. validation.
  const ledgerId = str(pick(body, "ledger_id", "ledgerId")).trim();
  if (!ledgerId) return badRequest(reply, "ledger_id is required");

  // 3. tenant door — the ledger must belong to THIS tenant (scoped select → 404).
  const [ledger] = (await db.select(
    retentionLedgers,
    eq(retentionLedgers.id, ledgerId),
  )) as RetentionLedgerRow[];
  if (!ledger) return notFound(reply, `retention ledger ${ledgerId} not found`);

  // 4. outstanding — SERVER-computed balance; both operands are stored columns.
  const withheld = num(ledger.withheld);
  const returned = num(ledger.returned);
  const balance = round2(withheld - returned);
  if (balance <= 0) {
    return conflict(
      reply,
      "retention ledger has no outstanding balance to release",
    );
  }

  // 5. held + due-12mo — the core B-125 gate. The stored status must be 'held'
  // and the effective due (dueDate ?? created_at + 12 months) must have elapsed.
  if (ledger.status !== "held") {
    return conflict(
      reply,
      "retention ledger is not in a releasable (held) state",
    );
  }
  const dueMs = dueMsOf(ledger);
  const nowMs = Date.now();
  if (dueMs == null || nowMs < dueMs) {
    return conflict(
      reply,
      "retention not yet due — the 12-month warranty period has not elapsed",
    );
  }

  // 6. accounts — resolve the posting COA codes in THIS tenant; a missing code is
  // an honest 409 (never post against an invented account — C-177).
  const acctIds = await resolveAccountIds(db, [ACCT.retentionPayable, ACCT.bank]);
  const retentionPayableId = acctIds.get(ACCT.retentionPayable);
  const bankId = acctIds.get(ACCT.bank);
  if (!retentionPayableId || !bankId) {
    return conflict(
      reply,
      "the tenant chart of accounts is missing a required posting account (retention-payable / bank)",
    );
  }

  // TRANCHE: releaseAmount = the full outstanding balance. seq keeps the
  // source_doc unique under the 0038 index — a ledger already partially returned
  // upstream (returned>0) completes at seq 2; the fresh-seed case is seq 1 = 100%.
  const seq = returned === 0 ? 1 : 2;
  const sourceDoc = `ret:${ledgerId}:${seq}`;

  // Idempotency pre-check: a release JV already carrying this source_doc → 409
  // (the balance ≤ 0 gate already blocks re-release of a fully-returned ledger;
  // the mandatory backstop is the 23505 catch on the transaction below).
  const priorJv = (await db.select(
    jvs,
    eq(jvs.sourceDoc, sourceDoc),
  )) as JvRow[];
  if (priorJv.length > 0) {
    return conflict(reply, `retention ledger ${ledgerId} already released`);
  }

  // B-318: assigned INSIDE allocThenRelease below (a retry must re-read the max).
  let jvNo = "";
  const jvId = randomUUID();
  const currencyCode = ledger.currencyCode ?? "THB";
  // Balanced double entry: Dr 2030 retention-payable / Cr 1020 bank = balance.
  const lineRows: (typeof jvLines.$inferInsert)[] = [
    { jvId, accountId: retentionPayableId, dr: moneyStr(balance), cr: moneyStr(0), currencyCode },
    { jvId, accountId: bankId, dr: moneyStr(0), cr: moneyStr(balance), currencyCode },
  ];

  // ONE transaction (mirror ar.ts approveCn + fa.ts writeOff): jv header + its
  // lines + the ledger flip are all-or-nothing. insertThrough re-proves this
  // tenant owns the just-created parent jv (jv_line has no company_id).
  // B-318: allocate + release is ONE retryable unit (see withDocNoRetry). The
  // ledger flip is inside the tx, so a losing attempt un-flips on rollback.
  const allocThenRelease = async (): Promise<void> => {
    jvNo = await allocJvNo(db);
    await db.transaction(async (tx) => {
      await tx
        .insert(jvs, {
          id: jvId,
          no: jvNo,
          sourceDoc,
          memo: `retention-release ${ledgerId}:${seq}`,
        })
        .returning();
      await tx.insertThrough(jvLines, jvs, jvId, lineRows);
      // Terminal flip: returned := withheld, status := 'released' (the prototype's
      // 'done'; the register derives 'released'|returned>=withheld → 'done').
      await tx
        .update(
          retentionLedgers,
          { returned: moneyStr(withheld), status: "released" },
          eq(retentionLedgers.id, ledgerId),
        )
        .returning();
    });
  };
  try {
    await withDocNoRetry(allocThenRelease);
  } catch (err) {
    // B-318 FIRST: JV-number allocation lost the race to exhaustion. Nothing
    // committed — a 409 here would falsely claim the retention was already released.
    if (err instanceof DocNoExhaustedError) return docNoExhausted(reply);
    // A concurrent/duplicate release trips the 0038 source_doc UNIQUE index — map
    // it to the same 409 as the pre-check (never a 500, never a double PV).
    if (isUniqueViolation(err)) {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: `retention ledger ${ledgerId} already released`,
      });
    }
    throw err;
  }

  return reply
    .code(200)
    .send({ id: ledgerId, jv_no: jvNo, amount: balance, status: "released" });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the retention routes on the given (/api/v1-prefixed) scope. */
export function registerRetentionRoute(app: FastifyInstance): void {
  const body = (request: FastifyRequest): Record<string, unknown> =>
    (request.body ?? {}) as Record<string, unknown>;

  app.get("/retention", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return reply.code(200).send(listEnvelope(await listRegister(db)));
  });

  app.post("/retention/release", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return releaseRetention(db, request, body(request), reply);
  });
}
