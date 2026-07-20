// AR (accounts-receivable) handlers — Phase-3 Finance Wave-0 (AR + e-Tax lane).
// Wires the ar.jsx ARInvoice + ReceiveVoucher screens: create a customer
// invoice (server-authoritative money) and record a receipt voucher (RV) against
// it. Registered in app.ts (registerArRoute) by the orchestrator.
//
// Contract (openapi.yaml — declared opaque, NO openapi edit this wave):
//   POST /ar/invoices → EntityCreated  — create an AR invoice   (createArInvoice)
//   POST /ar/rv       → EntityCreated  — record a receipt (RV)  (createArRv)
// Each body/row is the opaque Entity (snake_case wire of REAL columns). A POST on
// an opaque endpoint needs no contract change (FLOW-A opaque-Entity finding).
//
// Money is SERVER authority (B-107a · Wei C-176): the client-supplied amount/vat
// are IGNORED. An AR invoice's amount is Σ(line.qty × line.price) and its VAT is
// the 7% Thai output tax computed through @juneflow/tax-engine.calcVat (the typed
// fake-first compliance engine — NOT inline float math — so the real RD driver
// swaps in behind the same interface). An RV's amount is validated against the
// invoice's outstanding balance and REJECTED (never clamped) when it over-pays.
//
// Tenant scope (fail closed): ar_invoice + rv both carry company_id → the scoped
// TenantDb.select()/insert() doors are company-scoped by construction. The only
// cross-table ownership check is rv → invoice (a scoped select that returns
// nothing for a foreign invoice → 404). Without a resolved tenant, request.db is
// absent and every handler answers a flat 401.
//
// Financial authorization (B-082 F1 lineage): a create is a financial mutation,
// so the caller must carry the `finance.create` perm from the stored role matrix
// (authz.ts loadCaller/permAllowed) — fail-closed 403 for an unattributable
// caller or one lacking the perm. AuditLog fires automatically (middleware) on a
// successful POST and stays silent on a 4xx guard.
//
// Wave-0 HONEST GAPs (C10 — flagged, never fabricated):
//   - ar_invoice_line does NOT exist yet (post-Wave-0 migration): the request
//     lines are the INPUT to the money calc only and are NOT persisted.
//   - ar_invoice has no `status`/`due_date` column yet (post-Wave-0): the RV
//     paid-flip (Σrv ≥ amount+vat → invoice paid) lands with that status column;
//     this wave records the receipt without flipping any invoice state.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { arInvoices, customers, rvs } from "@juneflow/db/schema";
import { FakeTaxEngine } from "@juneflow/tax-engine/thailand";
import type { TaxEngine } from "@juneflow/tax-engine";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { has, pick, str, toNum } from "./procurement.js";
import { loadCaller, permAllowed } from "./authz.js";

type ArInvoiceRow = typeof arInvoices.$inferSelect;
type RvRow = typeof rvs.$inferSelect;
type CustomerRow = typeof customers.$inferSelect;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The perms-matrix module (seed MODULE_IDS) that governs finance mutations. */
const FINANCE_MODULE = "finance";

/**
 * Thai output-VAT rate (percent). ar.jsx AR_INV shows a 7% output VAT on the
 * common-area invoice (amount 184000 → vat 12880 = 7%). The rate is applied
 * through @juneflow/tax-engine.calcVat (exclusive) so the real RD rate table
 * swaps in behind the same interface (TODO(P0-INT-01)).
 */
const VAT_RATE_PERCENT = 7;

/**
 * The compliance tax engine (mock-first, PLAN.md §4). The fake adapter does the
 * VAT float math deterministically for dev/tests; the real `thailand` driver
 * swaps in behind the same TaxEngine interface once P0-INT-01 lands. Instantiated
 * once at module load — stateless, no credentials.
 */
const taxEngine: TaxEngine = new FakeTaxEngine();

// ---------------------------------------------------------------------------
// Reply + parse helpers
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

