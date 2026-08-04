/*
 * Project-P&L view-model helpers for GLProjectPL (gl.projectpl) — pure, i18n-free, ASCII-only
 * logic ported from pototype/accounting-extra2.jsx GLProjectPL (L343-494). Route gl.projectpl
 * (docs/extract/NAV-ROUTES.md L66, section "gl").
 *
 * The prototype held the whole comparison in a local mock (PROJPL_SEED — fixed Thai project
 * names/types + hardcoded revenue/cogs sub-lines, computing GP / EBIT / tax / net / margins on
 * the CLIENT via plRev/plCogs/plGP/plEBIT/plNP). §0 rule 3: that mock is dropped — every figure is
 * the REAL server aggregation from GET /gl/reports/project-pl (apps/api/src/routes/gl.ts glProjectPl
 * L1086-1181). The wire is the opaque EntityOk OBJECT (NOT a B-014 list envelope):
 *   { projects: ProjectPlWire[],
 *     totals: { revenue, cogs, gross_profit, sga, interest, net_income, net_margin,
 *               project_count, losing_count },
 *     currency_code }
 *   ProjectPlWire = { project_id, project_name, revenue, cogs, gross_profit, sga, interest,
 *                     pre_tax, tax, net_income, gross_margin, net_margin }
 *
 * MONEY AUTHORITY (§0 + apps/web/CLAUDE.md — the P&L is SERVER-computed, money=NONE on the web):
 * the server owns 100% of the authoritative figures. Every result figure — gross_profit, pre_tax,
 * tax, net_income, and BOTH margins — is read STRAIGHT off the wire and is NEVER recomputed here
 * (a client roll-up would be forbidden money-math that could diverge from the server). The only
 * client arithmetic anywhere is the presentational "SG&A + interest" column GROUPING (sum of two
 * already-authoritative server cost fields into one combined display column, mirroring the
 * prototype `p.sga + p.interest`) — it is not a P&L result the server owns differently and cannot
 * diverge. `pickBest` SELECTS (never computes) the highest-net-margin row for the KPI.
 *
 * Margins arrive from the server ALREADY IN PERCENT (gross_margin: 40 means 40%) and HONEST-NULL at
 * 0 revenue (never a divide-by-zero / fabricated 0%) — a null renders an em-dash in the .tsx.
 *
 * HONEST DIVERGENCES (never fabricated), documented in gl.ts and surfaced in gl-projectpl.tsx:
 *   - the prototype's per-project `type` sub-label + the modal's indented revenue/cogs SUB-LINES +
 *     its EBIT subtotal have no wire source (the endpoint AGGREGATES to totals per project) -> they
 *     are omitted, never fabricated. The register + the detail modal render only server fields.
 *   - the "best margin" ordering: the server returns projects revenue-desc (a stable order the
 *     seed's margin-sort lacks); `pickBest` re-selects the max-net-margin row for the KPI off the
 *     loaded server figures (an ap-deposit-style KPI selection, not a recomputation).
 * ASCII-only, tokens-free, no Thai/baht (B-073).
 */

/** The em-dash marker for an honest-null margin / a missing name (U+2014 — ASCII-safe, not Thai). */
const DASH = "—";

/** One project P&L row as the register consumes it (narrowed from an opaque wire object). All money
 *  fields are FULL baht, server-authoritative; margins are server percents, honest-null at 0 rev. */
export interface ProjectPlRow {
  /** project_id — null for the unallocated (central) bucket (jv_line with a NULL project_id). */
  projectId: string | null;
  /** project_name — "" (central bucket / unresolved FK) renders an em-dash in the .tsx. */
  projectName: string;
  revenue: number;
  cogs: number;
  /** Server gross_profit (= revenue − cogs, server-computed). Read off the wire, never recomputed. */
  grossProfit: number;
  sga: number;
  interest: number;
  /** Server pre_tax (= gp − sga − interest). */
  preTax: number;
  /** Server tax (flat 20% estimate when pre_tax > 0, else 0). */
  tax: number;
  /** Server net_income (= pre_tax − tax). */
  netIncome: number;
  /** Server gross margin in PERCENT; null at 0 revenue (honest-null). */
  grossMargin: number | null;
  /** Server net margin in PERCENT; null at 0 revenue (honest-null). */
  netMargin: number | null;
}

/** Register totals (the wire `totals` object — every figure server-authoritative). */
export interface ProjectPlTotals {
  revenue: number;
  cogs: number;
  grossProfit: number;
  sga: number;
  interest: number;
  netIncome: number;
  /** Server total net margin in PERCENT; null at 0 total revenue. */
  netMargin: number | null;
  projectCount: number;
  losingCount: number;
}

/** The whole project-P&L payload (the narrowed EntityOk object). */
export interface ProjectPlVM {
  rows: ProjectPlRow[];
  totals: ProjectPlTotals;
  currencyCode: string;
}

/** Read a string field off an opaque value; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque value; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Read a number-or-null field (honest-null margins stay null; never coerced to 0). */
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Coerce an unknown to a plain record ({} when it is not an object). */
function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Coerce an unknown to an array ([] when it is not one). */
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Narrow one opaque wire project object to a ProjectPlRow (every result figure read straight off
 *  the wire — nothing recomputed here). */
