/*
 * Fixed Asset Register row helpers (fa.register) — pure, i18n-free, ASCII-only logic ported
 * from pototype/fa.jsx FARegister (L24-141). Mirrors gl-inbox-rows.ts / po-wo-rows.ts.
 *
 * The prototype held the register in a local ASSETS array (fa.jsx L3-12). Section-0 rule 3: that
 * mock seed is dropped — the list is the real server catalogue (GET /fa/assets, apps/api/src/
 * routes/fa.ts assetWire). The migration-0035 superset wire row (opaque Entity, snake_case) is:
 *   { id, name, cost, currency_code, life_years: number|null, cc_id: string|null,
 *     depr_method: string|null, salvage, acquired_date: string|null, accumulated_depr,
 *     status, book_value } — book_value is DERIVED server-side (cost - accumulated_depr).
 *
 * HONEST DATA GAPS (never fabricated) — the fixed_asset table (finance.ts) carries NO
 * category, NO location, and NO human asset "code" column:
 *   - the prototype's `code` (FA-0001) column has no wire field -> the code cell em-dashes.
 *   - the prototype's `cat` (category) column has no wire field -> the category cell em-dashes,
 *     and the category tabs (land/veh/mach) can never match a row -> they render 0 / empty.
 *   - the prototype's `loc` (location) column has no wire field -> the location cell em-dashes.
 *   - `age` is the real life_years (the fa.lifeYears "{n} yr" template); accumulated_depr / book_value / cost are real; the
 *     status column maps the raw wire status to the active/writeoff badge.
 *
 * Every colour the .tsx paints from these rows is an @juneflow/tokens var(); no Thai/baht leaks
 * here.
 */

/** Derived list status — the register shows an asset as either in-service or written off. */
export type AssetStatus = "active" | "writeoff";

/** The six prototype tabs. land/veh/mach filter on a category the wire lacks -> always empty. */
export type FaTab = "all" | "active" | "land" | "veh" | "mach" | "writeoff";

