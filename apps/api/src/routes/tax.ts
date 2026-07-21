// Tax reports handlers — Phase-3 Finance round-A. DERIVED, read-only reports over
// ar_invoice (sales/output VAT) + ap_billing (purchase/input VAT + withholding
// tax), with vendor supplying the ภ.ง.ด. payee-type split. Handler-only: every
// figure is a REAL Σ over stored rows — money is SERVER authority, never a client
// value (these are GETs; there is no client figure to trust). A report over zero
// rows returns honest zeros (decision C10), never a fabricated figure. Registered
// in app.ts (registerTaxRoute).
//
// Contract (openapi.yaml §Finance): both are the opaque EntityOk — a SINGLE
// report object, NOT a list envelope — mirroring gl trial-balance.
//   GET /tax/reports/vat  → EntityOk — VAT (ภ.พ.30) output/input summary
//   GET /tax/reports/wht  → EntityOk — withholding-tax (ภ.ง.ด.) summary
//
// Tenant scope (fail closed): ar_invoice / ap_billing / vendor ALL carry a
// company_id column → the scoped TenantDb.select() door (a bare read cannot
// escape tenant scope, so no cross-tenant figure can enter a Σ). Without a
// resolved tenant, request.db is absent and both handlers answer a flat 401.
// These are reads only — no mutation — so no authz/audit gate (mirrors gl
// trial-balance).
//
// Server ships DATA, never a translated Thai UI word: the response carries raw
// money magnitudes + a stable currency_code, and the withholding groups are keyed
// by the stable form codes (pnd3 / pnd53), never a localized label.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { arInvoices, apBillings, vendors } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";

