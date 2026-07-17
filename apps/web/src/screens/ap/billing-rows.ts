/*
 * AP-billing row + form helpers for APBilling (P2-WEB-14) — pure, i18n-free,
 * ASCII-only logic ported from pototype/ap.jsx APBilling (L11-99) + BillingForm
 * (L101-154).
 *
 * The prototype held the billings in a local array (AP_BILL, L3-9) whose rows
 * carried denormalised display strings + hardcoded money. Juneflow §0 rule: that
 * mock seed is dropped — the list is the real server catalogue (GET /ap/billing,
 * apps/api/src/routes/ap.ts listBilling) of opaque Entity rows narrowed here. The
 * wire carries { id, no, vendor_id, vendor_name, po_id, wo_id, gr_id, ref,
 * invoice_no, amount, vat, wht, retention, due_date, aging, status, kind,
 * currency_code, doc_date, created_at }.
 *
 * HONEST GAPS the screen em-dashes (never fabricated):
 *   - `no` is an honest null on EVERY row (ap.ts: ap_billing has no doc-number
 *     column) -> the "AP number" cell em-dashes. The AP-2026-xxxx numbers the
 *     prototype shows are not persisted.
 *   - `aging` derives from `due_date`; the seed carries no due_date, so aging (and
 *     the due-date cell) read null there -> em-dash rather than an invented age.
 *   - `wht` / `retention` are nullable columns -> null renders an em-dash.
 * The KPI values (AP total, due-in-7, overdue, WHT total) + tab counts are REAL
 * derivations off the loaded rows (amount / wht / aging / status), so they are
 * honest even when the underlying columns are null (they simply read 0). Every
 * colour is an @juneflow/tokens var() or a prototype-verbatim STATUS dot hex
 * (B-037(a)); no Thai/baht leaks here (labels live in billing-strings.json).
 */

/** A billing as the list table consumes it (GET /ap/billing row, narrowed). */
export interface BillingRow {
  id: string;
  /** Honest null on the wire (ap_billing has no doc-number column) -> "" here. */
  no: string;
  vendorId: string;
  /** Resolved vendor name (server join); "" when absent. */
  vendorName: string;
  poId: string;
  woId: string;
  grId: string;
  /** Resolved po.no / wo.no / gr.no reference (server join); "" when absent. */
  ref: string;
  invoiceNo: string;
  /** Base amount (FULL baht, server system of record). */
  amount: number;
  vat: number;
  /** Withholding-tax amount, or null (no wht stored) -> em-dash. */
  wht: number | null;
  /** Retention hold-back amount, or null -> em-dash. */
  retention: number | null;
  /** Due date (nullable); "" when absent -> em-dash. */
  dueDate: string;
  /** Days past due (derived from due_date), or null when no due_date. */
  aging: number | null;
  /** Lifecycle status (free text: draft | pending | approved | paid | ...). */
  status: string;
  kind: string;
  currencyCode: string;
  /** Row creation timestamp (the only date on the wire). */
  createdAt: string;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Read a nullable numeric field: null stays null, else coerced (invalid -> null). */
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Read a nullable integer field (aging): null stays null. */
function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n == null ? null : Math.trunc(n);
}

