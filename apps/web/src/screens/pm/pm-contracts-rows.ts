/*
 * PMContracts list-row helpers (pm.contracts port, gate G3) — pure, i18n-free,
 * ASCII-only logic derived from pototype/pm2.jsx PMContracts (L8-100) +
 * PMContractForm (L372-492) and pototype/pm.jsx PM_CONTRACTS / PMC_STATUS
 * (L61-71).
 *
 * PLAN.md §0 rule 3 + Wei ruling B-136 (LEAN): the prototype's local
 * PM_CONTRACTS mock (denormalised project/customer/scope strings, hardcoded
 * status/no, Thai display dates) is dropped — the list is the real server
 * catalogue (GET /pm/contracts, use-pm.ts) whose opaque Entity wire is EXACTLY
 * (apps/api/src/routes/pm.ts contractWire):
 *   { id, project_id, customer_id, mode('MA'|'per_visit'), visits_per_year, sla,
 *     value, currency_code, end }
 * `value` is money in FULL currency units; `end` is a real ISO date column
 * (packages/db schema/pm.ts `date("end")`). The customer NAME resolves from
 * customer_id via GET /customers; the project NAME from project_id via GET
 * /projects (FK-as-string -> real id join, mirrors subcon-rows).
 *
 * DERIVED STATUS (B-136). The prototype's `status` is a hardcoded mock field
 * with NO wire column (pm.ts header: "status are NOT columns and are not
 * fabricated"). Instead this module DERIVES the status honestly from the real
 * `end` date (statusFromEnd): expired when end < today, expiring within the
 * 60-day near-expiry window (matches the prototype's KPI sub "within 60 days",
 * pm2.jsx L37), active otherwise. An absent/unparseable end has NO basis -> the
 * view renders an em-dash badge (never a fabricated status).
 *
 * WIRE GAPS (reported, never fabricated). The contract wire carries NO contract
 * `no`, NO scope, NO site, NO cycle-label, NO start date — the view renders an
 * em-dash for each. This module never invents values for them.
 */

/** A PM contract as the table consumes it (GET /pm/contracts row). */
export interface PmContractRow {
  id: string;
  /** Owning project id (resolved to a project name via GET /projects). */
  projectId: string;
  /** Customer id (resolved to a customer name via GET /customers; "" when unset). */
  customerId: string;
  /** Service mode — "MA" (on-call SLA) or "per_visit" (scheduled); "" when unset. */
  mode: string;
  /** Scheduled visits per year (per_visit); null when absent (em-dash). */
  visitsPerYear: number | null;
  /** SLA response marker (opaque wire string; "" when unset -> em-dash). */
  sla: string;
  /** Contract value / year in FULL currency units. */
  value: number;
  /** ISO currency code carried with the money value. */
  currencyCode: string;
  /** Contract end date (ISO "YYYY-MM-DD"; "" when unset). Drives statusFromEnd. */
  end: string;
}

/** A named reference (id -> display name) for the customer / project resolvers. */
export interface NamedRef {
  id: string;
  name: string;
}

/** Derived contract status from the real end date (never a wire column). */
export type PmcStatus = "active" | "expiring" | "expired";

/** Near-expiry window in days (pm2.jsx PMContracts KPI sub "within 60 days"). */
export const EXPIRING_WINDOW_DAYS = 60;

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
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

/** Read an integer field, or null when the field is absent/blank/invalid (em-dash). */
function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Narrow an opaque /pm/contracts Entity row to the PmContractRow the table needs.
 * Multi-word fields accept snake_case (server convention) or camelCase for
 * robustness (mirrors subcon-rows toContractRow). Missing fields default
 * (0 / "" / null).
 */
export function toPmContractRow(e: Record<string, unknown>): PmContractRow {
  return {
    id: str(e.id),
    projectId: str(e.project_id ?? e.projectId),
    customerId: str(e.customer_id ?? e.customerId),
    mode: str(e.mode),
    visitsPerYear: intOrNull(e.visits_per_year ?? e.visitsPerYear),
    sla: str(e.sla),
    value: num(e.value),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    end: str(e.end),
  };
}

