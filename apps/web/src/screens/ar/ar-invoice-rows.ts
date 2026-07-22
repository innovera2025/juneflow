/*
 * AR Invoice / Billing row helpers (ar.invoice) — pure, i18n-free, ASCII-only logic
 * ported from pototype/ar.jsx ARInvoice (L16-108) + ARInvoiceForm (L110-147).
 *
 * The prototype held the list in a local array (AR_INV, L7-14) whose rows carried
 * denormalised display strings + hardcoded money + mock flags (over/closed). §0
 * rule 3: that mock seed is dropped — the list is the real server catalogue
 * (GET /ar/invoices, use-ar-invoice.ts -> apps/api/src/routes/ar.ts listInvoices).
 * The wire row (opaque Entity, snake_case) is:
 *   { id, no, customer_id, project_id, amount, vat, currency_code, credit_term,
 *     due_date, status, etax_status, doc_date, created_at, outstanding }.
 *
 * MONEY AUTHORITY (B-107a · Wei C-176): amount = Σ(line.qty × price) and vat = 7%
 * are computed SERVER-side; the create path here only sends the line items (never a
 * client total), and the preview math (lineTotal / previewVat / previewTotal) is a
 * UX-only estimate — the authoritative figures come back on the create response.
 *
 * HONEST DATA GAPS (never fabricated) — see the ar-invoice.tsx header for the cells:
 *   - customer NAME resolves from customer_id via GET /customers; the prototype's
 *     per-row `unit` (B-12) has NO wire column -> the customer sub-line em-dashes.
 *   - the prototype's `phase` (nguad) column has NO wire column -> that cell em-dashes.
 *   - `due_date` is a real date (nullable); the days-remaining sub-line is derived
 *     from it and only shown for OPEN (unpaid) invoices — a PAID invoice is settled,
 *     so it shows no overdue/days-left warning (matching the prototype's closed row).
 *   - the wire status is `open` | `paid` (ar.ts: create -> open, RV settle -> paid).
 *     The prototype colour-coded its mock rows as "approved" (a workflow state the AR
 *     invoice does not have) — statusView renders the REAL state honestly instead.
 *
 * Every colour the .tsx paints from these rows is an @juneflow/tokens var(); no
 * Thai/baht leaks here (B-073).
 */

/** Milliseconds in a day — the due-date day arithmetic (mirror ar.ts MS_PER_DAY). */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Thai output-VAT rate as a fraction (7%) — the create preview only (server authority). */
export const VAT_RATE = 0.07;

/** An AR invoice as the table consumes it (GET /ar/invoices row, narrowed). */
export interface InvoiceRow {
  id: string;
  /** Real invoice number (ar_invoice.no). */
  no: string;
  /** Customer id — resolved to a name via GET /customers in the view. */
  customerId: string;
  /** Owning project id (nullable on the wire; "" when absent). */
  projectId: string;
  /** Net amount = Σ(line qty × price), SERVER-authoritative. */
  amount: number;
  /** Output VAT (7%), SERVER-authoritative; 0 when none. */
  vat: number;
  /** Currency of amount/vat ("" when absent). */
  currencyCode: string;
  /** Payment credit term in days (null when unset). */
  creditTerm: number | null;
  /** Due date as 'YYYY-MM-DD' ("" when null — a draft with no term). */
  dueDate: string;
  /** Lifecycle status — "open" | "paid" (ar_invoice.status). */
  status: string;
  /** e-Tax queue state (queued/void/...); real wire field. */
  etaxStatus: string;
  /** Outstanding receivable = round2(amount + vat − Σ rv) — the real AR balance. */
  outstanding: number;
  /** Row creation timestamp (stored UTC). */
  createdAt: string;
}

/** A customer option (id -> display name + tax id) from GET /customers. */
export interface CustomerRef {
  id: string;
  name: string;
  /** Customer tax id ("" when absent) — shown under the create-form picker. */
  taxId: string;
}

/** A create-form line draft (raw input strings, parsed by the preview math). */
export interface LineDraft {
  description: string;
  qty: string;
  price: string;
}

/** The five prototype tabs (ar.jsx L55-60). */
export type InvoiceTab = "all" | "open" | "due" | "over" | "paid";

/** Derived status view — the wire only ever yields open/paid (C10). */
export type InvoiceStatusView = "open" | "paid";

/* --------------------------------------------------------------------------- */
/* Opaque-row readers                                                          */
/* --------------------------------------------------------------------------- */

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

