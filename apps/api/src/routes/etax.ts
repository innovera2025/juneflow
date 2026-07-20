// e-Tax handlers — Phase-3 Finance Wave-0 (AR + e-Tax lane). Wires the etax.jsx
// e-Tax Invoice register: send a batch of queued AR invoices to the RD (a
// state-machine flip, FakeTaxEngine stub) and read the honest per-status
// aggregate. Registered in app.ts (registerEtaxRoute) by the orchestrator.
//
// Contract (openapi.yaml — declared opaque, NO openapi edit this wave):
//   POST /etax/send   → ActionOk    — send a queued batch   (sendEtax)
//   GET  /etax/status → EntityList  — per-status aggregate  (getEtaxStatus)
//
// HONEST stub (Wei B-124 — no fabricated compliance theater): POST /etax/send is
// a FakeTaxEngine stub — it does NOT call the real RD, and it fabricates NO ขบ.02
// acknowledgement or CA-cert. All it does is advance the e-Tax queue state machine
// (decision C4): an invoice whose etax_status is `queued` flips to `sent`; an
// already-sent/rejected/void invoice is left untouched. etax.jsx sendBatch does
// exactly this (pending → sent for the whole batch). The flips run in ONE
// db.transaction so the batch is all-or-nothing (B-097). GET /etax/status returns
// ONLY what etax_status really holds — the count of ar_invoice per status — never
// an invented RD receipt.
//
// Tenant scope (fail closed): ar_invoice carries company_id → the scoped
// TenantDb.select()/update() doors are company-scoped by construction, so a
// foreign invoice_id in the batch resolves to nothing (never read, never flipped,
// no leak). Without a resolved tenant, request.db is absent and every handler
// answers a flat 401.
//
// Financial authorization: POST /etax/send is a financial mutation → the caller
// must carry the `finance.create` perm (authz.ts loadCaller/permAllowed), fail
// closed 403. GET /etax/status is a read — like the AP/AR GETs it needs only a
// resolved tenant (401 fail-closed), no perm gate. AuditLog fires automatically
// (middleware) on the successful POST.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { inArray } from "drizzle-orm";
import { arInvoices, etaxStatus } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";
import { pick, str } from "./procurement.js";
import { loadCaller, permAllowed } from "./authz.js";

type ArInvoiceRow = typeof arInvoices.$inferSelect;

/** The perms-matrix module (seed MODULE_IDS) that governs finance mutations. */
const FINANCE_MODULE = "finance";

// ---------------------------------------------------------------------------
// Reply + authz helpers
// ---------------------------------------------------------------------------

/** Flat 401 (fail closed) when no tenant was resolved onto the request. */
function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Flat 400 VALIDATION error (contract Error shape). */
function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ code: "VALIDATION", message });
}

/** Flat 403 FORBIDDEN error (contract Error shape). */
function forbidden(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(403).send({ code: "FORBIDDEN", message });
}

/**
 * Fail-closed financial-authz gate: the caller must be attributable AND carry the
 * `finance.create` perm. On failure it sends the 403 and returns false; the
 * handler then returns the reply untouched. Mirrors the B-082 F1 model.
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
// POST /etax/send — flip a queued batch to sent (etax.jsx sendBatch)
// ---------------------------------------------------------------------------
// Body: { invoice_ids: [uuid] }. Enforced, in order:
//   - finance.create perm (403 fail-closed).
//   - invoice_ids a non-empty array (400 else).
// For each id resolved WITHIN this tenant (a foreign id resolves to nothing and
// is silently ignored — no leak): an invoice with etax_status `queued` flips to
// `sent` (C4 state machine queued → sent); already-sent/rejected/void invoices
// stay. This is a FakeTaxEngine stub — NO real RD send, NO fabricated ขบ.02
// acknowledgement (Wei B-124). The flips run in one db.transaction (B-097).
// Returns ActionOk with the count actually sent.
async function sendEtax(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinanceCreate(request, reply))) return reply;

  const rawIds = pick(body, "invoice_ids", "invoiceIds");
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return badRequest(reply, "invoice_ids must be a non-empty array");
  }
  const ids = [...new Set(rawIds.map((v) => str(v).trim()).filter((v) => v !== ""))];
  if (ids.length === 0) {
    return badRequest(reply, "invoice_ids must be a non-empty array");
  }

  // All-or-nothing (B-097): resolve the tenant-owned invoices, then flip only the
  // queued ones to sent in a single scoped UPDATE inside the transaction.
  const sentIds = await db.transaction(async (tx) => {
    const owned = (await tx.select(
      arInvoices,
      inArray(arInvoices.id, ids),
    )) as ArInvoiceRow[];
    const queuedIds = owned
      .filter((inv) => inv.etaxStatus === "queued")
      .map((inv) => inv.id);
    if (queuedIds.length > 0) {
      await tx
        .update(
          arInvoices,
          { etaxStatus: "sent" },
          inArray(arInvoices.id, queuedIds),
        )
        .returning();
    }
    return queuedIds;
  });

  return reply
    .code(200)
    .send({ ok: true, sent: sentIds.length, invoice_ids: sentIds });
}

// ---------------------------------------------------------------------------
// GET /etax/status — honest per-status aggregate (etax.jsx cnt(status))
// ---------------------------------------------------------------------------
// Returns the tenant-scoped count of ar_invoice grouped by etax_status, one row
// per enum value (queued | sent | rejected | void), 0-count buckets included so
// the domain is complete. This is the HONEST aggregate (Wei B-124) — only what
// etax_status really holds, never a fabricated RD-ack / CA-cert. EntityList shape.
async function getEtaxStatus(
  db: TenantDb,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const invoices = (await db.select(arInvoices)) as ArInvoiceRow[];
  const counts = new Map<string, number>();
  for (const status of etaxStatus.enumValues) counts.set(status, 0);
  for (const inv of invoices) {
    counts.set(inv.etaxStatus, (counts.get(inv.etaxStatus) ?? 0) + 1);
  }
  const rows = etaxStatus.enumValues.map((status) => ({
    etax_status: status,
    count: counts.get(status) ?? 0,
  }));
  return reply.code(200).send(listEnvelope(rows));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the e-Tax routes on the given (/api/v1-prefixed) scope. */
export function registerEtaxRoute(app: FastifyInstance): void {
  app.post("/etax/send", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return sendEtax(
      db,
      request,
      (request.body ?? {}) as Record<string, unknown>,
      reply,
    );
  });

  app.get("/etax/status", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return getEtaxStatus(db, reply);
  });
}
