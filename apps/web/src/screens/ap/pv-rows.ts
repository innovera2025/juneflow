/*
 * Payment-voucher row + form helpers for APPaymentVoucher (P2-WEB-14) — pure,
 * i18n-free, ASCII-only logic ported from pototype/ap.jsx APPaymentVoucher
 * (L167-234) + PVCreateForm (L236-315).
 *
 * The prototype held the PVs in a local array (PV_LIST, L160-165) with hardcoded
 * money + Thai method labels. Juneflow §0 rule: that mock seed is dropped — the
 * list is the real server catalogue (GET /ap/pv, apps/api/src/routes/ap.ts listPv)
 * of opaque Entity rows narrowed here. The wire carries { id, no, billing_ids,
 * vendor_id, payee, amount, wht_pct, wht, retention, net, method, cheque_no,
 * cheque_bank, cheque_date, currency_code, batch_id, status, doc_date, created_at }.
 *
 * HONEST GAPS the screen em-dashes (never fabricated):
 *   - `no` is an honest null on EVERY row (ap.ts: pv has no doc-number column) ->
 *     the "PV number" cell em-dashes.
 *   - the prototype's "ref-from" reference is the source AP's doc-number, which is
 *     ALSO null (ap_billing has no doc-number) -> the ref cell em-dashes (the wire
 *     only carries billing_ids UUIDs, not a meaningful AP number).
 *   - `method` / `cheque_no` / `retention` are nullable -> null renders an em-dash.
 * The KPI values (pending count, WHT total, retention total) are REAL derivations
 * off the loaded rows; "PV this month" needs a month partition the label implies
 * but the screen cannot honestly derive -> that KPI em-dashes (gl-jv precedent).
 * `wht` and `net` are the server's tax-engine results (system of record); the
 * create form only PREVIEWS a client-side net (pvNet) — the server re-computes.
 * Every colour is an @juneflow/tokens var(); no Thai/baht leaks here.
 */

/** A PV as the list table consumes it (GET /ap/pv row, narrowed from opaque). */
export interface PvRow {
  id: string;
  /** Honest null on the wire (pv has no doc-number column) -> "" here. */
  no: string;
  billingIds: string[];
  vendorId: string;
  /** Resolved payee name (server join billing -> vendor); "" when absent. */
  payee: string;
  /** Gross payable, FULL baht (server system of record). */
  amount: number;
  /** Withholding-tax rate percent used by the server's tax-engine leg. */
  whtPct: number;
  /** Withholding-tax amount (server tax-engine result), FULL baht. */
  wht: number;
  /** Retention hold-back amount, or null -> em-dash. */
  retention: number | null;
  /** Net paid = gross - wht - retention (server result), FULL baht. */
  net: number;
  /** Settlement method enum (cash | transfer | cheque | deposit); "" when null. */
  method: string;
  chequeNo: string;
  chequeBank: string;
  chequeDate: string;
  currencyCode: string;
  /** Lifecycle status (pending | approved | ...). */
  status: string;
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

/** Read a string[] field off an opaque row; [] when absent/non-array. */
function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter((x) => x !== "");
}

