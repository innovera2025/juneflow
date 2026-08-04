/*
 * AP credit/debit-note row + form helpers for APCreditDebit (ap.cn-dn) — pure, i18n-free,
 * ASCII-only logic ported from pototype/ap.jsx APCreditDebit (L321-382) + CNDNForm (L486-518).
 *
 * The prototype held ONE local array mixing CN + DN rows (each tagged by `kind`) with hardcoded
 * signed money. Juneflow §0 rule 3: that mock seed is dropped — the register is the real server
 * catalogue of TWO lists (GET /ap/cn + GET /ap/dn, apps/api/src/routes/ap-cndn.ts listApCn/listApDn)
 * that this module tags + combines. Each wire row (opaque Entity, snake_case) is:
 *   { id, no, vendor_id, ref_ap_id, reason: string|null, amount: number, currency_code,
 *     status: string|null, note_date: string|null, created_at }.
 *
 * MONEY AUTHORITY (B-231 · Wei C-176 · Model-A no-VAT — the SERVER owns the JV):
 *   - `amount` is the positive magnitude the user typed; the SERVER stores it, allocates the note
 *     `no` (CN-<year>-<NNNN> / DN-<year>-<NNNN>), and — only on approve — posts the balanced 2-line
 *     JV (CN: Dr 2010 AP / Cr 5020 · DN: Dr 5100 / Cr 2010 AP). buildCreateNoteBody() sends ONLY
 *     { vendor_id, ref_ap_id, amount, reason } — never a client `no` / status / JV / balance.
 *   - signedValue() derives the DISPLAY sign for the register (a credit note REDUCES the payable ->
 *     negative/green; a debit note INCREASES it -> positive/red), matching the prototype's own
 *     signed mock values (ap.jsx L355-359 + L372). It is a view concern, never posted.
 *
 * HONEST DATA GAPS (never fabricated) — see ap-cndn.ts:
 *   - `status` is a nullable column the handlers NEITHER set on create NOR flip on approve (the
 *     approve marker is the reversal JV's source_doc, not this column). So a freshly-created note is
 *     status="" -> statusKind() maps it to the prototype "draft" bucket, and it stays that way even
 *     after a successful approve. The register reports this so the un-flipped badge is honest.
 *   - `vendor_id` / `ref_ap_id` are UUIDs; the register resolves the vendor name (GET /vendors) and
 *     the referenced AP billing (GET /ap/billing) real, em-dashing an unresolved id. ap_billing has
 *     NO doc-number column (ap.ts GAP) -> apBillingLabel() falls back to invoice_no / vendor_name.
 *   - the prototype's Thai buddhist mock `date` is dropped — the wire's note_date (null on a fresh
 *     row) falls back to created_at (stored UTC), formatted honestly YYYY-MM-DD.
 *
 * Every colour the .tsx paints from these rows is an @juneflow/tokens var() or a prototype-verbatim
 * STATUS dot hex (B-037(a)); no Thai/baht leaks here (labels live in ap-cn-dn-strings.json, B-073).
 */

/** A note is a credit note (CN) or a debit note (DN) — the two GET lists tagged into one register. */
export type NoteKind = "CN" | "DN";

/** Derived note lifecycle kind (the wire status narrowed; "" / unknown -> the prototype "draft"). */
export type NoteStatusKind = "approved" | "pending" | "draft";

