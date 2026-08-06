// AP (accounts-payable) handlers — P2-BE-18 part 2, Wave-2 (finance). Wires the
// ap.billing + ap.pv screens: list/create AP billings, list/create payment
// vouchers (PV), and the PV approval ladder. The schema (migration 0026:
// ap_billing.wht/retention/wo_id, pv.amount/retention/method/cheque_*, cheque.
// pv_id), the Finance Manager role seed (B-089 / F-PV1), and the contract paths
// (openapi.yaml — widened POST bodies + the two opaque EntityList reads)
// ALL pre-exist. This file wires the handlers and is registered in app.ts.
//
// Contract (openapi.yaml §Finance-Accounting):
//   GET  /ap/billing   → EntityList     — AP billings          (listApBilling)
//   POST /ap/billing   → EntityCreated  — create a billing     (createApBilling)
//   GET  /ap/pv        → EntityList     — payment vouchers     (listApPv)
//   POST /ap/pv        → EntityCreated  — create a PV          (createApPv)
//   POST /pv/{id}/approve → ActionOk    — approve a PV         (approvePv)
// Each row/body is the opaque Entity (snake_case wire of REAL columns). Reads on
// an opaque endpoint need no contract change (FLOW-A opaque-Entity finding).
//
// Tenant scope (fail closed): ap_billing / pv / vendor carry company_id → the
// scoped TenantDb.select() door. po / wo / gr carry NO company_id — they anchor
// through pr → project, so a supplied po_id/wo_id/gr_id is tenant-verified via
// selectThrough (a foreign id resolves to nothing → rejected). Without a
// resolved tenant, request.db is absent and every handler answers a flat 401.
//
// WHT (F-AP1, Wei = ก persist + tax-engine): the withholding-tax leg is computed
// through @juneflow/tax-engine.calcWht (the typed, fake-first compliance engine —
// NOT inline float math) so the real Thai RD implementation swaps in later behind
// the same interface. On POST /ap/billing an explicit `wht` is honoured; when
// omitted it is derived at the default construction WHT rate. On POST /ap/pv the
// WHT leg of net = gross − WHT − retention is always the engine's result.
//
// PV approval ladder (F-PV1, flows.html "บัญชี → ผจก.การเงิน (>500K) → MD (>2M)"):
// the caller's role must carry the finance-approve perm (tier-1 = บัญชี, any
// level) AND reach the approval tier the PV's gross demands — approvalLevel ≥ 3
// (the seeded Finance Manager `finmgr` / PM level) above 500K, ≥ 4 (dir / MD)
// above 2M. Reuses authz.ts (loadCaller/permAllowed) + the procurement approval
// model; it invents no new policy. Fail-closed: an unattributable caller, or one
// lacking the perm or tier, is denied 403.
//
// HONEST GAPs (C10 — flagged, never fabricated):
//   - ap_billing / pv have NO own doc-number column (the AP-2026-xxxx / PV-2026-
//     xxxx numbers the prototype shows are dropped at seed time) → `no` is an
//     honest null on every wire, not a fabricated running number.
//   - ap_billing `aging` derives from due_date (days past due); the seed carries
//     no due_date, so aging reads null there rather than an invented age.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import {
  apBillings,
  grs,
  projects,
  prs,
  pos,
  pvMethod,
  pvs,
  vendors,
  wos,
} from "@juneflow/db/schema";
import { FakeTaxEngine } from "@juneflow/tax-engine/thailand";
import type { TaxEngine } from "@juneflow/tax-engine";
import type { TenantDb } from "../db/tenant-db.js";
import { businessNowMs } from "../business-clock.js";
import { round2 } from "./money.js";
import { listEnvelope } from "./list-envelope.js";
import { has, pick, str, toNum } from "./procurement.js";
import { loadCaller, permAllowed } from "./authz.js";

type ApBillingRow = typeof apBillings.$inferSelect;
type PvRow = typeof pvs.$inferSelect;
type VendorRow = typeof vendors.$inferSelect;
type PoRow = typeof pos.$inferSelect;
type WoRow = typeof wos.$inferSelect;
type GrRow = typeof grs.$inferSelect;

// ---------------------------------------------------------------------------
// Constants — the finance perms module + the PV approval-ladder thresholds.
// ---------------------------------------------------------------------------

