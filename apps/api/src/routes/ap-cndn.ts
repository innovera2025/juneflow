// AP credit-note / debit-note handlers — Phase-3 Finance (B-231 · Wei=ก Model-A).
//
// The payables-side mirror of the AR credit-note lane (ar.ts createCn/approveCn/
// listCn). It lives in its OWN file (NOT ap.ts, which is stale on this branch vs
// dev) and is registered in app.ts by registerApCnDnRoute next to registerApRoute.
//
// Contract (openapi.yaml §finance — declared opaque Entity):
//   GET  /ap/cn                 → EntityList    — list AP credit notes
//   POST /ap/cn                 → EntityCreated — create an AP credit note
//   POST /ap/cn/{id}/approve    → ActionOk      — post the CN's Model-A JV
//   GET  /ap/dn                 → EntityList    — list AP debit notes
//   POST /ap/dn                 → EntityCreated — create an AP debit note
//   POST /ap/dn/{id}/approve    → ActionOk      — post the DN's Model-A JV
// Each body/row is the opaque Entity (snake_case wire of REAL columns).
//
// Money is SERVER authority (B-107a · Wei C-176) — Model-A (Wei B-231=ก): a note
// posts a 2-line, NO-VAT balanced JV on the EXISTING chart of accounts (no new COA
// account). A credit note REDUCES the payable + reverses materials cost:
//   Dr 2010 AP / Cr 5020 materials = amount.
// A debit note INCREASES the payable + adds expense:
//   Dr 5100 admin-expense / Cr 2010 AP = amount.
// The client never supplies the JV; only the note's `amount` funds it (finite > 0).
//
// The note `no` is SERVER-generated — CN-<CE-year>-<NNNN> / DN-<CE-year>-<NNNN>
// (§0 rule-3: a mock literal is never copied). It is a DISPLAY running number like
// jv.no (mirror allocOmNo/allocJvNo), NOT an idempotency key, so it carries no
// unique constraint. The approve idempotency key is instead the reversal JV's
// source_doc (`apcn:<id>` / `apdn:<id>`) — the 0037 partial-UNIQUE index on
// jv.source_doc makes a second approve a 409, never a double post.
//
// Tenant scope (fail closed): ap_credit_note, ap_debit_note and jv all carry
// company_id → the scoped TenantDb.select()/insert() doors. jv_line hangs off jv
// (no company_id) → written through insertThrough() (which re-proves this tenant
// owns the parent jv). Cross-table ownership (note → vendor / ap_billing) is a
// scoped select that returns nothing for a foreign id → 400 / 404. Without a
// resolved tenant, request.db is absent and every handler answers a flat 401.
//
// Financial authorization (B-082 F1 lineage — mirrors ar.ts): a create gates
// `finance.create`; an approve gates `finance.approve` (loadCaller / permAllowed)
// — fail-closed 403 for an unattributable caller or one lacking the perm. Reads
// gate on the resolved tenant only (401 else). AuditLog fires automatically
// (middleware) on a 2xx and stays silent on a 4xx guard.
//
// HONEST notes (C10 — flagged, never fabricated):
//   - Model-A is NO-VAT by ruling (Wei B-231=ก): a note's `amount` is posted whole,
//     with no VAT split (unlike ar.ts CN, which extracts amount × 7/107).
//   - ap_credit_note / ap_debit_note carry a nullable `status` column (wired as-is);
//     the approve idempotency key is the JV source_doc, NOT that column, so a
//     re-approve is a 409 even though `status` is never mutated here.
//   - The note `no` has NO unique constraint (a display running number); two truly
//     concurrent creates could in principle mint the same number — the same
//     non-guarantee as solar OM tickets (allocOmNo). The money idempotency that
//     matters (the approve JV) IS DB-enforced via jv.source_doc.
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import {
  apBillings,
  apCreditNotes,
  apDebitNotes,
  jvLines,
  jvs,
  vendors,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { has, pick, str, toNum } from "./procurement.js";
import { loadCaller, permAllowed } from "./authz.js";
import { listEnvelope } from "./list-envelope.js";
import { newestFirst } from "./list-order.js";
import {
  ACCT,
  allocJvNo,
  docNoExhausted,
  DocNoExhaustedError,
  isUniqueViolation,
  resolveAccountIds,
  withDocNoRetry,
} from "./gl-post.js";

type ApCreditNoteRow = typeof apCreditNotes.$inferSelect;
type ApDebitNoteRow = typeof apDebitNotes.$inferSelect;
type VendorRow = typeof vendors.$inferSelect;
type ApBillingRow = typeof apBillings.$inferSelect;
type JvRow = typeof jvs.$inferSelect;

/** A note row (CN or DN) — structurally identical; the wire mapper accepts both. */
type ApNoteRow = ApCreditNoteRow | ApDebitNoteRow;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The perms-matrix module (seed MODULE_IDS) that governs finance mutations. */
const FINANCE_MODULE = "finance";

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

// B-323: the local `newestFirst` + its `msOf` helper are DELETED here — they were a
// hand-rolled shadow of list-order.ts's export, and the shadow was tie-BLIND: its
// comparator returned 0 for two notes sharing an instant, which hands the pair back to
// the join plan. Two CN/DN notes created in one transaction share `now()` exactly.
// The shared `newestFirst` is TOTAL (created_at DESC, then id ASC).

/**
 * The next SERVER running note number <prefix>-<CE-year>-<NNNN> — one past the max
 * numeric suffix among this tenant's note numbers for the year prefix (mirror
 * allocOmNo/allocJvNo). Pure over the existing numbers; a display number, NOT an
 * idempotency key (no unique constraint). §0 rule-3: never copies the mock literal.
 */
function nextNoteNo(existingNos: readonly (string | null)[], prefix: string): string {
  const year = new Date().getFullYear();
  const full = `${prefix}-${year}-`;
  let max = 0;
  for (const no of existingNos) {
    if (!no || !no.startsWith(full)) continue;
    const m = /-(\d+)$/.exec(no);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${full}${String(max + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Financial-authz gates (B-082 F1 model — mirrors ar.ts, invents no new policy)
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
 * Fail-closed gate for an approve: the caller must be attributable AND carry the
 * `finance.approve` perm.
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
// Wire serializer (snake_case wire of the REAL columns — CN + DN share one shape)
// ---------------------------------------------------------------------------

function noteWire(row: ApNoteRow): Record<string, unknown> {
  return {
    id: row.id,
    no: row.no,
    vendor_id: row.vendorId,
    ref_ap_id: row.refApId,
    reason: row.reason,
    amount: num(row.amount),
    currency_code: row.currencyCode,
    status: row.status,
    note_date: row.noteDate,
    created_at: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Create validation (shared by CN + DN — identical body contract)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { vendor_id, ref_ap_id, amount, reason? }. Enforced, in
// order (mirror ar.ts createCn):
//   - finance.create perm (403 fail-closed).
//   - vendor_id required (400); ref_ap_id required (400); amount required, finite,
//     > 0 (400); reason optional.
//   - vendor_id must be THIS tenant's vendor (scoped select → 400 foreign).
//   - ref_ap_id must be THIS tenant's ap_billing (scoped select → 404 foreign).
// Returns the validated input, or null AFTER having sent the 4xx reply.
interface NoteCreateInput {
  vendorId: string;
  refApId: string;
  amount: number;
  reason: string | null;
}

async function validateNoteCreate(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<NoteCreateInput | null> {
  if (!(await requireFinanceCreate(request, reply))) return null;

  const vendorId = str(pick(body, "vendor_id", "vendorId")).trim();
  if (!vendorId) {
    badRequest(reply, "vendor_id is required");
    return null;
  }

  const refApId = str(pick(body, "ref_ap_id", "refApId")).trim();
  if (!refApId) {
    badRequest(reply, "ref_ap_id is required");
    return null;
  }

  const amount = toNum(pick(body, "amount"));
  if (amount == null || amount <= 0) {
    badRequest(reply, "amount is required and must be greater than zero");
    return null;
  }

  const reason = has(body, "reason")
    ? str(pick(body, "reason")).trim() || null
    : null;

  // vendor must belong to this tenant (scoped select → 400 for a foreign id).
  const [vendor] = (await db.select(
    vendors,
    eq(vendors.id, vendorId),
  )) as VendorRow[];
  if (!vendor) {
    badRequest(reply, "vendor not found in this tenant");
    return null;
  }

  // ref ap_billing must belong to this tenant (scoped select → 404 for a foreign id).
  const [bill] = (await db.select(
    apBillings,
    eq(apBillings.id, refApId),
  )) as ApBillingRow[];
  if (!bill) {
    notFound(reply, `AP billing ${refApId} not found`);
    return null;
  }

  return { vendorId, refApId, amount, reason };
}

// ---------------------------------------------------------------------------
// Model-A JV post (the SINGLE money authority shared by CN + DN approve)
// ---------------------------------------------------------------------------
// Idempotent, balanced, 2-line, no-VAT (Wei B-231=ก). In order:
//   1. Pre-check idempotency: a JV already carrying this source_doc → 409 (the
//      note is already approved; the note `status` is NOT mutated — honest).
//   2. Resolve the two posting codes in THIS tenant's COA; a missing code is an
//      honest 409 (never post an unbalanced / mis-accounted JV — gl-post.ts C-177).
//   3. Post a balanced Dr drCode / Cr crCode = amount JV in ONE db.transaction
//      (jv + jv_line via insertThrough — B-097).
//   4. A concurrent double-approve trips the 0037 source_doc UNIQUE index (23505)
//      → mapped to the same 409 (never a 500, never a duplicate JV).
// Returns the JV number on success, or null AFTER having sent the 4xx reply.
async function postModelAJv(
  db: TenantDb,
  reply: FastifyReply,
  opts: {
    amount: number;
    drCode: string;
    crCode: string;
    sourceDoc: string;
    memo: string;
    currencyCode: string;
    label: string;
    docId: string;
  },
): Promise<string | null> {
  const priorJv = (await db.select(
    jvs,
    eq(jvs.sourceDoc, opts.sourceDoc),
  )) as JvRow[];
  if (priorJv.length > 0) {
    conflict(reply, `${opts.label} ${opts.docId} already approved`);
    return null;
  }

  const acctIds = await resolveAccountIds(db, [opts.drCode, opts.crCode]);
  const drId = acctIds.get(opts.drCode);
  const crId = acctIds.get(opts.crCode);
  if (!drId || !crId) {
    conflict(
      reply,
      "the tenant chart of accounts is missing a required posting account",
    );
    return null;
  }

  // B-318: assigned INSIDE allocThenPost below (a retry must re-read the max).
  let jvNo = "";
  const jvId = randomUUID();
  const lineRows: (typeof jvLines.$inferInsert)[] = [
    { jvId, accountId: drId, dr: moneyStr(opts.amount), cr: moneyStr(0), currencyCode: opts.currencyCode },
    { jvId, accountId: crId, dr: moneyStr(0), cr: moneyStr(opts.amount), currencyCode: opts.currencyCode },
  ];

  // B-318: allocate + post is ONE retryable unit (see withDocNoRetry).
  const allocThenPost = async (): Promise<void> => {
    jvNo = await allocJvNo(db);
    await db.transaction(async (tx) => {
      await tx
        .insert(jvs, {
          id: jvId,
          no: jvNo,
          sourceDoc: opts.sourceDoc,
          memo: opts.memo,
        })
        .returning();
      await tx.insertThrough(jvLines, jvs, jvId, lineRows);
    });
  };
  try {
    await withDocNoRetry(allocThenPost);
  } catch (err) {
    // B-318 FIRST: JV-number allocation lost the race to exhaustion. Nothing
    // committed — a 409 here would falsely claim the note was already approved.
    if (err instanceof DocNoExhaustedError) {
      docNoExhausted(reply);
      return null;
    }
    if (isUniqueViolation(err)) {
      conflict(reply, `${opts.label} ${opts.docId} already approved`);
      return null;
    }
    throw err;
  }

  return jvNo;
}

// ---------------------------------------------------------------------------
// GET /ap/cn — list AP credit notes
// ---------------------------------------------------------------------------
async function listApCn(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(apCreditNotes)) as ApCreditNoteRow[];
  return newestFirst(rows).map(noteWire);
}

// ---------------------------------------------------------------------------
// GET /ap/dn — list AP debit notes
// ---------------------------------------------------------------------------
async function listApDn(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(apDebitNotes)) as ApDebitNoteRow[];
  return newestFirst(rows).map(noteWire);
}

// ---------------------------------------------------------------------------
// POST /ap/cn — create an AP credit note
// ---------------------------------------------------------------------------
// Validated per validateNoteCreate; `no` is SERVER-generated (CN-<year>-<NNNN>);
// stored as-is (currency THB); company_id is force-set by the scoped insert.
async function createApCn(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const input = await validateNoteCreate(db, request, body, reply);
  if (!input) return reply;

  const existing = (await db.select(apCreditNotes)) as ApCreditNoteRow[];
  const no = nextNoteNo(existing.map((r) => r.no), "CN");

  const [created] = (await db
    .insert(apCreditNotes, {
      no,
      vendorId: input.vendorId,
      refApId: input.refApId,
      reason: input.reason,
      amount: moneyStr(input.amount),
      currencyCode: "THB",
    })
    .returning()) as ApCreditNoteRow[];

  return reply.code(201).send(noteWire(created!));
}

// ---------------------------------------------------------------------------
// POST /ap/dn — create an AP debit note
// ---------------------------------------------------------------------------
async function createApDn(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const input = await validateNoteCreate(db, request, body, reply);
  if (!input) return reply;

  const existing = (await db.select(apDebitNotes)) as ApDebitNoteRow[];
  const no = nextNoteNo(existing.map((r) => r.no), "DN");

  const [created] = (await db
    .insert(apDebitNotes, {
      no,
      vendorId: input.vendorId,
      refApId: input.refApId,
      reason: input.reason,
      amount: moneyStr(input.amount),
      currencyCode: "THB",
    })
    .returning()) as ApDebitNoteRow[];

  return reply.code(201).send(noteWire(created!));
}

// ---------------------------------------------------------------------------
// POST /ap/cn/{id}/approve — post the CN's Model-A JV (Dr 2010 AP / Cr 5020)
// ---------------------------------------------------------------------------
// finance.approve gate. Load the CN (scoped → 404). A credit note REDUCES the
// payable + reverses materials cost: Dr AP / Cr materials = amount (no VAT — Wei
// B-231=ก). Idempotent on source_doc `apcn:<id>`. Returns ActionOk {id,jv_no,amount}.
async function approveApCn(
  db: TenantDb,
  request: FastifyRequest,
  cnId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinanceApprove(request, reply))) return reply;

  const [cn] = (await db.select(
    apCreditNotes,
    eq(apCreditNotes.id, cnId),
  )) as ApCreditNoteRow[];
  if (!cn) return notFound(reply, `AP credit note ${cnId} not found`);

  const amount = round2(num(cn.amount));
  const jvNo = await postModelAJv(db, reply, {
    amount,
    drCode: ACCT.ap, // 2010 — reduce the payable
    crCode: ACCT.materials, // 5020 — reverse materials cost
    sourceDoc: `apcn:${cnId}`,
    memo: `ap-credit-note ${cn.no}`,
    currencyCode: cn.currencyCode ?? "THB",
    label: "AP credit note",
    docId: cnId,
  });
  if (jvNo === null) return reply;

  return reply.code(200).send({ id: cnId, jv_no: jvNo, amount });
}

// ---------------------------------------------------------------------------
// POST /ap/dn/{id}/approve — post the DN's Model-A JV (Dr 5100 / Cr 2010 AP)
// ---------------------------------------------------------------------------
// finance.approve gate. Load the DN (scoped → 404). A debit note INCREASES the
// payable + adds expense: Dr admin-expense / Cr AP = amount (no VAT — Wei B-231=ก).
// Idempotent on source_doc `apdn:<id>`. Returns ActionOk {id,jv_no,amount}.
async function approveApDn(
  db: TenantDb,
  request: FastifyRequest,
  dnId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinanceApprove(request, reply))) return reply;

  const [dn] = (await db.select(
    apDebitNotes,
    eq(apDebitNotes.id, dnId),
  )) as ApDebitNoteRow[];
  if (!dn) return notFound(reply, `AP debit note ${dnId} not found`);

  const amount = round2(num(dn.amount));
  const jvNo = await postModelAJv(db, reply, {
    amount,
    drCode: ACCT.adminExpense, // 5100 — add expense
    crCode: ACCT.ap, // 2010 — increase the payable
    sourceDoc: `apdn:${dnId}`,
    memo: `ap-debit-note ${dn.no}`,
    currencyCode: dn.currencyCode ?? "THB",
    label: "AP debit note",
    docId: dnId,
  });
  if (jvNo === null) return reply;

  return reply.code(200).send({ id: dnId, jv_no: jvNo, amount });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the AP CN/DN routes on the given (already /api/v1-prefixed) scope. */
export function registerApCnDnRoute(app: FastifyInstance): void {
  const body = (request: FastifyRequest): Record<string, unknown> =>
    (request.body ?? {}) as Record<string, unknown>;
  const idParam = (request: FastifyRequest): string =>
    (request.params as { id?: string }).id ?? "";

  // --- credit notes ---------------------------------------------------------
  app.get("/ap/cn", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return reply.code(200).send(listEnvelope(await listApCn(db)));
  });

  app.post("/ap/cn", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createApCn(db, request, body(request), reply);
  });

  app.post("/ap/cn/:id/approve", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return approveApCn(db, request, idParam(request), reply);
  });

  // --- debit notes ----------------------------------------------------------
  app.get("/ap/dn", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return reply.code(200).send(listEnvelope(await listApDn(db)));
  });

  app.post("/ap/dn", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createApDn(db, request, body(request), reply);
  });

  app.post("/ap/dn/:id/approve", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return approveApDn(db, request, idParam(request), reply);
  });
}