/** Narrow an opaque /ap/billing Entity row to the BillingRow the table needs. */
export function toBillingRow(e: Record<string, unknown>): BillingRow {
  return {
    id: str(e.id),
    no: str(e.no),
    vendorId: str(e.vendor_id ?? e.vendorId),
    vendorName: str(e.vendor_name ?? e.vendorName),
    poId: str(e.po_id ?? e.poId),
    woId: str(e.wo_id ?? e.woId),
    grId: str(e.gr_id ?? e.grId),
    ref: str(e.ref),
    invoiceNo: str(e.invoice_no ?? e.invoiceNo),
    amount: num(e.amount),
    vat: num(e.vat),
    wht: numOrNull(e.wht),
    retention: numOrNull(e.retention),
    dueDate: str(e.due_date ?? e.dueDate),
    aging: intOrNull(e.aging),
    status: str(e.status),
    kind: str(e.kind),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/**
 * Group a FULL-baht amount with thousands separators ("920000" -> "920,000"),
 * matching the prototype's fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits
 * + comma only (no baht symbol / decimals); non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Millions with 2dp ("2350000" -> "2.35"), prototype fmtM (ap.jsx L37). */
export function formatMillions(n: number): string {
  return (n / 1e6).toFixed(2);
}

/** Thousands with 0dp ("70000" -> "70"), prototype (wht / 1e3).toFixed(0) (L42). */
export function formatThousands0(n: number): string {
  return (n / 1e3).toFixed(0);
}

/** The four KPI-card numbers (ap.jsx L33-42), all derived from the loaded rows. */
export interface BillingKpis {
  /** Row count (AP total sub "N docs"). */
  count: number;
  /** Sum of base amount, FULL baht (AP total value). */
  totalAmount: number;
  /** Count of rows due within 7 days (aging in [0, 7]). */
  due7Count: number;
  /** Sum of those rows' amount. */
  due7Amount: number;
  /** Count of overdue rows (aging < 0). */
  overCount: number;
  /** Sum of those rows' amount. */
  overAmount: number;
  /** Sum of the (nullable) wht column, FULL baht. */
  whtTotal: number;
}

/** Compute the KPI-card numbers from the loaded rows (ap.jsx L33-42). */
export function billingKpis(rows: readonly BillingRow[]): BillingKpis {
  const due7 = rows.filter((r) => r.aging != null && r.aging >= 0 && r.aging <= 7);
  const over = rows.filter((r) => r.aging != null && r.aging < 0);
  return {
    count: rows.length,
    totalAmount: rows.reduce((s, r) => s + r.amount, 0),
    due7Count: due7.length,
    due7Amount: due7.reduce((s, r) => s + r.amount, 0),
    overCount: over.length,
    overAmount: over.reduce((s, r) => s + r.amount, 0),
    whtTotal: rows.reduce((s, r) => s + (r.wht ?? 0), 0),
  };
}

/** The four TabBar counts (ap.jsx L50-55) — presentational, but real counts. */
export interface BillingTabCounts {
  all: number;
  due: number;
  over: number;
  paid: number;
}

/** Count rows per tab (ap.jsx L49-54). */
export function billingTabCounts(rows: readonly BillingRow[]): BillingTabCounts {
  return {
    all: rows.length,
    due: rows.filter((r) => r.aging != null && r.aging >= 0 && r.aging <= 7).length,
    over: rows.filter((r) => r.aging != null && r.aging < 0).length,
    paid: rows.filter((r) => r.status === "paid").length,
  };
}

/**
 * Aging cell descriptor (ap.jsx L89). kind drives the tone; `days` is the absolute
 * whole-day magnitude the label renders ("over" -> days late, "due" -> days left).
 * `null` aging (no due_date) -> null (the cell em-dashes).
 */
export type AgingKind = "over" | "soon" | "far";
export interface AgingCell {
  kind: AgingKind;
  days: number;
}

/** Classify aging into its tone bucket + absolute day magnitude (ap.jsx L89). */
export function agingCell(aging: number | null): AgingCell | null {
  if (aging == null) return null;
  if (aging < 0) return { kind: "over", days: -aging };
  if (aging < 7) return { kind: "soon", days: aging };
  return { kind: "far", days: aging };
}

/** Token colour for an aging bucket (ap.jsx L89 inline ternary). */
export function agingColor(kind: AgingKind): string {
  switch (kind) {
    case "over":
      return "var(--danger)";
    case "soon":
      return "var(--warn)";
    default:
      return "var(--text-3)";
  }
}

/**
 * Status-badge tone (ds.jsx STATUS map, read by <StatusBadge status={..}>). bg/fg are
 * @juneflow/tokens var() references; `dot` is the prototype-verbatim STATUS dot hex
 * (no matching token, B-037(a)). Unknown -> draft fallback (STATUS[status] || draft).
 */
export function statusTone(status: string): { bg: string; fg: string; dot: string } {
  switch (status) {
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "rejected":
      return { bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}

/** Which i18n label a wire status renders (resolved in the view — no Thai here). */
export function statusLabelKind(
  status: string,
): "draft" | "pending" | "approved" | "rejected" | "paid" {
  switch (status) {
    case "pending":
      return "pending";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "paid":
      return "paid";
    default:
      return "draft";
  }
}

/* --------------------------------------------------------------------------- */
/* Create-form (POST /ap/billing) helpers                                       */
/* --------------------------------------------------------------------------- */

/**
 * The BillingForm draft state. Only the fields that map to the widened
 * POST /ap/billing body are collected (ap.ts createBilling): vendor_id + amount
 * are required; gr_id / invoice_no / due_date / vat / wht are optional. The
 * prototype fields that have no create-body counterpart (AP number [no wire
 * column], billing date [server-owned], invoice date / type [no column], the
 * WHT-rate dropdown [server derives when wht omitted]) are NOT collected here —
 * jv-create-form precedent (drop rather than collect un-persistable data).
 */
export interface BillingDraft {
  vendorId: string;
  grId: string;
  invoiceNo: string;
  dueDate: string;
  /** Raw string inputs (parsed on submit). */
  amount: string;
  vat: string;
  wht: string;
}

/** A blank billing draft. */
export function emptyBillingDraft(): BillingDraft {
  return { vendorId: "", grId: "", invoiceNo: "", dueDate: "", amount: "", vat: "", wht: "" };
}

/** Parse a raw money input to a non-negative finite number (blank/invalid -> 0). */
export function parseMoney(raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** The submit is enabled only when a vendor is chosen AND amount > 0 (ap.ts guard). */
export function billingSubmittable(d: BillingDraft): boolean {
  return d.vendorId.trim() !== "" && parseMoney(d.amount) > 0;
}

/**
 * Compose the opaque POST /ap/billing body from the draft. Only present optional
 * fields are sent; the server derives WHT via the tax-engine when `wht` is omitted,
 * defaults vat to 0, and owns status/currency. Never fabricates a doc number.
 */
export function buildBillingBody(d: BillingDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    vendor_id: d.vendorId.trim(),
    amount: parseMoney(d.amount),
  };
  if (d.grId.trim() !== "") body.gr_id = d.grId.trim();
  if (d.invoiceNo.trim() !== "") body.invoice_no = d.invoiceNo.trim();
  if (d.dueDate.trim() !== "") body.due_date = d.dueDate.trim();
  if (d.vat.trim() !== "") body.vat = parseMoney(d.vat);
  if (d.wht.trim() !== "") body.wht = parseMoney(d.wht);
  return body;
}
