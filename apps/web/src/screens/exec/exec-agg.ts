/*
 * Pure aggregation + transform logic for the Executive Dashboard screen
 * (group-C Wave-2b, gate G3).
 *
 * The prototype (pototype/exec-audit.jsx ExecDashboard) is a MOCK: the per-project
 * `roll` object (budget/actual/progress/sold/health literals) and the window.PROJECTS
 * / window.ACCEPT_ITEMS globals are all hardcoded. Per section-0 rule 3 + C10 (PLAN.md
 * Appendix C) NONE of those mock numbers are reproduced. This module instead parses
 * the OPAQUE Entity JSON returned by the real GET /analytics/portfolio handler
 * (apps/api/src/routes/analytics.ts, B-101) into typed rows, plus the pure formatters /
 * health-tone map / over-spend rule / KPI derivations the view consumes. No React, no
 * i18n, no fetch here — every lookup stays unit-testable (G3).
 *
 * WIRE REALITY (honest, never fabricated): the handler returns budget/actual from
 * cbs_budget, progress from the phase-progress built% source, sold% from sales_unit,
 * and health as the STORED curated label surfaced verbatim (B-102). Where a source is
 * genuinely absent (no curated health / no sales units) the handler returns an HONEST
 * null; the parsers keep that null so the view can render an em-dash, never a value.
 * The accept-center strip has NO endpoint at all -> the view renders honest em-dashes.
 *
 * No raw Thai byte lives in this source (B-073): the two stored health labels this
 * module must compare against are written as \u escapes (mirrors dashboard-agg BAHT).
 */

/** An opaque contract Entity — the /analytics/portfolio body is `{ [k]: unknown }`. */
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

/* ── Parsed row types ────────────────────────────────────────────────────────── */

/** GET /analytics/portfolio `totals` — the portfolio KPI aggregates. */
export interface PortfolioTotals {
  budgetTotal: number;
  actualTotal: number;
  avgProgress: number;
  atRiskCount: number;
  currencyCode: string | null;
}

/** One `projects[]` row (health/sold_pct are honest-null wire gaps). */
export interface PortfolioProject {
  projectId: string;
  name: string | null;
  /** realestate | solar | civil | service — null when the project has no type. */
  typeKey: string | null;
  budget: number;
  actual: number;
  progressPct: number;
  /** Stored curated label surfaced verbatim (B-102), or null when uncurated. */
  health: string | null;
  soldPct: number | null;
}

/** One `type_mix[]` row — the budget sum grouped by project type. */
export interface TypeMixRow {
  typeKey: string;
  budgetSum: number;
}

/** The whole GET /analytics/portfolio rollup. */
export interface Portfolio {
  totals: PortfolioTotals;
  projects: PortfolioProject[];
  typeMix: TypeMixRow[];
}

/* ── Parser (opaque Entity → typed) ───────────────────────────────────────────── */

export function parsePortfolio(e: Ent | undefined): Portfolio | null {
  if (!e) return null;
  const totalsEnt = (e.totals as Ent | undefined) ?? undefined;
  return {
    totals: {
      budgetTotal: entNum(totalsEnt, "budget_total"),
      actualTotal: entNum(totalsEnt, "actual_total"),
      avgProgress: entNum(totalsEnt, "avg_progress"),
      atRiskCount: entNum(totalsEnt, "at_risk_count"),
      currencyCode: entStr(totalsEnt, "currency_code"),
    },
    projects: entArr(e, "projects").map((p) => ({
      projectId: entStr(p, "project_id") ?? "",
      name: entStr(p, "name"),
      typeKey: entStr(p, "type_key"),
      budget: entNum(p, "budget"),
      actual: entNum(p, "actual"),
      progressPct: entNum(p, "progress_pct"),
      health: entStr(p, "health"),
      soldPct: entNumOrNull(p, "sold_pct"),
    })),
    typeMix: entArr(e, "type_mix").map((m) => ({
      typeKey: entStr(m, "type_key") ?? "",
      budgetSum: entNum(m, "budget_sum"),
    })),
  };
}

