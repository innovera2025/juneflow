/*
 * AR Tax Invoice / Receipt row helpers (ar.tax) — pure, i18n-free, ASCII-only logic
 * ported from pototype/ar.jsx ARTaxInvoice (L153-224).
 *
 * The prototype held the register in a local literal array (ar.jsx L195-200, the TX/RC/CX
 * mock rows). Juneflow §0 rule 3: that mock seed is dropped — the list is the real server
 * catalogue GET /ar/tax-register, a DERIVED read (Wei B-121 Q6: one row per ar_invoice =
 * one tax invoice; settlement reflected via the invoice status paid-flip, NO new table —
 * apps/api/src/routes/ar.ts taxRegisterWire / listTaxRegister). The wire row (opaque Entity,
 * snake_case of the REAL invoice columns) is:
 *   { id, no, customer_id, amount, vat, total, etax_status, status, doc_date }.
 *
 * HONEST DATA GAPS (never fabricated) — see ar.ts taxRegisterWire:
 *   - `customer_id` is an opaque uuid; the derive carries NO customer NAME and NO line/item
 *     description -> the prototype's customer/item cell em-dashes (the screen renders DASH).
 *   - the prototype's TX / RC / CX "type" is a mock trichotomy. The backend derive states
 *     "one row per invoice = one tax invoice", so every non-void row IS a tax invoice (kind
 *     "tax"); a voided e-Tax (etax_status === 'void') is "cancel". There is NO wire signal
 *     that classifies a RECEIPT (kind "receipt" is never derived) -> the receipt tab is an
 *     honest-empty 0 (the blessed gl-inbox scheduled/error precedent), never fabricated.
 *   - `amount` / `vat` / `total` are REAL; the prototype's cell predicate is value-driven
 *     (`> 0 ? show : em-dash`), preserved verbatim (a voided invoice keeps its real figures
 *     on the wire, so it shows them — cancel only flips etax_status, ar.ts cancelTaxRegister).
 *   - `doc_date` is the invoice createdAt (stored UTC, PLAN.md §4) -> formatted YYYY-MM-DD;
 *     the prototype's Thai buddhist date came from a dropped mock field (gl-inbox precedent).
 *
 * KPIs are REAL derivations over the loaded rows (issued count + Σ total, Σ VAT, cancelled
 * count); the "ready to submit to RD" KPI has NO wire signal -> the screen em-dashes it (the
 * Sync-SAP honest precedent). Every colour the .tsx paints from these rows is an
 * @juneflow/tokens var() (rule 6) or a ds.jsx STATUS-verbatim hex (B-037(a)); no Thai/baht
 * leaks here (B-073).
 */

/** Document kind. `tax` = tax invoice, `cancel` = voided e-Tax; `receipt` is never derived. */
export type TaxKind = "tax" | "receipt" | "cancel";

/** The four prototype tabs (ar.jsx L174-179). `receipt` has no wire signal -> always 0. */
export type TaxTab = "all" | "tax" | "receipt" | "cancel";

/** Status shown by the ds.jsx StatusBadge — void -> cancelled, else approved. */
export type TaxDisplayStatus = "approved" | "cancelled";

