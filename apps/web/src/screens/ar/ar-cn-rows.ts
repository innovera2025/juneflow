/*
 * AR Credit Note row helpers (ar.cn) — pure, i18n-free, ASCII-only logic ported from
 * pototype/accounting-extra2.jsx ARCreditNote (L114-181) + ARCNForm (L182-223).
 *
 * The prototype held the register in local state (ARCN_SEED, L107-111). Section-0 rule 3: that
 * mock seed is dropped — the list is the real server catalogue (GET /ar/cn, apps/api/src/routes/
 * ar.ts listCn -> cnWire). The wire row (opaque Entity, snake_case) is:
 *   { id, no, customer_id, ref_invoice_id, reason: string|null, amount: number,
 *     vat: number, currency_code, status: string|null, note_date: string|null, created_at }.
 *
 * MONEY AUTHORITY (B-121 · Juneflow C10 — the SERVER owns the VAT):
 *   - `amount` is the VAT-INCLUSIVE (gross) credit the user typed (ar.cn.fldAmount, "incl VAT").
 *   - `vat` is DERIVED server-side = round2(amount × 7/107) (ar.ts vatFromInclusive) and returned
 *     REAL on the wire — the table + KPI read that field, never a client figure. The authoritative
 *     posting VAT is fixed on approve (POST /ar/cn/{id}/approve posts the reversal JV Dr revenue +
 *     Dr vat / Cr AR through the posting-inbox, source_doc 'cn:<id>').
 *   - vatPreview()/preVatBase() are CLIENT-ONLY UX previews for the create form (no row exists yet);
 *     they mirror the prototype's inline split (accounting-extra2.jsx L213) but are never posted.
 *
 * HONEST DATA GAPS (never fabricated) — see ar.ts:
 *   - `status` is a nullable column that ar.ts NEITHER sets on create NOR flips on approve (the
 *     approve marker is the reversal JV's source_doc, not this column). So seed rows carry a REAL
 *     status (approved/pending/draft) but a freshly-created CN is status="" and stays "" even after
 *     a successful approve. statusKind() maps "" / unknown to the prototype's else-branch ("draft",
 *     accounting-extra2.jsx L167 ternary). The screen reports this so the un-flipped badge is honest,
 *     not a bug.
 *   - `customer_id` / `ref_invoice_id` are UUIDs; the screen resolves the display name / invoice no
 *     via GET /customers + GET /ar/invoices (real), em-dashing an unresolved id.
 *   - the prototype's Thai buddhist mock `date` is dropped — the wire's note_date (null on the seed)
 *     falls back to created_at (stored UTC), formatted honestly YYYY-MM-DD.
 *
 * Every colour the .tsx paints from these rows is an @juneflow/tokens var(); no Thai/baht leaks
 * here (B-073).
 */

/** Derived CN lifecycle kind (the wire status narrowed; "" / unknown -> the prototype "draft" else). */
export type CnStatusKind = "approved" | "pending" | "draft";