export function toProjectPlRow(e: Record<string, unknown>): ProjectPlRow {
  const projectId = e.project_id ?? e.projectId;
  return {
    projectId: projectId == null ? null : str(projectId),
    projectName: str(e.project_name ?? e.projectName),
    revenue: num(e.revenue),
    cogs: num(e.cogs),
    grossProfit: num(e.gross_profit ?? e.grossProfit),
    sga: num(e.sga),
    interest: num(e.interest),
    preTax: num(e.pre_tax ?? e.preTax),
    tax: num(e.tax),
    netIncome: num(e.net_income ?? e.netIncome),
    grossMargin: numOrNull(e.gross_margin ?? e.grossMargin),
    netMargin: numOrNull(e.net_margin ?? e.netMargin),
  };
}

/** Narrow the wire `totals` object (every figure server-authoritative; net_margin honest-null). */
export function toProjectPlTotals(v: unknown): ProjectPlTotals {
  const o = asRecord(v);
  return {
    revenue: num(o.revenue),
    cogs: num(o.cogs),
    grossProfit: num(o.gross_profit ?? o.grossProfit),
    sga: num(o.sga),
    interest: num(o.interest),
    netIncome: num(o.net_income ?? o.netIncome),
    netMargin: numOrNull(o.net_margin ?? o.netMargin),
    projectCount: num(o.project_count ?? o.projectCount),
    losingCount: num(o.losing_count ?? o.losingCount),
  };
}

/**
 * Narrow the opaque EntityOk object into a ProjectPlVM. The wire is a single object (unwrap()
 * already stripped the envelope) — NOT a list, so every branch is read off the object directly.
 * A missing/empty payload yields no rows, zero totals, and a THB default (nothing is fabricated).
 */
export function toProjectPl(
  entity: Record<string, unknown> | null | undefined,
): ProjectPlVM {
  const obj = asRecord(entity);
  return {
    rows: asArray(obj.projects).map((r) => toProjectPlRow(asRecord(r))),
    totals: toProjectPlTotals(obj.totals),
    currencyCode: str(obj.currency_code ?? obj.currencyCode) || "THB",
  };
}

/**
 * SELECT (never compute) the highest-net-margin project for the "best margin" KPI — the prototype's
 * `[...rows].sort((a,b) => netMargin(b) − netMargin(a))[0]`. Rows with a null margin (0-revenue
 * projects) are ineligible. Returns null when no eligible row exists (empty / all-null). The KPI
 * value it feeds is the row's SERVER net margin — this is an ap-deposit-style selection over the
 * loaded server figures, not a client money computation.
 */
export function pickBest(rows: ProjectPlRow[]): ProjectPlRow | null {
  let best: ProjectPlRow | null = null;
  for (const r of rows) {
    if (r.netMargin == null) continue;
    if (best == null || r.netMargin > (best.netMargin ?? -Infinity)) best = r;
  }
  return best;
}

/** The names of the losing projects (server net_income < 0), for the losing-count KPI sub. Empty
 *  names (central bucket) fall back to the em-dash, never dropped silently. */
export function losingNames(rows: ProjectPlRow[]): string[] {
  return rows.filter((r) => r.netIncome < 0).map((r) => r.projectName || DASH);
}

/**
 * Presentational GROUPING of the two server cost fields into the register's single "SG&A + interest"
 * column (prototype `p.sga + p.interest`). Both inputs are already server-authoritative; this is a
 * display combine, NOT a P&L result the server owns — it cannot diverge.
 */
export function sgaInterest(row: { sga: number; interest: number }): number {
  return row.sga + row.interest;
}

/**
 * Group a FULL-baht amount with thousands separators ("1000000" -> "1,000,000"), matching the
 * prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits + comma only (no baht
 * symbol / decimals); negative keeps a leading "-"; non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Accounting-style amount: a negative shows in parentheses "(600,000)", a non-negative shows plain
 * "1,000,000" (prototype accounting-extra2.jsx L385/465 `v < 0 ? (fmt(-v)) : fmt(v)`).
 */
export function formatParen(n: number): string {
  return n < 0 ? `(${formatMoney(-n)})` : formatMoney(n);
}

/**
 * Display-scale a FULL-baht figure to millions with 1dp for a KPI value (prototype `(n/1e6)
 * .toFixed(1)`). A pure presentation scaling — the underlying figure stays server-authoritative.
 */
export function formatMillions(n: number): string {
  return (n / 1e6).toFixed(1);
}

/**
 * A server margin percent to a "40.0%" string, or the em-dash for an HONEST-NULL margin (0 revenue)
 * — never a fabricated "0.0%". The percent is server-owned; this only fixes it to 1dp + appends "%".
 */
export function formatMargin(pct: number | null): string {
  return pct == null ? DASH : `${pct.toFixed(1)}%`;
}

/**
 * The GP-margin bar fill width (0..100) at the prototype's fixed max=50% scale
 * (accounting-extra2.jsx L460 `<Bar value={Math.max(0, gpPct)} max={50}/>`). Presentational only;
 * a null margin -> 0 width (the .tsx shows an em-dash instead of the bar). Clamped to [0,100].
 */
export function marginBarPct(pct: number | null): number {
  if (pct == null) return 0;
  const scaled = (Math.max(0, pct) / 50) * 100;
  return Math.min(100, Math.max(0, scaled));
}
