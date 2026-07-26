/*
 * Retention register row helpers (ap.retention) — pure, i18n-free, ASCII-only logic ported from
 * pototype/accounting-extra2.jsx APRetention (L20-104).
 *
 * The prototype held the register in a local RETENTION_SEED (L6-11) with a rich
 * {wo, vendor, scope, contract, rate, withheld, returned, due, status} shape. Section-0 rule 3:
 * that seed is DROPPED — the list is the real server register (GET /retention, apps/api/src/routes/
 * retention.ts registerWire). The opaque Entity row (snake_case) is:
 *   { id, wo_id, vendor_id, contract_id, scope, rate:number|null, withheld:number, returned:number,
 *     currency_code, created_at, vendor_name:string|null, contract_value:number|null,
 *     remaining:number, due_date:string|null, days_until_due:number|null, status }
 * where remaining is SERVER-computed (round2(withheld - returned)), due_date is DERIVED
 * (dueDate ?? created_at + 12 months, B-125), and status is the DERIVED display status.
 *
 * HONEST GAPS (never fabricated) — see ap-retention.tsx for the screen-level notes:
 *   - wo_id is a UUID (no human WO number on the wire) -> the contract/vendor cell shows the vendor
 *     name only; the WO number em-dashes.
 *   - vendor_name / contract_value are JOINED (nullable) -> em-dash an unresolved id.
 *   - remaining is the SERVER outstanding (never a client subtraction here for display authority);
 *     bal() is re-derived only for the pure releasable/settled predicates and mirrors the server.
 *
 * MONEY AUTHORITY (B-131 / gate-4.5): the release amount is SERVER-computed. releaseAmount() reads
 * ONLY the server response `amount` (never a client calculation). No function here invents a money
 * figure. ASCII-only, no Thai/baht (B-073) — the screen paints colours from @juneflow/tokens.
 */

/** The prototype-facing display status (retention.ts deriveStatus). 'withholding' is never emitted
 *  by the current server (folded into 'holding') but is mapped for forward-compat. */
export type RetStatus =
  | "withholding"
  | "holding"
  | "due"
  | "partial"
  | "done"
  | string;

