/*
 * AR Receive-Voucher (RV) row + form helpers (ar.rv) — pure, i18n-free, ASCII-only
 * logic ported from pototype/ar.jsx ARReceiveVoucher (L230-299) + RVCreateForm
 * (L300-336). Route ar.rv (docs/extract/NAV-ROUTES.md L76, component
 * ARReceiveVoucher, section "acct").
 *
 * The prototype held the RVs in a hardcoded array (ar.jsx L270-275, Thai payer +
 * method labels + mock money). Juneflow §0 rule 3: that mock seed is dropped — the
 * list is the real server catalogue (GET /ar/rv, apps/api/src/routes/ar.ts listRv)
 * of opaque Entity rows narrowed here. The rv wire (ar.ts rvWire) is:
 *   { id, invoice_id, no, amount, currency_code, method, receipt_date, bank,
 *     status, source, doc_date, created_at }.
 *
 * HONEST GAPS the screen em-dashes (never fabricated) — see the .tsx REAL-vs-dash
 * banner:
 *   - `no` is nullable (ar.ts createArRv never sets a receipt number) -> "" here ->
 *     the "RV number" cell em-dashes (real only for a row that carries one).
 *   - the payer column has NO wire field: the rv row carries only an
 *     invoice_id FK, not a resolved customer/payer name -> the payer cell em-dashes.
 *   - the settled-AR column: the wire carries only the opaque
 *     invoice_id UUID, NOT the human invoice number the prototype shows -> the cell
 *     em-dashes (the ap-pv "ref" precedent: a bare UUID FK is not a meaningful doc
 *     number). A retention-refund rv carries a null invoice_id (source
 *     'retention-refund', migration 0035) -> also em-dashed.
 *   - `method` is nullable -> "" narrows to no badge (em-dash cell).
 * EMPTY BY DESIGN (C10, decision-parallel to gl-inbox's honest-empty posted tab):
 * no rv rows are seeded (packages/db/src/seed/index.ts L1531 "no seeded rv (AR
 * Phase-5-deferred)"), so GET /ar/rv is legitimately empty on the current data —
 * the list renders empty and the method KPIs count a legitimate 0. This is correct,
 * NOT a bug. A real rv is minted through the create form (POST /ar/rv) against a
 * seeded unpaid invoice, after which it appears here honestly.
 *
 * The KPI counts (transfer / cheque / retention-refund) are REAL derivations off
 * the loaded rows; "RV this month" needs a month partition the label implies but
 * the screen cannot honestly derive (the wire carries both receipt_date and
 * created_at — an ambiguous "month") -> that KPI em-dashes (ap-pv/gl-jv precedent).
 * The prototype's mock KPI money sub-captions (unkeyed fabricated M-baht figures)
 * are omitted (po-list precedent).
 *
 * Create form (RVCreateForm): a SINGLE-invoice receipt (B-121 frozen contract POST
 * /ar/rv { invoice_id, amount, method? }). The picker options are the tenant's
 * unpaid invoices (GET /ar/invoices, each row carrying the server-computed
 * `outstanding`); `amount` is the real cash RECEIVED (a legitimate client value).
 * The server validates amount <= outstanding and REJECTS an over-payment with a 409
 * (never clamped) — the form shows the outstanding as a preview + flags an
 * over-allocation informationally, but never clamps or blocks: the server is the
 * authority (the 409 is surfaced honestly by the .tsx). No client-side JV is posted
 * (the rv rides the GL posting inbox, source 'rv:').
 *
 * Every colour the .tsx paints from these rows is an @juneflow/tokens var(); the
 * StatusBadge dot hexes are prototype-verbatim (ds.jsx STATUS, B-037(a)). No
 * Thai/baht leaks here (B-073).
 */

