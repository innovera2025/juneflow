// AR (accounts-receivable) handlers — Phase-3 Finance (AR + e-Tax lane).
// Wave-0 wired the two create POSTs (invoice + RV); round-A completes the lane:
// the invoice now persists its lines + due_date + status, the RV flips the
// invoice to `paid`, and the reads (list / aging / tax-register / credit-note)
// plus the credit-note create + GL-reversal approve land here. Registered in
// app.ts (registerArRoute) by the orchestrator.
//
// Contract (openapi.yaml §finance — declared opaque, NO openapi edit this wave):
//   POST /ar/invoices              → EntityCreated — create an AR invoice
//   GET  /ar/invoices              → EntityList    — list (status/etax/customer/period)
//   POST /ar/rv                    → EntityCreated — record a receipt (RV)
//   GET  /ar/rv                    → EntityList    — list receipts
//   GET  /ar/aging                 → EntityOk      — AR aging buckets
//   GET  /ar/cn                    → EntityList    — list credit notes
//   POST /ar/cn                    → EntityCreated — create a credit note
//   POST /ar/cn/{id}/approve       → ActionOk      — post the CN reversal JV
//   GET  /ar/tax-register          → EntityList    — tax register (derived)
//   POST /ar/tax-register/{id}/cancel → ActionOk   — void an invoice's e-Tax
// Each body/row is the opaque Entity (snake_case wire of REAL columns). A read or
// POST on an opaque endpoint needs no contract change (FLOW-A opaque-Entity).
//
// Money is SERVER authority (B-107a · Wei C-176): a client-supplied amount/vat is
// IGNORED for every COMPUTED value. An AR invoice's amount is Σ(line.qty × price),
// its VAT is the 7% Thai output tax through @juneflow/tax-engine.calcVat, and each
// stored line's amount is qty × price. An RV's amount is validated against the
// invoice's outstanding balance and REJECTED (never clamped) when it over-pays. A
// credit note's VAT is EXTRACTED from its VAT-inclusive amount (amount × 7/107),
// and the CN-approve reversal JV is balanced from that split (Dr revenue + Dr
// VAT-output / Cr AR), never from a client figure.
//
// Tenant scope (fail closed): ar_invoice, rv, ar_credit_note and jv all carry
// company_id → the scoped TenantDb.select()/insert()/update() doors. ar_invoice_
// line and jv_line hang off their parent (no company_id) → they are WRITTEN
// through insertThrough() (which re-verifies this tenant owns the parent) — a bare
// FK is not scope. Cross-table ownership (rv → invoice, cn → customer/invoice) is a
// scoped select that returns nothing for a foreign id → 400/404. Without a resolved
// tenant, request.db is absent and every handler answers a flat 401.
//
// Financial authorization (B-082 F1 lineage): a create gates `finance.create`; an
// approve/void gates `finance.approve` (loadCaller/permAllowed) — fail-closed 403
// for an unattributable caller or one lacking the perm. Reads gate on the resolved
// tenant only (401 else). AuditLog fires automatically (middleware) on a 2xx and
// stays silent on a 4xx guard — never called here.
//
// HONEST notes (C10 — flagged, never fabricated):
//   - A credit note's `vat` is DERIVED (amount × 7/107), not a stored column.
//   - ar_credit_note carries a nullable `status` column (wired as-is); the approve
//     idempotency key is the reversal JV's source_doc (`cn:<id>`), NOT that column,
//     so a re-approve is a 409 even though `status` is never mutated here.
//   - The tax register is DERIVED from ar_invoice (one row per invoice = one tax
//     invoice; settlement reflected via the invoice `status` paid-flip · Wei Q6),
//     no new table.
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import {
  arCreditNotes,
  arInvoiceLines,
  arInvoices,
  customers,
  jvLines,
  jvs,
  rvs,
} from "@juneflow/db/schema";
import { FakeTaxEngine } from "@juneflow/tax-engine/thailand";
import type { TaxEngine } from "@juneflow/tax-engine";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { has, pick, str, toNum } from "./procurement.js";
import { loadCaller, permAllowed } from "./authz.js";
import { listEnvelope } from "./list-envelope.js";
import { ACCT, allocJvNo, resolveAccountIds } from "./gl-post.js";

