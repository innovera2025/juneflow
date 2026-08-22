/*
 * Cost-allocation view-model helpers for AllocateCost (route `alloc`) — pure, i18n-free,
 * ASCII-only logic ported from pototype/petty-alloc.jsx AllocateCost (L123-303).
 *
 * SCOPE IS A WEI RULING, not a shortcut. B-232 = ค: "the AllocateCost screen is READ-ONLY (no
 * POST) -> NO backend endpoint... ports the variance report thin from existing reads", pointing
 * at the B-229 subcon.progress precedent: port every element an existing read backs, and
 * em-dash the rest. So this module derives ONLY from GET /dashboard/budget-actual, which the
 * dashboard screen already parses (dashboard-agg.ts CostCategory) — no second parser, no new
 * endpoint, nothing invented.
 *
 * WHAT THE WIRE GIVES, and what it does not:
 *   cost_categories[] = { category_label, plan_value, actual_value } per boq_group. The
 *   prototype's ALLOC_CAT carried six rows with a leading code ("01".."06"); the SERVED label
 *   embeds that same code ("01 งานเตรียม + Site Work"), so splitCode() splits the served
 *   string — a display split of real data, never a fabricated column.
 *
 *   Variance and % variance are NOT on the wire. They are display arithmetic over the served
 *   plan/actual, which is exactly what B-229 allows (the subcon.progress KPIs are derived the
 *   same way). Nothing here re-derives a figure the server owns.
 *
 *   Block-level scoping, the per-unit tiles and the month-over-month deltas have NO source in
 *   the schema at all (cbs_budget hangs off boq_group -> boq_doc -> project and has no
 *   project_node link; no table carries a per-unit cost). Those are dropped by the ruling
 *   above, and named in B-433 rather than approximated.
 * ASCII-only, tokens-free, no Thai/baht (B-073).
 */

/** One category row as the chart + table consume it. */
export interface AllocRow {
  /** Leading code split off the served label ("" when the label carries none). */
  code: string;
  /** The rest of the served label ("" when absent -> em-dash in the .tsx). */
  name: string;
  /** Standard cost — the served plan_value. */
  standard: number;
  /** Actual cost — the served actual_value. */
  actual: number;
  /** actual - standard. Positive = over plan. Display arithmetic (B-229). */
  variance: number;
  /**
   * Variance as a percent of standard, or null when standard is 0.
   *
   * null rather than 0: a category with no budget has no meaningful percentage, and printing
   * "0%" there would read as "on plan" for a row that is entirely unplanned spend.
   */
  variancePct: number | null;
}

/** The prototype's own banding (petty-alloc.jsx L217-219): |pct| >= 10 is "a lot". */
export const VARIANCE_WARN_PCT = 10;

/** Which badge a row earns. `other` is the honest state when there is no percentage at all. */
export type AllocStatus = "over" | "under" | "normal" | "other";

/** Read a finite number off an opaque value; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Split a served category label into its leading code and the remaining name.
 *
 * The seed writes boq_group.name as "01 งานเตรียม + Site Work" (seed/index.ts:437-443) and the
 * prototype rendered the two halves in separate columns. This splits ONLY on a leading run of
 * digits followed by a space; a label without one keeps its whole text as the name and yields
 * an empty code, so the code cell em-dashes rather than inventing a number.
 */
export function splitCode(label: string): { code: string; name: string } {
  const m = /^(\d+)\s+(.*)$/.exec(label);
  if (!m) return { code: "", name: label };
  return { code: m[1]!, name: m[2]! };
}

/** Narrow one parsed CostCategory into an AllocRow (variance derived, never re-read). */
export function toAllocRow(c: { label: string | null; plan: number; actual: number }): AllocRow {
  const { code, name } = splitCode(c.label ?? "");
  const standard = num(c.plan);
  const actual = num(c.actual);
  return {
    code,
    name,
    standard,
    actual,
    variance: actual - standard,
    variancePct: standard === 0 ? null : ((actual - standard) / standard) * 100,
  };
}

/** The badge a row earns, following the prototype's own thresholds. */
export function statusOf(row: AllocRow): AllocStatus {
  if (row.variancePct == null) return "other";
  const big = Math.abs(row.variancePct) >= VARIANCE_WARN_PCT;
  if (!big) return "normal";
  return row.variance > 0 ? "over" : "under";
}

/**
 * Half-width of the centre-zero diverging bar, in percent of the track (prototype L220:
 * `Math.min(100, Math.abs(r.pct) * 4)` then halved either side of the centre line).
 * A row with no percentage draws nothing.
 */
export function barHalfWidth(row: AllocRow): number {
  if (row.variancePct == null) return 0;
  return Math.min(100, Math.abs(row.variancePct) * 4) / 2;
}

/** Column totals for the table foot. */
export interface AllocTotals {
  standard: number;
  actual: number;
  variance: number;
  /** null when the standard total is 0 — same reasoning as the per-row percentage. */
  variancePct: number | null;
}

export function allocTotals(rows: AllocRow[]): AllocTotals {
  const standard = rows.reduce((s, r) => s + r.standard, 0);
  const actual = rows.reduce((s, r) => s + r.actual, 0);
  const variance = actual - standard;
  return {
    standard,
    actual,
    variance,
    variancePct: standard === 0 ? null : (variance / standard) * 100,
  };
}
