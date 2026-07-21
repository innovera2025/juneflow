/*
 * e-Tax Invoice row helpers (tax.etax) — pure, i18n-free, ASCII-only logic ported from
 * pototype/etax.jsx TaxETax (L18-128). Mirrors the gl.inbox precedent (gl-inbox-rows.ts):
 * opaque-row narrowing + derived status + honest formatters, no React / no i18n / no Thai.
 *
 * The prototype held the register in local state (ETAX_SEED, L5-12) with a rich compliance
 * "theater". Section-0 rule 3 drops that mock seed — the register is the real server data:
 *   - GET /etax/status  -> the HONEST per-status aggregate (apps/api/src/routes/etax.ts
 *                          getEtaxStatus): one { etax_status, count } row per enum value
 *                          (queued | sent | rejected | void). Drives the KPI counts.
 *   - GET /ar/invoices  -> the invoice register rows (apps/api/src/routes/ar.ts listInvoices):
 *                          { id, no, customer_id, amount, vat, currency_code, etax_status,
 *                          doc_date, created_at, ... }. amount is the SERVER-authoritative net
 *                          (Sigma qty x price), vat is the 7% output VAT; total = amount + vat.
 *   - GET /customers    -> resolves customer_id -> { name, tax_id } (both REAL columns).
 *
 * The real etax_status enum maps 1:1 onto the prototype's four visual states:
 *   queued   <- prototype "pending" -> StatusBadge "pending"
 *   sent     <- prototype "sent"    -> StatusBadge "approved"
 *   rejected <- prototype "error"   -> StatusBadge "rejected"
 *   void     <- prototype "void"    -> StatusBadge "draft"
 *
 * HONEST-EMPTY THEATER (Wei B-124) — the crux of this port: the prototype fabricates a whole
 * e-Tax compliance theater (RD acknowledgement / receipt numbers, CA certificate serial/SHA-256/
 * expiry, XML digital-signature timeline, per-channel delivery receipts). NONE of that has a
 * real source, so the aggregate + register carry ONLY the real per-invoice etax_status. Every
 * theater artefact is em-dashed / omitted (see HONEST_EMPTY_THEATER below). The Send action is
 * the only real mutation (POST /etax/send flips queued/rejected -> sent, FakeTaxEngine).
 */

/** The real ar_invoice.etax_status enum (etax.ts etaxStatus.enumValues). */
export type EtaxStatus = "queued" | "sent" | "rejected" | "void";

/** The four enum values in the honest-aggregate order (queued | sent | rejected | void). */
export const ETAX_STATUSES: readonly EtaxStatus[] = ["queued", "sent", "rejected", "void"];

/** StatusBadge kinds (ds.jsx STATUS map) the four etax states resolve to. */
export type BadgeKind = "approved" | "pending" | "rejected" | "draft";

/**
 * B-124 HONEST-EMPTY THEATER: the prototype's e-Tax compliance theater has NO real data source,
 * so none of these is ever rendered as a value — each is em-dashed or omitted. Kept as an
 * explicit, unit-tested list so the honest-empty ruling is guarded against a future "let's just
 * show it" regression. (Reported: the entire cert/ack/XML/delivery surface is honest-empty.)
 */
export const HONEST_EMPTY_THEATER = [
  "rdAcknowledgement", // RD receipt / acknowledgement numbers (the "accepted" ack forms)
  "caCertificate", // CA serial / SHA-256 hash / certificate expiry
  "xmlSigningTimestamp", // the digital-signature step timeline
  "deliveryReceipt", // per-channel "delivered to customer" confirmation
] as const;

export type TheaterField = (typeof HONEST_EMPTY_THEATER)[number];

/** A GET /etax/status aggregate row, narrowed. */
export interface EtaxStatusCount {
  status: EtaxStatus;
  count: number;
}

/** Per-status totals (all four buckets present, 0-filled — the honest complete domain). */
export type EtaxCounts = Record<EtaxStatus, number>;

/** An invoice register row (GET /ar/invoices), narrowed for the table + send set. */
export interface EtaxInvoiceRow {
  id: string;
  no: string;
  customerId: string;
  /** Net amount (VAT-exclusive, server-authoritative Sigma qty x price). */
  amount: number;
  /** Output VAT (7% of net, server-computed). */
  vat: number;
  /** Gross total = amount + vat (VAT-inclusive; the prototype's "total incl VAT"). */
  total: number;
  currencyCode: string;
  etaxStatus: EtaxStatus;
  /** Row timestamp (stored UTC) — the only real date on the wire. */
  createdAt: string;
}