/**
 * Fail-closed financial-authz gate for a create: the caller must be attributable
 * AND carry the `finance.create` perm. On failure it sends the 403 and returns
 * false; the handler then returns the reply untouched. Mirrors the B-082 F1
 * loadCaller/permAllowed model (invents no new policy).
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
 * The output VAT on a net base value via @juneflow/tax-engine.calcVat (exclusive,
 * NOT inline math). Returns the 2-dp rounded magnitude.
 */
async function computeVat(base: number): Promise<number> {
  const result = await taxEngine.calcVat({
    baseAmount: { amount: moneyStr(base), currencyCode: "THB" },
    ratePercent: VAT_RATE_PERCENT,
    inclusive: false,
  });
  return round2(num(result.vatAmount.amount));
}

/**
 * The invoice net amount = Σ over lines of qty × price (C10 — the SERVER money
 * authority, never a client-supplied total). A line missing/invalid qty or price
 * contributes 0. Rounded to the currency minor unit (2 dp).
 */
function sumLines(lines: unknown[]): number {
  let amount = 0;
  for (const raw of lines) {
    if (typeof raw !== "object" || raw === null) continue;
    const ln = raw as Record<string, unknown>;
    const qty = toNum(pick(ln, "qty")) ?? 0;
    const price = toNum(pick(ln, "price")) ?? 0;
    amount += qty * price;
  }
  return round2(amount);
}

// ---------------------------------------------------------------------------
// Wire serializers (snake_case wire of the REAL columns)
// ---------------------------------------------------------------------------

function invoiceWire(inv: ArInvoiceRow): Record<string, unknown> {
  return {
    id: inv.id,
    no: inv.no,
    customer_id: inv.customerId,
    project_id: inv.projectId,
    amount: num(inv.amount),
    vat: num(inv.vat),
    currency_code: inv.currencyCode,
    credit_term: inv.creditTerm,
    etax_status: inv.etaxStatus,
    doc_date: inv.createdAt,
    created_at: inv.createdAt,
  };
}

function rvWire(rv: RvRow): Record<string, unknown> {
  return {
    id: rv.id,
    invoice_id: rv.invoiceId,
    amount: num(rv.amount),
    currency_code: rv.currencyCode,
    method: rv.method,
    doc_date: rv.createdAt,
    created_at: rv.createdAt,
  };
}

// ---------------------------------------------------------------------------
// POST /ar/invoices — create an AR invoice (ar.jsx ARInvoiceForm)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { customer_id, project_id?, no, lines: [{qty, price}],
//   credit_term? }. Enforced, in order:
//   - finance.create perm (403 fail-closed).
//   - customer_id required; no required (client-supplied doc number for Wave-0,
//     ar_invoice.no is NOT NULL); lines a non-empty array.
//   - customer_id must be THIS tenant's customer (scoped select → 400 if absent).
//   - SERVER money (B-107a): amount = Σ(qty × price); vat = 7% via calcVat. Any
//     client amount/vat in the body is IGNORED.
// The invoice starts etax_status `queued` (the e-Tax queue head, decision C4).
// company_id is force-set by the scoped insert. The request `lines` are NOT
// persisted (ar_invoice_line is a post-Wave-0 table — header GAP).
async function createArInvoice(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinanceCreate(request, reply))) return reply;

  const customerId = str(pick(body, "customer_id", "customerId")).trim();
  if (!customerId) return badRequest(reply, "customer_id is required");

  const no = str(pick(body, "no")).trim();
  if (!no) return badRequest(reply, "no is required");

  const rawLines = pick(body, "lines");
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return badRequest(reply, "lines must be a non-empty array");
  }

  const projectId = str(pick(body, "project_id", "projectId")).trim() || null;
  const creditTermRaw = toNum(pick(body, "credit_term", "creditTerm"));
  const creditTerm = creditTermRaw != null ? Math.trunc(creditTermRaw) : null;

  // customer must belong to this tenant (scoped select — no cross-tenant leak).
  const [customer] = (await db.select(
    customers,
    eq(customers.id, customerId),
  )) as CustomerRow[];
  if (!customer) return badRequest(reply, "customer not found in this tenant");

  // SERVER money authority (B-107a · Wei C-176): compute from the lines; the
  // client's amount/vat are never read. The lines themselves are NOT stored.
  const amount = sumLines(rawLines);
  const vat = await computeVat(amount);

  const [created] = (await db
    .insert(arInvoices, {
      customerId,
      projectId,
      no,
      amount: moneyStr(amount),
      vat: moneyStr(vat),
      currencyCode: "THB",
      creditTerm,
      etaxStatus: "queued",
    })
    .returning()) as ArInvoiceRow[];

  return reply.code(201).send(invoiceWire(created!));
}