/** The perms-matrix module (seed MODULE_IDS) that governs finance approvals. */
const FINANCE_MODULE = "finance";

/**
 * PV approval-ladder thresholds (THB, strict >), flows.html PV row:
 * บัญชี approve every PV (tier-1) → ผจก.การเงิน required above 500K (tier-2) → MD
 * above 2M (tier-3). These are flows.html constants (the seed's role blanket
 * limit is not a per-tier matrix), mirroring the pr.ts / procurement.ts ruling.
 */
const PV_TIER_FINMGR_THRESHOLD = 500_000; // gross > this → approvalLevel ≥ 3
const PV_TIER_MD_THRESHOLD = 2_000_000; // gross > this → approvalLevel ≥ 4

/** role.approvalLevel tiers (packages/db seed) engaged by the PV ladder. */
const APPROVAL_LEVEL_FINMGR = 3; // ผจก.การเงิน — the seeded Finance Manager (finmgr) / PM level
const APPROVAL_LEVEL_MD = 4; // MD (dir) — unlimited tier

/**
 * The default withholding-tax rate (percent) applied when a POST /ap/billing
 * omits an explicit `wht`. 3% is the Thai construction/subcontract WHT rate the
 * prototype + seed use (PV_LIST whtPct "3.00", ap.jsx WHT 3%). A real per-income-
 * type rate table belongs to the tax-engine (TODO(P0-INT-01)); this default keeps
 * the derived leg faithful until then. (FLAGGED for Wei — see report.)
 */
const DEFAULT_WHT_PCT = 3;

/** One calendar day in ms — aging = days past due_date. */
const MS_PER_DAY = 86_400_000;

/**
 * The compliance tax engine (mock-first, PLAN.md §4). The fake adapter does the
 * WHT/VAT float math deterministically for dev/tests; the real `thailand` driver
 * swaps in behind the same TaxEngine interface (env-selected) once P0-INT-01
 * lands. Instantiated once at module load — stateless, no credentials.
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
 * The withholding-tax amount on a gross value, via @juneflow/tax-engine.calcWht
 * (NOT inline math — F-AP1). Returns the 2-dp rounded magnitude.
 */
async function computeWht(gross: number, ratePercent: number): Promise<number> {
  const result = await taxEngine.calcWht({
    baseAmount: { amount: moneyStr(gross), currencyCode: "THB" },
    ratePercent,
  });
  return round2(num(result.whtAmount.amount));
}

/** Aging in whole days past due_date (null when no due_date is stored). */
function agingDays(dueDate: unknown): number | null {
  if (dueDate == null) return null;
  const due = new Date(dueDate as string | Date).getTime();
  if (!Number.isFinite(due)) return null;
  return Math.floor((businessNowMs() - due) / MS_PER_DAY); // B-224: businessNow aligns aging with a frozen seed (default Date.now())
}

