/*
 * FA Depreciation row helpers (fa.depr) — pure, i18n-free, ASCII-only logic ported from
 * pototype/fa.jsx FADepreciation (L444-519) + DeprRunForm (L521-568).
 *
 * The prototype held the assets in a local ASSETS seed (fa.jsx L3-12) and computed a MOCK
 * monthly figure of cost/(life*12) (L491) that DROPS salvage. Section-0 rule 3: that seed +
 * mock formula are dropped. The list is the real server catalogue (GET /fa/assets, apps/api/
 * src/routes/fa.ts listAssets -> assetWire), and the monthly depreciation is the SERVER-
 * authoritative straight-line formula (cost - salvage) / life_years / 12 (Wei B-123 Q1). The
 * client computes the SAME formula only for a PREVIEW; POST /fa/run-depreciation is the
 * authority that actually posts the JV (fa.ts runDepreciation).
 *
 * The opaque /fa/assets Entity row (snake_case) is:
 *   { id, name, cost:number, currency_code, life_years:number|null, cc_id:string|null,
 *     depr_method:string|null, salvage:number, acquired_date:string|null,
 *     accumulated_depr:number, status, book_value:number }  (fa.ts assetWire).
 *
 * HONEST GAPS (never fabricated) — see fa-depr.tsx for the screen-level notes:
 *   - there is NO per-year depreciation-schedule endpoint; the depr screen shows a MONTHLY
 *     per-asset projection only (the prototype's yearly schedule lives in AssetDetail on the
 *     register screen, out of scope here).
 *   - the wire has no YTD split, no JV linkage, and no internal-rent figure -> those KPIs
 *     em-dash on the screen; only "this month" (sumMonthly, a real projection) is populated.
 *
 * Every colour the .tsx paints from these rows is an @juneflow/tokens var(); no Thai/baht leaks
 * here (B-073).
 */

/** Asset status as the wire carries it (fa.ts: 'active' | 'written_off' | ...). */
export type AssetStatus = string;

/** A fixed asset as the depr screen consumes it (GET /fa/assets row, narrowed). */
export interface FaAsset {
  id: string;
  /** Asset name (data, not i18n). */
  name: string;
  /** Acquisition cost (money). */
  cost: number;
  /** Currency of the money columns ("" when absent). */
  currencyCode: string;
  /** Useful life in years (0 when absent / not depreciable). */
  lifeYears: number;
  /** Cost-center id ("" when absent). */
  ccId: string;
  /** Depreciation method label (data, e.g. free text; "" when absent). */
  deprMethod: string;
  /** Residual/salvage value (money). */
  salvage: number;
  /** Acquisition date ("" when absent). */
  acquiredDate: string;
  /** Running accumulated depreciation (money). */
  accumulatedDepr: number;
  /** Lifecycle status (drives the depreciable filter). */
  status: AssetStatus;
  /** DERIVED carrying amount from the server (cost - accumulated_depr). */
  bookValue: number;
}

/** Round to 2 decimals (matches the server round2, avoids fp drift in the preview). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row, else 0 (money columns are never null on the wire). */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Narrow an opaque /fa/assets Entity row to the FaAsset the screen needs. */
export function toFaAsset(e: Record<string, unknown>): FaAsset {
  const cost = num(e.cost);
  const accumulatedDepr = num(e.accumulated_depr ?? e.accumulatedDepr);
  // book_value is DERIVED server-side; fall back to (cost - accumulated) if ever absent.
  const bookValueRaw = e.book_value ?? e.bookValue;
  const bookValue =
    bookValueRaw == null ? round2(cost - accumulatedDepr) : num(bookValueRaw);
  return {
    id: str(e.id),
    name: str(e.name),
    cost,
    currencyCode: str(e.currency_code ?? e.currencyCode),
    lifeYears: num(e.life_years ?? e.lifeYears),
    ccId: str(e.cc_id ?? e.ccId),
    deprMethod: str(e.depr_method ?? e.deprMethod),
    salvage: num(e.salvage),
    acquiredDate: str(e.acquired_date ?? e.acquiredDate),
    accumulatedDepr,
    status: str(e.status) || "active",
    bookValue,
  };
}

/** Straight-line depreciable base = max(0, cost - salvage). */
export function depreciableBase(cost: number, salvage: number): number {
  return Math.max(0, round2(cost - salvage));
}

/**
 * SERVER-authoritative monthly straight-line depreciation = (cost - salvage) / life_years / 12,
 * capped to the remaining base so accumulated can never exceed (cost - salvage). Returns 0 when
 * the asset is not depreciable (life <= 0, base <= 0, or already fully depreciated). This is the
 * client PREVIEW of the exact formula fa.ts runDepreciation posts (Wei B-123 Q1); the server,
 * not this figure, remains the authority.
 */