/** An AP CN/DN row as the register table consumes it (GET /ap/cn|dn row, narrowed + kind-tagged). */
export interface NoteRow {
  id: string;
  /** Which list the row came from (drives the type badge + display sign). */
  kind: NoteKind;
  /** Real server-allocated note number (CN-/DN-<year>-<NNNN>); "" when absent. */
  no: string;
  /** Vendor UUID — resolved to a name via the vendors map ("" -> em-dash). */
  vendorId: string;
  /** Referenced ap_billing UUID — resolved via the billing map ("" -> em-dash). */
  refApId: string;
  /** Free-text reason ("" -> em-dash). */
  reason: string;
  /** Note amount as a POSITIVE magnitude — SERVER-authoritative (the display sign is derived). */
  amount: number;
  /** Currency of amount. */
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

/** Narrow an opaque /ap/cn|dn Entity row to the NoteRow the register needs, tagging its kind. */
export function toNoteRow(e: Record<string, unknown>, kind: NoteKind): NoteRow {
  return {
    id: str(e.id),
    kind,
    no: str(e.no),
    vendorId: str(e.vendor_id ?? e.vendorId),
    refApId: str(e.ref_ap_id ?? e.refApId),
    reason: str(e.reason),
    amount: num(e.amount),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    status: str(e.status),
    noteDate: str(e.note_date ?? e.noteDate),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/** Epoch ms of a stored timestamp, else 0 (a malformed/absent value sorts last). */
function msOf(raw: string): number {
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Combine the CN + DN lists into the single register the prototype renders (ap.jsx L354-359), tagged
 * by kind and sorted newest-first by created_at (each list already arrives newest-first server-side;
 * this restores that order across the merge).
 */
export function combineNotes(
  cnRows: readonly Record<string, unknown>[],
  dnRows: readonly Record<string, unknown>[],
): NoteRow[] {
  const rows = [
    ...cnRows.map((e) => toNoteRow(e, "CN")),
    ...dnRows.map((e) => toNoteRow(e, "DN")),
  ];
  return rows.sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt));
}

/**
 * The DISPLAY-signed value for the register amount column (ap.jsx L372): a credit note reduces the
 * payable -> negative; a debit note increases it -> positive. A view concern only (never posted).
 */
export function signedValue(kind: NoteKind, amount: number): number {
  const mag = Number.isFinite(amount) ? Math.abs(amount) : 0;
  return kind === "CN" ? -mag : mag;
}

/**
 * Token colour for a signed value (ap.jsx L372 inline ternary): negative (a CN reduction) -> ok
 * (green); positive (a DN increase) -> danger (red). Zero -> ok (neutral reduction side).
 */
export function valueTone(kind: NoteKind): string {
  return kind === "CN" ? "var(--ok)" : "var(--danger)";
}

/**
 * Narrow the wire status to a lifecycle kind. Mirrors the ar-cn / ds.jsx ternary: approved ->
 * approved, pending -> pending, EVERYTHING ELSE (draft / "" / unknown) -> draft. A freshly-created
 * note (status="") therefore renders as "draft".
 */
export function statusKind(status: string): NoteStatusKind {
  if (status === "approved") return "approved";
  if (status === "pending") return "pending";
  return "draft";
}

/** Status-badge tokens (ds.jsx STATUS; bg/fg = @juneflow/tokens, dot = prototype-verbatim hex). */
export function statusTone(kind: NoteStatusKind): { bg: string; fg: string; dot: string } {
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
 * Group a money amount with thousands separators ("25500" -> "25,500"), matching the prototype's fmt
 * (ds.jsx th-TH maximumFractionDigits 0). ASCII digits + comma only; non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Signed money for the register value cell + KPI subs (ap.jsx L372 "{value>0?'+':''}{fmt(value)}"):
 * a positive value gets a leading "+", a negative one keeps formatMoney's "-", zero stays "0".
 */
export function formatSignedMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  return rounded > 0 ? `+${formatMoney(rounded)}` : formatMoney(rounded);
}

/**
 * The date cell (YYYY-MM-DD): note_date when present, else created_at (stored UTC), else "" (the cell
 * then em-dashes). The prototype's Thai buddhist mock date is dropped (rule 3).
 */
export function formatDate(noteDate: string, createdAt: string): string {
  const raw = noteDate || createdAt;
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/* --------------------------------------------------------------------------- */
/* KPI strip (ap.jsx L334-338) — real derivations off the loaded rows           */
/* --------------------------------------------------------------------------- */

/** The three KPI-card numbers (ap.jsx L335-337), all derived from the combined rows. */
export interface NoteKpis {
  /** CN row count (KPI 1 value). */
  cnCount: number;
  /** DN row count (KPI 2 value). */
  dnCount: number;
  /** Σ CN amount (positive magnitude) — the CN KPI sub reduction. */
  cnAmount: number;
  /** Σ DN amount (positive magnitude) — the DN KPI sub increase. */
  dnAmount: number;
  /** Net AP change = DN increases − CN reductions (KPI 3 value; negative when CN outweighs DN). */
  netAp: number;
}

/** Compute the KPI-card numbers from the combined rows (ap.jsx L335-337). */
export function noteKpis(rows: readonly NoteRow[]): NoteKpis {
  const cn = rows.filter((r) => r.kind === "CN");
  const dn = rows.filter((r) => r.kind === "DN");
  const cnAmount = cn.reduce((s, r) => s + Math.abs(r.amount), 0);
  const dnAmount = dn.reduce((s, r) => s + Math.abs(r.amount), 0);
  return {
    cnCount: cn.length,
    dnCount: dn.length,
    cnAmount,
    dnAmount,
    netAp: dnAmount - cnAmount,
  };
}

/* --------------------------------------------------------------------------- */
/* Referenced ap_billing (the ref_ap_id picker + register resolution)           */
/* --------------------------------------------------------------------------- */

/** An ap_billing row as the ref picker / register resolution consumes it. */
export interface ApBillingPick {
  id: string;
  /** Vendor's tax-invoice number (nullable) — the closest real analog to a doc number. */
  invoiceNo: string;
  /** Resolved vendor name (server join); "" when absent. */
  vendorName: string;
  /** Base amount (server system of record). */
  amount: number;
}

/** Narrow an opaque /ap/billing row to the fields the ref picker / resolution needs. */
export function toApBillingPick(e: Record<string, unknown>): ApBillingPick {
  return {
    id: str(e.id),
    invoiceNo: str(e.invoice_no ?? e.invoiceNo),
    vendorName: str(e.vendor_name ?? e.vendorName),
    amount: num(e.amount),
  };
}

/**
 * Display label for a referenced ap_billing (register cell + picker option). ap_billing has NO
 * doc-number column (ap.ts GAP), so the label falls back through the real fields: invoice_no +
 * vendor_name joined by " · ", else whichever is present, else "" (the caller then em-dashes / uses a
 * short id). Never fabricates an AP-2026-xxxx number.
 */
export function apBillingLabel(p: ApBillingPick): string {
  return [p.invoiceNo, p.vendorName].filter((s) => s.trim() !== "").join(" · ");
}

/* --------------------------------------------------------------------------- */
/* Create-form (POST /ap/cn | /ap/dn) helpers — money=SERVER                     */
/* --------------------------------------------------------------------------- */

/**
 * The CNDNForm draft state — only the fields the opaque POST body needs (ap-cndn.ts
 * validateNoteCreate): vendor_id + ref_ap_id + amount>0 are server-required; reason is server-
 * optional but the prototype marks it required (ap.jsx L506) so the form requires it too. The
 * prototype's read-only note-no + date fields are NOT collected (server owns them — see the
 * ap-cn-dn-strings.json _source; billing-form precedent).
 */
export interface NoteDraft {
  vendorId: string;
  refApId: string;
  /** Raw amount input (digits only). */
  amount: string;
  reason: string;
}

/** A blank note draft. */
export function emptyNoteDraft(): NoteDraft {
  return { vendorId: "", refApId: "", amount: "", reason: "" };
}

/** Parse the raw amount input to a positive number, else 0. */
export function parseAmount(raw: string): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Form validity: vendor + referenced AP billing + a positive amount + a non-blank reason (the
 * prototype marks all four required, ap.jsx L500-506; vendor/ref/amount are also server-required).
 */
export function noteFormValid(d: NoteDraft): boolean {
  return (
    d.vendorId !== "" &&
    d.refApId !== "" &&
    parseAmount(d.amount) > 0 &&
    d.reason.trim() !== ""
  );
}

/**
 * Compose the opaque POST /ap/cn | /ap/dn body from the draft. money=SERVER: this sends ONLY
 * { vendor_id, ref_ap_id, amount, reason } — the server owns the note `no`, the status, and the
 * balanced approve JV. NEVER sends a client-computed number / balance / JV / status.
 */
export function buildCreateNoteBody(d: NoteDraft): Record<string, unknown> {
  return {
    vendor_id: d.vendorId,
    ref_ap_id: d.refApId,
    amount: parseAmount(d.amount),
    reason: d.reason.trim(),
  };
}