type ArInvoiceRow = typeof arInvoices.$inferSelect;
type RvRow = typeof rvs.$inferSelect;
type CustomerRow = typeof customers.$inferSelect;
type ArCreditNoteRow = typeof arCreditNotes.$inferSelect;
type JvRow = typeof jvs.$inferSelect;

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

/** Milliseconds in a day — the aging / due-date day arithmetic (mirror ap.ts). */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The AR aging buckets, in the fixed display order (days past due_date). */
const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
type AgingBucket = (typeof AGING_BUCKETS)[number];

/**
 * The compliance tax engine (mock-first, PLAN.md §4). The fake adapter does the
 * VAT float math deterministically for dev/tests; the real `thailand` driver
 * swaps in behind the same TaxEngine interface once P0-INT-01 lands. Instantiated
 * once at module load — stateless, no credentials.
 */
const taxEngine: TaxEngine = new FakeTaxEngine();

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

/**
 * The invoice due date = invoice date + credit_term days, as a 'YYYY-MM-DD' string
 * (the ar_invoice.due_date `date` column). Null when no credit term is given (a
 * draft with no term — nullable by design, migration 0035).
 */
function computeDueDate(invoiceDate: Date, creditTerm: number | null): string | null {
  if (creditTerm == null) return null;
  return new Date(invoiceDate.getTime() + creditTerm * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/** Whole days past a due_date (null when no due_date is stored; mirror ap.ts). */
function agingDays(dueDate: unknown): number | null {
  if (dueDate == null) return null;
  const due = new Date(dueDate as string | Date).getTime();
  if (!Number.isFinite(due)) return null;
  return Math.floor((Date.now() - due) / MS_PER_DAY);
}

/** The aging bucket of a due_date: `current` when not yet due (or no due_date). */
function agingBucket(dueDate: unknown): AgingBucket {
  const days = agingDays(dueDate);
  if (days == null || days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
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
 * The VAT EXTRACTED from a VAT-INCLUSIVE amount = amount × 7/107 (a credit note is
 * issued gross, so its embedded output VAT is backed out — the reversal JV then
 * credits AR the gross and debits revenue+VAT-output the split). Derived, never
 * stored (C10). 2-dp rounded.
 */
function vatFromInclusive(amount: number): number {
  return round2((amount * VAT_RATE_PERCENT) / (100 + VAT_RATE_PERCENT));
}

// ---------------------------------------------------------------------------
// Financial-authz gates (B-082 F1 model — invents no new policy)
// ---------------------------------------------------------------------------

/**
 * Fail-closed gate for a create: the caller must be attributable AND carry the
 * `finance.create` perm. On failure it sends the 403 and returns false.
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
 * Fail-closed gate for an approve/void (CN approve, tax-register cancel): the
 * caller must be attributable AND carry the `finance.approve` perm. Mirrors the
 * gl.ts period-close gate.
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
    due_date: inv.dueDate,
    status: inv.status,
    etax_status: inv.etaxStatus,
    doc_date: inv.createdAt,
    created_at: inv.createdAt,
  };
}

function rvWire(rv: RvRow): Record<string, unknown> {
  return {
    id: rv.id,
    invoice_id: rv.invoiceId,
    no: rv.no,
    amount: num(rv.amount),
    currency_code: rv.currencyCode,
    method: rv.method,
    receipt_date: rv.receiptDate,
    bank: rv.bank,
    status: rv.status,
    source: rv.source,
    doc_date: rv.createdAt,
    created_at: rv.createdAt,
  };
}

function cnWire(cn: ArCreditNoteRow): Record<string, unknown> {
  const amount = num(cn.amount);
  return {
    id: cn.id,
    no: cn.no,
    customer_id: cn.customerId,
    ref_invoice_id: cn.refInvoiceId,
    reason: cn.reason,
    amount,
    // Derived, not stored (C10): the output VAT embedded in the gross credit.
    vat: vatFromInclusive(amount),
    currency_code: cn.currencyCode,
    status: cn.status,
    note_date: cn.noteDate,
    created_at: cn.createdAt,
  };
}

// ---------------------------------------------------------------------------
// POST /ar/invoices — create an AR invoice (ar.jsx ARInvoiceForm)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { customer_id, project_id?, no, lines: [{qty, price,
//   description?}], credit_term? }. Enforced, in order:
//   - finance.create perm (403 fail-closed).
//   - customer_id required; no required (ar_invoice.no is NOT NULL); lines a
//     non-empty array.
//   - customer_id must be THIS tenant's customer (scoped select → 400 if absent).
//   - SERVER money (B-107a): amount = Σ(qty × price); vat = 7% via calcVat. A
//     client amount/vat is IGNORED. A ≤ 0 total is rejected (400 — C-180 NIT).
// The invoice starts status `open` + etax_status `queued` (the e-Tax queue head,
// C4). due_date = date + credit_term days (JS, when a term is given). Header +
// lines are ONE db.transaction (B-097): each stored line carries qty/unit_price/
// amount (= qty × price, server-authoritative), written via insertThrough (child
// scopes through ar_invoice). company_id is force-set by the scoped insert.
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
  // client's amount/vat are never read.
  const amount = sumLines(rawLines);
  // C-180 (NIT fold): a ≤ 0 invoice is rejected before any insert.
  if (amount <= 0) {
    return badRequest(reply, "invoice total must be greater than zero");
  }
  const vat = await computeVat(amount);
  const dueDate = computeDueDate(new Date(), creditTerm);

  // Per-line storage (server-authoritative): amount = qty × price, same parse as
  // the header sum above (identical keys) so Σ line.amount == header amount.
  const lineInputs = rawLines.map((raw) => {
    const ln = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const qty = toNum(pick(ln, "qty")) ?? 0;
    const price = toNum(pick(ln, "price")) ?? 0;
    const description = str(pick(ln, "description")).trim() || null;
    return {
      description,
      qty: moneyStr(qty),
      unitPrice: moneyStr(price),
      amount: moneyStr(round2(qty * price)),
      currencyCode: "THB",
    };
  });

  // B-097: header + lines are ONE post — a line failure rolls back the header.
  const created = await db.transaction(async (tx) => {
    const [inv] = (await tx
      .insert(arInvoices, {
        customerId,
        projectId,
        no,
        amount: moneyStr(amount),
        vat: moneyStr(vat),
        currencyCode: "THB",
        creditTerm,
        dueDate,
        status: "open",
        etaxStatus: "queued",
      })
      .returning()) as ArInvoiceRow[];
    const lineRows = lineInputs.map((li) => ({ arInvoiceId: inv!.id, ...li }));
    await tx.insertThrough(arInvoiceLines, arInvoices, inv!.id, lineRows);
    return inv!;
  });

  return reply.code(201).send(invoiceWire(created));
}

// ---------------------------------------------------------------------------
// GET /ar/invoices — list AR invoices (ar.jsx ARInvoice list + e-Tax queue)
// ---------------------------------------------------------------------------
// Query (all optional): status, etax_status, customer_id, period ('YYYY-MM' → the
// createdAt CE month). Dual-serves the tax e-Tax queue (filter by etax_status).
// Per row = invoiceWire + outstanding = round2(amount + vat − Σ rv). Newest-first.
async function listInvoices(
  db: TenantDb,
  query: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const [invRows, rvRows] = await Promise.all([
    db.select(arInvoices) as Promise<ArInvoiceRow[]>,
    db.select(rvs) as Promise<RvRow[]>,
  ]);
  const receivedByInvoice = sumReceivedByInvoice(rvRows);

  const status = str(pick(query, "status")).trim();
  const etax = str(pick(query, "etax_status", "etaxStatus")).trim();
  const customerId = str(pick(query, "customer_id", "customerId")).trim();
  const period = str(pick(query, "period")).trim();

  const filtered = invRows.filter(
    (inv) =>
      (!status || inv.status === status) &&
      (!etax || inv.etaxStatus === etax) &&
      (!customerId || inv.customerId === customerId) &&
      (!period || ceMonthKey(inv.createdAt) === period),
  );

  return newestFirst(filtered).map((inv) => {
    const received = receivedByInvoice.get(inv.id) ?? 0;
    const outstanding = round2(num(inv.amount) + num(inv.vat) - received);
    return { ...invoiceWire(inv), outstanding };
  });
}

/** Σ rv.amount per invoice id (tenant-scoped rvs; a null invoice_id is skipped). */
function sumReceivedByInvoice(rvRows: readonly RvRow[]): Map<string, number> {
  const byInvoice = new Map<string, number>();
  for (const rv of rvRows) {
    if (!rv.invoiceId) continue; // retention-refund RV settles no invoice (0035)
    byInvoice.set(rv.invoiceId, round2((byInvoice.get(rv.invoiceId) ?? 0) + num(rv.amount)));
  }
  return byInvoice;
}

// ---------------------------------------------------------------------------
// POST /ar/rv — record a receipt voucher against an invoice (ar.jsx receive)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { invoice_id, amount, method? }. Enforced, in order:
//   - finance.create perm (403 fail-closed).
//   - invoice_id required; the invoice must be THIS tenant's (scoped select → 404).
//   - amount required, finite, > 0 (400 else).
//   - Over-allocation guard (Wei C-176 — REJECT never clamp): outstanding =
//     round2((amount + vat) − Σ existing rv.amount); an over-payment is 409.
// On success (B-097 one transaction): insert the RV (source='invoice', currency
// inherited) and, when Σ rv now covers amount + vat, flip the invoice status →
// `paid` (Q4 paid-flip). company_id is force-set by the scoped insert/update.
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

  // The invoice must belong to this tenant (scoped select → 404 for a foreign id).
  const [inv] = (await db.select(
    arInvoices,
    eq(arInvoices.id, invoiceId),
  )) as ArInvoiceRow[];
  if (!inv) return notFound(reply, `invoice ${invoiceId} not found`);

  const amount = toNum(pick(body, "amount"));
  if (amount == null || amount <= 0) {
    return badRequest(reply, "amount is required and must be greater than zero");
  }

  // Over-allocation guard: outstanding = (invoice amount + vat) − Σ prior receipts
  // (both tenant-scoped). REJECT an over-payment (409) — never clamp / partial.
  const priorRvs = (await db.select(rvs, eq(rvs.invoiceId, invoiceId))) as RvRow[];
  const received = priorRvs.reduce((sum, r) => sum + num(r.amount), 0);
  const invoiceTotal = round2(num(inv.amount) + num(inv.vat));
  const outstanding = round2(invoiceTotal - received);
  if (amount > outstanding) {
    return conflict(
      reply,
      `receipt ${amount} exceeds the invoice outstanding ${outstanding}`,
    );
  }

  // Q4 paid-flip: Σ rv AFTER this receipt (received prior + this amount). No
  // re-query — the new receipt's amount is known and server-authoritative.
  const totalReceived = round2(received + amount);

  const created = await db.transaction(async (tx) => {
    const [rv] = (await tx
      .insert(rvs, {
        invoiceId,
        amount: moneyStr(amount),
        currencyCode: inv.currencyCode ?? "THB",
        method,
        source: "invoice",
      })
      .returning()) as RvRow[];
    if (totalReceived >= invoiceTotal) {
      await tx
        .update(arInvoices, { status: "paid" }, eq(arInvoices.id, invoiceId))
        .returning();
    }
    return rv!;
  });

  return reply.code(201).send(rvWire(created));
}

// ---------------------------------------------------------------------------
// GET /ar/rv — list receipt vouchers (ar.jsx receive list)
// ---------------------------------------------------------------------------
async function listRv(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(rvs)) as RvRow[];
  return newestFirst(rows).map(rvWire);
}

// ---------------------------------------------------------------------------
// GET /ar/aging — AR aging report (ar.jsx aging) — EntityOk (single object)
// ---------------------------------------------------------------------------
// For each NON-paid invoice: outstanding = round2(amount + vat − Σ rv); bucket by
// days-overdue (today − due_date). NOT enveloped — a single report object:
//   { buckets:[{bucket,count,amount}], total_outstanding, currency_code }.
// Honest (C10): real invoice rows only; a non-paid invoice always has
// outstanding > 0 by construction (the paid-flip fires at ≥ total), so it ages.
async function aging(db: TenantDb, reply: FastifyReply): Promise<FastifyReply> {
  const [invRows, rvRows] = await Promise.all([
    db.select(arInvoices) as Promise<ArInvoiceRow[]>,
    db.select(rvs) as Promise<RvRow[]>,
  ]);
  const receivedByInvoice = sumReceivedByInvoice(rvRows);

  const agg = new Map<AgingBucket, { count: number; amount: number }>(
    AGING_BUCKETS.map((b) => [b, { count: 0, amount: 0 }]),
  );
  let totalOutstanding = 0;
  let currency: string | null = null;

  for (const inv of invRows) {
    if (inv.status === "paid") continue;
    const received = receivedByInvoice.get(inv.id) ?? 0;
    const outstanding = round2(num(inv.amount) + num(inv.vat) - received);
    if (outstanding <= 0) continue; // fully settled without a paid-flip — nothing to age
    if (currency == null) currency = inv.currencyCode ?? null;
    const cell = agg.get(agingBucket(inv.dueDate))!;
    cell.count += 1;
    cell.amount = round2(cell.amount + outstanding);
    totalOutstanding = round2(totalOutstanding + outstanding);
  }

  return reply.code(200).send({
    buckets: AGING_BUCKETS.map((b) => ({ bucket: b, ...agg.get(b)! })),
    total_outstanding: totalOutstanding,
    currency_code: currency ?? "THB",
  });
}

// ---------------------------------------------------------------------------
// GET /ar/cn — list AR credit notes (accounting-extra2.jsx ARCN)
// ---------------------------------------------------------------------------
async function listCn(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(arCreditNotes)) as ArCreditNoteRow[];
  return newestFirst(rows).map(cnWire);
}

// ---------------------------------------------------------------------------
// POST /ar/cn — create an AR credit note (accounting-extra2.jsx ARCN create)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { no, customer_id, ref_invoice_id, amount, reason? }.
// Enforced, in order:
//   - finance.create perm (403 fail-closed).
//   - no required (client-supplied, ar_credit_note.no is NOT NULL); customer_id +
//     ref_invoice_id required; amount required, finite, > 0.
//   - customer_id must be THIS tenant's customer (scoped select → 400); ref_
//     invoice_id must be THIS tenant's invoice (scoped select → 404).
//   - `no` is unique per tenant (scoped select → 409 on a duplicate).
// Stored as-is (currency THB); the VAT is DERIVED at read (cnWire), not stored.
async function createCn(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinanceCreate(request, reply))) return reply;

  const no = str(pick(body, "no")).trim();
  if (!no) return badRequest(reply, "no is required");

  const customerId = str(pick(body, "customer_id", "customerId")).trim();
  if (!customerId) return badRequest(reply, "customer_id is required");

  const refInvoiceId = str(pick(body, "ref_invoice_id", "refInvoiceId")).trim();
  if (!refInvoiceId) return badRequest(reply, "ref_invoice_id is required");

  const amount = toNum(pick(body, "amount"));
  if (amount == null || amount <= 0) {
    return badRequest(reply, "amount is required and must be greater than zero");
  }

  const reason = has(body, "reason")
    ? str(pick(body, "reason")).trim() || null
    : null;

  // Both refs must belong to THIS tenant (scoped selects — fail closed).
  const [customer] = (await db.select(
    customers,
    eq(customers.id, customerId),
  )) as CustomerRow[];
  if (!customer) return badRequest(reply, "customer not found in this tenant");

  const [inv] = (await db.select(
    arInvoices,
    eq(arInvoices.id, refInvoiceId),
  )) as ArInvoiceRow[];
  if (!inv) return notFound(reply, `invoice ${refInvoiceId} not found`);

  // `no` uniqueness per tenant (scoped select).
  const dup = (await db.select(
    arCreditNotes,
    eq(arCreditNotes.no, no),
  )) as ArCreditNoteRow[];
  if (dup.length > 0) return conflict(reply, `credit note ${no} already exists`);

  const [created] = (await db
    .insert(arCreditNotes, {
      no,
      customerId,
      refInvoiceId,
      reason,
      amount: moneyStr(amount),
      currencyCode: "THB",
    })
    .returning()) as ArCreditNoteRow[];

  return reply.code(201).send(cnWire(created!));
}