/** A tax-register row as the table consumes it (GET /ar/tax-register row, narrowed). */
export interface TaxRow {
  id: string;
  /** REAL invoice number (ar_invoice.no is NOT NULL). */
  no: string;
  /** REAL net amount (server-authoritative Σ lines). */
  amount: number;
  /** REAL output VAT (7% via tax-engine). */
  vat: number;
  /** REAL total = amount + vat. */
  total: number;
  /** e-Tax lifecycle (queued | void); drives the type badge + status badge. */
  etaxStatus: string;
  /** Settlement status (open | paid) — kept for completeness (not a column). */
  status: string;
  /** Invoice createdAt (stored UTC). */
  docDate: string;
  /** Derived: void -> cancel, else tax (receipt is never derived). */
  kind: TaxKind;
  /** Derived: void -> cancelled, else approved. */
  displayStatus: TaxDisplayStatus;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row, else 0 (amounts are numbers on the wire). */
function numOr0(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Derived kind: a voided e-Tax is `cancel`; otherwise the row is a tax invoice (C10). */
export function deriveKind(etaxStatus: string): TaxKind {
  return etaxStatus === "void" ? "cancel" : "tax";
}

/** Derived status: a voided e-Tax shows `cancelled`; otherwise `approved` (issued). */
export function deriveDisplayStatus(etaxStatus: string): TaxDisplayStatus {
  return etaxStatus === "void" ? "cancelled" : "approved";
}

/** Narrow an opaque /ar/tax-register Entity row to the TaxRow the table needs. */
export function toTaxRow(e: Record<string, unknown>): TaxRow {
  const etaxStatus = str(e.etax_status ?? e.etaxStatus);
  return {
    id: str(e.id),
    no: str(e.no),
    amount: numOr0(e.amount),
    vat: numOr0(e.vat),
    total: numOr0(e.total),
    etaxStatus,
    status: str(e.status),
    docDate: str(e.doc_date ?? e.docDate ?? e.created_at ?? e.createdAt),
    kind: deriveKind(etaxStatus),
    displayStatus: deriveDisplayStatus(etaxStatus),
  };
}

/**
 * Type-badge tone (bg/fg), mapped from the kind (ar.jsx L204-208). The LABEL is resolved
 * from the DICT in the .tsx (Thai must not leak here); bg/fg are @juneflow/tokens var().
 */
export function kindTag(kind: TaxKind): { bg: string; fg: string } {
  switch (kind) {
    case "tax":
      return { bg: "var(--info-soft)", fg: "var(--info)" };
    case "receipt":
      return { bg: "var(--ok-soft)", fg: "var(--ok)" };
    default:
      return { bg: "var(--surface-3)", fg: "var(--text-3)" };
  }
}

/**
 * Status-badge tone (ds.jsx STATUS, B-037(a) verbatim hexes). `cancelled` reuses the
 * STATUS.cancelled slate hexes (not tokened in the prototype); `approved` is tokened + the
 * verbatim green dot.
 */
export function statusTone(status: TaxDisplayStatus): { bg: string; fg: string; dot: string } {
  if (status === "cancelled") {
    // ds.jsx STATUS.cancelled: bg #F1F5F9, fg #64748B, dot #94A3B8 (prototype-verbatim).
    return { bg: "#F1F5F9", fg: "#64748B", dot: "#94A3B8" };
  }
  // ds.jsx STATUS.approved: tokened bg/fg + verbatim green dot #16A34A.
  return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
}

/** Rows in a tab (presentational tabs — the prototype's onChange is a no-op, ar.jsx L179). */
export function filterByTab(rows: readonly TaxRow[], tab: TaxTab): TaxRow[] {
  if (tab === "all") return [...rows];
  return rows.filter((r) => r.kind === tab);
}

/** Count of rows in a tab (receipt -> 0, honest empty; no wire signal). */
export function tabCount(rows: readonly TaxRow[], tab: TaxTab): number {
  return filterByTab(rows, tab).length;
}

/** The issued (non-void) tax invoices — the population the "issued" + VAT KPIs sum over. */
export function issuedRows(rows: readonly TaxRow[]): TaxRow[] {
  return rows.filter((r) => r.kind === "tax");
}

/** Count of issued (non-void) tax invoices. */
export function issuedCount(rows: readonly TaxRow[]): number {
  return issuedRows(rows).length;
}

/** Σ total over the issued (non-void) rows — the "issued this month" value sub. */
export function issuedTotal(rows: readonly TaxRow[]): number {
  return issuedRows(rows).reduce((s, r) => s + r.total, 0);
}

/** Σ output VAT over the issued (non-void) rows — the VAT-payable KPI (voided excluded). */
export function vatTotal(rows: readonly TaxRow[]): number {
  return issuedRows(rows).reduce((s, r) => s + r.vat, 0);
}

/** Count of voided (cancelled) e-Tax rows. */
export function cancelledCount(rows: readonly TaxRow[]): number {
  return rows.filter((r) => r.kind === "cancel").length;
}

/**
 * Group a money amount with thousands separators, 0 decimals ("1000000" -> "1,000,000"),
 * matching the prototype's ds.jsx fmt (Intl th-TH maximumFractionDigits 0). ASCII digits +
 * comma only; non-finite -> "0". Used for the net-total column.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Group a money amount with thousands separators, 2 decimals ("2007476.64" ->
 * "2,007,476.64"), matching the prototype's ds.jsx fmtDec (Intl th-TH min/max 2). ASCII
 * digits + comma + dot only; non-finite -> "0.00". Used for the value + VAT columns.
 */
export function formatDec(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  const sign = n < 0 ? "-" : "";
  const [int, frac] = Math.abs(n).toFixed(2).split(".");
  return sign + int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + frac!;
}

/** Millions with 2 decimals ("32140000" -> "32.14"), the prototype's fmtM (ar.jsx L42). */
export function formatMillions(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return (n / 1e6).toFixed(2);
}

/**
 * Format the row's doc_date (invoice createdAt, stored UTC) as YYYY-MM-DD. The prototype
 * showed a Thai buddhist date, but that came from a dropped mock field; the wire exposes the
 * insert timestamp, formatted honestly (gl-inbox precedent). "" for a missing/invalid value
 * (the cell then em-dashes).
 */
export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
