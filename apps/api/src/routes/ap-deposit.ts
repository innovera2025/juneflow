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
//
// DEPOSIT IDEMPOTENCY (B-313 · migration 0060) — this comment used to read "a
// deposit posts its JV EXACTLY ONCE at create (the deposit id is fresh), so there is
// no idempotency pre-check to make; the source_doc `dep:<id>` UNIQUE index
// (migration 0039) is the mandatory race backstop". That reasoning is BACKWARDS and
// is deleted. It is the same false comment B-312 deleted from inventory.ts, and it
// is why this survived review: a fresh id per request is precisely WHY a replay is
// unprotected. `depositId = randomUUID()` → `dep:${depositId}`, so a replayed create
// mints a NEW uuid → a NEW source_doc → jv_source_doc_uq can never see it. That
// index is real, armed, and its predicate DOES list `dep:` (verified live — a
// same-source_doc insert raises 23505); it simply backstops a re-post of the SAME
// deposit, never a replayed CREATE. apps/mobile's offline SyncProcessor retries
// at-least-once, so a create it never heard back on is re-sent.
// PROVEN LIVE on the un-patched build (byte-identical body posted twice):
//   201, 201 → DP-2026-0001 + DP-2026-0002, JV-2026-0419 + JV-2026-0420,
//   Σ Dr 1160 = Σ Cr 1010 = 500,000.00 for ONE intended ฿250,000 payment.
// Cash is credited twice for one disbursement and the vendor advance is overstated
// by the full amount; the AuditLog rows are indistinguishable (action=create, same
// user, no entity id), so post-hoc the duplicate is invisible.
// The fix is the ratified B-261/B-307 template: a CLIENT idempotency_key + a PARTIAL
// unique index + a catch that returns the ORIGINAL. It is a CLIENT key (not B-308's
// natural key) because BOTH halves of the natural-key test fail live — see the
// schema note on apDeposits.idempotencyKey (finance.ts).
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
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
import { has, pick, readIdempotencyKey, str, toNum } from "./procurement.js";
import { loadCaller, permAllowed } from "./authz.js";
import { listEnvelope } from "./list-envelope.js";
import { newestFirst } from "./list-order.js";
import {
  ACCT,
  allocJvNo,
  DEPOSIT_NO_CONSTRAINTS,
  docNoExhausted,
  DocNoExhaustedError,
  isUniqueViolation,
  resolveAccountIds,
  violatedConstraint,
  withDocNoRetry,
} from "./gl-post.js";

type ApDepositRow = typeof apDeposits.$inferSelect;
type VendorRow = typeof vendors.$inferSelect;
type PoRow = typeof pos.$inferSelect;
type WoRow = typeof wos.$inferSelect;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The perms-matrix module (seed MODULE_IDS) that governs finance mutations. */
const FINANCE_MODULE = "finance";

/** The partial unique index the B-313 replay branch gates on BY NAME (B-263). */
const DEPOSIT_IDEMPOTENCY_CONSTRAINT = "ap_deposit_idempotency_uq";

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

// B-323: the local `newestFirst` + its `msOf` helper are DELETED here — they were a
// hand-rolled shadow of list-order.ts's export, and the shadow was tie-BLIND: its
// comparator returned 0 for two deposits sharing an instant, which hands the pair back
// to the join plan. The shared `newestFirst` is TOTAL (created_at DESC, then id ASC).

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
// Shared ref resolution + the B-313 idempotency resolver / sender
// ---------------------------------------------------------------------------

/**
 * Resolve a deposit's `ref` (po.no ?? wo.no) through the SAME scoped pr → project
 * hops everything else in this file uses, and report whether each supplied id
 * resolved. ONE function for BOTH callers so the create's validation and the B-313
 * replay can never drift on how a ref is tenant-scoped:
 *   - the CREATE passes the REQUEST's ids and maps a false flag to its 400 (a
 *     foreign / cross-tenant id resolves to nothing through the hops — fail closed);
 *   - the REPLAY passes the ORIGINAL ROW's stored ids and takes `refNo` only. Those
 *     ids were tenant-validated at create time and both FKs are ON DELETE SET NULL,
 *     so a stored id is always still resolvable or already null; an unresolvable one
 *     yields the honest null registerWire already documents, never a fabrication.
 */