// ---------------------------------------------------------------------------
// POST /ar/cn/{id}/approve — post the CN's reversal JV (accounting-extra2.jsx)
// ---------------------------------------------------------------------------
// finance.approve gate. Load the CN (scoped → 404). IDEMPOTENT: a reversal JV with
// source_doc `cn:<id>` already existing → 409 (the CN is already approved). Else
// split the VAT-inclusive credit: vat = amount × 7/107, net = amount − vat; post a
// BALANCED reversal JV (Dr revenue = net, Dr VAT-output = vat, Cr AR = amount, so
// net + vat = amount) in one db.transaction (jv + jv_line via insertThrough). A
// required COA code the tenant lacks → 409 honest error (never invent an account —
// gl-post.ts C-177). Returns ActionOk { id, jv_no, amount, vat }.
async function approveCn(
  db: TenantDb,
  request: FastifyRequest,
  cnId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinanceApprove(request, reply))) return reply;

  const [cn] = (await db.select(
    arCreditNotes,
    eq(arCreditNotes.id, cnId),
  )) as ArCreditNoteRow[];
  if (!cn) return notFound(reply, `credit note ${cnId} not found`);

  // Idempotency: the reversal JV's source_doc is the approval marker (the CN
  // status column is NOT mutated here — honest, ar_credit_note has no lifecycle
  // machine this wave). A second approve is a 409, never a double post.
  const sourceDoc = `cn:${cnId}`;
  const priorJv = (await db.select(
    jvs,
    eq(jvs.sourceDoc, sourceDoc),
  )) as JvRow[];
  if (priorJv.length > 0) {
    return conflict(reply, `credit note ${cnId} already approved`);
  }

  const amount = round2(num(cn.amount));
  const vat = vatFromInclusive(amount); // VAT-inclusive extraction (amount × 7/107)
  const net = round2(amount - vat); // net + vat === amount → the JV balances

  // Resolve the reversal accounts in THIS tenant's COA; a missing code is an
  // honest 409 (never post an unbalanced / mis-accounted JV).
  const acctIds = await resolveAccountIds(db, [
    ACCT.revenue,
    ACCT.vatOutput,
    ACCT.ar,
  ]);
  const revenueId = acctIds.get(ACCT.revenue);
  const vatOutputId = acctIds.get(ACCT.vatOutput);
  const arId = acctIds.get(ACCT.ar);
  if (!revenueId || !vatOutputId || !arId) {
    return conflict(
      reply,
      "the tenant chart of accounts is missing a required posting account (revenue / VAT-output / AR)",
    );
  }

  const jvNo = await allocJvNo(db);
  const jvId = randomUUID();
  const currencyCode = cn.currencyCode ?? "THB";
  const lineRows: (typeof jvLines.$inferInsert)[] = [
    { jvId, accountId: revenueId, dr: moneyStr(net), cr: moneyStr(0), currencyCode },
    { jvId, accountId: vatOutputId, dr: moneyStr(vat), cr: moneyStr(0), currencyCode },
    { jvId, accountId: arId, dr: moneyStr(0), cr: moneyStr(amount), currencyCode },
  ];

  // B-097: jv header + its lines are ONE post (insertThrough re-proves this tenant
  // owns the just-created parent jv inside the same transaction).
  await db.transaction(async (tx) => {
    await tx
      .insert(jvs, {
        id: jvId,
        no: jvNo,
        sourceDoc,
        memo: `credit-note ${cn.no}`,
      })
      .returning();
    await tx.insertThrough(jvLines, jvs, jvId, lineRows);
  });

  return reply.code(200).send({ id: cnId, jv_no: jvNo, amount, vat });
}

