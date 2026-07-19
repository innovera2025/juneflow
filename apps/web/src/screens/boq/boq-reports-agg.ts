/*
 * Pure aggregation + transform logic for the BOQ Reports screen (group-C W2b/W3b,
 * gate G3). No React, no i18n, no fetch here — every helper is unit-testable.
 *
 * The prototype (pototype/boq.jsx BOQReports L1637-1852 + boq-extra.jsx
 * BOQReportsExtra L322-479) is a MOCK: the RPT-001 +880,000 / +7.1% over, the
 * RPT-003 M/S/L literals, the RPT-004 per-period actuals and the RPT-005 PV/EV/AC
 * series + SPI/CPI are all hardcoded. Per PLAN.md §0 rule 3 + Appendix C10 NONE of
 * those numbers are reproduced. This module instead parses the OPAQUE Entity JSON
 * returned by the four real GET /boq/reports/* aggregate handlers (B-101) into
 * typed rows, plus the pure formatters, threshold-colour helpers and chart-point
 * geometry the view consumes.
 *
 * WIRE REALITY (honest, never fabricated): on the current seed most reports are
 * honestly thin — Non-BOQ over-plan spend is an unpriceable gap (backend returns
 * 0), the variance + EVM stores may be empty (empty series → em-dash shells). The
 * parsers surface those as empty arrays / null so the view renders the honest
 * em-dash / empty-state, never a mock value.
 */
import { formatMoney } from "./boq-rows";

export { formatMoney };

/** The honest em-dash marker used for every un-sourced value (C10). */
export const DASH = "—";

/** An opaque contract Entity — every /boq/reports/* body is `{ [k]: unknown }`. */
export type Ent = Record<string, unknown>;

/* ── Opaque-Entity field readers (defensive — the contract is Entity/opaque) ──── */