/** A receive-voucher as the list table consumes it (GET /ar/rv row, narrowed). */
export interface RvRow {
  id: string;
  /** Receipt number where present (nullable on the wire) -> "" em-dashes. */
  no: string;
  /** Settled-invoice FK (opaque UUID); "" for a retention-refund rv. */
  invoiceId: string;
  /** Cash received, FULL baht (server system of record). */
  amount: number;
  currencyCode: string;
  /** Settlement method enum (cash | transfer | cheque); "" when null. */
  method: string;
  /** Calendar date received (nullable on the wire) -> "" falls back to createdAt. */
  receiptDate: string;
  bank: string;
  /** Lifecycle status: 'open' (recorded, awaiting GL post) | 'posted'. */
  status: string;
  /** Discriminator: 'invoice' (invoice receipt) | 'retention-refund'. */
  source: string;
  /** Row creation timestamp (the reliable wire date). */
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

/** Narrow an opaque /ar/rv Entity row to the RvRow the table needs. */
export function toRvRow(e: Record<string, unknown>): RvRow {
  return {
    id: str(e.id),
    no: str(e.no),
    invoiceId: str(e.invoice_id ?? e.invoiceId),
    amount: num(e.amount),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    method: str(e.method),
    receiptDate: str(e.receipt_date ?? e.receiptDate),
    bank: str(e.bank),
    status: str(e.status),
    source: str(e.source),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/**
 * Group a FULL-baht amount with thousands separators ("728000" -> "728,000"),
 * matching the prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII
 * digits + comma only (no baht symbol / decimals); non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format the row's date as an ISO date (YYYY-MM-DD, UTC — deterministic, ASCII).
 * The prototype showed a Thai buddhist date; the wire exposes receipt_date (the
 * calendar date received) with created_at (the row-insert timestamp) as the honest
 * fallback. "" for a missing/invalid value (the cell then em-dashes).
 */
export function formatDate(receiptDate: string, createdAt: string): string {
  const raw = receiptDate || createdAt;
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * The settlement-method enum -> a display discriminant. The prototype colours the
 * badge by method (ar.jsx L282-286: transfer/cheque/cash). "" for an unset/unknown
 * method (the cell em-dashes).
 */
export type MethodKey = "cash" | "transfer" | "cheque" | "";

/** Narrow the wire method to a known key (or "" when null/unexpected). */
export function methodKey(method: string): MethodKey {
  switch (method) {
    case "cash":
    case "transfer":
    case "cheque":
      return method;
    default:
      return "";
  }
}

/**
 * Method-badge tone (ar.jsx L282-286): transfer -> info, cheque -> warn, cash ->
 * ok. bg/fg are @juneflow/tokens var() references.
 */
export function methodTone(key: MethodKey): { bg: string; fg: string } {
  switch (key) {
    case "transfer":
      return { bg: "var(--info-soft)", fg: "var(--info)" };
    case "cheque":
      return { bg: "var(--warn-soft)", fg: "var(--warn)" };
    default:
      return { bg: "var(--ok-soft)", fg: "var(--ok)" };
  }
}

/** A create-form method option: the enum key + its picker icon (ds.jsx icons). */
export interface MethodOption {
  key: Exclude<MethodKey, "">;
  icon: string;
}

/**
 * The three RV settlement methods in prototype order (ar.jsx list badges
 * transfer/cheque/cash; the create form's method picker). Labels live in the
 * DICT (fin.methodTransfer / fin.methodCheque / fin.methodCash) — resolved in the
 * .tsx, never here (B-073).
 */
export const METHOD_OPTIONS: readonly MethodOption[] = [
  { key: "transfer", icon: "sync" },
  { key: "cheque", icon: "paperclip" },
  { key: "cash", icon: "cash" },
];

/**
 * A retention-refund rv settles a held-back retention, not an invoice — it carries
 * no invoice_id (migration 0035, source 'retention-refund'). The null invoice_id is
 * the defining characteristic (ar.ts sumReceivedByInvoice skips it).
 */
export function isRetentionRefund(row: RvRow): boolean {
  return row.invoiceId === "";
}

/** The KPI counts the wire can honestly derive (ar.jsx L250-253). */
export interface RvKpis {
  /** RVs received by bank transfer (method 'transfer'). */
  transferCount: number;
  /** RVs received by cheque (method 'cheque'). */
  chequeCount: number;
  /** Retention-refund RVs (null invoice_id). */
  retentionCount: number;
}

/** Compute the derivable KPI counts from the loaded rows (ar.jsx L250-253). */
export function rvKpis(rows: readonly RvRow[]): RvKpis {
  return {
    transferCount: rows.filter((r) => methodKey(r.method) === "transfer").length,
    chequeCount: rows.filter((r) => methodKey(r.method) === "cheque").length,
    retentionCount: rows.filter(isRetentionRefund).length,
  };
}

/** Which lifecycle a wire status renders (resolved in the view — no Thai here). */
export type StatusKind = "posted" | "open" | "other";

/** Narrow the wire status to its lifecycle discriminant (rv: 'open' | 'posted'). */
export function statusKind(status: string): StatusKind {
  switch (status) {
    case "posted":
      return "posted";
    case "open":
      return "open";
    default:
      return "other";
  }
}

/**
 * StatusBadge tone (ds.jsx STATUS map, dot hexes prototype-verbatim, B-037(a)). The
 * rv lifecycle is 'open' (recorded, awaiting GL post -> warn, the same treatment the
 * gl posting inbox gives these very rows) and 'posted' (GL-posted -> ok).
 */
export function statusTone(status: string): { bg: string; fg: string; dot: string } {
  switch (statusKind(status)) {
    case "posted":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "open":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}

/* --------------------------------------------------------------------------- */
/* Create-form (POST /ar/rv) helpers                                            */
/* --------------------------------------------------------------------------- */

/** Round to 2dp the way the server does (avoids float dust in the preview). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * An unpaid AR invoice as the create-form picker consumes it (GET /ar/invoices
 * row, narrowed). The server list adds a computed `outstanding` = round2(amount +
 * vat - Σ prior rv.amount) per row (ar.ts listInvoices).
 */
export interface InvoiceOption {
  id: string;
  /** The human invoice number (ar_invoice.no, NOT NULL). */
  no: string;
  amount: number;
  vat: number;
  /** Server-computed remaining balance (amount + vat - received). */
  outstanding: number;
  status: string;
  currencyCode: string;
}

/** Narrow an opaque /ar/invoices Entity row to the picker option. */
export function toInvoiceOption(e: Record<string, unknown>): InvoiceOption {
  return {
    id: str(e.id),
    no: str(e.no),
    amount: num(e.amount),
    vat: num(e.vat),
    outstanding: num(e.outstanding),
    status: str(e.status),
    currencyCode: str(e.currency_code ?? e.currencyCode),
  };
}

/**
 * The pickable invoices: not fully paid and still carrying a positive outstanding
 * balance (a fully-received invoice cannot take another receipt — the server would
 * 409 it). Honest — real invoice rows only.
 */
export function unpaidInvoices(rows: readonly InvoiceOption[]): InvoiceOption[] {
  return rows.filter((r) => r.status !== "paid" && r.outstanding > 0);
}

/**
 * The invoice outstanding = round2(amount + vat - received) — the SERVER money
 * authority formula (ar.ts createArRv), reproduced here for transparency + the
 * over-allocation preview (the list wire already carries this as `outstanding`; the
 * form uses that value). Negative received clamps to 0.
 */
export function computeOutstanding(
  invoiceAmount: number,
  invoiceVat: number,
  received: number,
): number {
  const prior = received > 0 ? received : 0;
  return round2(invoiceAmount + invoiceVat - prior);
}

/**
 * Over-allocation detection (B-121 Wei C-176): a receipt greater than the invoice
 * outstanding over-pays. The SERVER REJECTS this with a 409 (never clamped); the
 * form uses this only to flag the preview informationally — it never clamps or
 * blocks the submit (the server is the authority).
 */
export function isOverAllocated(amount: number, outstanding: number): boolean {
  return amount > outstanding;
}

/** The RVCreateForm draft state — the fields the POST /ar/rv body needs. */
export interface RvDraft {
  /** The single selected AR invoice id (invoice_id). */
  invoiceId: string;
  /** The real cash amount received (a legitimate client value, NOT computed). */
  amount: number;
  /** Chosen settlement method ("" until picked). */
  method: MethodKey;
}

/** The submit is enabled once an invoice is chosen and a positive amount entered. */
export function rvSubmittable(d: RvDraft): boolean {
  return d.invoiceId.trim() !== "" && d.amount > 0;
}

/**
 * Compose the opaque POST /ar/rv body from the draft: the SINGLE invoice id + the
 * real received amount (never a clamped/fabricated total); method is sent only when
 * picked. The server owns status ('open'), currency (inherited from the invoice),
 * source ('invoice'), and the outstanding/over-allocation validation.
 */
export function buildRvBody(d: RvDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    invoice_id: d.invoiceId.trim(),
    amount: d.amount,
  };
  if (d.method !== "") body.method = d.method;
  return body;
}
