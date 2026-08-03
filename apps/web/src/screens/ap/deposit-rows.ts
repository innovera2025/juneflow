/*
 * AP vendor-deposit row + form helpers for APDeposit (ap.jsx APDeposit L388-448 +
 * APDepositForm L452-483) — pure, i18n-free, ASCII-only logic (B-073).
 *
 * The prototype held the register in a local array (ap.jsx L420-425) with hardcoded
 * money + denormalised display strings. Juneflow §0 rule 3: that mock seed is dropped
 * — the list is the real server catalogue (GET /ap/deposit, apps/api/src/routes/
 * ap-deposit.ts listRegister) of opaque Entity rows narrowed here. The wire carries
 * { id, no, vendor_id, po_id, wo_id, reason, pct, amount, used, currency_code,
 * status, created_at, vendor_name, ref, balance }.
 *
 * MONEY = SERVER AUTHORITY. `balance` is SERVER-computed (amount - used, ap-deposit.ts
 * L219) and read straight off the wire here — never recomputed as an independent money
 * decision. The create form sends only ids + the user-typed `amount` (and the label
 * `pct`); the server owns the posted JV + the stored amount, and re-validates.
 *
 * HONEST GAPS the screen em-dashes (never fabricated):
 *   - `vendor_name` / `ref` are server JOINs — null when the ref is null / the seed
 *     dropped the joined `no` -> em-dash, not an invented value.
 *   - `reason` is nullable (the create form has no reason input) -> em-dash.
 *   - `balance === 0` renders an em-dash (prototype L433) even though the wire sends 0.
 * The 3 KPI numbers are REAL derivations off the loaded rows (balance / used / amount /
 * created_at) — never the prototype's mock literals (ap.jsx L401-403 divergence #1).
 * The cleared/outstanding badge is DERIVED client-side from balance === 0 (the wire
 * never ships a Thai UI string). Every colour is an @juneflow/tokens var().
 */

