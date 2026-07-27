/*
 * Survey/Feasibility derivations for LandSurvey (P3-WEB, read + client-derived, LA-3) —
 * pure, i18n-free, ASCII-only logic ported VERBATIM from pototype/land2.jsx LandSurvey
 * (L21-107, feasibility block L29-35 + the two FeasStat branches L80-94).
 *
 * §0 rule 3 drops the prototype mock: the prototype held plots in a local LAND_PLOTS
 * array and read a denormalised per-plot `title/amphoe/prov/owner`. Here the list is the
 * real server catalogue (GET /land/plots, use-land-bank.ts useLandPlots) whose plot wire
 * is { id, project_id, deed_no, area_sqm, gps, price_per_rai, currency_code, stage,
 * tenure, created_at } (apps/api/src/routes/land-sales.ts plotWire). The area conversion,
 * money grouping and PlotRow narrowing are REUSED from land-bank-rows.ts (sibling screen,
 * same wire) — never duplicated.
 *
 * FEASIBILITY IS CLIENT-DERIVED (LA-3): the figures below are computed from the plot's
 * REAL stored `area_sqm` (and `price_per_rai` for land cost) using the prototype's
 * business formulas, ported verbatim. They are genuine derivations (not persisted, not
 * fabricated, not an em-dash placeholder). LA-3 sanctions this client-side derivation.
 * The prototype's `reYears` (land2.jsx L35) is intentionally NOT ported: it is computed
 * but never rendered by any FeasStat, so porting it would add dead logic.
 *
 * TYPE-AWARE branch (land2.jsx L23 `isSolar = pt.id === "solar"`): the prototype used the
 * ACTIVE project's type; this port resolves EACH plot's own type from its project_id via
 * GET /projects (projectTypeById), which is more precise for a full-register selector. A
 * plot whose type is unresolvable defaults to the residential (non-solar) branch (honest).
 */
import { areaRai, plotValue, formatMoney, type PlotRow } from "./land-bank-rows";

/* --------------------------------------------------------------------------- */
/* project_id -> project.type resolver (real FK join, GET /projects)            */
/* --------------------------------------------------------------------------- */

/**
 * Build a plot's-project-id -> project.type map from the /projects rows. Skips rows with
 * no id/type. The type enum is realestate|solar|civil|service (openapi Project.type); the
 * screen only branches on "solar" (mirrors the prototype's `pt.id === "solar"`).
 */
export function projectTypeById(
  projects: readonly { id: string; type?: string }[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of projects ?? []) if (p.id && p.type) map.set(p.id, p.type);
  return map;
}

/** True when a resolved project type is the solar branch (land2.jsx isSolar). */
export function isSolarType(type: string | undefined): boolean {
  return type === "solar";
}

/* --------------------------------------------------------------------------- */
/* Numeric derivations (land2.jsx L29-35) — all from the REAL area_sqm/price    */
/* Note: prototype `area` = area in RAI = area_sqm / 1600 (areaRai).            */
/* --------------------------------------------------------------------------- */

/** Round to one decimal as a number (prototype `+(x).toFixed(1)`). Non-finite -> 0. */
export function round1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

/**
 * Developable units (land2.jsx L30): Math.floor(area_rai * 1600 * 0.55 / 120) i.e.
 * Math.floor(area_sqm * 0.55 / 120) — ~55% net efficiency, 120 sqm/unit.
 */
export function unitsDevelopable(areaSqm: number): number {
  const a = Number.isFinite(areaSqm) ? areaSqm : 0;
  return Math.floor((a * 0.55) / 120);
}

/** Net sellable area in sqm (land2.jsx L90): Math.round(area_rai * 1600 * 0.55) = round(area_sqm * 0.55). */
export function netSellableSqm(areaSqm: number): number {
  const a = Number.isFinite(areaSqm) ? areaSqm : 0;
  return Math.round(a * 0.55);
}

/** Installable capacity in MWp (land2.jsx L31): round1(area_rai * 0.18), ground-mount. */
export function mwpInstallable(areaSqm: number): number {
  return round1(areaRai(areaSqm) * 0.18);
}

/** Estimated annual energy in MWh (land2.jsx L32): round(mwpInstallable * 1450). */
export function annualMWh(areaSqm: number): number {
  return Math.round(mwpInstallable(areaSqm) * 1450);
}

/** Estimated annual tariff revenue in FULL baht units (land2.jsx L33): round(annualMWh * 1000 * 4.12). */
export function annualRevenue(areaSqm: number): number {
  return Math.round(annualMWh(areaSqm) * 1000 * 4.12);
}

/** Annual revenue expressed in millions (land2.jsx L84 `annualRevenue / 1e6`). */
export function annualRevenueM(areaSqm: number): number {
  return annualRevenue(areaSqm) / 1e6;
}

/**
 * Preliminary payback in years (land2.jsx L85):
 *   mwpInstallable * 31 / (annualRevenueM - mwpInstallable * 1.2)
 * The formula is ported verbatim; callers guard a non-finite result (see paybackText).
 */
export function paybackYears(areaSqm: number): number {
  const mwp = mwpInstallable(areaSqm);
  const revM = annualRevenueM(areaSqm);
  return (mwp * 31) / (revM - mwp * 1.2);
}

/** Land cost in FULL baht units (land2.jsx L34 plotPrice = area_rai * price_per_rai). */
export function landCost(row: PlotRow): number {
  return plotValue(row);
}

/** Land cost per developable unit in FULL baht units (land2.jsx L92): round(landCost / max(1, units)). */
export function landCostPerUnit(row: PlotRow): number {
  return Math.round(landCost(row) / Math.max(1, unitsDevelopable(row.areaSqm)));
}

/* --------------------------------------------------------------------------- */
/* Display strings — the exact prototype fmt/toFixed applied for each FeasStat  */
/* (`fmt` = land-bank formatMoney = th-TH grouped, 0 fraction digits).          */
/* --------------------------------------------------------------------------- */

/** Net sellable sqm, grouped (land2.jsx L90 `fmt(Math.round(area*1600*0.55))`). */
export function netSellableText(areaSqm: number): string {
  return formatMoney(netSellableSqm(areaSqm));
}

/** Project value in millions (land2.jsx L91 `(unitsDevelopable * 3.5 / 1).toFixed(0)`). */
export function projectValueMText(areaSqm: number): string {
  return (unitsDevelopable(areaSqm) * 3.5).toFixed(0);
}

/** Land cost per unit, grouped baht (land2.jsx L92 `fmt(Math.round(landCost / max(1, units)))`). */
export function landCostPerUnitText(row: PlotRow): string {
  return formatMoney(landCostPerUnit(row));
}

/** Annual energy, grouped (land2.jsx L83 `fmt(annualMWh)`). */
export function annualMWhText(areaSqm: number): string {
  return formatMoney(annualMWh(areaSqm));
}

/** Annual revenue in millions, one decimal (land2.jsx L84 `(annualRevenue / 1e6).toFixed(1)`). */
export function revenueMText(areaSqm: number): string {
  return annualRevenueM(areaSqm).toFixed(1);
}

/**
 * Payback years, one decimal (land2.jsx L85 `(...).toFixed(1)`). A non-finite result
 * (degenerate plot: zero/near-zero area making the denominator 0) renders the em-dash
 * placeholder instead of the prototype's raw "NaN"/"Infinity" — a defensive display
 * guard only; the verbatim formula lives in {@link paybackYears}.
 */
export function paybackText(areaSqm: number): string {
  const y = paybackYears(areaSqm);
  return Number.isFinite(y) ? y.toFixed(1) : "—";
}