// ---------------------------------------------------------------------------
// POST /ar/rv — record a receipt voucher against an invoice (ar.jsx receive)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { invoice_id, amount, method? }. Enforced, in order:
//   - finance.create perm (403 fail-closed).
//   - invoice_id required; the invoice must be THIS tenant's (scoped select →
//     404 for a foreign / unknown invoice — the cross-table ownership check).
//   - amount required, finite, > 0 (400 else).
//   - Over-allocation guard (Wei C-176 — SERVER money authority, REJECT never
//     clamp): outstanding = round2((amount + vat) − Σ existing rv.amount) for the
//     invoice; a receipt exceeding it is 409 INVALID_STATE (no partial create).
// currency inherits the invoice's. NO paid-flip this wave (ar_invoice has no
// status column yet — header GAP). company_id is force-set by the scoped insert.
async function createArRv(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinanceCreate(request, reply))) return reply;

  const invoiceId = str(pick(body, "invoice_id", "invoiceId")).trim();
  if (!invoiceId) return badRequest(reply, "invoice_id is required");

  const method = has(body, "method")
    ? str(pick(body, "method")).trim() || null
    : null;

  // The invoice must belong to this tenant (scoped select → 404 for a foreign
  // id). This IS the cross-table ownership check for the receipt.
  const [inv] = (await db.select(
    arInvoices,
    eq(arInvoices.id, invoiceId),
  )) as ArInvoiceRow[];
  if (!inv) {
    return reply
      .code(404)
      .send({ code: "NOT_FOUND", message: `invoice ${invoiceId} not found` });
  }

  const amount = toNum(pick(body, "amount"));
  if (amount == null || amount <= 0) {
    return badRequest(reply, "amount is required and must be greater than zero");
  }

  // Over-allocation guard: outstanding = (invoice amount + vat) − Σ prior receipts
  // (both tenant-scoped). REJECT an over-payment (409) — never clamp / partial.
  const priorRvs = (await db.select(
    rvs,
    eq(rvs.invoiceId, invoiceId),
  )) as RvRow[];
  const received = priorRvs.reduce((sum, r) => sum + num(r.amount), 0);
  const outstanding = round2(num(inv.amount) + num(inv.vat) - received);
  if (amount > outstanding) {
    return reply.code(409).send({
      code: "INVALID_STATE",
      message: `receipt ${amount} exceeds the invoice outstanding ${outstanding}`,
    });
  }

  const [created] = (await db
    .insert(rvs, {
      invoiceId,
      amount: moneyStr(amount),
      currencyCode: inv.currencyCode ?? "THB",
      method,
    })
    .returning()) as RvRow[];

  return reply.code(201).send(rvWire(created!));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the AR (invoice + RV) routes on the given (/api/v1-prefixed) scope. */
export function registerArRoute(app: FastifyInstance): void {
  app.post("/ar/invoices", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createArInvoice(
      db,
      request,
      (request.body ?? {}) as Record<string, unknown>,
      reply,
    );
  });

  app.post("/ar/rv", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createArRv(
      db,
      request,
      (request.body ?? {}) as Record<string, unknown>,
      reply,
    );
  });
}