/** A vendor deposit as the register table consumes it (GET /ap/deposit row, narrowed). */
export interface DepositRow {
  id: string;
  /** Server-allocated doc number (DP-YYYY-NNNN); "" only if unexpectedly absent. */
  no: string;
  vendorId: string;
  /** Resolved vendor name (server join); "" when absent -> em-dash. */
  vendorName: string;
  poId: string;
  woId: string;
  /** Free-text deposit reason; "" when absent -> em-dash. */
  reason: string;
  /** Resolved po.no / wo.no reference (server join); "" when absent -> em-dash. */
  ref: string;
  /** Stored deposit percentage LABEL (never drives amount), or null. */
  pct: number | null;
  /** Deposit amount (FULL baht, server system of record). */
  amount: number;
  /** Amount already offset against billings (FULL baht; 0 when none). */
  used: number;
  /** Outstanding = amount - used, SERVER-computed (read off the wire, never recomputed). */
  balance: number;
  currencyCode: string;
  /** Lifecycle status (server-owned; "approved" on create). */
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

/** Read a nullable numeric field (pct): null stays null, else coerced (invalid -> null). */
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Narrow an opaque /ap/deposit Entity row to the DepositRow the register needs. */
export function toDepositRow(e: Record<string, unknown>): DepositRow {
  return {
    id: str(e.id),
    no: str(e.no),
    vendorId: str(e.vendor_id ?? e.vendorId),
    vendorName: str(e.vendor_name ?? e.vendorName),
    poId: str(e.po_id ?? e.poId),
    woId: str(e.wo_id ?? e.woId),
    reason: str(e.reason),
    ref: str(e.ref),
    pct: numOrNull(e.pct),
    amount: num(e.amount),
    used: num(e.used),
    // SERVER-computed (amount - used) — read off the wire, not recomputed here.
    balance: num(e.balance),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    status: str(e.status),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/**
 * Group a FULL-baht amount with thousands separators ("380400" -> "380,400"),
 * matching the prototype's fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits
 * + comma only (no baht symbol / decimals); non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Millions with 2dp ("1860000" -> "1.86"), prototype fmtM (ap.jsx L37). */
export function formatMillions(n: number): string {
  return (n / 1e6).toFixed(2);
}

/** The 3 KPI-card numbers (ap.jsx L401-403), all derived from the loaded rows. */
export interface DepositKpis {
  /** Outstanding-deposits KPI: count of rows still outstanding (balance > 0). */
  outstandingCount: number;
  /** Sum of those rows' balance (FULL baht). */
  outstandingSum: number;
  /** Offset KPI: count of rows with any offset (used > 0). No per-offset date on the
   *  wire, so this is offset-to-date off the loaded rows, not month-scoped (div #1). */
  offsetCount: number;
  /** Sum of used across the loaded rows (FULL baht). */
  offsetSum: number;
  /** Deposit-YTD KPI: count of rows created in `year`. */
  ytdCount: number;
  /** Sum of those rows' amount (FULL baht). */
  ytdSum: number;
}

/** The UTC calendar year of an ISO timestamp, or NaN when unparseable. */
function createdYear(iso: string): number {
  if (!iso) return Number.NaN;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Number.NaN;
  return new Date(t).getUTCFullYear();
}

/**
 * Compute the 3 KPI-card numbers from the loaded rows (ap.jsx L401-403). YTD is
 * scoped to `year` (defaults to the current calendar year) so the function stays pure
 * + unit-testable. Never re-prints the prototype's mock literals (divergence #1).
 */
export function depositKpis(
  rows: readonly DepositRow[],
  year: number = new Date().getFullYear(),
): DepositKpis {
  const outstanding = rows.filter((r) => r.balance > 0);
  const offset = rows.filter((r) => r.used > 0);
  const ytd = rows.filter((r) => createdYear(r.createdAt) === year);
  return {
    outstandingCount: outstanding.length,
    outstandingSum: outstanding.reduce((s, r) => s + r.balance, 0),
    offsetCount: offset.length,
    offsetSum: offset.reduce((s, r) => s + r.used, 0),
    ytdCount: ytd.length,
    ytdSum: ytd.reduce((s, r) => s + r.amount, 0),
  };
}

/**
 * The register status badge (ap.jsx L439) — DERIVED client-side from balance, binary:
 * balance === 0 -> "cleared", else "outstanding". The wire never ships the Thai UI
 * string (ap-deposit.ts L45-49).
 */
export type DepositStatusKind = "cleared" | "outstanding";

/** Which badge a row shows, from its SERVER-computed balance. */
export function depositStatusKind(balance: number): DepositStatusKind {
  return balance === 0 ? "cleared" : "outstanding";
}

/** Token bg/fg for the badge (ap.jsx L437-438 inline ternary). */
export function depositStatusTone(balance: number): { bg: string; fg: string } {
  return balance === 0
    ? { bg: "var(--ok-soft)", fg: "var(--ok)" }
    : { bg: "var(--warn-soft)", fg: "var(--warn)" };
}

/* --------------------------------------------------------------------------- */
/* Create-form (POST /ap/deposit) helpers                                       */
/* --------------------------------------------------------------------------- */

/**
 * The APDepositForm draft state (ap.jsx L452-483). Only the fields that map to the
 * POST /ap/deposit body are collected: vendor_id + amount are required; po_id / wo_id
 * (a single ref selection) + pct are optional. The prototype fields with no create-body
 * counterpart are NOT collected (billing-form precedent — drop rather than fabricate):
 * the doc-number field (server-allocated DP-no, readOnly auto) + the date field
 * (server owns created_at). `reason` has no form input in the prototype either.
 */
export interface DepositDraft {
  vendorId: string;
  /** The single PO/WO reference selection, encoded "" | "po:<id>" | "wo:<id>". */
  refSel: string;
  /** Raw digit inputs (parsed on submit); pct is a stored LABEL, never a multiplier. */
  pct: string;
  amount: string;
}

/** A blank deposit draft. */
export function emptyDepositDraft(): DepositDraft {
  return { vendorId: "", refSel: "", pct: "", amount: "" };
}

/** Parse a raw money input to a non-negative finite number (blank/invalid -> 0). */
export function parseMoney(raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Submit is enabled only when a vendor is chosen AND amount > 0 (ap-deposit.ts guard). */
export function depositSubmittable(d: DepositDraft): boolean {
  return d.vendorId.trim() !== "" && parseMoney(d.amount) > 0;
}

/**
 * Decode the single ref selection into the POST body's po_id / wo_id (mutually
 * exclusive). An empty / malformed selection contributes nothing (the row's ref then
 * honestly em-dashes — divergence #5b).
 */
export function decodeRef(refSel: string): { po_id?: string; wo_id?: string } {
  const s = refSel.trim();
  if (s.startsWith("po:")) {
    const id = s.slice(3).trim();
    return id ? { po_id: id } : {};
  }
  if (s.startsWith("wo:")) {
    const id = s.slice(3).trim();
    return id ? { wo_id: id } : {};
  }
  return {};
}

/**
 * Compose the opaque POST /ap/deposit body from the draft ({ vendor_id, amount,
 * po_id? | wo_id?, pct? }). Only present optionals are sent; pct is a stored label
 * (integer, never drives amount); the server owns the doc number, balance + the JV.
 */
export function buildDepositBody(d: DepositDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    vendor_id: d.vendorId.trim(),
    amount: parseMoney(d.amount),
  };
  const pct = d.pct.trim();
  if (pct !== "") {
    const n = Number.parseInt(pct, 10);
    if (Number.isFinite(n)) body.pct = n;
  }
  Object.assign(body, decodeRef(d.refSel));
  return body;
}