/** Narrow an opaque /customers Entity row to a NamedRef (id -> name). */
export function toCustomerRef(e: Record<string, unknown>): NamedRef {
  return { id: str(e.id), name: str(e.name) };
}

/* --------------------------------------------------------------------------- */
/* status derivation (B-136 — honest, from the real `end` date)              */
/* --------------------------------------------------------------------------- */

/** Parse a leading ISO date ("YYYY-MM-DD…") to its Y/M/D parts, or null. */
function parseIsoDate(s: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * Derive the contract status from its real `end` date (B-136):
 *   - "expired"  when end is strictly before today,
 *   - "expiring" when end is within EXPIRING_WINDOW_DAYS from today (inclusive),
 *   - "active"   otherwise.
 * An empty / unparseable end has no basis -> null (the view renders an em-dash;
 * a fabricated status is never returned). `today` is injectable for tests.
 */
export function statusFromEnd(end: string, today: Date = new Date()): PmcStatus | null {
  const parsed = parseIsoDate(end);
  if (!parsed) return null;
  const endUtc = Date.UTC(parsed.y, parsed.m - 1, parsed.d);
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.floor((endUtc - todayUtc) / 86_400_000);
  if (days < 0) return "expired";
  if (days <= EXPIRING_WINDOW_DAYS) return "expiring";
  return "active";
}

/* --------------------------------------------------------------------------- */
/* KPI aggregates (pm2.jsx PMContracts L10/36-38)                               */
/* --------------------------------------------------------------------------- */

/** Total contract count — the real row length (pm2.jsx `list.length`). */
export function contractCount(rows: readonly PmContractRow[]): number {
  return rows.length;
}

/** Σ value/year — the real sum of every contract value in FULL units (pm2.jsx `totalValue`). */
export function totalValue(rows: readonly PmContractRow[]): number {
  return rows.reduce((s, r) => s + r.value, 0);
}

/** Active-contract count — derived status === "active" (pm2.jsx filter status active). */
export function activeCount(rows: readonly PmContractRow[], today: Date = new Date()): number {
  return rows.filter((r) => statusFromEnd(r.end, today) === "active").length;
}

/** Near-expiry count — derived status === "expiring" (pm2.jsx filter status expiring). */
export function expiringCount(rows: readonly PmContractRow[], today: Date = new Date()): number {
  return rows.filter((r) => statusFromEnd(r.end, today) === "expiring").length;
}

/* --------------------------------------------------------------------------- */
/* id -> display resolvers (real FK joins, never a raw UUID leak)              */
/* --------------------------------------------------------------------------- */

/** Build an id -> name map from NamedRefs, skipping id-less rows (customer column). */
export function customerNameById(refs: readonly NamedRef[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of refs ?? []) if (r.id) map.set(r.id, r.name);
  return map;
}

/** Build an id -> name map from /projects rows (project column). */
export function projectNameById(
  projects: readonly { id: string; name: string }[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of projects ?? []) if (p.id) map.set(p.id, p.name);
  return map;
}

/* --------------------------------------------------------------------------- */
/* formatting                                                                  */
/* --------------------------------------------------------------------------- */

/**
 * Group a FULL-unit amount with thousands separators ("144000" -> "144,000"),
 * matching the prototype's Intl fmt (ds.jsx, th-TH maximumFractionDigits 0).
 * ASCII digits + comma only; NaN / non-finite -> "0". Mirrors subcon-rows formatMoney.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** KPI "value in millions" ((total/1e6).toFixed(2)), mirrors pm2.jsx `(totalValue/1e6).toFixed(2)`. */
export function millionsValue(totalUnits: number): string {
  return (totalUnits / 1e6).toFixed(2);
}