/** Resolved customer identity (GET /customers) — both fields are REAL columns. */
export interface EtaxCustomer {
  name: string;
  taxId: string;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row, else 0. */
function numOr0(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Round to the currency minor unit (2 dp), float-noise safe. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Narrow an unknown to a known EtaxStatus; an unexpected value falls to "queued" (DB-constrained, unreachable). */
export function asEtaxStatus(v: unknown): EtaxStatus {
  return ETAX_STATUSES.includes(v as EtaxStatus) ? (v as EtaxStatus) : "queued";
}

/** Narrow an opaque /etax/status row to { status, count }. */
export function toStatusCount(e: Record<string, unknown>): EtaxStatusCount {
  return {
    status: asEtaxStatus(e.etax_status ?? e.etaxStatus),
    count: Math.max(0, Math.round(numOr0(e.count))),
  };
}

/** Fold the aggregate rows to per-status totals (all four buckets 0-initialised). */
export function statusCountMap(rows: readonly EtaxStatusCount[]): EtaxCounts {
  const out: EtaxCounts = { queued: 0, sent: 0, rejected: 0, void: 0 };
  for (const r of rows) out[r.status] += r.count;
  return out;
}

/** Total invoices across all statuses. */
export function totalCount(counts: EtaxCounts): number {
  return counts.queued + counts.sent + counts.rejected + counts.void;
}

/** Narrow an opaque /ar/invoices Entity row to the EtaxInvoiceRow the table needs. */
export function toEtaxInvoiceRow(e: Record<string, unknown>): EtaxInvoiceRow {
  const amount = numOr0(e.amount);
  const vat = numOr0(e.vat);
  return {
    id: str(e.id),
    no: str(e.no),
    customerId: str(e.customer_id ?? e.customerId),
    amount,
    vat,
    total: round2(amount + vat),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    etaxStatus: asEtaxStatus(e.etax_status ?? e.etaxStatus),
    createdAt: str(e.created_at ?? e.createdAt ?? e.doc_date ?? e.docDate),
  };
}

/** Build a customer_id -> { name, taxId } lookup from GET /customers rows. */
export function toCustomerMap(rows: readonly Record<string, unknown>[]): Map<string, EtaxCustomer> {
  const m = new Map<string, EtaxCustomer>();
  for (const r of rows) {
    const id = str(r.id);
    if (id) m.set(id, { name: str(r.name), taxId: str(r.tax_id ?? r.taxId) });
  }
  return m;
}

/** The StatusBadge kind for an etax state (ds.jsx STATUS: sent->approved, queued->pending, etc.). */
export function statusBadgeKind(status: EtaxStatus): BadgeKind {
  switch (status) {
    case "sent":
      return "approved";
    case "queued":
      return "pending";
    case "rejected":
      return "rejected";
    case "void":
      return "draft";
  }
}

/**
 * Invoice ids whose e-Tax is queued — the batch-send set (prototype sendBatch flips the whole
 * `pending` batch). POST /etax/send additionally accepts a single `rejected` id (row retry).
 */
export function queuedInvoiceIds(rows: readonly EtaxInvoiceRow[]): string[] {
  return rows.filter((r) => r.etaxStatus === "queued").map((r) => r.id);
}

/** Sum of the gross totals (amount + vat) across the loaded invoices (the KPI amount). */
export function sumGrossTotal(rows: readonly EtaxInvoiceRow[]): number {
  return round2(rows.reduce((s, r) => s + r.total, 0));
}

/**
 * Group a money amount with thousands separators ("1000000" -> "1,000,000"), matching the
 * prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits + comma only (no
 * baht symbol / decimals — the baht glyph lives only in i18n-full.json, never in this .ts);
 * non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Format a total as millions with one decimal ("3850000" -> "3.9"); non-finite -> "0.0". */
export function formatMillions(n: number): string {
  return (Number.isFinite(n) ? n / 1e6 : 0).toFixed(1);
}

/**
 * Format the row's created_at as an ISO date (YYYY-MM-DD, UTC — deterministic, ASCII). The
 * prototype showed a Thai buddhist date from a mock field; the wire only exposes created_at
 * (the row-insert timestamp, stored UTC), so the date cell shows that. "" -> the cell em-dashes.
 */
export function formatDate(createdAt: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