async function resolveRef(
  db: TenantDb,
  poId: string | null,
  woId: string | null,
): Promise<{ poOk: boolean; woOk: boolean; refNo: string | null }> {
  let refNo: string | null = null;
  let poOk = true;
  let woOk = true;
  if (poId) {
    const [po] = (await db.selectThrough(pos, PO_HOPS, eq(pos.id, poId))) as PoRow[];
    poOk = Boolean(po);
    refNo = po?.no ?? null;
  }
  if (woId) {
    const [wo] = (await db.selectThrough(wos, WO_HOPS, eq(wos.id, woId))) as WoRow[];
    woOk = Boolean(wo);
    refNo = refNo ?? wo?.no ?? null;
  }
  return { poOk, woOk, refNo };
}

/**
 * The ONLY place a 201 create/replay body is produced. Both the FRESH create and the
 * B-313 replay call it with the same serializer (registerWire — also the register's),
 * so a replayed POST is byte-identical to the original BY CONSTRUCTION rather than by
 * two hand-built shapes happening to agree today (the grCreateEnvelope precedent).
 * The three arguments agree on a replay too: `row` IS the persisted original, and
 * `vendorName` comes from the REQUEST's vendor_id which findDepositByIdempotencyKey
 * AND-binds — so it is necessarily the original's vendor. `refNo` is re-derived from
 * the ORIGINAL row's stored po/wo ids by resolveRef.
 */
function sendDeposit(
  reply: FastifyReply,
  row: ApDepositRow,
  vendorName: string | null,
  refNo: string | null,
): FastifyReply {
  return reply.code(201).send(registerWire(row, vendorName, refNo));
}

/**
 * Resolve the ORIGINAL deposit behind a client idempotency_key. TWO filters, BOTH
 * load-bearing:
 *   - the TENANT scope — `ap_deposit` carries company_id directly, so it is a plain
 *     TenantTable and db.select() AND-binds company_id by construction (ZERO hops,
 *     the attendance / material-issue shape — unlike gr, which has no company_id and
 *     must walk po/wo → pr → project). Without it a key-only lookup could resolve
 *     ANOTHER company's deposit: ap_deposit_idempotency_uq is a GLOBAL partial index
 *     on the key alone, so a cross-tenant key clash is physically possible.
 *   - the ANCHOR vendor_id — the same key replayed against a DIFFERENT vendor must
 *     never hand back the first vendor's deposit: that would confirm a payment the
 *     second vendor never received, and hide the one that was actually made.
 * vendor_id is the ONE anchor with the properties this needs — required (400 when
 * absent), tenant-verified before we get here, and never null on a keyed row. po_id
 * and wo_id are deliberately NOT anchors: both are optional nullable free refs, so an
 * equality filter on them is three-valued (a null-vs-null "match" is trivially true
 * and buys nothing), and the case that matters — a key reused against a different
 * PAYEE — is already closed by vendor_id.
 * A non-matching anchor deliberately resolves to null: the caller falls through to
 * the insert, trips the global index, and the catch answers the honest 409
 * "idempotency_key already used". Handing back someone else's document is worse than
 * a 409. Used by BOTH the pre-check and the 23505 catch — ONE resolver, so the two
 * paths can never diverge on what counts as "the client's own deposit".
 */
async function findDepositByIdempotencyKey(
  db: TenantDb,
  args: { idempotencyKey: string; vendorId: string },
): Promise<ApDepositRow | null> {
  const [existing] = (await db.select(
    apDeposits,
    and(
      eq(apDeposits.idempotencyKey, args.idempotencyKey),
      eq(apDeposits.vendorId, args.vendorId),
    ),
  )) as ApDepositRow[];
  return existing ?? null;
}

/**
 * Rebuild and send the 201 for an ALREADY-PERSISTED deposit — same id, same server
 * `no`, money RE-READ from the stored column not recomputed, and critically NO second
 * write of any kind: no ap_deposit row, no JV header, no jv_line, so no second cash
 * credit. A later change to the request body cannot make the replay disagree with the
 * original, because nothing in this path reads the body.
 */
async function sendExistingDeposit(
  db: TenantDb,
  reply: FastifyReply,
  existing: ApDepositRow,
  vendorName: string | null,
): Promise<FastifyReply> {
  const { refNo } = await resolveRef(db, existing.poId, existing.woId);
  return sendDeposit(reply, existing, vendorName, refNo);
}