// ---------------------------------------------------------------------------
// GET /ar/tax-register — the tax register (accounting-extra.jsx TaxRegister)
// ---------------------------------------------------------------------------
// DERIVED from ar_invoice — one row per invoice = one tax invoice (Wei Q6, NO new
// table). Settlement is reflected via the invoice `status` (the RV paid-flip). Per
// row: { id, no, customer_id, amount, vat, total = amount + vat, etax_status,
// status, doc_date }. Optional `period` filter (createdAt CE month). Envelope,
// newest-first. Honest — real invoice rows only.
function taxRegisterWire(inv: ArInvoiceRow): Record<string, unknown> {
  const amount = num(inv.amount);
  const vat = num(inv.vat);
  return {
    id: inv.id,
    no: inv.no,
    customer_id: inv.customerId,
    amount,
    vat,
    total: round2(amount + vat),
    etax_status: inv.etaxStatus,
    status: inv.status,
    doc_date: inv.createdAt,
  };
}

async function listTaxRegister(
  db: TenantDb,
  query: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const invRows = (await db.select(arInvoices)) as ArInvoiceRow[];
  const period = str(pick(query, "period")).trim();
  const filtered = invRows.filter(
    (inv) => !period || ceMonthKey(inv.createdAt) === period,
  );
  return newestFirst(filtered).map(taxRegisterWire);
}

