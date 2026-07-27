/*
 * Sales loan-application row helpers for SalesLoan (sales.loan, the loan & transfer
 * register) — pure, i18n-free, ASCII-only logic derived from pototype/sales-process.jsx
 * SalesLoan (L493-598).
 *
 * The prototype held its register in a local array of denormalised display rows (a
 * customer NAME, a unit CODE, a human loan-result verdict string, a transfer-due label).
 * PLAN.md section 0 rule 3: that mock is dropped as data — the table is the real
 * server register (GET /sales/loans, use-sales-loan.ts) whose opaque wire is
 * (apps/api/src/routes/land-sales.ts loanWire):
 *   { id, sales_unit_id, bank, ask_amt, approved_amt, currency_code, term,
 *     submit_date, result_date, status, created_at }   (ordered newest-first server-side).
 *
 * WIRE / HONEST NOTES (never fabricated — see sales-loan.tsx header for the full list):
 *  - status is the 5-state loan lifecycle (SA-6, loan_application.status; packages/db
 *    misc.ts L215): submitted | approved | partial | rejected | transfer. filterLoanByTab
 *    partitions the real rows by that status; statusTone / statusLabelKind carry the
 *    prototype's per-status colour + badge label.
 *  - ask_amt / approved_amt are money (currency_code) RECORDED as supplied (no server
 *    recompute — a loan application is not a GL posting). Kept as number | null so the
 *    view can distinguish "not yet approved" (null / 0 -> em-dash) from an approved figure.
 *  - sales_unit_id is a raw sales-unit uuid; there is no clean 1-hop path to the buyer
 *    name or unit code, so the view em-dashes the customer/unit cell (never leaks the
 *    uuid). transfer-due has no wire column at all -> em-dashed in the view.
 *  All ASCII (B-073) — no Thai lives here; every label is resolved in the view via t().
 */

/** The 5 loan-application statuses (SA-6, loan_application.status; misc.ts L215). */
export const LOAN_STATUSES = ["submitted", "approved", "partial", "rejected", "transfer"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

/** The 5 SalesLoan tabs (sales-process.jsx SalesLoan TabBar L520-526), in board order. */
export const LOAN_TABS = ["all", "submitted", "approved", "transfer", "rejected"] as const;
export type LoanTab = (typeof LOAN_TABS)[number];

/** A loan application as the table consumes it (GET /sales/loans row, narrowed). */
export interface LoanRow {
  id: string;
  /** Buyer's sales-unit uuid; em-dashed in the view (no clean name/code resolution). */
  salesUnitId: string;
  bank: string;
  /** Requested amount (money); null when the column is unset. */
  askAmt: number | null;
  /** Approved amount (money); null = not yet approved, 0 = declined limit. */
  approvedAmt: number | null;
  currencyCode: string;
  /** Loan term in years (nullable int). */
  term: number | null;
  /** Application submit date (ISO), or "" when null. */
  submitDate: string;
  /** Bank-result date (ISO), or "" when null. */
  resultDate: string;
  /** Raw status value (normally one of LOAN_STATUSES; kept as string for robustness). */
  status: string;
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Parse a money field to a number; null when absent/empty/non-finite (never NaN). */
function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Parse an integer field; null when absent/non-finite (term is a nullable column). */
function intOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Narrow an opaque /sales/loans Entity row to the LoanRow the table needs. Accepts
 * snake_case (server convention) or camelCase for robustness (mirrors toLeadRow).
 * Missing string fields default to "" (never undefined); money/term default to null.
 */
export function toLoanRow(e: Record<string, unknown>): LoanRow {
  return {
    id: str(e.id),
    salesUnitId: str(e.sales_unit_id ?? e.salesUnitId),
    bank: str(e.bank),
    askAmt: numOrNull(e.ask_amt ?? e.askAmt),
    approvedAmt: numOrNull(e.approved_amt ?? e.approvedAmt),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    term: intOrNull(e.term),
    submitDate: str(e.submit_date ?? e.submitDate),
    resultDate: str(e.result_date ?? e.resultDate),
    status: str(e.status),
  };
}

/** True when `s` is one of the 5 known loan statuses. */
export function isLoanStatus(s: string): s is LoanStatus {
  return (LOAN_STATUSES as readonly string[]).includes(s);
}

/**
 * Filter the loans for a tab. The prototype's tab counts are a mock; production
 * partitions the real rows honestly by status (each tab is a single status; the
 * "partial" status has no tab of its own, so it appears only under "all"):
 *   all        -> every loan application
 *   submitted  -> awaiting the bank result (status "submitted")
 *   approved   -> approved (status "approved")
 *   transfer   -> transfer scheduled (status "transfer")
 *   rejected   -> declined (status "rejected")
 */
export function filterLoanByTab(rows: readonly LoanRow[], tab: LoanTab): LoanRow[] {
  switch (tab) {
    case "all":
      return [...rows];
    case "submitted":
      return rows.filter((r) => r.status === "submitted");
    case "approved":
      return rows.filter((r) => r.status === "approved");
    case "transfer":
      return rows.filter((r) => r.status === "transfer");
    case "rejected":
      return rows.filter((r) => r.status === "rejected");
  }
}

/** C10 tab badge count — the real length of the tab's filtered set. */
export function loanTabCount(rows: readonly LoanRow[], tab: LoanTab): number {
  return filterLoanByTab(rows, tab).length;
}

/** Count loans whose status equals `status` (KPI aggregates, C10). */
export function countByStatus(rows: readonly LoanRow[], status: string): number {
  return rows.filter((r) => r.status === status).length;
}

/**
 * KPI "rejected / reduced limit" (sales.loan.kpiRejected) — the label explicitly
 * covers BOTH a rejection and a reduced-limit (partial) approval, so it counts
 * status "rejected" plus status "partial" (C10, derived from the real rows).
 */
export function countRejectedOrReduced(rows: readonly LoanRow[]): number {
  return rows.reduce((n, r) => n + (r.status === "rejected" || r.status === "partial" ? 1 : 0), 0);
}

/**
 * The status-badge colours (sales-process.jsx SalesLoan L572-587). bg/fg are
 * @juneflow/tokens var() references (rule 6). Unknown statuses fall back to the
 * approved (accent) tone, exactly like the prototype's trailing `: "var(--accent-*)"`.
 */
export function statusTone(status: string): { bg: string; fg: string } {
  switch (status) {
    case "transfer":
      return { bg: "var(--ok-soft)", fg: "var(--ok)" };
    case "submitted":
      return { bg: "var(--warn-soft)", fg: "var(--warn)" };
    case "rejected":
      return { bg: "var(--danger-soft)", fg: "var(--danger)" };
    case "partial":
      return { bg: "var(--warn-soft)", fg: "var(--warn)" };
    default:
      return { bg: "var(--accent-soft)", fg: "var(--accent)" };
  }
}

/** Which i18n badge label a wire status renders (resolved in the view — no Thai here). */
export type LoanStatusLabel = "waiting" | "ready" | "partial" | "rejected" | "transfer";

/** Map a wire status to its badge label kind (sales-process.jsx SalesLoan L584-587). */
export function statusLabelKind(status: string): LoanStatusLabel {
  switch (status) {
    case "transfer":
      return "transfer";
    case "submitted":
      return "waiting";
    case "rejected":
      return "rejected";
    case "partial":
      return "partial";
    default:
      return "ready";
  }
}

/**
 * Group a FULL-unit money amount with thousands separators ("4185000" -> "4,185,000"),
 * matching the prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII
 * digits + comma only; NaN / non-finite -> "0". Mirrors po-wo-rows formatMoney.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