/**
 * B-313 idempotency REPLAY, reached from the 23505 CATCH. The deposit insert tripped
 * ap_deposit_idempotency_uq: a POST /ap/deposit carrying a previously-seen
 * idempotency_key is the mobile SyncProcessor's at-least-once retry, NOT a new
 * payment. This is the CONCURRENCY BACKSTOP for the pre-check — the pre-check read
 * nothing, then a racing replay of the same key committed before our insert. A key
 * that collided at the DB layer but resolves to nothing in THIS tenant/vendor (a
 * cross-tenant clash, or the same key against a different vendor) is an honest 409 —
 * never a leak, never a fabricated deposit. Kept deliberately alongside the
 * pre-check: a pre-check is NOT a substitute for the unique index + catch
 * (money-post-idempotency lesson).
 */
async function replayExistingDeposit(
  db: TenantDb,
  reply: FastifyReply,
  args: { idempotencyKey: string; vendorId: string; vendorName: string | null },
): Promise<FastifyReply> {
  const existing = await findDepositByIdempotencyKey(db, args);
  if (!existing) return conflict(reply, "idempotency_key already used");
  return sendExistingDeposit(db, reply, existing, args.vendorName);
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
// Body (opaque Entity): { vendor_id, po_id?, wo_id?, amount, pct?, reason?,
// idempotency_key? }. Enforced fail-closed, IN ORDER (mirrors ap.ts createBilling +
// ar.ts create):
//   1. authz: finance.create (paying cash) → 403.
//   1b. B-313/B-309: idempotency_key parsed FIRST after authz — a present non-string
//      key is a 400, never a silent dedup-off.
//   2. vendor_id required → 400.
//   3. amount required + finite + > 0 → 400.
//   4. vendor must be THIS tenant's (scoped select → 400).
//   5. po_id / wo_id, when supplied, must resolve to THIS tenant via selectThrough
//      (a foreign / cross-tenant id resolves to nothing → 400, fail closed).
//   5b. B-313 REPLAY PRE-CHECK: a key that already resolves to a deposit of this
//      tenant + payee returns THAT deposit's 201 — no second row, no second JV. It
//      sits after every anchor gate and BEFORE step 6 on purpose (see the note there).
//   6. accounts: resolve 1160 + 1010 in THIS tenant's COA; a missing code → 409
//      honest (never invent an account — gl-post.ts C-177).
// Then, in ONE db.transaction (money=SERVER — the JV reads the STORED amount):
// allocate DP-no + insert ap_deposit {company_id force-set, no, vendorId, poId,
// woId, reason, pct(nullable), amount, used='0', currency THB, status='approved',
// idempotencyKey} + post the balanced JV (Dr 1160 / Cr 1010 = amount, source_doc
// dep:<depositId>, jv_line via insertThrough). Note the DP/JV numbers are allocated
// AFTER the pre-check, so a replay burns neither. Race-safe on TWO indexes:
// ap_deposit_idempotency_uq (0060) → the client's ORIGINAL deposit, 201; and
// jv_source_doc_uq (0039, a re-post of the SAME deposit) → 409 (never a 500, never a
// double post). Returns 201 with the created row's register wire.
async function createDeposit(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  // 1. authz — paying a deposit spends cash → finance.create (fail-closed 403).
  if (!(await requireFinanceCreate(request, reply))) return reply;

  // B-313: the client's replay key, read FIRST — before any validation, any read and
  // any write, so nothing can run ahead of it. Absent / explicit null / blank → null,
  // so the web create form is unchanged and no dedup path fires without a key (the
  // index is PARTIAL and SQL NULL is not equal to itself, so both layers refuse a
  // null independently). B-309: a PRESENT but non-string key is a 400 rather than
  // being swallowed by str() into that same null — a silent dedup-off double-posts
  // this deposit's JV, which is the whole defect. Shared parser
  // (readIdempotencyKey) with POST /gr, /labor/attendance and /inventory/issues so
  // the money-writes cannot drift on what counts as a key.
  const idem = readIdempotencyKey(body);
  if (!idem.ok) return badRequest(reply, idem.message);
  const idempotencyKey = idem.key;

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

  // 5. each supplied po/wo ref must resolve to this tenant (fail closed). Shared
  // resolver with the B-313 replay sender — same hops, no drift.
  const ref = await resolveRef(db, poId, woId);
  if (!ref.poOk) return badRequest(reply, "po_id not found in this tenant");
  if (!ref.woOk) return badRequest(reply, "wo_id not found in this tenant");
  const refNo = ref.refNo;

  // B-313 PRE-CHECK, placed AFTER every anchor gate (a foreign vendor/po/wo is a 400
  // REGARDLESS of any key — a replay against something that is not ours must never be
  // answered from our data) and deliberately BEFORE the COA resolution below. That
  // order is load-bearing, not cosmetic: the ORIGINAL deposit could only have posted
  // if 1160 and 1010 existed, but the COA is editable, so if an admin removed one
  // afterwards a replay would answer 409 "chart of accounts is missing a required
  // posting account" for cash that HAS already left the company —
  // apps/mobile/sync_processor.dart dead-letters every 4xx PERMANENTLY, so the payer
  // would see FAILED with no in-app recovery for a payment that succeeded. That is
  // B-264 exactly. Falling through is safe: a key that is new (or belongs to another
  // vendor/tenant) still meets every gate below, and the 23505 catch remains the
  // concurrency backstop.
  if (idempotencyKey) {
    const existing = await findDepositByIdempotencyKey(db, { idempotencyKey, vendorId });
    if (existing) return sendExistingDeposit(db, reply, existing, vendor.name);
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

  // Pre-resolve the ids so source_doc dep:<depositId> references the row.
  const depositId = randomUUID();
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
  // B-318: the two doc numbers are assigned INSIDE the retried closure below (the
  // whole point of the retry is to re-read the advanced max), but the catch and the
  // 201 body both need the numbers that were actually attempted/committed — so they
  // live out here and the closure writes them.
  let no = "";
  let jvNo = "";

  // ONE transaction (mirror ar.ts createArInvoice + approveCn): the ap_deposit row,
  // the jv header + its lines are all-or-nothing. The JV amount reads the value
  // just stored on the deposit (money=SERVER). insertThrough re-proves this tenant
  // owns the just-created parent jv (jv_line has no company_id).
  //
  // B-318: allocate + write is wrapped in withDocNoRetry on BOTH numbered rows this
  // tx writes (ap_deposit.no and jv.no). A concurrent DISTINCT deposit that read the
  // same max now trips 0061 → this rolls back → re-allocate → write again, instead
  // of the false "already posted" 409 the index alone would produce. The B-313
  // idempotency-key 23505 names a DIFFERENT constraint, so it is never retried: it
  // propagates on the first throw to its own branch below.
  let created: ApDepositRow;
  try {
    created = await withDocNoRetry(async () => {
      no = await allocDepositNo(db);
      jvNo = await allocJvNo(db);
      return db.transaction(async (tx) => {
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
            // B-313: the deposit carries the client key. A REPLAY that raced past the
            // pre-check trips ap_deposit_idempotency_uq → 23505 → the catch below
            // returns the ORIGINAL. This is the FIRST write in the tx, so that 23505
            // rolls the whole block back BEFORE the JV header or either leg exists —
            // the replay-safety of the posting is structural, not a compensating
            // action.
            idempotencyKey,
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
    }, DEPOSIT_NO_CONSTRAINTS);
  } catch (err) {
    // B-318 FIRST: the allocate-and-write loop above gave up. Nothing is committed,
    // and this is transient contention — a 409 would both lie about a business
    // conflict and (mobile sync_processor) dead-letter a payment the user still owes.
    if (err instanceof DocNoExhaustedError) return docNoExhausted(reply);
    // B-313 CONCURRENCY BACKSTOP, checked FIRST. Our pre-check read before the
    // original committed; our insert then hit the index. Entering this branch needs
    // ALL THREE of: a key present (the partial index exempts nulls, so a key-less
    // insert can never dedup), SQLSTATE 23505, and — B-263 — the violated constraint
    // BY NAME. `err.constraint` alone is undefined in production because drizzle
    // nests the DatabaseError under `.cause`; violatedConstraint() reads both levels.
    // The name check is load-bearing: 23505 alone only says "SOME unique constraint",
    // and this table now has TWO reachable ones. If violatedConstraint ever returned
    // undefined the request would fall through to the bare 409 below — no replay
    // convenience, but still no double post, which is the safe direction.
    if (
      idempotencyKey &&
      isUniqueViolation(err) &&
      violatedConstraint(err) === DEPOSIT_IDEMPOTENCY_CONSTRAINT
    ) {
      return replayExistingDeposit(db, reply, {
        idempotencyKey,
        vendorId,
        vendorName: vendor.name,
      });
    }
    // Any OTHER unique violation — chiefly a re-post of the SAME deposit against the
    // 0039 jv_source_doc_uq index — is a 409 (never a 500, never a double post).
    // Mirrors ar.ts approveCn. ORDER matters: this bare catch must stay BELOW the
    // named branch or it would swallow every idempotency replay into "already posted".
    if (isUniqueViolation(err)) {
      return conflict(reply, `vendor deposit ${no} already posted`);
    }
    throw err;
  }

  return sendDeposit(reply, created, vendor.name, refNo);
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