// ---------------------------------------------------------------------------
// POST /ar/tax-register/{id}/cancel — void an invoice's e-Tax (accounting-extra)
// ---------------------------------------------------------------------------
// The {id} is an INVOICE id. finance.approve gate. Scoped select → 404 for a
// foreign / unknown invoice. Sets etax_status = 'void' (C4 superset). Returns
// ActionOk { id, etax_status: 'void' }.
async function cancelTaxRegister(
  db: TenantDb,
  request: FastifyRequest,
  invoiceId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinanceApprove(request, reply))) return reply;

  const [inv] = (await db.select(
    arInvoices,
    eq(arInvoices.id, invoiceId),
  )) as ArInvoiceRow[];
  if (!inv) return notFound(reply, `invoice ${invoiceId} not found`);

  await db
    .update(arInvoices, { etaxStatus: "void" }, eq(arInvoices.id, invoiceId))
    .returning();

  return reply.code(200).send({ id: invoiceId, etax_status: "void" });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the AR routes on the given (already /api/v1-prefixed) scope. */
export function registerArRoute(app: FastifyInstance): void {
  const body = (request: FastifyRequest): Record<string, unknown> =>
    (request.body ?? {}) as Record<string, unknown>;
  const query = (request: FastifyRequest): Record<string, unknown> =>
    (request.query ?? {}) as Record<string, unknown>;
  const idParam = (request: FastifyRequest): string =>
    (request.params as { id?: string }).id ?? "";

  // --- invoices -------------------------------------------------------------
  app.post("/ar/invoices", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createArInvoice(db, request, body(request), reply);
  });

  app.get("/ar/invoices", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return reply.code(200).send(listEnvelope(await listInvoices(db, query(request))));
  });

  // --- receipts -------------------------------------------------------------
  app.post("/ar/rv", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createArRv(db, request, body(request), reply);
  });

  app.get("/ar/rv", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return reply.code(200).send(listEnvelope(await listRv(db)));
  });

  // --- aging (single report object, NOT enveloped) --------------------------
  app.get("/ar/aging", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return aging(db, reply);
  });

  // --- credit notes ---------------------------------------------------------
  app.get("/ar/cn", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return reply.code(200).send(listEnvelope(await listCn(db)));
  });

  app.post("/ar/cn", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createCn(db, request, body(request), reply);
  });

  app.post("/ar/cn/:id/approve", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return approveCn(db, request, idParam(request), reply);
  });

  // --- tax register ---------------------------------------------------------
  app.get("/ar/tax-register", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return reply
      .code(200)
      .send(listEnvelope(await listTaxRegister(db, query(request))));
  });

  app.post("/ar/tax-register/:id/cancel", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return cancelTaxRegister(db, request, idParam(request), reply);
  });
}