/** Narrow an opaque /ap/pv Entity row to the PvRow the table needs. */
export function toPvRow(e: Record<string, unknown>): PvRow {
  return {
    id: str(e.id),
    no: str(e.no),
    billingIds: strArray(e.billing_ids ?? e.billingIds),
    vendorId: str(e.vendor_id ?? e.vendorId),
    payee: str(e.payee),
    amount: num(e.amount),
    whtPct: num(e.wht_pct ?? e.whtPct),
    wht: num(e.wht),
    retention: numOrNull(e.retention),
    net: num(e.net),
    method: str(e.method),
    chequeNo: str(e.cheque_no ?? e.chequeNo),
    chequeBank: str(e.cheque_bank ?? e.chequeBank),
    chequeDate: str(e.cheque_date ?? e.chequeDate),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    status: str(e.status),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/**
 * Group a FULL-baht amount with thousands separators ("645000" -> "645,000"),
 * matching the prototype's fmt. ASCII digits + comma only; non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Thousands with 0dp ("240000" -> "240"), prototype (x / 1e3).toFixed(0). */
export function formatThousands0(n: number): string {
  return (n / 1e3).toFixed(0);
}

/**
 * Format the row's created_at as an ISO date (YYYY-MM-DD, UTC — deterministic,
 * ASCII). The prototype showed a Thai buddhist date from a mock field; the wire
 * only exposes created_at, so the date cell shows that. "" for missing/invalid.
 */
export function formatDate(createdAt: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * The payment-method enum -> a display discriminant (ap.jsx PVCreateForm L253-256
 * uses stable English codes; the list badge, L217-218, colours cheque/transfer
 * one way and everything else neutrally). "" for an unset/unknown method.
 */
export type MethodKey = "cash" | "transfer" | "cheque" | "deposit" | "";

/** Narrow the wire method to a known key (or "" when null/unexpected). */
export function methodKey(method: string): MethodKey {
  switch (method) {
    case "cash":
    case "transfer":
    case "cheque":
    case "deposit":
      return method;
    default:
      return "";
  }
}

/**
 * Method-badge tone (ap.jsx L216-219): cheque -> warn, transfer -> info, else ok
 * (cash / deposit). bg/fg are @juneflow/tokens var() references.
 */
export function methodTone(key: MethodKey): { bg: string; fg: string } {
  switch (key) {
    case "cheque":
      return { bg: "var(--warn-soft)", fg: "var(--warn)" };
    case "transfer":
      return { bg: "var(--info-soft)", fg: "var(--info)" };
    default:
      return { bg: "var(--ok-soft)", fg: "var(--ok)" };
  }
}

/** The four PVCreateForm method options (ap.jsx L253-256): key + icon. */
export interface MethodOption {
  key: Exclude<MethodKey, "">;
  icon: string;
}

/** The fixed method options in prototype order (labels live in pv-strings.json). */
export const METHOD_OPTIONS: readonly MethodOption[] = [
  { key: "cash", icon: "cash" },
  { key: "transfer", icon: "sync" },
  { key: "cheque", icon: "paperclip" },
  { key: "deposit", icon: "ledger" },
];

/** The three KPI numbers the wire can honestly derive (ap.jsx L187-190). */
export interface PvKpis {
  /** Count of PVs awaiting approval (status "pending"). */
  pendingCount: number;
  /** Sum of the wht column, FULL baht. */
  whtTotal: number;
  /** Sum of the (nullable) retention column, FULL baht. */
  retentionTotal: number;
}

/** Compute the derivable KPI numbers from the loaded rows (ap.jsx L187-190). */
export function pvKpis(rows: readonly PvRow[]): PvKpis {
  return {
    pendingCount: rows.filter((r) => r.status === "pending").length,
    whtTotal: rows.reduce((s, r) => s + r.wht, 0),
    retentionTotal: rows.reduce((s, r) => s + (r.retention ?? 0), 0),
  };
}

/** Status-badge tone (ds.jsx STATUS map). Shared shape with billing-rows. */
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
): "draft" | "pending" | "approved" | "rejected" {
  switch (status) {
    case "pending":
      return "pending";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    default:
      return "draft";
  }
}

/* --------------------------------------------------------------------------- */
/* Create-form (POST /ap/pv) helpers                                            */
/* --------------------------------------------------------------------------- */

/**
 * Round to 2dp the way the server does (avoids float dust in the net preview).
 */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Client-side net PREVIEW (ap.jsx L292-303 net-payable box): wht = gross x
 * whtPct / 100, net = gross - wht - retention. This mirrors what the server's
 * tax-engine leg computes (ap.ts createPv net = gross - calcWht(gross, whtPct) -
 * retention); the STORED net is the server's authoritative result — this is only
 * the form's live estimate. Negative inputs clamp to 0.
 */
export interface PvNet {
  gross: number;
  wht: number;
  retention: number;
  net: number;
}

/** Compute the live net preview from the selected billing's figures. */
export function pvNet(gross: number, whtPct: number, retention: number): PvNet {
  const g = gross > 0 ? gross : 0;
  const pct = whtPct > 0 ? whtPct : 0;
  const ret = retention > 0 ? retention : 0;
  const wht = round2((g * pct) / 100);
  return { gross: round2(g), wht, retention: round2(ret), net: round2(g - wht - ret) };
}

/**
 * The gross payable of ONE AP billing — B-315.
 *
 * `amount` is VAT-INCLUSIVE: the row's `vat` is the tax portion CONTAINED IN it,
 * not an addend (every seeded row satisfies vat = amount x 7/107, and ap.jsx's PV
 * net box prints AP-2026-0180 as 645,000 under the label "มูลค่า AP รวม (รวม VAT)"
 * while that billing's vat is 42,196 — excluded). This screen previously previewed
 * `amount + vat`, which double-counted the VAT by 6.54%.
 *
 * PREVIEW ONLY. The server derives the STORED gross from the same billing rows
 * (ap.ts createPv) and ignores anything the client sends — the approval tier, the
 * JV and the bank file all read the SERVER's figure. One helper here so the
 * preview cannot silently drift from the number the server will store.
 */
export function pvGross(billing: { amount: number }): number {
  return round2(billing.amount);
}

/**
 * Derive the WHT rate percent implied by a billing's stored wht amount over its
 * gross (pvGross — the VAT-inclusive `amount`, NOT amount + vat: only that base
 * yields the seeded 3.00%). Used to preview + submit a wht_pct the server re-applies
 * via the tax-engine over its OWN gross — so an inflated base here no longer
 * self-cancels (it would understate the stored WHT). Returns 0 when the gross is 0
 * or the wht is null (honest — no fabricated rate). Rounded to 2dp.
 */
export function impliedWhtPct(wht: number | null, gross: number): number {
  if (wht == null || gross <= 0) return 0;
  return round2((wht / gross) * 100);
}

/** The PVCreateForm draft state — the fields the widened POST /ap/pv body needs. */
export interface PvDraft {
  /** The single selected AP billing id (billing_ids = [this]). */
  billingId: string;
  /**
   * Gross payable PREVIEW (pvGross of the selected billing). B-315: never sent —
   * the server derives the stored gross from billing_ids itself. Kept in the draft
   * because the net box renders it and pvSubmittable gates on it.
   */
  gross: number;
  /** WHT rate percent (derived from the selected billing). */
  whtPct: number;
  /** Retention amount (defaults from the selected billing). */
  retention: number;
  /** Chosen settlement method ("" until picked). */
  method: MethodKey;
  chequeNo: string;
  chequeBank: string;
  chequeDate: string;
}

/** The submit is enabled only when a billing is chosen (ap.ts requires billing_ids). */
export function pvSubmittable(d: PvDraft): boolean {
  return d.billingId.trim() !== "" && d.gross > 0;
}

/**
 * Compose the opaque POST /ap/pv body from the draft. billing_ids is the single
 * chosen AP; method + cheque fields are sent only when present; the server owns
 * status ("pending") + re-derives wht/net via the tax-engine. Never fabricated.
 *
 * B-315 (Wei = ก): `amount` is NOT sent. The server computes the gross from
 * billing_ids and ignores any client value, so a field on the wire that has no
 * effect would only mislead the next reader. d.gross stays a screen-local preview.
 * (The server ignores `amount` regardless of who sends it — that is the security
 * property; dropping it here is the honesty half.) The request body has no
 * `required` list in openapi.yaml and `amount` is optional there, so omitting it
 * needs no contract change.
 */
export function buildPvBody(d: PvDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    billing_ids: [d.billingId.trim()],
    wht_pct: d.whtPct,
    retention: d.retention,
  };
  if (d.method !== "") body.method = d.method;
  if (d.chequeNo.trim() !== "") body.cheque_no = d.chequeNo.trim();
  if (d.chequeBank.trim() !== "") body.cheque_bank = d.chequeBank.trim();
  if (d.chequeDate.trim() !== "") body.cheque_date = d.chequeDate.trim();
  return body;
}
