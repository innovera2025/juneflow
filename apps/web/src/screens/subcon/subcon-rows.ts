/*
 * SubconContracts list-row helpers (subcon.contracts port, gate G3) — pure,
 * i18n-free, ASCII-only logic derived from pototype/subcon-accept.jsx
 * SubconContracts (L72-114) + SubcContractForm (L116-166).
 *
 * PLAN.md section 0 rule 3: the prototype's local SUBC_CONTRACTS mock
 * (denormalised subcon/project/scope strings, inline period arrays, hardcoded
 * money) is dropped — the list is the real server catalogue (GET
 * /subcon-contracts, use-subcon.ts) whose opaque Entity wire is EXACTLY
 * (apps/api/src/routes/subcon.ts contractWire):
 *   { id, no, vendor_id, project_id, value, currency_code, retention_pct, start, end }
 * The subcontractor NAME resolves from vendor_id via GET /vendors; the project
 * NAME resolves from project_id via GET /projects (FK-as-string -> real id join,
 * mirrors po-wo-rows vendorNameById / projectNameById). `value` is money in FULL
 * currency units.
 *
 * WIRE GAPS (reported, never fabricated — see the SubconContracts view header for
 * the full list). The contract wire carries NO po sub-line, NO scope, NO method
 * column (a period's basis lives per-work-period), and NO inline periods (GET
 * /subcon-contracts/{id}/periods is a SEPARATE call) — so the progress bar/percent
 * and the "periods pending review" acceptance badge have no inline source. This
 * module never invents values for them; the view renders an em-dash.
 *
 * nextContractNo generates the wire-forced create `no` (POST /subcon-contracts
 * REQUIRES a non-empty no — subcon.ts; the prototype SubcContractForm has no
 * doc-number field), mirroring boq-rows.nextBoqNo: the next running
 * WO-<year>-#### drawn from the catalogue's existing numbers.
 */

/** A subcon contract as the table consumes it (GET /subcon-contracts row). */
export interface ContractRow {
  id: string;
  no: string;
  /** Subcontractor id (resolved to a vendor name via GET /vendors in the view). */
  vendorId: string;
  /** Owning project id (resolved to a project name via GET /projects in the view). */
  projectId: string;
  /** Contract value in FULL currency units. */
  value: number;
  /** ISO currency code carried with the money value. */
  currencyCode: string;
  /** Retention hold-back rate as a percentage (e.g. 10 = 10%). */
  retentionPct: number;
  /** Contract start marker (opaque wire string; "" when unset). */
  start: string;
  /** Contract end marker (opaque wire string; "" when unset). */
  end: string;
}

/** A vendor option (id -> display name for the list + create picker). */
export interface VendorRef {
  id: string;
  name: string;
}

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

/**
 * Narrow an opaque /subcon-contracts Entity row to the ContractRow the table
 * needs. Multi-word fields accept snake_case (server convention) or camelCase for
 * robustness (mirrors po-wo-rows toWoRow). Missing fields default (0 / "").
 */
export function toContractRow(e: Record<string, unknown>): ContractRow {
  return {
    id: str(e.id),
    no: str(e.no),
    vendorId: str(e.vendor_id ?? e.vendorId),
    projectId: str(e.project_id ?? e.projectId),
    value: num(e.value),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    retentionPct: num(e.retention_pct ?? e.retentionPct),
    start: str(e.start),
    end: str(e.end),
  };
}

/** Narrow an opaque /vendors Entity row to a VendorRef (id -> name). */
export function toVendorRef(e: Record<string, unknown>): VendorRef {
  return { id: str(e.id), name: str(e.name) };
}

/* --------------------------------------------------------------------------- */
/* KPI aggregates (subcon-accept.jsx SubconContracts L73/80-81)                 */
/* --------------------------------------------------------------------------- */

/** KPI-1 "active contracts" — the real row count (SUBC_CONTRACTS.length). */
export function contractCount(rows: readonly ContractRow[]): number {
  return rows.length;
}

/** KPI-2 "total value" — the real sum of every contract value (FULL units). */
export function totalValue(rows: readonly ContractRow[]): number {
  return rows.reduce((s, r) => s + r.value, 0);
}

/* --------------------------------------------------------------------------- */
/* id -> display resolvers (real FK joins, never a raw UUID leak)              */
/* --------------------------------------------------------------------------- */

/** Build an id -> vendor-name map from VendorRefs (list subcon column + picker). */
export function vendorNameById(vendors: readonly VendorRef[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of vendors ?? []) if (v.id) map.set(v.id, v.name);
  return map;
}

/** Build an id -> name map from /projects rows (list project sub-line). */
export function projectNameById(
  projects: readonly { id: string; name: string }[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of projects ?? []) if (p.id) map.set(p.id, p.name);
  return map;
}

/* --------------------------------------------------------------------------- */
/* formatting + wire-forced create no                                          */
/* --------------------------------------------------------------------------- */

/**
 * Group a FULL-unit amount with thousands separators ("2150000" -> "2,150,000"),
 * matching the prototype's Intl fmt (ds.jsx, th-TH maximumFractionDigits 0).
 * ASCII digits + comma only; NaN / non-finite -> "0". Mirrors po-wo-rows formatMoney.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** KPI "value in millions" ((total/1e6).toFixed(2)), mirrors po-wo-rows millionsValue. */
export function millionsValue(totalUnits: number): string {
  return (totalUnits / 1e6).toFixed(2);
}

/**
 * The next running WO document number for the create body (POST /subcon-contracts
 * REQUIRES a non-empty `no`; the prototype form has no doc-number field, so this
 * is generated). Mirrors boq-rows.nextBoqNo: count the WO-<year>-#### numbers
 * already in the catalogue, take the next, and skip any collision. The prototype's
 * contract numbers are 4-digit (subcon-accept.jsx "WO-2026-0042").
 */
export function nextContractNo(
  existingNos: readonly string[],
  year: number = new Date().getFullYear(),
): string {
  const taken = new Set(existingNos);
  const prefix = "WO-" + year + "-";
  const seq = new RegExp("^WO-" + year + "-\\d{4}$");
  let n = existingNos.filter((no) => seq.test(no)).length + 1;
  let cand = prefix + String(n).padStart(4, "0");
  while (taken.has(cand)) {
    n += 1;
    cand = prefix + String(n).padStart(4, "0");
  }
  return cand;
}