/** An AR credit-note row as the table consumes it (GET /ar/cn row, narrowed). */
export interface CnRow {
  id: string;
  /** Real CN document number (ar_credit_note.no, NOT NULL). */
  no: string;
  /** Customer UUID — resolved to a name via the customers map ("" -> em-dash). */
  customerId: string;
  /** Referenced invoice UUID — resolved to its no via the invoices map ("" -> em-dash). */
  refInvoiceId: string;
  /** Free-text reason ("" -> em-dash). */
  reason: string;
  /** Gross (VAT-inclusive) credit amount — SERVER-authoritative. */
  amount: number;
  /** VAT DERIVED server-side (round2(amount × 7/107)) — real wire field. */
  vat: number;
  /** Currency of amount/vat. */
  currencyCode: string;
  /** Raw wire status ("" for a null column). */
  status: string;
  /** note_date ("" when null on the wire). */
  noteDate: string;
  /** Row creation timestamp (stored UTC). */
  createdAt: string;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row, else 0. */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Narrow an opaque /ar/cn Entity row to the CnRow the table needs. */
export function toCnRow(e: Record<string, unknown>): CnRow {
  return {
    id: str(e.id),
    no: str(e.no),
    customerId: str(e.customer_id ?? e.customerId),
    refInvoiceId: str(e.ref_invoice_id ?? e.refInvoiceId),
    reason: str(e.reason),
    amount: num(e.amount),
    vat: num(e.vat),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    status: str(e.status),
    noteDate: str(e.note_date ?? e.noteDate),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/**
 * CLIENT PREVIEW of the VAT embedded in a VAT-inclusive amount = round(amount × 7/107), matching
 * the prototype's inline preview (accounting-extra2.jsx L213) AND the server's derivation
 * (ar.ts vatFromInclusive). UX only — the authoritative VAT is the server's on approve. Non-finite
 * / non-positive input -> 0.
 */
export function vatPreview(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round((amount * 7) / 107);
}

/**
 * CLIENT PREVIEW of the pre-VAT (net) base = round(amount × 100/107), the {amount} slot of
 * ar.cn.calcLine (prototype accounting-extra2.jsx L213). Non-finite / non-positive -> 0.
 */
export function preVatBase(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round((amount * 100) / 107);
}

/**
 * Narrow the wire status to a lifecycle kind. Mirrors the prototype's exact ternary
 * (accounting-extra2.jsx L167): approved -> approved, pending -> pending, EVERYTHING ELSE
 * (draft / "" / unknown) -> draft. A freshly-created CN (status="") therefore renders as "draft".
 */
export function statusKind(status: string): CnStatusKind {
  if (status === "approved") return "approved";
  if (status === "pending") return "pending";
  return "draft";
}

/** Status-badge tokens (ds.jsx STATUS L85-88; bg/fg = @juneflow/tokens, dot = verbatim hex). */
export function statusTone(kind: CnStatusKind): { bg: string; fg: string; dot: string } {
  switch (kind) {
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}

/**
 * Reason-tag tone (prototype accounting-extra2.jsx L163): the cancel-booking reason is danger,
 * every other reason is info. The prototype's Thai substring test stays out of source — the caller
 * passes the resolved ar.cn.reasonCancelBooking label so the comparison is dict-driven (B-073).
 */
export function reasonTone(reason: string, cancelReason: string): string {
  return reason !== "" && reason === cancelReason ? "var(--danger)" : "var(--info)";
}

/**
 * Group a money amount with thousands separators ("200000" -> "200,000"), matching the prototype's
 * Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits + comma only; non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The date cell (YYYY-MM-DD): note_date when present, else created_at (stored UTC), else "" (the
 * cell then em-dashes). The prototype's Thai buddhist mock date is dropped (rule 3).
 */
export function formatDate(noteDate: string, createdAt: string): string {
  const raw = noteDate || createdAt;
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** Total credit-note count (KPI ar.cn.kpiMonth). */
export function cnCount(rows: readonly CnRow[]): number {
  return rows.length;
}

/** Count of rows of a derived status kind (KPI sub {approved} / {pending}). */
export function countStatus(rows: readonly CnRow[], kind: CnStatusKind): number {
  return rows.filter((r) => statusKind(r.status) === kind).length;
}

/** Σ gross amount (KPI ar.cn.kpiTotal — includes VAT). */
export function sumAmount(rows: readonly CnRow[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

/** Σ the REAL wire vat of APPROVED rows only (KPI ar.cn.kpiVat). */
export function sumVatApproved(rows: readonly CnRow[]): number {
  return rows.reduce((s, r) => (statusKind(r.status) === "approved" ? s + r.vat : s), 0);
}

/** The create-form draft state (the fields the POST /ar/cn body needs). */
export interface CnDraft {
  /** Customer UUID (GET /customers). */
  customerId: string;
  /** Referenced invoice UUID (GET /ar/invoices) — REQUIRED (server 400 without it). */
  refInvoiceId: string;
  /** Resolved reason label (one of the ar.cn.reason* dict values). */
  reason: string;
  /** Raw VAT-inclusive amount input (digits only). */
  amount: string;
}

/** Parse the raw amount input to a positive number, else 0. */
export function parseAmount(raw: string): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Form validity: customer + referenced invoice + a positive amount are all required. The prototype
 * left the invoice ref optional (free text), but POST /ar/cn REJECTS a missing ref_invoice_id
 * (ar.ts createCn 400) — so the ported picker is required (reported).
 */
export function cnFormValid(draft: CnDraft): boolean {
  return draft.customerId !== "" && draft.refInvoiceId !== "" && parseAmount(draft.amount) > 0;
}

/**
 * Compose the opaque POST /ar/cn body from the draft + a client-supplied `no`. The server owns the
 * VAT/total (it re-derives from amount); this sends only the gross amount + refs + reason. `no` is
 * client-generated because ar_credit_note.no is NOT NULL with no server allocator (reported) — a
 * duplicate is a server 409 the caller surfaces honestly.
 */
export function buildCreateCnBody(
  no: string,
  draft: CnDraft,
): Record<string, unknown> {
  return {
    no,
    customer_id: draft.customerId,
    ref_invoice_id: draft.refInvoiceId,
    reason: draft.reason,
    amount: parseAmount(draft.amount),
  };
}