// ---------------------------------------------------------------------------
// Tenant-anchor hops for the parent-scoped (company_id-less) tables.
// ---------------------------------------------------------------------------
// po / wo scope through pr → project (mirror po.ts / wo.ts / gr.ts). A GR
// anchors on EITHER a PO or a WO, so its scope UNIONs the two chains (gr.ts).
const PO_HOPS = [
  { fk: pos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const WO_HOPS = [
  { fk: wos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const GR_PO_HOPS = [
  { fk: grs.poId, parent: pos },
  { fk: pos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const GR_WO_HOPS = [
  { fk: grs.woId, parent: wos },
  { fk: wos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];

// ---------------------------------------------------------------------------
// GET /ap/billing — AP billings (ap.jsx APBilling)
// ---------------------------------------------------------------------------
// Real source: ap_billing (company-scoped). The wire carries the REAL columns
// plus display joins the screen needs: vendor_name (vendorId → vendor), ref
// (the linked po.no / wo.no / gr.no — the "GR/WO" reference column), and aging
// (days past due_date). `no` is an honest null (ap_billing has no doc-number
// column — see header GAP). All po/wo/gr `no` lookups are resolved through the
// tenant-scoped sets (never a cross-tenant read).
function billingWire(
  b: ApBillingRow,
  vendorNames: Map<string, string>,
  refs: { po: Map<string, string | null>; wo: Map<string, string | null>; gr: Map<string, string | null> },
): Record<string, unknown> {
  const ref =
    (b.poId ? refs.po.get(b.poId) : null) ??
    (b.woId ? refs.wo.get(b.woId) : null) ??
    (b.grId ? refs.gr.get(b.grId) : null) ??
    null;
  return {
    id: b.id,
    no: null, // GAP: ap_billing has no own doc-number column (header).
    vendor_id: b.vendorId,
    vendor_name: b.vendorId ? vendorNames.get(b.vendorId) ?? null : null,
    po_id: b.poId,
    wo_id: b.woId,
    gr_id: b.grId,
    ref,
    invoice_no: b.invoiceNo,
    amount: num(b.amount),
    vat: num(b.vat),
    wht: b.wht == null ? null : num(b.wht),
    retention: b.retention == null ? null : num(b.retention),
    due_date: b.dueDate,
    aging: agingDays(b.dueDate),
    status: b.status,
    kind: b.kind,
    currency_code: b.currencyCode,
    doc_date: b.createdAt,
    created_at: b.createdAt,
  };
}

async function listBilling(db: TenantDb): Promise<Record<string, unknown>[]> {
  const [bills, vendorRows, poRows, woRows, grsViaPo, grsViaWo] = await Promise.all([
    db.select(apBillings) as Promise<ApBillingRow[]>,
    db.select(vendors) as Promise<VendorRow[]>,
    db.selectThrough(pos, PO_HOPS) as Promise<PoRow[]>,
    db.selectThrough(wos, WO_HOPS) as Promise<WoRow[]>,
    db.selectThrough(grs, GR_PO_HOPS) as Promise<GrRow[]>,
    db.selectThrough(grs, GR_WO_HOPS) as Promise<GrRow[]>,
  ]);

  const vendorNames = new Map(vendorRows.map((v) => [v.id, v.name]));
  const refs = {
    po: new Map(poRows.map((p) => [p.id, p.no])),
    wo: new Map(woRows.map((w) => [w.id, w.no])),
    gr: new Map([...grsViaPo, ...grsViaWo].map((g) => [g.id, g.no])),
  };

  return [...bills]
    .sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    })
    .map((b) => billingWire(b, vendorNames, refs));
}

// ---------------------------------------------------------------------------
// POST /ap/billing — create an AP billing (ap.jsx BillingForm)
// ---------------------------------------------------------------------------
// Body (contract-widened): { po_id?, wo_id?, gr_id?, vendor_id, invoice_no?,
//   amount, vat?, wht?, retention?, due_date? }. Enforced, in order:
//   - vendor_id required + must be THIS tenant's vendor (fail closed).
//   - amount required, finite, > 0.
//   - any supplied po_id / wo_id / gr_id must resolve to THIS tenant (a foreign
//     id resolves to nothing through the scoped hops → 400, fail closed).
//   - WHT (F-AP1): an explicit `wht` is stored as-is; when omitted it is derived
//     through tax-engine.calcWht at the default construction rate.
// status starts `draft` (server-owned; AP billing has no separate approval step
// in this scope — unlike PV). company_id is force-set by the scoped insert.
async function createBilling(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const vendorId = str(pick(body, "vendor_id", "vendorId")).trim();
  if (!vendorId) return badRequest(reply, "vendor_id is required");

  const amount = toNum(pick(body, "amount"));
  if (amount == null || amount <= 0) {
    return badRequest(reply, "amount is required and must be greater than zero");
  }

  const poId = str(pick(body, "po_id", "poId")).trim() || null;
  const woId = str(pick(body, "wo_id", "woId")).trim() || null;
  const grId = str(pick(body, "gr_id", "grId")).trim() || null;
  const invoiceNo = has(body, "invoice_no", "invoiceNo")
    ? str(pick(body, "invoice_no", "invoiceNo")).trim() || null
    : null;
  const dueDate = has(body, "due_date", "dueDate")
    ? str(pick(body, "due_date", "dueDate")).trim() || null
    : null;
  const vat = toNum(pick(body, "vat"));
  const retention = toNum(pick(body, "retention"));
  const suppliedWht = toNum(pick(body, "wht"));

  // vendor must belong to this tenant (scoped select — no cross-tenant leak).
  const [vendor] = await db.select(vendors, eq(vendors.id, vendorId));
  if (!vendor) return badRequest(reply, "vendor not found in this tenant");

  // Each supplied po/wo/gr ref must resolve to this tenant (fail closed).
  if (poId) {
    const [po] = await db.selectThrough(pos, PO_HOPS, eq(pos.id, poId));
    if (!po) return badRequest(reply, "po_id not found in this tenant");
  }
  if (woId) {
    const [wo] = await db.selectThrough(wos, WO_HOPS, eq(wos.id, woId));
    if (!wo) return badRequest(reply, "wo_id not found in this tenant");
  }
  if (grId) {
    const [viaPo] = await db.selectThrough(grs, GR_PO_HOPS, eq(grs.id, grId));
    const [viaWo] = viaPo ? [viaPo] : await db.selectThrough(grs, GR_WO_HOPS, eq(grs.id, grId));
    if (!viaPo && !viaWo) return badRequest(reply, "gr_id not found in this tenant");
  }

  // WHT (F-AP1): honour an explicit value; else derive via tax-engine.calcWht.
  const wht =
    suppliedWht != null ? round2(suppliedWht) : await computeWht(amount, DEFAULT_WHT_PCT);

  const [created] = (await db
    .insert(apBillings, {
      vendorId,
      poId,
      woId,
      grId,
      invoiceNo,
      dueDate,
      amount: moneyStr(amount),
      vat: vat != null ? moneyStr(vat) : "0",
      wht: moneyStr(wht),
      retention: retention != null ? moneyStr(retention) : null,
      status: "draft",
    })
    .returning()) as ApBillingRow[];

  return reply.code(201).send(
    billingWire(
      created!,
      new Map([[vendor.id, vendor.name]]),
      { po: new Map(), wo: new Map(), gr: new Map() },
    ),
  );
}

// ---------------------------------------------------------------------------
// GET /ap/pv — payment vouchers (ap.jsx APPaymentVoucher)
// ---------------------------------------------------------------------------
// Real source: pv (company-scoped). payee = billing_ids[0] → ap_billing →
// vendor. wht (amount) is derived through tax-engine.calcWht from the stored
// gross + wht_pct (the prototype PV_LIST `wht`); net / retention / method /
// cheque fields are read straight from stored columns. `no` is an honest null
// (pv has no doc-number column — header GAP).
async function pvWire(
  pv: PvRow,
  payee: { vendorId: string | null; vendorName: string | null },
): Promise<Record<string, unknown>> {
  const gross = num(pv.amount);
  const whtPct = num(pv.whtPct);
  return {
    id: pv.id,
    no: null, // GAP: pv has no own doc-number column (header).
    billing_ids: pv.billingIds,
    vendor_id: payee.vendorId,
    payee: payee.vendorName,
    amount: gross,
    wht_pct: whtPct,
    wht: await computeWht(gross, whtPct),
    retention: pv.retention == null ? null : num(pv.retention),
    net: num(pv.net),
    method: pv.method,
    cheque_no: pv.chequeNo,
    cheque_bank: pv.chequeBank,
    cheque_date: pv.chequeDate,
    currency_code: pv.currencyCode,
    batch_id: pv.batchId,
    status: pv.status,
    doc_date: pv.createdAt,
    created_at: pv.createdAt,
  };
}

/** Resolve each PV's payee (billing_ids[0] → ap_billing → vendor), tenant-scoped. */
function resolvePayees(
  pvRows: PvRow[],
  bills: ApBillingRow[],
  vendorRows: VendorRow[],
): Map<string, { vendorId: string | null; vendorName: string | null }> {
  const billVendor = new Map(bills.map((b) => [b.id, b.vendorId]));
  const vendorNames = new Map(vendorRows.map((v) => [v.id, v.name]));
  const out = new Map<string, { vendorId: string | null; vendorName: string | null }>();
  for (const pv of pvRows) {
    const firstBilling = pv.billingIds[0] ?? null;
    const vendorId = firstBilling ? billVendor.get(firstBilling) ?? null : null;
    out.set(pv.id, {
      vendorId,
      vendorName: vendorId ? vendorNames.get(vendorId) ?? null : null,
    });
  }
  return out;
}

async function listPv(db: TenantDb): Promise<Record<string, unknown>[]> {
  const [pvRows, bills, vendorRows] = await Promise.all([
    db.select(pvs) as Promise<PvRow[]>,
    db.select(apBillings) as Promise<ApBillingRow[]>,
    db.select(vendors) as Promise<VendorRow[]>,
  ]);
  const payees = resolvePayees(pvRows, bills, vendorRows);

  const sorted = [...pvRows].sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bt - at;
  });
  return Promise.all(
    sorted.map((pv) => pvWire(pv, payees.get(pv.id) ?? { vendorId: null, vendorName: null })),
  );
}

// ---------------------------------------------------------------------------
// POST /ap/pv — create a payment voucher (ap.jsx PVCreateForm)
// ---------------------------------------------------------------------------
// Body (contract-widened): { billing_ids[], method?, amount, wht_pct?,
//   retention?, cheque_no?, cheque_bank?, cheque_date? }. Enforced, in order:
//   - billing_ids a non-empty array; every id must belong to THIS tenant (the
//     scoped ap_billing select — a foreign id resolves to nothing → 400).
//   - amount (gross) required, finite, > 0.
//   - method, when supplied, must be a valid pv_method enum code.
//   - net = gross − WHT − retention, where the WHT leg is tax-engine.calcWht
//     over the gross at wht_pct (F-AP1). currency inherits the first billing's.
// status starts `pending` — a PV has a SEPARATE approval step (POST
// /pv/{id}/approve), unlike an AP billing. company_id is force-set on insert.
//
// B-094-3 (SoD): the DICTIONARY user who created the PV is captured on the row
// (created_by) so the approval step can enforce separation-of-duties (a creator
// may not approve their own PV). The creator is resolved via loadCaller — the
// same email→dictionary-user mechanism as the audit actor / approval ladder, NOT
// the better-auth auth_user id (which would violate the FK). An unattributable
// caller leaves created_by null (honest — the SoD gate then fails SAFE).
async function createPv(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const rawIds = pick(body, "billing_ids", "billingIds");
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return badRequest(reply, "billing_ids must be a non-empty array");
  }
  const billingIds = [...new Set(rawIds.map((v) => str(v).trim()).filter((v) => v !== ""))];
  if (billingIds.length === 0) {
    return badRequest(reply, "billing_ids must be a non-empty array");
  }

  // B-315 (Wei = ก · 2026-08-06) — money = SERVER. `amount` is deliberately NOT
  // read from the request; it is derived below from the billing rows this handler
  // already loads. Any client `amount` is IGNORED (the browser keeps its figure as
  // an on-screen preview only). See the derivation after the tenant-scope check.

  const whtPctRaw = toNum(pick(body, "wht_pct", "whtPct"));
  const whtPct = whtPctRaw != null && whtPctRaw >= 0 ? whtPctRaw : 0;
  const retention = toNum(pick(body, "retention"));
  const retentionForCalc = retention != null && retention >= 0 ? retention : 0;

  const methodRaw = str(pick(body, "method")).trim();
  let method: (typeof pvMethod.enumValues)[number] | null = null;
  if (methodRaw) {
    if (!(pvMethod.enumValues as readonly string[]).includes(methodRaw)) {
      return badRequest(
        reply,
        `method must be one of ${pvMethod.enumValues.join(" | ")}`,
      );
    }
    method = methodRaw as (typeof pvMethod.enumValues)[number];
  }
  const chequeNo = has(body, "cheque_no", "chequeNo")
    ? str(pick(body, "cheque_no", "chequeNo")).trim() || null
    : null;
  const chequeBank = has(body, "cheque_bank", "chequeBank")
    ? str(pick(body, "cheque_bank", "chequeBank")).trim() || null
    : null;
  const chequeDate = has(body, "cheque_date", "chequeDate")
    ? str(pick(body, "cheque_date", "chequeDate")).trim() || null
    : null;

  // Every referenced billing must belong to this tenant (fail closed) — the
  // scoped select returns only this tenant's rows, so a foreign id is absent.
  const ownedBills = (await db.select(
    apBillings,
    inArray(apBillings.id, billingIds),
  )) as ApBillingRow[];
  const ownedIds = new Set(ownedBills.map((b) => b.id));
  const foreign = billingIds.find((id) => !ownedIds.has(id));
  if (foreign) {
    return badRequest(reply, `billing_id ${foreign} not found in this tenant`);
  }

  // ── B-315: the SERVER computes the payable ────────────────────────────────
  // The gross is what the covered billings already carry — Σ ap_billing.amount.
  //
  // `ap_billing.amount` is VAT-INCLUSIVE: `vat` is the tax portion CONTAINED IN
  // it, never an addend. Every seeded row satisfies vat = amount × 7/107
  // (920000/60187, 96800/6334, 415400/27184, 268000/17542, 645000/42196), and
  // ap.jsx's own PV net box shows AP-2026-0180 as "645,000.00" under the label
  // "มูลค่า AP รวม (รวม VAT)" while that billing's vat is 42,196 — excluded.
  // 645000 − 19350 (3%) − 64500 = 561,150, the prototype's printed net exactly.
  // The browser was sending amount + vat, which DOUBLE-COUNTED the VAT (+6.54%).
  //
  // billing_ids is a SET (deduped above) and the handler accepts N ids, so this
  // SUMS — it must not read billingIds[0] the way payee/currency do. ownedBills
  // is exactly the requested set: the select is inArray-scoped and any id missing
  // from it already returned 400 above, so no row can be counted twice or missed.
  //
  // The 400 below replaces the deleted client-side `amount > 0` check: a billing
  // may legitimately carry amount 0 (the column is notNull default "0", and the
  // land-sales / subcon inserters write computed values), and a zero-value PV
  // would post a zero JV and print a zero bank instruction.
  const amount = round2(ownedBills.reduce((sum, b) => sum + num(b.amount), 0));
  if (amount <= 0) {
    return badRequest(reply, "billing_ids cover no payable amount");
  }

  // WHT leg via the tax engine (F-AP1); net = gross − WHT − retention. Currency
  // inherits the first covered billing's (C10 — real), else THB.
  const wht = await computeWht(amount, whtPct);
  const net = round2(amount - wht - retentionForCalc);
  const currency =
    ownedBills.find((b) => b.id === billingIds[0])?.currencyCode ??
    ownedBills[0]?.currencyCode ??
    "THB";

  // B-094-3 (SoD): stamp the creator's DICTIONARY user id (loadCaller — email→
  // user, tenant-scoped). null when the caller can't be attributed (honest — the
  // approve gate then can't prove self-approval and won't block).
  const caller = await loadCaller(request);
  const createdBy = caller?.userId ?? null;

  const [created] = (await db
    .insert(pvs, {
      billingIds,
      whtPct: whtPct.toFixed(2),
      amount: moneyStr(amount),
      net: moneyStr(net),
      retention: moneyStr(retentionForCalc),
      method,
      chequeNo,
      chequeBank,
      chequeDate,
      currencyCode: currency,
      createdBy,
      status: "pending",
    })
    .returning()) as PvRow[];

  const payee = resolvePayees([created!], ownedBills, [])
    .get(created!.id) ?? { vendorId: null, vendorName: null };
  // Resolve the payee NAME too (the payee-name map above had no vendor rows).
  const vendorId = payee.vendorId;
  let vendorName: string | null = null;
  if (vendorId) {
    const [vendor] = await db.select(vendors, eq(vendors.id, vendorId));
    vendorName = vendor?.name ?? null;
  }
  return reply.code(201).send(await pvWire(created!, { vendorId, vendorName }));
}

// ---------------------------------------------------------------------------
// POST /pv/{id}/approve — the PV approval ladder (ap.jsx PV approve action)
// ---------------------------------------------------------------------------
// flows.html PV row: บัญชี approve every PV (tier-1) → ผจก.การเงิน above 500K
// (tier-2) → MD above 2M (tier-3). The caller must (a) carry the finance-approve
// perm — the base tier-1 capability every approver in the ladder holds (บัญชี /
// finmgr / dir) — AND (b) reach the approvalLevel the PV's gross demands. Reuses
// authz.ts (loadCaller/permAllowed); it invents no new policy. Fail-closed: an
// unattributable caller, or one missing the perm or the tier, is denied 403.
//
// B-094-3 (separation-of-duties): AFTER the perm + tier checks, a proven creator
// may not approve their own PV — if the caller's DICTIONARY user id equals the
// row's non-null created_by, the approval is denied 403. Fail-SAFE, not just
// fail-closed: a null created_by (legacy / unattributed PV) can't prove a
// self-approval, so it is NOT blocked — only a proven creator==approver is.
async function approvePvHandler(
  db: TenantDb,
  request: FastifyRequest,
  id: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [pv] = (await db.select(pvs, eq(pvs.id, id))) as PvRow[];
  if (!pv) {
    return reply.code(404).send({ code: "NOT_FOUND", message: `PV ${id} not found` });
  }

  const caller = await loadCaller(request);
  if (!caller) {
    return reply
      .code(403)
      .send({ code: "FORBIDDEN", message: "caller cannot be attributed" });
  }
  if (!permAllowed(caller.perms, FINANCE_MODULE, "approve")) {
    return reply.code(403).send({
      code: "FORBIDDEN",
      message: "PV approval requires the finance approve permission",
    });
  }

  // The stored GROSS fixes which tier must sign off (highest triggered tier).
  const gross = num(pv.amount);
  const needed =
    gross > PV_TIER_MD_THRESHOLD
      ? APPROVAL_LEVEL_MD
      : gross > PV_TIER_FINMGR_THRESHOLD
        ? APPROVAL_LEVEL_FINMGR
        : 0; // tier-1 (บัญชี): the finance-approve perm alone is enough.
  if (caller.approvalLevel < needed) {
    return reply.code(403).send({
      code: "FORBIDDEN",
      message: `PV approval of ${gross} requires approval level ${needed}`,
    });
  }

  // B-094-3 (SoD): a proven creator may not approve their own PV. Only block when
  // created_by is non-null AND equals the caller — a null creator (legacy /
  // unattributed) can't prove self-approval, so it is left to the ladder above.
  if (pv.createdBy != null && caller.userId === pv.createdBy) {
    return reply.code(403).send({
      code: "FORBIDDEN",
      message:
        "a payment voucher cannot be approved by its creator (separation of duties)",
    });
  }

  if (pv.status !== "pending") {
    return reply.code(409).send({
      code: "INVALID_STATE",
      message: "only a pending PV can be approved",
    });
  }

  // B-149 optimistic guard: fold the pending pre-state into the WHERE. A
  // concurrent approve that already flipped this PV updates 0 rows here → 409
  // (atomic backstop past the JS pre-check above).
  const [updated] = (await db
    .update(pvs, { status: "approved" }, and(eq(pvs.id, id), eq(pvs.status, "pending")))
    .returning()) as PvRow[];
  if (!updated) {
    return reply.code(409).send({
      code: "INVALID_STATE",
      message: "only a pending PV can be approved",
    });
  }

  // Re-resolve the payee for the echo (single-row read).
  const firstBilling = updated.billingIds[0] ?? null;
  let vendorId: string | null = null;
  let vendorName: string | null = null;
  if (firstBilling) {
    const [billing] = (await db.select(
      apBillings,
      eq(apBillings.id, firstBilling),
    )) as ApBillingRow[];
    vendorId = billing?.vendorId ?? null;
    if (vendorId) {
      const [vendor] = await db.select(vendors, eq(vendors.id, vendorId));
      vendorName = vendor?.name ?? null;
    }
  }
  return reply.code(200).send(await pvWire(updated, { vendorId, vendorName }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the AP (billing + PV) routes on the given (/api/v1-prefixed) scope. */
export function registerApRoute(app: FastifyInstance): void {
  const withTenantList =
    (run: (db: TenantDb) => Promise<Record<string, unknown>[]>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      return reply.code(200).send(listEnvelope(await run(db)));
    };

  app.get("/ap/billing", withTenantList(listBilling));
  app.get("/ap/pv", withTenantList(listPv));

  app.post("/ap/billing", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createBilling(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });

  app.post("/ap/pv", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createPv(db, request, (request.body ?? {}) as Record<string, unknown>, reply);
  });

  app.post("/pv/:id/approve", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const { id } = request.params as { id: string };
    return approvePvHandler(db, request, id, reply);
  });
}
