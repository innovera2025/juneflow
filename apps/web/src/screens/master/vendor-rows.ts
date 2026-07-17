/*
 * vendor-rows — pure, i18n-free, ASCII-only row logic for MasterVendor (P2-WEB-01),
 * ported 1:1 from pototype/master-party.jsx MasterVendor (L56-135) + VendorForm (L137-183).
 *
 * The prototype held vendors in local state (VENDOR_SEED + setRows) whose `type` was a
 * 4-way Thai badge and whose `spend` was a per-vendor purchase total. §0 rule 3: that mock
 * seed is dropped — the list is the real server catalogue (GET /vendors, use-vendors.ts) of
 * opaque Entity rows {id, name, code, tax_id, kind, credit_term, addr, bank, status}, narrowed
 * here. Two schema realities (B-070 / B-071) are isolated in this module so they can be
 * unit-tested (gate G3):
 *
 *   - TYPE is display-derived from `kind` (B-070). The DB is 2-way (supplier | subcon); the
 *     prototype's 4-way badge (material / service / land -> supplier, contractor -> subcon) is
 *     a WEB display concern with no finer source, so displayType() collapses kind to its
 *     representative discriminant: subcon -> "contractor", supplier -> "material". The
 *     "service"/"land" discriminants exist (the prototype's filter tabs + form type buttons
 *     render them, design fidelity) but no wire row derives to them — an honest consequence
 *     of the 2-way schema, not a screen defect. typeToKind() is the inverse the form uses
 *     before POST/PUT (service/land/material -> supplier, contractor -> subcon).
 *   - SPEND has NO wire field: the per-vendor purchase total has no AP source yet (B-071
 *     honest gap), so the screen renders an em-dash for the spend column (vendor.thSpend) and
 *     the cumulative-spend KPI (vendor.kpiSpend). This module carries no spend at all — it is
 *     never fabricated.
 *
 * credit_term is an integer of DAYS on the wire (or null). creditTermKey() maps the closed
 * set the VendorForm dropdown can produce (0 = cash, 15/30/45/60 = day counts, null / any
 * other integer = "none" -> em-dash) to a discriminant the screen resolves to an i18n key.
 */

/** vendor.status closed set the handler enforces (VendorForm dropdown, master-party.jsx:175). */
export type VendorStatus = "active" | "inactive";

/** vendor_kind enum on the wire (project.ts). */
export type VendorKind = "supplier" | "subcon";

/**
 * The prototype's 4-way type discriminant (master-party.jsx:14 VEN_TYPES). Derived from the
 * 2-way `kind` for display; only "material"/"contractor" are ever produced from wire data.
 */
export type VendorTypeKey = "material" | "contractor" | "service" | "land";

/** credit_term (days) -> a display discriminant the screen resolves to an i18n key. */
export type CreditTermKey = "cash" | "d15" | "d30" | "d45" | "d60" | "none";