type ArInvoiceRow = typeof arInvoices.$inferSelect;
type ApBillingRow = typeof apBillings.$inferSelect;
type VendorRow = typeof vendors.$inferSelect;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flat 401 (fail closed) when no tenant was resolved onto the request. */
function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Coerce a drizzle numeric (string) / number / null to a finite number, else 0. */
function num(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** The optional ?period= filter ('YYYY-MM'), trimmed; null when absent/blank. */
function periodParam(request: FastifyRequest): string | null {
  const q = (request.query ?? {}) as Record<string, unknown>;
  const raw = typeof q.period === "string" ? q.period.trim() : "";
  return raw || null;
}

/**
 * The CE 'YYYY-MM' key of a stored timestamp, derived in UTC (money/time are
 * stored UTC — root CLAUDE.md "เวลาเก็บ UTC เสมอ"). A null/invalid date yields
 * null, so a period-filtered report excludes rows that carry no createdAt.
 */
function cePeriodKey(createdAt: Date | null): string | null {
  if (createdAt == null) return null;
  const dt = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(dt.getTime())) return null;
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Keep a row when no period filter is active, or when its createdAt falls inside
 * that CE month. A row with a null createdAt is EXCLUDED under an active filter
 * (its month is unknowable) — never silently counted.
 */
function inPeriod(createdAt: Date | null, period: string | null): boolean {
  if (period == null) return true;
  const key = cePeriodKey(createdAt);
  return key != null && key === period;
}

// NOTE: HEURISTIC (flagged, NOT authoritative — decision C10). The ภ.ง.ด.3 vs
// ภ.ง.ด.53 split is inferred purely from the vendor's tax_id LENGTH: a 13-digit
// tax_id is treated as a juristic company → ภ.ง.ด.53; any other (missing / short)
// tax_id is treated as an individual → ภ.ง.ด.3. The AUTHORITATIVE classification
// is the payee's registered legal type, which is not stored (a Thai personal ID
// is also 13 digits, so this test is an approximation, never a legal ruling).
// This is surfaced as a documented heuristic, never presented as the truth.
function isCompanyTaxId(taxId: string | null | undefined): boolean {
  if (!taxId) return false;
  const digits = taxId.replace(/\D/g, "");
  return digits.length === 13;
}

// ---------------------------------------------------------------------------
// GET /tax/reports/vat — VAT (ภ.พ.30) output/input summary
// ---------------------------------------------------------------------------
// Real sources: ar_invoice (output/sales VAT) + ap_billing (input/purchase VAT),
// both company-scoped and optionally period-filtered. Every figure is a REAL Σ
// over the stored 2-dp numeric columns:
//   output_vat  = Σ ar_invoice.vat      output_base = Σ ar_invoice.amount
//   input_vat   = Σ ap_billing.vat      input_base  = Σ ap_billing.amount
//   net_vat     = round2(output_vat − input_vat)   (>0 payable, <0 credit)
// Over zero rows every Σ is honestly 0.00 (C10) — never a fabricated figure.
async function vatReport(
  db: TenantDb,
  period: string | null,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [arRows, apRows] = await Promise.all([
    db.select(arInvoices) as Promise<ArInvoiceRow[]>,
    db.select(apBillings) as Promise<ApBillingRow[]>,
  ]);

  let outputVat = 0;
  let outputBase = 0;
  for (const r of arRows) {
    if (!inPeriod(r.createdAt, period)) continue;
    outputVat += num(r.vat);
    outputBase += num(r.amount);
  }

  let inputVat = 0;
  let inputBase = 0;
  for (const b of apRows) {
    if (!inPeriod(b.createdAt, period)) continue;
    inputVat += num(b.vat);
    inputBase += num(b.amount);
  }

  const output_vat = round2(outputVat);
  const input_vat = round2(inputVat);
  return reply.code(200).send({
    output_vat,
    output_base: round2(outputBase),
    input_vat,
    input_base: round2(inputBase),
    net_vat: round2(output_vat - input_vat),
    period: period ?? null,
    currency_code: "THB",
  });
}

// ---------------------------------------------------------------------------
// GET /tax/reports/wht — withholding-tax (ภ.ง.ด.) summary
// ---------------------------------------------------------------------------
// Real source: ap_billing.wht (nullable — a bill with no withholding leaves it
// null; only bills with wht > 0 count), company-scoped and optionally
// period-filtered. Each counted bill is joined to its vendor (both
// company-scoped) and bucketed by the tax_id-LENGTH heuristic (isCompanyTaxId —
// flagged above): a company → ภ.ง.ด.53 (pnd53), an individual → ภ.ง.ด.3 (pnd3).
// Per group: count (bills with wht > 0), wht = Σ ap_billing.wht, base = Σ
// ap_billing.amount. total_wht = Σ of both groups' wht. Over zero rows every
// figure is honestly 0 (C10) — never fabricated.
interface WhtGroup {
  count: number;
  wht: number;
  base: number;
}

async function whtReport(
  db: TenantDb,
  period: string | null,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [apRows, vendorRows] = await Promise.all([
    db.select(apBillings) as Promise<ApBillingRow[]>,
    db.select(vendors) as Promise<VendorRow[]>,
  ]);

  const vendorById = new Map(vendorRows.map((v) => [v.id, v]));
  const pnd3: WhtGroup = { count: 0, wht: 0, base: 0 };
  const pnd53: WhtGroup = { count: 0, wht: 0, base: 0 };

  for (const b of apRows) {
    if (!inPeriod(b.createdAt, period)) continue;
    const wht = num(b.wht);
    if (wht <= 0) continue; // only bills that actually withheld tax count.
    const vendor = b.vendorId ? vendorById.get(b.vendorId) : undefined;
    const group = isCompanyTaxId(vendor?.taxId) ? pnd53 : pnd3;
    group.count += 1;
    group.wht += wht;
    group.base += num(b.amount);
  }

  const wireGroup = (g: WhtGroup) => ({
    count: g.count,
    wht: round2(g.wht),
    base: round2(g.base),
  });
  return reply.code(200).send({
    pnd3: wireGroup(pnd3),
    pnd53: wireGroup(pnd53),
    total_wht: round2(pnd3.wht + pnd53.wht),
    period: period ?? null,
    currency_code: "THB",
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the tax-report routes on the given (/api/v1-prefixed) scope. Both are
 *  the opaque EntityOk (a single report object) — NOT wrapped in a list envelope,
 *  mirroring gl trial-balance. Fail-closed 401 without a resolved tenant. */
export function registerTaxRoute(app: FastifyInstance): void {
  app.get("/tax/reports/vat", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return vatReport(db, periodParam(request), reply);
  });

  app.get("/tax/reports/wht", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return whtReport(db, periodParam(request), reply);
  });
}