/** Finite number at `key`, else 0. */
export function entNum(e: Ent | undefined, key: string): number {
  const v = e?.[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Finite number at `key`, else null (distinguishes an honest gap from a real 0). */
export function entNumOrNull(e: Ent | undefined, key: string): number | null {
  const v = e?.[key];
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Non-empty string at `key`, else null. */
export function entStr(e: Ent | undefined, key: string): string | null {
  const v = e?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Array of Entities at `key`, else []. */
export function entArr(e: Ent | undefined, key: string): Ent[] {
  const v = e?.[key];
  return Array.isArray(v) ? (v as Ent[]) : [];
}

/** Plain object at `key`, else {} (nested totals / ratio blocks). */
export function entObj(e: Ent | undefined, key: string): Ent {
  const v = e?.[key];
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Ent) : {};
}

/* ── RPT-001 · BOQ vs Non-BOQ (GET /boq/reports/boq-vs-nonboq) ─────────────────── */

/** One category (or the synthetic unattributed) row of the BOQ-vs-Non-BOQ report. */
export interface BoqVsNonBoqRow {
  /** boq_group id, or null for the synthetic unattributed Non-BOQ row (B-101 D1). */
  groupId: string | null;
  /** Work-category label (server data), or null for the unattributed row → view DASH. */
  categoryLabel: string | null;
  /** In-plan BOQ value = Σ(qty × price) of the group. */
  boq: number;
  /** Over-plan Non-BOQ spend (honestly 0 — pr_item carries no price, DATA GAP). */
  nonBoq: number;
  /** boq + nonBoq. */
  totalActual: number;
  /** round(nonBoq / boq × 100), or null when boq = 0 (no ratio). */
  pctOver: number | null;
}

export interface BoqVsNonBoqTotals {
  boq: number;
  nonBoq: number;
  totalActual: number;
  pctOver: number | null;
}

export interface BoqVsNonBoqReport {
  rows: BoqVsNonBoqRow[];
  totals: BoqVsNonBoqTotals;
  currencyCode: string | null;
}

export function parseBoqVsNonboq(e: Ent | undefined): BoqVsNonBoqReport | null {
  if (!e) return null;
  const t = entObj(e, "totals");
  return {
    rows: entArr(e, "rows").map((r) => ({
      groupId: entStr(r, "group_id"),
      categoryLabel: entStr(r, "category_label"),
      boq: entNum(r, "boq"),
      nonBoq: entNum(r, "non_boq"),
      totalActual: entNum(r, "total_actual"),
      pctOver: entNumOrNull(r, "pct_over"),
    })),
    totals: {
      boq: entNum(t, "boq"),
      nonBoq: entNum(t, "non_boq"),
      totalActual: entNum(t, "total_actual"),
      pctOver: entNumOrNull(t, "pct_over"),
    },
    currencyCode: entStr(e, "currency_code"),
  };
}

/* ── RPT-003 · Material / Subcon / Labor (GET /boq/reports/cost-type) ──────────── */

export interface CostTypeRow {
  groupId: string | null;
  categoryLabel: string | null;
  material: number;
  subcon: number;
  labor: number;
  total: number;
  currencyCode: string | null;
}

export interface CostTypeTotals {
  material: number;
  subcon: number;
  labor: number;
  grand: number;
}

/** Integer percentages of the grand total, or all-null when grand = 0 (honest). */
export interface CostTypeRatio {
  materialPct: number | null;
  subconPct: number | null;
  laborPct: number | null;
}

export interface CostTypeReport {
  rows: CostTypeRow[];
  totals: CostTypeTotals;
  ratio: CostTypeRatio;
  currencyCode: string | null;
}

export function parseCostType(e: Ent | undefined): CostTypeReport | null {
  if (!e) return null;
  const t = entObj(e, "totals");
  const ratio = entObj(e, "ratio");
  return {
    rows: entArr(e, "rows").map((r) => ({
      groupId: entStr(r, "group_id"),
      categoryLabel: entStr(r, "category_label"),
      material: entNum(r, "material"),
      subcon: entNum(r, "subcon"),
      labor: entNum(r, "labor"),
      total: entNum(r, "total"),
      currencyCode: entStr(r, "currency_code"),
    })),
    totals: {
      material: entNum(t, "material"),
      subcon: entNum(t, "subcon"),
      labor: entNum(t, "labor"),
      grand: entNum(t, "grand"),
    },
    ratio: {
      materialPct: entNumOrNull(ratio, "material_pct"),
      subconPct: entNumOrNull(ratio, "subcon_pct"),
      laborPct: entNumOrNull(ratio, "labor_pct"),
    },
    currencyCode: entStr(e, "currency_code"),
  };
}

/* ── RPT-004 · Variance Plan vs Actual (GET /boq/reports/variance) ─────────────── */

export interface VarianceRow {
  /** Period label (server 'YYYY-MM' / description), rendered raw (not an i18n key). */
  periodLabel: string | null;
  /** Planned (BOQ) value for the period. */
  plan: number;
  /** Actual spend, or null when the period has no actual yet (pending). */
  actual: number | null;
  /** actual − plan, or null (pending). */
  variance: number | null;
  /** round(variance / plan × 100, 1dp), or null (pending). */
  pctDev: number | null;
  /** Server status code (mapped to an i18n label by classifyVarianceRow). */
  status: string | null;
}

export interface VarianceReport {
  rows: VarianceRow[];
  currencyCode: string | null;
}

export function parseVariance(e: Ent | undefined): VarianceReport | null {
  if (!e) return null;
  return {
    rows: entArr(e, "rows").map((r) => ({
      periodLabel: entStr(r, "period_label"),
      plan: entNum(r, "plan"),
      actual: entNumOrNull(r, "actual"),
      variance: entNumOrNull(r, "variance"),
      pctDev: entNumOrNull(r, "pct_dev"),
      status: entStr(r, "status"),
    })),
    currencyCode: entStr(e, "currency_code"),
  };
}

/* ── RPT-005 · EVM S-curve + SPI/CPI (GET /boq/reports/evm) ────────────────────── */

export interface EvmPoint {
  /** Period label (server 'YYYY-MM'), rendered raw. */
  periodLabel: string | null;
  /** Planned Value (baht). */
  pv: number;
  /** Earned Value (baht). */
  ev: number;
  /** Actual Cost (baht). */
  ac: number;
}

export interface EvmReport {
  series: EvmPoint[];
  /** Schedule Performance Index (EV/PV), or null when unavailable. */
  spi: number | null;
  /** Cost Performance Index (EV/AC), or null when unavailable. */
  cpi: number | null;
  currencyCode: string | null;
}

export function parseEvm(e: Ent | undefined): EvmReport | null {
  if (!e) return null;
  return {
    series: entArr(e, "series").map((p) => ({
      periodLabel: entStr(p, "period_label"),
      pv: entNum(p, "pv"),
      ev: entNum(p, "ev"),
      ac: entNum(p, "ac"),
    })),
    spi: entNumOrNull(e, "spi"),
    cpi: entNumOrNull(e, "cpi"),
    currencyCode: entStr(e, "currency_code"),
  };
}

/* ── Formatters ───────────────────────────────────────────────────────────────── */

/** Baht → "millions, 2 decimals" (RPT-001 bar shows "4.84M"), NaN/∞ → "0.00". */
export function millions2(baht: number): string {
  if (!Number.isFinite(baht)) return "0.00";
  return (baht / 1e6).toFixed(2);
}

/** Baht → "millions, 1 decimal" (RPT-005 footer shows "11.6M"), NaN/∞ → "0.0". */
export function millions1(baht: number): string {
  if (!Number.isFinite(baht)) return "0.0";
  return (baht / 1e6).toFixed(1);
}

/** Whole-ish percent to 1 decimal ("7.1"), no % sign; NaN/∞ → "0.0". */
export function formatPct1(pct: number): string {
  if (!Number.isFinite(pct)) return "0.0";
  return pct.toFixed(1);
}

/* ── Threshold-colour helpers (prototype-verbatim rules, tokens only) ──────────── */

/** A token-var background/foreground pair for a badge. */
export interface BadgeTone {
  bg: string;
  fg: string;
}

/**
 * RPT-001 "% เกิน" badge colour (boq.jsx:1763-1764): > 10 danger, > 5 warn, else ok.
 */
export function pctOverBadge(pct: number): BadgeTone {
  if (pct > 10) return { bg: "var(--danger-soft)", fg: "var(--danger)" };
  if (pct > 5) return { bg: "var(--warn-soft)", fg: "var(--warn)" };
  return { bg: "var(--ok-soft)", fg: "var(--ok)" };
}

/**
 * RPT-004 "% Dev." badge colour (boq-extra.jsx:397,406): bad = pct > 5, warn =
 * 0 < pct ≤ 5, else ok.
 */
export function varianceDevBadge(pctDev: number): BadgeTone {
  const bad = pctDev > 5;
  const warn = pctDev > 0 && pctDev <= 5;
  if (bad) return { bg: "var(--danger-soft)", fg: "var(--danger)" };
  if (warn) return { bg: "var(--warn-soft)", fg: "var(--warn)" };
  return { bg: "var(--ok-soft)", fg: "var(--ok)" };
}

/** RPT-004 Variance value colour (boq-extra.jsx:403): over-plan danger, else ok. */
export function varianceColor(variance: number): string {
  return variance > 0 ? "var(--danger)" : "var(--ok)";
}

/** RPT-005 SPI/CPI "good" rule (boq-extra.jsx:459-460): index ≥ 1 is on/ahead. */
export function spiGood(value: number): boolean {
  return value >= 1;
}

/* ── RPT-004 status classification (existing i18n keys, no invented Thai) ──────── */

/** The two report-status DICT keys the mock uses (เสร็จ / รอดำเนิน). */
export type VarianceStatusKey = "boq.repStatusDone" | "boq.repStatusPending";

/**
 * Map a server variance status code to an existing i18n key (the mock's only two
 * labels: done / pending). An unknown non-empty code → null so the view renders the
 * raw code honestly and it can be flagged (§0 rule 4 — never invent Thai). When the
 * status is ABSENT the classification mirrors the prototype's own rule (a period is
 * pending until it has a real actual), so `hasActual` drives the fallback.
 *
 * NOTE (provisional): the GET /boq/reports/variance handler is not yet wired on the
 * backend, so this status vocabulary is forward-compat; the code-set below covers
 * the obvious done/pending spellings and every other code falls through to raw
 * passthrough + a BLOCKED-key flag.
 */
export function varianceStatusKey(
  status: string | null,
  hasActual: boolean,
): VarianceStatusKey | null {
  const s = (status ?? "").trim().toLowerCase();
  if (s.length > 0) {
    if (["done", "complete", "completed", "actual", "posted", "closed"].includes(s)) {
      return "boq.repStatusDone";
    }
    if (["pending", "planned", "in_progress", "upcoming", "open"].includes(s)) {
      return "boq.repStatusPending";
    }
    return null;
  }
  return hasActual ? "boq.repStatusDone" : "boq.repStatusPending";
}

/** A variance row's display classification (pending → em-dash the actual/dev cells). */
export interface VarianceRowView {
  /** Render actual / variance / % Dev. as the honest em-dash. */
  pending: boolean;
  /** i18n key for the status cell, or null when the raw code is unknown. */
  statusKey: VarianceStatusKey | null;
  /** Raw server status — shown honestly when statusKey is null. */
  rawStatus: string | null;
}

export function classifyVarianceRow(row: VarianceRow): VarianceRowView {
  const hasActual = row.actual != null && row.actual > 0;
  const statusKey = varianceStatusKey(row.status, hasActual);
  const pending =
    statusKey === "boq.repStatusPending" || (statusKey == null && row.actual == null);
  return { pending, statusKey, rawStatus: row.status };
}

/* ── RPT-001 stacked-bar geometry (boq.jsx:1707-1721) ──────────────────────────── */

/** One left-panel bar: label + BOQ/Non-BOQ baht + their width percentages. */
export interface BoqBar {
  label: string | null;
  boq: number;
  nonBoq: number;
  /** Width % of the BOQ segment (of the scaled max). */
  boqPct: number;
  /** Width % of the Non-BOQ segment. */
  nonPct: number;
}

/**
 * Build the RPT-001 stacked bars from the report rows. Only rows with real value
 * (boq + nonBoq > 0) become bars — the synthetic unattributed row (0/0) and any
 * empty group are dropped from the CHART (they still appear in the table). Widths
 * scale to the largest row total so the tallest bar fills the track, exactly like
 * the prototype's fixed axis but data-driven. Empty in → [] (view keeps EmptyBody).
 */
export function buildBoqBars(rows: readonly BoqVsNonBoqRow[]): BoqBar[] {
  const visible = rows.filter((r) => r.boq > 0 || r.nonBoq > 0);
  if (visible.length === 0) return [];
  const max = Math.max(...visible.map((r) => r.boq + r.nonBoq));
  const denom = max > 0 ? max : 1;
  return visible.map((r) => ({
    label: r.categoryLabel,
    boq: r.boq,
    nonBoq: r.nonBoq,
    boqPct: (r.boq / denom) * 100,
    nonPct: (r.nonBoq / denom) * 100,
  }));
}

/* ── RPT-003 M/S/L segmented bar (boq-extra.jsx:335-339) ───────────────────────── */

/** One M/S/L bar segment: track width (from totals) + inline label % (from ratio). */
export interface MslSegment {
  widthPct: number;
  labelPct: number | null;
}

export interface MslBar {
  /** Whether the bar has real spend (grand > 0) — else the view keeps EmptyBody. */
  hasData: boolean;
  material: MslSegment;
  subcon: MslSegment;
  labor: MslSegment;
}

/**
 * Build the RPT-003 M/S/L segmented bar. Segment WIDTH is the exact share of the
 * grand total (matching the prototype's `tX/grand*100`); the inline LABEL uses the
 * server's integer ratio percentage. When grand = 0 there is no spend → hasData
 * false (honest empty), and the labels are null.
 */
export function buildMslBar(report: CostTypeReport): MslBar {
  const { material, subcon, labor, grand } = report.totals;
  const hasData = grand > 0;
  const width = (part: number): number => (hasData ? (part / grand) * 100 : 0);
  return {
    hasData,
    material: { widthPct: width(material), labelPct: report.ratio.materialPct },
    subcon: { widthPct: width(subcon), labelPct: report.ratio.subconPct },
    labor: { widthPct: width(labor), labelPct: report.ratio.laborPct },
  };
}

/* ── RPT-005 EVM S-curve geometry (boq-extra.jsx:430-449) ──────────────────────── */

export interface EvmChartOpts {
  width: number;
  height: number;
  pad: number;
}

const EVM_CHART_DEFAULTS: EvmChartOpts = { width: 560, height: 200, pad: 34 };

/**
 * "Nice" y-axis ceiling in millions = ceil(max PV/EV/AC over the series in M฿),
 * min 1. Deterministic (no fuzzy headroom) so the gridline labels are stable.
 */
export function evmMaxMillions(series: readonly EvmPoint[]): number {
  const vals = series.flatMap((p) => [p.pv, p.ev, p.ac]).map((v) => v / 1e6);
  const max = vals.length > 0 ? Math.max(0, ...vals) : 0;
  return max <= 0 ? 1 : Math.max(1, Math.ceil(max));
}

/** A horizontal gridline: its y and the axis-value label (in whole M฿). */
export interface EvmGridLine {
  y: number;
  label: string;
}

/** An x-axis tick: its x and the period label (raw server value). */
export interface EvmXLabel {
  x: number;
  label: string | null;
}

/** A plotted point (EV marker). */
export interface EvmPointXY {
  cx: number;
  cy: number;
}

/** The full computed geometry for the EVM SVG (all values in the viewBox space). */
export interface EvmChartGeom {
  width: number;
  height: number;
  pad: number;
  maxV: number;
  gridLines: EvmGridLine[];
  xLabels: EvmXLabel[];
  pvPath: string;
  evPath: string;
  acPath: string;
  evPoints: EvmPointXY[];
}

/**
 * Compose the EVM chart geometry from the REAL series (values converted baht → M฿).
 * Mirrors the prototype's coordinate math 1:1. Returns null when fewer than 2 points
 * exist (a line needs 2, and the prototype's x() divides by n−1) → the view keeps
 * the honest EmptyBody. All numbers are pre-rounded to 1dp for stable SVG output.
 */
export function buildEvmChart(
  series: readonly EvmPoint[],
  opts: EvmChartOpts = EVM_CHART_DEFAULTS,
): EvmChartGeom | null {
  const n = series.length;
  if (n < 2) return null;
  const { width: W, height: H, pad } = opts;
  const maxV = evmMaxMillions(series);
  const x = (i: number): number => pad + i * ((W - pad * 2) / (n - 1));
  const y = (vMillions: number): number => H - pad - (vMillions / maxV) * (H - pad * 2);
  const m = (baht: number): number => baht / 1e6;

  const line = (pick: (p: EvmPoint) => number): string =>
    series
      .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(m(pick(p))).toFixed(1)}`)
      .join(" ");

  const gridLines: EvmGridLine[] = [0, 0.25, 0.5, 0.75, 1].map((g) => ({
    y: pad + g * (H - pad * 2),
    label: (maxV * (1 - g)).toFixed(0),
  }));

  return {
    width: W,
    height: H,
    pad,
    maxV,
    gridLines,
    xLabels: series.map((p, i) => ({ x: x(i), label: p.periodLabel })),
    pvPath: line((p) => p.pv),
    evPath: line((p) => p.ev),
    acPath: line((p) => p.ac),
    evPoints: series.map((p, i) => ({ cx: x(i), cy: y(m(p.ev)) })),
  };
}