export function monthlyStraightLine(
  cost: number,
  salvage: number,
  lifeYears: number,
  accumulatedDepr = 0,
): number {
  if (lifeYears <= 0) return 0;
  const base = depreciableBase(cost, salvage);
  if (base <= 0) return 0;
  const remaining = round2(base - accumulatedDepr);
  if (remaining <= 0) return 0;
  const monthly = round2(base / lifeYears / 12);
  return monthly > remaining ? remaining : monthly;
}

/**
 * A depreciable asset (matches fa.ts runDepreciation eligibility): active, life_years > 0,
 * cost > salvage, and not yet fully depreciated. These are exactly the rows the depr table
 * lists ("only assets that still depreciate; excludes land + write-offs").
 */
export function isDepreciable(a: FaAsset): boolean {
  if (a.status !== "active") return false;
  if (a.lifeYears <= 0) return false;
  const base = depreciableBase(a.cost, a.salvage);
  if (base <= 0) return false;
  return round2(base - a.accumulatedDepr) > 0;
}

/** The depreciable assets, in the wire order (newest-first from the server list). */
export function depreciableAssets(assets: readonly FaAsset[]): FaAsset[] {
  return assets.filter(isDepreciable);
}

/** One row of the depr table: real book value, the monthly projection, and the remainder. */
export interface DeprRow {
  id: string;
  name: string;
  /** Method label (data, "" -> the cell em-dashes). */
  method: string;
  /** Cost-center id (data, "" -> the cell em-dashes). */
  ccId: string;
  /** Carrying amount brought forward (real book_value). */
  book: number;
  /** This month's straight-line depreciation (real projection). */
  monthly: number;
  /** Carrying amount after this month's depreciation (book - monthly). */
  remain: number;
}

/** Project one depreciable asset into its depr-table row. */
export function toDeprRow(a: FaAsset): DeprRow {
  const monthly = monthlyStraightLine(a.cost, a.salvage, a.lifeYears, a.accumulatedDepr);
  return {
    id: a.id,
    name: a.name,
    method: a.deprMethod,
    ccId: a.ccId,
    book: a.bookValue,
    monthly,
    remain: round2(a.bookValue - monthly),
  };
}

/** Sum of this month's straight-line depreciation over all depreciable assets (KPI + run total). */
export function sumMonthly(assets: readonly FaAsset[]): number {
  return round2(
    depreciableAssets(assets).reduce(
      (s, a) => s + monthlyStraightLine(a.cost, a.salvage, a.lifeYears, a.accumulatedDepr),
      0,
    ),
  );
}

/** Count of depreciable assets (the run "assets to depreciate" figure). */
export function eligibleCount(assets: readonly FaAsset[]): number {
  return depreciableAssets(assets).length;
}

/** The current CE month as a 'YYYY-MM' key (UTC) — the period POST /fa/run-depreciation defaults to. */
export function currentCePeriod(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${mo}`;
}

/**
 * Group a money amount with thousands separators ("1000000" -> "1,000,000"), matching the
 * prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits + comma only
 * (no baht symbol / decimals — the baht glyph is an i18n key on the screen); non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The narrowed shape of the POST /fa/run-depreciation ActionOk result the screen reports. */
export interface RunResultSummary {
  /** Number of assets that actually posted a depreciation JV. */
  postedCount: number;
  /** Sum of the posted amounts (real server figures). */
  postedTotal: number;
  /** Number of assets skipped (already posted / fully depreciated / not eligible). */
  skippedCount: number;
}

/**
 * Narrow the opaque POST /fa/run-depreciation response { period, posted:[{asset_id, amount,
 * jv_no}], skipped:[{asset_id, reason}], currency_code } to the summary the toast reports. The
 * response is the opaque ActionOk Entity, so every field is read defensively.
 */
export function summarizeRunResult(res: unknown): RunResultSummary {
  const obj = (typeof res === "object" && res !== null ? res : {}) as Record<string, unknown>;
  const posted = Array.isArray(obj.posted) ? (obj.posted as unknown[]) : [];
  const skipped = Array.isArray(obj.skipped) ? (obj.skipped as unknown[]) : [];
  const postedTotal = posted.reduce<number>((s, row) => {
    const amount = (row as { amount?: unknown } | null)?.amount;
    return s + num(amount);
  }, 0);
  return {
    postedCount: posted.length,
    postedTotal: round2(postedTotal),
    skippedCount: skipped.length,
  };
}