/** A register row as the table consumes it (GET /fa/assets row, narrowed from opaque). */
export interface AssetRow {
  id: string;
  /** Asset name (the real identity — there is no wire "code"). */
  name: string;
  /** Acquisition cost (real). */
  cost: number;
  /** Currency of the money columns. */
  currencyCode: string;
  /** Useful life in years, or null (drives the age cell + the depreciation schedule). */
  lifeYears: number | null;
  /** Cost-center id (UUID), "" when none — resolved to a code in the detail via /cost-centers. */
  ccId: string;
  /** Free-text depreciation method, "" when none. */
  deprMethod: string;
  /** Salvage value (real). */
  salvage: number;
  /** Acquisition date (ISO), "" when none. */
  acquiredDate: string;
  /** Running accumulated depreciation (real). */
  accumulatedDepr: number;
  /** DERIVED carrying amount from the wire (cost - accumulated_depr). */
  bookValue: number;
  /** The raw wire status string (e.g. "active" / "written_off"). */
  rawStatus: string;
  /** Derived: "active" iff rawStatus === "active", else "writeoff". */
  status: AssetStatus;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Read a finite integer off an opaque row, else null (preserves the "no life" gap). */
function intOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

/** Derived list status — anything the server does not mark "active" is a written-off/disposed row. */
export function deriveStatus(rawStatus: string): AssetStatus {
  return rawStatus === "active" ? "active" : "writeoff";
}

/** Narrow an opaque /fa/assets Entity row to the AssetRow the table needs. */
export function toAssetRow(e: Record<string, unknown>): AssetRow {
  const rawStatus = str(e.status ?? e.rawStatus) || "active";
  const cost = num(e.cost);
  const accumulatedDepr = num(e.accumulated_depr ?? e.accumulatedDepr);
  const bookRaw = e.book_value ?? e.bookValue;
  return {
    id: str(e.id),
    name: str(e.name),
    cost,
    currencyCode: str(e.currency_code ?? e.currencyCode) || "THB",
    lifeYears: intOrNull(e.life_years ?? e.lifeYears),
    ccId: str(e.cc_id ?? e.ccId),
    deprMethod: str(e.depr_method ?? e.deprMethod),
    salvage: num(e.salvage),
    acquiredDate: str(e.acquired_date ?? e.acquiredDate),
    accumulatedDepr,
    // Prefer the server-derived book_value; fall back to the identity when absent.
    bookValue: bookRaw == null ? cost - accumulatedDepr : num(bookRaw),
    rawStatus,
    status: deriveStatus(rawStatus),
  };
}

/**
 * Rows in a tab. all -> every row; active/writeoff -> that derived status; land/veh/mach filter on
 * a CATEGORY the wire does not carry, so they are honest-empty (never a fabricated category).
 */
export function filterByTab(rows: readonly AssetRow[], tab: FaTab): AssetRow[] {
  switch (tab) {
    case "all":
      return [...rows];
    case "active":
      return rows.filter((r) => r.status === "active");
    case "writeoff":
      return rows.filter((r) => r.status === "writeoff");
    // No category column on the wire -> these tabs can never match a row.
    case "land":
    case "veh":
    case "mach":
      return [];
    default:
      return [...rows];
  }
}

/** Count of rows in a tab (land/veh/mach -> 0, honest empty). */
export function tabCount(rows: readonly AssetRow[], tab: FaTab): number {
  return filterByTab(rows, tab).length;
}

/** Count of rows with a derived status. */
export function countByStatus(rows: readonly AssetRow[], status: AssetStatus): number {
  return rows.filter((r) => r.status === status).length;
}

/** Sum of a numeric column across the loaded rows. */
export function sumBy(rows: readonly AssetRow[], pick: (r: AssetRow) => number): number {
  return rows.reduce((s, r) => s + pick(r), 0);
}

/** Total acquisition cost across the register. */
export function sumCost(rows: readonly AssetRow[]): number {
  return sumBy(rows, (r) => r.cost);
}

/** Total accumulated depreciation across the register. */
export function sumAccum(rows: readonly AssetRow[]): number {
  return sumBy(rows, (r) => r.accumulatedDepr);
}

/** Total net book value across the register. */
export function sumBook(rows: readonly AssetRow[]): number {
  return sumBy(rows, (r) => r.bookValue);
}

/**
 * Group a money amount with thousands separators ("1000000" -> "1,000,000"), matching the
 * prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits + comma only; a
 * non-finite value -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a baht amount as millions with one decimal ("78400000" -> "78.4"), matching the
 * prototype's M-baht KPI values (fa.jsx L74-76). Non-finite -> "0.0".
 */
export function formatMillions(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  return (n / 1_000_000).toFixed(1);
}

/** Badge tone + label key for a derived status (ds.jsx STATUS active/writeoff colours). */
export function statusTone(status: AssetStatus): {
  bg: string;
  fg: string;
  labelKey: "fa.statusActive" | "fa.statusWriteoff";
} {
  return status === "active"
    ? { bg: "var(--ok-soft)", fg: "var(--ok)", labelKey: "fa.statusActive" }
    : { bg: "var(--danger-soft)", fg: "var(--danger)", labelKey: "fa.statusWriteoff" };
}

/** Filter loaded rows by the free-text search (over the real name — there is no wire code). */
export function applySearch(rows: readonly AssetRow[], q: string): AssetRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((r) => r.name.toLowerCase().includes(needle));
}

/**
 * A single year of the client-side straight-line depreciation schedule (fa.jsx AssetDetail
 * L341-347). DERIVED from the real stored columns (cost/salvage/life_years/accumulated_depr) with
 * the same straight-line formula the server posts (fa.ts runDepreciation, Wei B-123 Q1) — a
 * projection preview, never a fabricated per-period JV record. The `posted` marker is an
 * APPROXIMATION from accumulated_depr (there is no per-period schedule endpoint on the wire).
 */
export interface ScheduleYear {
  year: number;
  annual: number;
  cumulative: number;
  book: number;
  /** Approximate: this year's depreciation is already reflected in accumulated_depr. */
  posted: boolean;
}

/** True when an asset is not depreciated (no positive life) -> the schedule shows the empty state. */
export function isNoDepr(row: Pick<AssetRow, "lifeYears">): boolean {
  return row.lifeYears == null || row.lifeYears <= 0;
}

/**
 * Build the straight-line yearly schedule from the real columns. Empty for a non-depreciable asset
 * (no positive life). yearly = round((cost - salvage) / life); cumulative is floored at the
 * depreciable base; posted years are approximated from accumulated_depr / yearly.
 */
export function buildSchedule(row: AssetRow): ScheduleYear[] {
  const life = row.lifeYears ?? 0;
  if (life <= 0) return [];
  const base = row.cost - row.salvage;
  const yearly = Math.round(base / life);
  const postedYears =
    row.accumulatedDepr > 0 && yearly > 0
      ? Math.min(life, Math.round(row.accumulatedDepr / yearly))
      : 0;
  const out: ScheduleYear[] = [];
  for (let y = 1; y <= life; y++) {
    const cumulative = Math.min(base, yearly * y);
    out.push({
      year: y,
      annual: yearly,
      cumulative,
      book: row.cost - cumulative,
      posted: y <= postedYears,
    });
  }
  return out;
}