/* ── Formatters ───────────────────────────────────────────────────────────────── */

/**
 * The prototype money formatter fmt (pototype/ds.jsx:4-5):
 * `Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 })`. The exec KPIs / table
 * cells call fmt() over MILLIONS values (its `roll` budgets are e.g. `248`, one unit =
 * one million baht), so the wire figure (THB) is scaled by 1e6 first, mirroring the
 * mock's unit exactly.
 */
const MILLION_FMT = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });

/** A THB amount → the prototype's millions display (fmt over value ÷ 1e6). */
export function fmtMillions(baht: number): string {
  if (!Number.isFinite(baht)) return "0";
  return MILLION_FMT.format(baht / 1e6);
}

/* ── Health tone (pototype/exec-audit.jsx:28 healthTone) ──────────────────────────
 * The stored health label is SERVER DATA (Thai) surfaced verbatim; these two
 * constants are the byte-exact good / watch labels written as \u escapes so no raw
 * Thai byte lands in source (B-073, mirrors dashboard-agg BAHT escape):
 *   HEALTH_OK    -> the "good" label     (U+0E14 U+0E35)
 *   HEALTH_WATCH -> the "watch" label    (U+0E40 U+0E1D U+0E49 U+0E32 U+0E23 U+0E30 U+0E27 U+0E31 U+0E07)
 */
const HEALTH_OK = "\u0E14\u0E35";
const HEALTH_WATCH = "\u0E40\u0E1D\u0E49\u0E32\u0E23\u0E30\u0E27\u0E31\u0E07";

/**
 * Health chip colour by stored label (exec-audit.jsx:28: good→ok · watch→warn ·
 * else→danger). A null (uncurated) health is NOT a value — it returns the neutral
 * tone, and the view renders an honest em-dash instead of a chip (section-0 rule 3).
 */
export function healthTone(health: string | null): string {
  if (health == null) return "var(--text-3)";
  if (health === HEALTH_OK) return "var(--ok)";
  if (health === HEALTH_WATCH) return "var(--warn)";
  return "var(--danger)";
}

/* ── Presentational rules + KPI derivations ───────────────────────────────────── */

/**
 * The "over" spend colouring rule (exec-audit.jsx:89): actual > budget × 0.9 → the
 * spend cell renders in danger. Presentational only (B-102: this 0.9 threshold is NOT
 * the health rule — health is the stored label; this only colours the cell).
 */
export function overSpend(actual: number, budget: number): boolean {
  return actual > budget * 0.9;
}

/**
 * Whole-percent actual-of-budget (exec-audit.jsx:41 `Math.round(totActual/totBudget*100)`)
 * — the actual-total KPI delta + its "% of budget" sub. 0-guarded (empty portfolio → 0).
 */
export function actualPctOfBudget(actual: number, budget: number): number {
  if (!Number.isFinite(actual) || !Number.isFinite(budget) || budget === 0) return 0;
  return Math.round((100 * actual) / budget);
}

/**
 * Distinct project-type count across the portfolio (the total-projects KPI "n types"
 * sub). The mock uses Object.keys(PROJECT_TYPES).length (its global type catalog);
 * that catalog is not in the portfolio response, so the honest analog derivable from
 * the wire is the number of distinct non-null type_keys present.
 */
export function distinctTypeCount(projects: PortfolioProject[]): number {
  const set = new Set<string>();
  for (const p of projects) if (p.typeKey != null) set.add(p.typeKey);
  return set.size;
}

/**
 * Bar fill fraction (pototype/ds.jsx Bar:169) — `min(100, value/max*100)`, 0 when
 * max ≤ 0. Drives every progress / type-mix bar width (the type-mix "bar math":
 * a type's budget_sum as a share of the portfolio budget_total).
 */
export function barPct(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, (value / max) * 100);
}