/** A retention register entry as the list consumes it (GET /retention row, narrowed). */
export interface RetentionRow {
  id: string;
  /** Work-order UUID (no human number on the wire -> the WO number cell em-dashes). */
  woId: string;
  vendorId: string;
  /** JOINED vendor name ("" when null/unresolved -> em-dash). */
  vendorName: string;
  /** JOINED subcon-contract value (null when unresolved). No table column keys this today. */
  contractValue: number | null;
  /** Retention rate percent (null when absent). No table column keys this today. */
  rate: number | null;
  /** Cumulative amount withheld (stored). */
  withheld: number;
  /** Amount already returned (stored). */
  returned: number;
  /** SERVER-computed outstanding = round2(withheld - returned). */
  remaining: number;
  /** Currency of the money columns ("" when absent). */
  currencyCode: string;
  /** DERIVED due date as 'YYYY-MM-DD' ("" when null/invalid -> em-dash). */
  dueDate: string;
  /** DERIVED display status. */
  status: RetStatus;
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

/** Read a finite number off an opaque row, else null (honest gap — never a fabricated 0). */
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Narrow an opaque /retention Entity row to the RetentionRow the register needs. */
export function toRetentionRow(e: Record<string, unknown>): RetentionRow {
  return {
    id: str(e.id),
    woId: str(e.wo_id ?? e.woId),
    vendorId: str(e.vendor_id ?? e.vendorId),
    vendorName: str(e.vendor_name ?? e.vendorName),
    contractValue: numOrNull(e.contract_value ?? e.contractValue),
    rate: numOrNull(e.rate),
    withheld: num(e.withheld),
    returned: num(e.returned),
    remaining: num(e.remaining),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    dueDate: formatDueDate(str(e.due_date ?? e.dueDate)),
    status: str(e.status),
  };
}

/**
 * Group a money amount with thousands separators ("1000000" -> "1,000,000"), ASCII digits + comma
 * only (no baht symbol / decimals — the baht glyph is an i18n key on the screen); non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A money magnitude in millions, fixed to 2 decimals ("2240000" -> "2.24") — the prototype's
 * `(sum / 1e6).toFixed(2)` for the mixed-scale KPIs (accounting-extra2.jsx L44/L46: held + withheld
 * are shown in millions). The unit label ("million baht") is an i18n key on the screen (pm.unitMillion,
 * cross-module reuse). Non-finite -> "0.00".
 */
export function millionsValue(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return (n / 1e6).toFixed(2);
}

/**
 * The wire due_date is already an ISO 'YYYY-MM-DD' (retention.ts isoDate). Validate + pass it
 * through; return "" for a missing/invalid value (the cell em-dashes). The prototype's Thai month
 * label came from a mock `due` field and is not reproduced (§0 rule 3 — no fabricated locale).
 */
export function formatDueDate(dueDate: string): string {
  if (!dueDate) return "";
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return "";
  return dueDate;
}

/** Sum the SERVER outstanding across rows (KPI: retention still held). */
export function sumRemaining(rows: readonly RetentionRow[]): number {
  return rows.reduce((s, r) => s + r.remaining, 0);
}

/** Sum the cumulative withheld across rows (KPI + table footer). */
export function sumWithheld(rows: readonly RetentionRow[]): number {
  return rows.reduce((s, r) => s + r.withheld, 0);
}

/** Sum the returned across rows (KPI + table footer). */
export function sumReturned(rows: readonly RetentionRow[]): number {
  return rows.reduce((s, r) => s + r.returned, 0);
}

/** Contract count = the number of register rows (KPI sub + footer). */
export function contractCount(rows: readonly RetentionRow[]): number {
  return rows.length;
}

/** Count of rows whose DERIVED status is 'due' (KPI: past the warranty period). */
export function dueCount(rows: readonly RetentionRow[]): number {
  return rows.filter((r) => r.status === "due").length;
}

/** StatusBadge tone discriminant (ds.jsx StatusBadge `status` prop set). */
export type StatusTone = "pending" | "draft" | "rejected" | "approved" | "neutral";

/**
 * Badge discriminant + tone for a derived status. `badge` maps to the label i18n key in the .tsx
 * (withholding -> stWithholding ... done -> stDone). Tones mirror the prototype RET_ST.s values
 * (withholding/partial -> pending, holding -> draft, due -> rejected, done -> approved); an
 * unrecognised status is neutral surface.
 */
export interface StatusMeta {
  badge: "withholding" | "holding" | "due" | "partial" | "done" | "other";
  tone: StatusTone;
}

export function statusMeta(status: RetStatus): StatusMeta {
  switch (status) {
    case "withholding":
      return { badge: "withholding", tone: "pending" };
    case "holding":
      return { badge: "holding", tone: "draft" };
    case "due":
      return { badge: "due", tone: "rejected" };
    case "partial":
      return { badge: "partial", tone: "pending" };
    case "done":
      return { badge: "done", tone: "approved" };
    default:
      return { badge: "other", tone: "neutral" };
  }
}

/**
 * Releasable predicate (prototype: bal(r) > 0 && (status 'due' || 'partial') -> show the return
 * button). Mirrors the prototype visibility; the SERVER remains the authority on whether a release
 * succeeds (held + due gate) — a rejected release surfaces its error honestly on screen.
 */
export function isReleasable(row: RetentionRow): boolean {
  return row.remaining > 0 && (row.status === "due" || row.status === "partial");
}

/** Settled predicate (prototype bal(r) === 0 -> the "complete" indicator). */
export function isSettled(row: RetentionRow): boolean {
  return row.remaining <= 0;
}

/**
 * Read the SERVER-authoritative release amount off the POST /retention/release response
 * ({ id, jv_no, amount, status }). MONEY AUTHORITY (B-131): the toast amount is this value, NEVER a
 * client calculation. Tolerates a future `{ data: {...} }` envelope. Returns null when absent /
 * non-finite (the caller em-dashes rather than fabricating a figure).
 */
export function releaseAmount(res: unknown): number | null {
  if (res == null || typeof res !== "object") return null;
  const obj = res as Record<string, unknown>;
  const src =
    obj.data != null && typeof obj.data === "object"
      ? (obj.data as Record<string, unknown>)
      : obj;
  const v = src.amount;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
