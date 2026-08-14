// GL revenue-recognition + WIP handlers (B-230 · Wei=ก FULL) — the accounting-
// extra.jsx RevRec / WIP lane. Two reads + two MONEY-CRITICAL posts:
//   GET  /gl/revrec              → EntityList — recognition rows (unbilled derived)
//   POST /gl/revrec/{id}/post    → ActionOk   — recognize revenue → balanced JV
//   GET  /gl/wip                 → EntityList — WIP cost balances (balance derived)
//   POST /gl/wip/{id}/transfer   → ActionOk   — move WIP → COGS → balanced JV
// Each row/body is the opaque Entity (snake_case wire of REAL columns). Registered
// in app.ts (registerRevRecRoute) by the orchestrator.
//
// Money is SERVER authority (B-107a · Wei C-176 · mirrors ar.ts / land-sales.ts):
//   - RECOGNIZE: the incremental amount is COMPUTED server-side, `due =
//     max(0, round2(contract_amount × pct / 100) − already-recognized)`. The
//     request body is IGNORED for money (it is an optional opaque Entity only). A
//     row already recognized to its pct target has due ≤ 0 → 409 (never a 0-value
//     or negative JV). The JV is Dr 1130 contract-asset / Cr 4020 construction-
//     revenue = due (balanced).
//   - TRANSFER: the client sends `amount` (a legitimate operator input — how much
//     WIP to move this tranche), VALIDATED against the remaining WIP balance and
//     REJECTED (never clamped) when it over-transfers. The JV is Dr 5010 COGS /
//     Cr 1140 WIP = amount (balanced).
//
// DOUBLE-POST SAFETY (verify-chain-atomicity + verify-seq-count-dedup lessons):
// neither post uses a per-doc idempotency key — a rev_rec is legitimately posted
// across multiple periods (pct 20% → 40% → …) and a WIP is transferred in several
// tranches, so a unique source_doc would falsely dedupe a real later post. The
// guard is instead an ATOMIC COMPARE-AND-SWAP on the parent's OWN money column,
// folded into the FINAL UPDATE's WHERE (NOT a pre-check read):
//   UPDATE rev_rec SET recognized = prev+due, posted = true
//     WHERE id = :id AND recognized = :prev          (company_id AND-ed by the door)
// Under READ COMMITTED a concurrent post that already advanced `recognized`
// re-checks this predicate against the committed row and matches 0 rows → we throw
// to ROLL BACK the whole transaction (no JV, no ledger row, no double-recognition)
// → 409. A SERIALIZED re-post reads the new `recognized`, so `due` computes to 0 →
// the due ≤ 0 gate 409s first. The two together close both the concurrent and the
// serialized double-post (a CAS on the money column, never a count-derived key).
// Each event is recorded in the rev_rec_txn / wip_transfer_txn ledger (audit +
// the JV's source_doc anchor `revrec:<eventId>` / `wip-transfer:<eventId>`, unique
// per event so legitimate multi-period posts never collide).
//
// Tenant scope (fail closed): rev_rec, wip, rev_rec_txn, wip_transfer_txn and jv
// all carry company_id → the scoped TenantDb.select()/insert()/update() doors.
// jv_line hangs off jv (no company_id) → written through insertThrough() (which
// re-proves this tenant owns the parent jv inside the same tx). Without a resolved
// tenant, request.db is absent and every handler answers a flat 401.
//
// AUTHZ (B-394): both posts are gated on the finance `approve` right, not merely
// the tenant door — they LOCK money into the ledger, which /gl/post and
// /gl/close-period (gl.ts) already establish in-code as a priority action. `approve`
// rather than the land-sales `create`: that gate covers operational sales documents
// that incidentally post a JV, whereas a /gl/ posting action IS the posting. The
// spec handler signatures carry no `request`, so the gate sits at the registration.
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import {
  jvLines,
  jvs,
  projects,
  revRecTxns,
  revRecs,
  wipTransferTxns,
  wips,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { pick, toNum } from "./procurement.js";
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
import { loadCaller, permAllowed } from "./authz.js";

/** Financial-authz module key (B-082 F1). */
const FINANCE_MODULE = "finance";

type RevRecRow = typeof revRecs.$inferSelect;
type WipRow = typeof wips.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

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

/** Flat 403 FORBIDDEN (financial-authz fail-closed). */
function forbidden(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(403).send({ code: "FORBIDDEN", message });
}

/**
 * B-394 financial gate for the two JV-POSTING handlers (revrec post / wip
 * transfer). Locking money into the ledger requires the finance `approve`
 * permission — not merely a resolved tenant — so a view-only in-tenant user (the
 * seeded `exec`) cannot recognize revenue. The two GET reads stay tenant-only
 * (view-level). Sends the 403 and returns false on failure.
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
    forbidden(
      reply,
      "GL posting (revrec / WIP transfer) requires the finance approve permission",
    );
    return false;
  }
  return true;
}

/**
 * Thrown INSIDE a posting transaction when the optimistic-lock compare-and-swap
 * matches 0 rows, to force drizzle to ROLL BACK the whole transaction (a return
 * cannot unwind a tx — only a throw does). The caller catches it and maps it to
 * the 409 the concurrent-post case reports.
 */
class ConcurrentPostError extends Error {
  constructor(message = "CONCURRENT_POST") {
    super(message);
    this.name = "ConcurrentPostError";
  }
}

// ---------------------------------------------------------------------------
// Money + parse helpers
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

// ---------------------------------------------------------------------------
// Wire serializers (snake_case wire of the REAL columns; derived fields honest)
// ---------------------------------------------------------------------------

function revRecWire(
  r: RevRecRow,
  projName: Map<string, string | null>,
): Record<string, unknown> {
  const recognized = num(r.recognized);
  const billed = num(r.billed);
  return {
    id: r.id,
    project_id: r.projectId,
    project_name: r.projectId ? projName.get(r.projectId) ?? null : null,
    method: r.method,
    contract_amount: num(r.contractAmount),
    pct: num(r.pct),
    recognized,
    billed,
    // Derived (accounting-extra.jsx): recognized-but-not-yet-billed revenue.
    unbilled: round2(recognized - billed),
    currency_code: r.currencyCode,
    posted: r.posted,
  };
}

function wipWire(
  w: WipRow,
  projName: Map<string, string | null>,
): Record<string, unknown> {
  const material = num(w.material);
  const subcon = num(w.subcon);
  const overhead = num(w.overhead);
  const transferred = num(w.transferred);
  return {
    id: w.id,
    project_id: w.projectId,
    project_name: w.projectId ? projName.get(w.projectId) ?? null : null,
    material,
    subcon,
    overhead,
    transferred,
    // Derived (accounting-extra.jsx): cost still sitting in WIP, not yet in COGS.
    balance: round2(material + subcon + overhead - transferred),
    currency_code: w.currencyCode,
  };
}

// ---------------------------------------------------------------------------
// GET /gl/revrec — revenue-recognition rows (accounting-extra.jsx RevRec)
// ---------------------------------------------------------------------------
async function listGlRevRec(db: TenantDb): Promise<Record<string, unknown>[]> {
  const [rows, projectRows] = await Promise.all([
    db.select(revRecs) as Promise<RevRecRow[]>,
    db.select(projects) as Promise<ProjectRow[]>,
  ]);
  const projName = new Map(projectRows.map((p) => [p.id, p.name]));
  return rows.map((r) => revRecWire(r, projName));
}

// ---------------------------------------------------------------------------
// POST /gl/revrec/{id}/post — recognize revenue (accounting-extra.jsx RevRec post)
// ---------------------------------------------------------------------------
// MONEY-CRITICAL. Load the rev_rec (scoped → 404). due = max(0, contract × pct /
// 100 − already-recognized) — server-computed, body IGNORED. due ≤ 0 → 409. Post a
// balanced JV Dr 1130 / Cr 4020 = due + one rev_rec_txn ledger row, then the atomic
// compare-and-swap on `recognized` as the FINAL statement (0 rows → roll back →
// 409). Returns ActionOk { id, jv_no, recognized, due }.
async function postGlRevRec(
  db: TenantDb,
  id: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [rev] = (await db.select(revRecs, eq(revRecs.id, id))) as RevRecRow[];
  if (!rev) return notFound(reply, `revenue-recognition ${id} not found`);

  const prevRecognized = num(rev.recognized);
  const pct = num(rev.pct);
  const target = round2((num(rev.contractAmount) * pct) / 100);
  const due = round2(Math.max(0, round2(target - prevRecognized)));
  if (due <= 0) {
    return conflict(
      reply,
      `revenue-recognition ${id} is already recognized to its ${pct}% target — nothing to recognize`,
    );
  }

  // Resolve the posting accounts in THIS tenant's COA; a missing code is an honest
  // 409 (never post an unbalanced / mis-accounted JV — gl-post.ts C-177).
  const acctIds = await resolveAccountIds(db, [
    ACCT.contractAsset,
    ACCT.constructionRevenue,
  ]);
  const contractAssetId = acctIds.get(ACCT.contractAsset);
  const revenueId = acctIds.get(ACCT.constructionRevenue);
  if (!contractAssetId || !revenueId) {
    return conflict(
      reply,
      "the tenant chart of accounts is missing a required posting account (contract-asset 1130 / construction-revenue 4020)",
    );
  }

  // B-318: assigned INSIDE allocThenPost below (a retry must re-read the max).
  let jvNo = "";
  const jvId = randomUUID();
  const txnId = randomUUID();
  const currencyCode = rev.currencyCode ?? "THB";
  const newRecognized = round2(prevRecognized + due);
  // The CAS predicate matches the EXACT stored value pre-read (a raw numeric
  // string, or NULL). A concurrent post that already moved `recognized` fails this
  // on the FINAL UPDATE (verify-chain-atomicity — never a pre-check read).
  const recognizedGuard =
    rev.recognized == null
      ? isNull(revRecs.recognized)
      : eq(revRecs.recognized, rev.recognized);

  const lineRows: (typeof jvLines.$inferInsert)[] = [
    { jvId, accountId: contractAssetId, dr: moneyStr(due), cr: moneyStr(0), currencyCode },
    { jvId, accountId: revenueId, dr: moneyStr(0), cr: moneyStr(due), currencyCode },
  ];

  // B-318: allocate + post is ONE retryable unit (see withDocNoRetry). The CAS
  // guard below re-reads nothing across attempts — the rolled-back attempt left
  // `recognized` untouched, so the same pre-read guard still holds.
  const allocThenPost = async (): Promise<void> => {
    jvNo = await allocJvNo(db);
    await db.transaction(async (tx) => {
      await tx
        .insert(jvs, {
          id: jvId,
          no: jvNo,
          sourceDoc: `revrec:${txnId}`,
          memo: `revrec ${id} @ ${pct}%`,
        })
        .returning();
      await tx.insertThrough(jvLines, jvs, jvId, lineRows);
      await tx
        .insert(revRecTxns, {
          id: txnId,
          revRecId: id,
          amount: moneyStr(due),
          jvId,
          currencyCode,
        })
        .returning();
      // ATOMIC GUARD — the FINAL statement. company_id is AND-ed by the door; the
      // caller predicate folds in id + the pre-read `recognized` (compare-and-swap).
      const updated = (await tx
        .update(
          revRecs,
          { recognized: moneyStr(newRecognized), posted: true },
          and(eq(revRecs.id, id), recognizedGuard),
        )
        .returning()) as RevRecRow[];
      if (updated.length === 0) throw new ConcurrentPostError();
    });
  };
  try {
    await withDocNoRetry(allocThenPost);
  } catch (err) {
    // B-318 FIRST: JV-number allocation lost the race to exhaustion. Nothing
    // committed — distinct from the CAS loss below, which IS a real conflict.
    if (err instanceof DocNoExhaustedError) return docNoExhausted(reply);
    // A concurrent post won the CAS (0 rows) → the whole tx rolled back → 409.
    if (err instanceof ConcurrentPostError) {
      return conflict(reply, `revenue-recognition ${id} was concurrently posted — retry`);
    }
    // Defensive: a fresh-uuid source_doc cannot collide, but keep the idempotent
    // mapping consistent with the other money posts (never a 500).
    if (isUniqueViolation(err)) {
      return conflict(reply, `revenue-recognition ${id} was concurrently posted — retry`);
    }
    throw err;
  }

  return reply.code(200).send({ id, jv_no: jvNo, recognized: newRecognized, due });
}

// ---------------------------------------------------------------------------
// GET /gl/wip — work-in-progress cost balances (accounting-extra.jsx WIP)
// ---------------------------------------------------------------------------
async function listGlWip(db: TenantDb): Promise<Record<string, unknown>[]> {
  const [rows, projectRows] = await Promise.all([
    db.select(wips) as Promise<WipRow[]>,
    db.select(projects) as Promise<ProjectRow[]>,
  ]);
  const projName = new Map(projectRows.map((p) => [p.id, p.name]));
  return rows.map((w) => wipWire(w, projName));
}

// ---------------------------------------------------------------------------
// POST /gl/wip/{id}/transfer — move WIP → COGS (accounting-extra.jsx WIP transfer)
// ---------------------------------------------------------------------------
// MONEY-CRITICAL. Load the wip (scoped → 404). amount is the operator's tranche
// (validated finite > 0 → 400; over the remaining balance → 409, REJECT never
// clamp). Post a balanced JV Dr 5010 / Cr 1140 = amount + one wip_transfer_txn
// ledger row, then the atomic compare-and-swap on `transferred` as the FINAL
// statement (0 rows → roll back → 409). Returns ActionOk { id, jv_no, transferred }.
async function transferGlWip(
  db: TenantDb,
  id: string,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [wip] = (await db.select(wips, eq(wips.id, id))) as WipRow[];
  if (!wip) return notFound(reply, `WIP ${id} not found`);

  const prevTransferred = num(wip.transferred);
  const balance = round2(
    num(wip.material) + num(wip.subcon) + num(wip.overhead) - prevTransferred,
  );

  const rawAmount = toNum(pick(body, "amount"));
  if (rawAmount == null || rawAmount <= 0) {
    return badRequest(reply, "amount is required and must be greater than zero");
  }
  const amount = round2(rawAmount);
  // Over-balance guard (REJECT, never clamp): a transfer cannot move more than the
  // cost still sitting in WIP. The CAS below also closes the concurrent double-move.
  if (amount > balance) {
    return conflict(reply, `transfer ${amount} exceeds the WIP balance ${balance}`);
  }

  const acctIds = await resolveAccountIds(db, [ACCT.cogs, ACCT.wip]);
  const cogsId = acctIds.get(ACCT.cogs);
  const wipAcctId = acctIds.get(ACCT.wip);
  if (!cogsId || !wipAcctId) {
    return conflict(
      reply,
      "the tenant chart of accounts is missing a required posting account (COGS 5010 / WIP 1140)",
    );
  }

  // B-318: assigned INSIDE allocThenTransfer below (a retry must re-read the max).
  let jvNo = "";
  const jvId = randomUUID();
  const txnId = randomUUID();
  const currencyCode = wip.currencyCode ?? "THB";
  const newTransferred = round2(prevTransferred + amount);
  const transferredGuard =
    wip.transferred == null
      ? isNull(wips.transferred)
      : eq(wips.transferred, wip.transferred);

  const lineRows: (typeof jvLines.$inferInsert)[] = [
    { jvId, accountId: cogsId, dr: moneyStr(amount), cr: moneyStr(0), currencyCode },
    { jvId, accountId: wipAcctId, dr: moneyStr(0), cr: moneyStr(amount), currencyCode },
  ];

  // B-318: allocate + post is ONE retryable unit (see withDocNoRetry).
  const allocThenTransfer = async (): Promise<void> => {
    jvNo = await allocJvNo(db);
    await db.transaction(async (tx) => {
      await tx
        .insert(jvs, {
          id: jvId,
          no: jvNo,
          sourceDoc: `wip-transfer:${txnId}`,
          memo: `wip-transfer ${id}`,
        })
        .returning();
      await tx.insertThrough(jvLines, jvs, jvId, lineRows);
      await tx
        .insert(wipTransferTxns, {
          id: txnId,
          wipId: id,
          amount: moneyStr(amount),
          jvId,
          currencyCode,
        })
        .returning();
      // ATOMIC GUARD — the FINAL statement (compare-and-swap on `transferred`).
      const updated = (await tx
        .update(
          wips,
          { transferred: moneyStr(newTransferred) },
          and(eq(wips.id, id), transferredGuard),
        )
        .returning()) as WipRow[];
      if (updated.length === 0) throw new ConcurrentPostError();
    });
  };
  try {
    await withDocNoRetry(allocThenTransfer);
  } catch (err) {
    // B-318 FIRST: JV-number allocation lost the race to exhaustion (nothing
    // committed) — distinct from the CAS loss below, which IS a real conflict.
    if (err instanceof DocNoExhaustedError) return docNoExhausted(reply);
    if (err instanceof ConcurrentPostError) {
      return conflict(reply, `WIP ${id} was concurrently transferred — retry`);
    }
    if (isUniqueViolation(err)) {
      return conflict(reply, `WIP ${id} was concurrently transferred — retry`);
    }
    throw err;
  }

  return reply.code(200).send({ id, jv_no: jvNo, transferred: newTransferred });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the GL revrec + WIP routes on the (already /api/v1-prefixed) scope. */
export function registerRevRecRoute(app: FastifyInstance): void {
  const body = (request: FastifyRequest): Record<string, unknown> =>
    (request.body ?? {}) as Record<string, unknown>;
  const idParam = (request: FastifyRequest): string =>
    (request.params as { id?: string }).id ?? "";

  app.get("/gl/revrec", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return reply.code(200).send(listEnvelope(await listGlRevRec(db)));
  });

  // B-394 finance.approve gate — posts money (see the AUTHZ header note).
  app.post("/gl/revrec/:id/post", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    if (!(await requireFinanceApprove(request, reply))) return reply;
    return postGlRevRec(db, idParam(request), reply);
  });

  app.get("/gl/wip", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return reply.code(200).send(listEnvelope(await listGlWip(db)));
  });

  // B-394 finance.approve gate — posts money (see the AUTHZ header note).
  app.post("/gl/wip/:id/transfer", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    if (!(await requireFinanceApprove(request, reply))) return reply;
    return transferGlWip(db, idParam(request), body(request), reply);
  });
}