/** Read a finite number, else null (preserves the honest null gap, e.g. credit_term). */
function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Round to 2 dp (currency minor unit) — mirrors ar.ts round2. */
export function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Narrow an opaque /ar/invoices Entity row to the InvoiceRow the table needs. */
export function toInvoiceRow(e: Record<string, unknown>): InvoiceRow {
  const amount = num(e.amount);
  const vat = num(e.vat);
  const hasOutstanding =
    typeof e.outstanding === "number" || typeof e.outstanding === "string";
  return {
    id: str(e.id),
    no: str(e.no),
    customerId: str(e.customer_id ?? e.customerId),
    projectId: str(e.project_id ?? e.projectId),
    amount,
    vat,
    currencyCode: str(e.currency_code ?? e.currencyCode),
    creditTerm: numOrNull(e.credit_term ?? e.creditTerm),
    dueDate: str(e.due_date ?? e.dueDate),
    status: str(e.status),
    etaxStatus: str(e.etax_status ?? e.etaxStatus),
    // The list serves `outstanding`; a bare create response omits it -> amount+vat.
    outstanding: hasOutstanding ? round2(num(e.outstanding)) : round2(amount + vat),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/** Narrow an opaque /customers Entity row to a CustomerRef (id -> name + tax id). */
export function toCustomerRef(e: Record<string, unknown>): CustomerRef {
  return {
    id: str(e.id),
    name: str(e.name),
    taxId: str(e.tax_id ?? e.taxId),
  };
}

/** Build an id -> CustomerRef map (list name-resolution + create-form picker). */
export function customerById(
  customers: readonly CustomerRef[] | undefined,
): Map<string, CustomerRef> {
  const map = new Map<string, CustomerRef>();
  for (const c of customers ?? []) if (c.id) map.set(c.id, c);
  return map;
}

/* --------------------------------------------------------------------------- */
/* Status                                                                      */
/* --------------------------------------------------------------------------- */

/** Derived status view — "paid" iff settled, else "open" (C10, honest). */
export function statusView(status: string): InvoiceStatusView {
  return status === "paid" ? "paid" : "open";
}

/* --------------------------------------------------------------------------- */
/* Due-date / aging arithmetic (deterministic — `nowMs` is injected)           */
/* --------------------------------------------------------------------------- */

/** UTC midnight (epoch ms) of the day containing `nowMs`. */
function startOfUtcDay(nowMs: number): number {
  return Math.floor(nowMs / MS_PER_DAY) * MS_PER_DAY;
}

/**
 * Whole calendar days from today (UTC) until the due date: > 0 future, 0 today,
 * < 0 past due. null when there is no due date (a draft with no credit term).
 */
export function daysUntil(dueDate: string, nowMs: number): number | null {
  if (!dueDate) return null;
  const dueMs = Date.parse(`${dueDate}T00:00:00Z`);
  if (!Number.isFinite(dueMs)) return null;
  return Math.round((dueMs - startOfUtcDay(nowMs)) / MS_PER_DAY);
}

/** True for an unsettled (open) invoice. */
export function isOpen(row: InvoiceRow): boolean {
  return statusView(row.status) === "open";
}

/** True for a settled (paid) invoice. */
export function isPaid(row: InvoiceRow): boolean {
  return statusView(row.status) === "paid";
}

/** Overdue = open AND past its due date. */
export function isOverdue(row: InvoiceRow, nowMs: number): boolean {
  if (!isOpen(row)) return false;
  const d = daysUntil(row.dueDate, nowMs);
  return d != null && d < 0;
}

/** Due soon = open AND due within the next 7 days (1..7 inclusive). */
export function isDueSoon(row: InvoiceRow, nowMs: number): boolean {
  if (!isOpen(row)) return false;
  const d = daysUntil(row.dueDate, nowMs);
  return d != null && d > 0 && d <= 7;
}

/* --------------------------------------------------------------------------- */
/* Tab partition (ar.jsx TabBar L55-60) — honest, real-row counts               */
/* --------------------------------------------------------------------------- */

/**
 * Filter the invoices for a tab:
 *   all  -> every invoice
 *   open -> unsettled (status != paid)
 *   due  -> open AND due within 7 days
 *   over -> open AND past due
 *   paid -> settled (status == paid)
 */
export function filterByTab(
  rows: readonly InvoiceRow[],
  tab: InvoiceTab,
  nowMs: number,
): InvoiceRow[] {
  switch (tab) {
    case "all":
      return [...rows];
    case "open":
      return rows.filter(isOpen);
    case "due":
      return rows.filter((r) => isDueSoon(r, nowMs));
    case "over":
      return rows.filter((r) => isOverdue(r, nowMs));
    case "paid":
      return rows.filter(isPaid);
  }
}

/** C10 tab badge count — the real length of the tab's filtered set. */
export function tabCount(
  rows: readonly InvoiceRow[],
  tab: InvoiceTab,
  nowMs: number,
): number {
  return filterByTab(rows, tab, nowMs).length;
}

/* --------------------------------------------------------------------------- */
/* KPI aggregates (ar.jsx L36-49) — all REAL (derived from the wire)            */
/* --------------------------------------------------------------------------- */

/** The open (unsettled) invoices. */
export function openInvoices(rows: readonly InvoiceRow[]): InvoiceRow[] {
  return rows.filter(isOpen);
}

/** The overdue invoices (open + past due). */
export function overdueInvoices(rows: readonly InvoiceRow[], nowMs: number): InvoiceRow[] {
  return rows.filter((r) => isOverdue(r, nowMs));
}

/** The due-soon invoices (open + due within 7 days). */
export function dueSoonInvoices(rows: readonly InvoiceRow[], nowMs: number): InvoiceRow[] {
  return rows.filter((r) => isDueSoon(r, nowMs));
}

/** Distinct customer count across ALL invoices (KPI total-AR sub, prototype custCount). */
export function distinctCustomerCount(rows: readonly InvoiceRow[]): number {
  const seen = new Set<string>();
  for (const r of rows) if (r.customerId) seen.add(r.customerId);
  return seen.size;
}

/** Σ `amount` (net, pre-VAT) over the given rows — the KPI money-at-risk sub. */
export function sumAmount(rows: readonly InvoiceRow[]): number {
  return round2(rows.reduce((s, r) => s + r.amount, 0));
}

/**
 * Σ outstanding receivable over the given rows — the honest "total AR" figure. The
 * prototype summed amount+vat (its mock had no receipts); `outstanding` is the true
 * receivable and degrades to amount+vat when nothing has been received.
 */
export function sumOutstanding(rows: readonly InvoiceRow[]): number {
  return round2(rows.reduce((s, r) => s + r.outstanding, 0));
}

/* --------------------------------------------------------------------------- */
/* Money formatting                                                            */
/* --------------------------------------------------------------------------- */

/**
 * Group a money amount with thousands separators ("728000" -> "728,000"), matching
 * the prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits +
 * comma only (no baht / decimals); non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** KPI "value in millions" ((n / 1e6).toFixed(2)) — matches the prototype fmtM. */
export function millionsValue(n: number): string {
  return (n / 1e6).toFixed(2);
}

/* --------------------------------------------------------------------------- */
/* Create-form line preview math (UX only — server is money authority)          */
/* --------------------------------------------------------------------------- */

/** Parse a grouped/decimal money input ("2,150" -> 2150) to a finite >= 0 number. */
export function parseAmount(raw: string): number {
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** A single line's total = round2(qty × price); 0 for a non-positive/invalid line. */
export function lineTotal(qty: number, price: number): number {
  const t = qty * price;
  return Number.isFinite(t) && t > 0 ? round2(t) : 0;
}

/** Σ over the lines of qty × price — the preview net subtotal (mirrors ar.ts sumLines). */
export function sumLineAmounts(lines: readonly { qty: number; price: number }[]): number {
  return round2(lines.reduce((s, l) => s + lineTotal(l.qty, l.price), 0));
}

/** Sum the (parsed) line drafts to a preview subtotal — empty/invalid drafts add 0. */
export function previewSubtotal(drafts: readonly LineDraft[]): number {
  return sumLineAmounts(
    drafts.map((d) => ({ qty: parseAmount(d.qty), price: parseAmount(d.price) })),
  );
}

/** Preview VAT (7% of the subtotal) — server-side calcVat gives the authoritative value. */
export function previewVat(subtotal: number): number {
  return round2(subtotal * VAT_RATE);
}

/** Preview gross total (subtotal + preview VAT). */
export function previewTotal(subtotal: number): number {
  return round2(subtotal + previewVat(subtotal));
}

/** A draft line is submittable when qty and price both parse to a positive number. */
export function isLineComplete(d: LineDraft): boolean {
  return parseAmount(d.qty) > 0 && parseAmount(d.price) > 0;
}

/** The wire lines[] for POST /ar/invoices — only complete drafts, description optional. */
export function toWireLines(
  drafts: readonly LineDraft[],
): { qty: number; price: number; description?: string }[] {
  return drafts.filter(isLineComplete).map((d) => {
    const description = d.description.trim();
    return description
      ? { qty: parseAmount(d.qty), price: parseAmount(d.price), description }
      : { qty: parseAmount(d.qty), price: parseAmount(d.price) };
  });
}