/** A vendor as the table consumes it (GET /vendors row, narrowed from the opaque Entity). */
export interface VendorRow {
  id: string;
  name: string;
  /** Display code ("V-00xx") — nullable free text on the wire ("" when absent). */
  code: string;
  /** Tax id — nullable free text ("" when absent). */
  taxId: string;
  /** vendor_kind enum (supplier | subcon); "" when an unexpected value arrives. */
  kind: string;
  /** Payment credit term in DAYS, or null (no term / not day-representable). */
  creditTerm: number | null;
  /** Registered-address display string ("" when absent). */
  addr: string;
  /** Bank-account display string ("" when absent). */
  bank: string;
  /** active | inactive (closed set); "" when an unexpected value arrives. */
  status: string;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * Read credit_term (days) off an opaque row: a finite number stays, a numeric string is
 * parsed, anything else (null / absent / blank / non-numeric) -> null. Never invents a day
 * count (matches the backend's honest null, vendors.ts toCreditTerm).
 */
function daysOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Narrow an opaque /vendors Entity row to the VendorRow the table needs. Multi-word fields
 * accept snake_case (server convention) or camelCase for robustness — mirrors cc-rows.ts.
 */
export function toVendorRow(e: Record<string, unknown>): VendorRow {
  return {
    id: str(e.id),
    name: str(e.name),
    code: str(e.code),
    taxId: str(e.tax_id ?? e.taxId),
    kind: str(e.kind),
    creditTerm: daysOrNull(e.credit_term ?? e.creditTerm),
    addr: str(e.addr),
    bank: str(e.bank),
    status: str(e.status),
  };
}

/**
 * Display-derive the 4-way type badge from the 2-way `kind` (B-070). subcon -> "contractor",
 * everything else (supplier) -> "material". "service"/"land" are never produced from wire
 * data — the schema cannot distinguish them within `supplier`.
 */
export function displayType(kind: string): VendorTypeKey {
  return kind === "subcon" ? "contractor" : "material";
}

/**
 * Inverse of displayType for the VendorForm write path (B-070): the 4-way form selection is
 * mapped back to the 2-way `kind` before POST/PUT. contractor -> subcon; material / service /
 * land all -> supplier (the schema has no finer supplier sub-type).
 */
export function typeToKind(type: VendorTypeKey): VendorKind {
  return type === "contractor" ? "subcon" : "supplier";
}

/**
 * Search predicate, verbatim master-party.jsx:62: case-insensitive substring over
 * code + name + taxId.
 */
export function matchesSearch(row: VendorRow, q: string): boolean {
  if (!q) return true;
  return (row.code + row.name + row.taxId).toLowerCase().includes(q.toLowerCase());
}

/**
 * Table list (master-party.jsx:61-65): search filter AND type filter. An empty typeFilter
 * ("" = the "all" tab) keeps every row; otherwise the row's display-derived type must
 * equal the selected discriminant.
 */
export function filterVendors(
  rows: readonly VendorRow[],
  q: string,
  typeFilter: VendorTypeKey | "",
): VendorRow[] {
  return rows.filter(
    (v) => matchesSearch(v, q) && (typeFilter === "" || displayType(v.kind) === typeFilter),
  );
}

/** Count rows whose display-derived type equals `type` (filter-tab badge counts). */
export function typeCount(rows: readonly VendorRow[], type: VendorTypeKey): number {
  return rows.filter((v) => displayType(v.kind) === type).length;
}

/** The four KPI-card numbers (master-party.jsx:83-86). Spend is deliberately absent (B-071). */
export interface VendorStats {
  /** Total rows (vendor.kpiTotal). */
  total: number;
  /** Active count (vendor.kpiSubActive sub-line). */
  active: number;
  /** Rows whose derived type is material or contractor (vendor.kpiMaterialContractor). */
  materialOrContractor: number;
  /** Inactive count (vendor.kpiInactive). */
  inactive: number;
}

/** Compute the KPI-card numbers from the loaded rows (master-party.jsx:83-86). */
export function vendorStats(rows: readonly VendorRow[]): VendorStats {
  return {
    total: rows.length,
    active: rows.filter((v) => v.status === "active").length,
    materialOrContractor: rows.filter((v) => {
      const t = displayType(v.kind);
      return t === "material" || t === "contractor";
    }).length,
    inactive: rows.filter((v) => v.status === "inactive").length,
  };
}

/**
 * Map credit_term (days) to a display discriminant. 0 = cash, 15/30/45/60 = day counts,
 * null / any other integer = "none" (the screen renders the literal em-dash "—"). The set
 * mirrors the VendorForm dropdown options (master-party.jsx:170).
 */
export function creditTermKey(days: number | null): CreditTermKey {
  switch (days) {
    case 0:
      return "cash";
    case 15:
      return "d15";
    case 30:
      return "d30";
    case 45:
      return "d45";
    case 60:
      return "d60";
    default:
      return "none";
  }
}

/**
 * Status-badge tone (ds.jsx STATUS map, read by the prototype's <StatusBadge status={active
 * ? "approved" : "draft"}>). active -> approved (ok) tone; inactive -> draft tone. bg/fg are
 * @juneflow/tokens var() references; `dot` is the prototype-verbatim STATUS dot hex (no
 * matching token, B-037(a)) — same values as cc-rows.ts statusTone.
 */
export function statusTone(status: string): { bg: string; fg: string; dot: string } {
  if (status === "active") {
    return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
  }
  return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
}

/** Sub-line under the vendor name (master-party.jsx:111): "addr · bank", omitting blanks. */
export function addrBankLine(addr: string, bank: string): string {
  return [addr, bank].filter((s) => s.trim() !== "").join(" · ");
}
