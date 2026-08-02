/*
 * LaborWorkers list-row helpers (P5-WEB, read-only) — pure, i18n-free, ASCII-only logic
 * narrowed from pototype/labor.jsx LaborWorkers (L18-71). No Thai/baht literal lives here
 * (PLAN.md section 0 rule 2/6); the screen supplies every label from i18n keys.
 *
 * The prototype held workers in a local WORKERS_SEED array (labor.jsx L6-15) whose rows
 * carried a mock string id ("W-001"), name, team, type, wage, skill, active. Section 0
 * rule 3: that mock is dropped — the list is the real server catalogue (GET /labor/workers,
 * use-labor.ts) whose worker wire is
 *   { id, name, day_rate, currency_code, code, team, supervisor, skill, pay_type, active,
 *     created_at }   (apps/api/src/routes/labor.ts workerWire L219-233)
 * MAP: the mock w.id ("W-001") is the wire `code` (business code, brand-bold in the table),
 * NOT the wire `id` (a uuid, React key only); w.wage -> day_rate (money, nullable ->
 * currency_code); w.type -> pay_type (free-text server data). supervisor/created_at are
 * unused by this screen.
 *
 * DIVERGENCE (reported, never fabricated): the prototype's Teams KPI counted a
 * hardcoded LABOR_TEAMS const (4 teams); there is no /labor/teams endpoint, so the team
 * count + the filter options are DERIVED from the fetched worker rows (distinctTeams) —
 * the count can differ from the prototype's fixed 4 when the rows cover fewer teams.
 * day_rate is nullable on the wire (the seed always set it): a null rate renders an
 * em-dash in the table (view) and is summed as 0 in the KPI aggregates (the prototype's
 * `Sum(wage)/n` formula, kept faithful).
 */

/** A worker as the table + KPIs consume it (GET /labor/workers row, narrowed). */
export interface WorkerRow {
  /** Server uuid — React key only, never rendered. */
  id: string;
  /** Business code (e.g. "W-001") — the brand-bold code column; "" when absent. */
  code: string;
  /** Full name (free-text server data, rendered raw). */
  name: string;
  /** Team name (free-text server data; "" when unassigned). */
  team: string;
  /** Skill (free-text server data; "" when absent). */
  skill: string;
  /** Pay type (free-text server data, e.g. daily; "" when absent). */
  payType: string;
  /** Day rate in FULL currency units (money -> currencyCode); null when unset. */
  dayRate: number | null;
  currencyCode: string;
  /** Active flag — drives the status badge + row opacity. */
  active: boolean;
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number OR null (money that may be unset on the wire). */
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Read a boolean field; falls back to `dflt` when absent/non-boolean. */
function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === "boolean" ? v : dflt;
}

/**
 * Narrow an opaque /labor/workers Entity row to the WorkerRow the screen needs. Multi-word
 * fields accept snake_case (server convention, workerWire) or camelCase for robustness
 * (mirrors land-bank-rows.toPlotRow). Missing fields default (0 / "" / null); `active`
 * defaults true (the schema default).
 */
export function toWorkerRow(e: Record<string, unknown>): WorkerRow {
  return {
    id: str(e.id),
    code: str(e.code),
    name: str(e.name),
    team: str(e.team),
    skill: str(e.skill),
    payType: str(e.pay_type ?? e.payType),
    dayRate: numOrNull(e.day_rate ?? e.dayRate),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    active: bool(e.active, true),
  };
}

/* --------------------------------------------------------------------------- */
/* Team filter + derivation (labor.jsx L20-21 / L38 / L45)                       */
/* --------------------------------------------------------------------------- */

/**
 * The distinct non-empty team names across the workers, in first-seen order — replaces
 * the hardcoded LABOR_TEAMS const (labor.jsx L5) for both the Teams KPI count and the
 * team filter options (DIVERGENCE: derived, no /labor/teams endpoint).
 */
export function distinctTeams(rows: readonly WorkerRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (r.team && !seen.has(r.team)) {
      seen.add(r.team);
      out.push(r.team);
    }
  }
  return out;
}

/** Filter the workers by team equality (labor.jsx L21); "" = no team filter. */
export function filterByTeam(rows: readonly WorkerRow[], team: string): WorkerRow[] {
  return rows.filter((r) => !team || r.team === team);
}

/* --------------------------------------------------------------------------- */
/* KPI aggregates (labor.jsx L37-40) — all over the FULL fetched set, not filtered */
/* --------------------------------------------------------------------------- */

/** Count of active workers (KPI-Total sub + row status). */
export function activeCount(rows: readonly WorkerRow[]): number {
  return rows.filter((r) => r.active).length;
}

/** Count of inactive workers (KPI-Total sub). */
export function inactiveCount(rows: readonly WorkerRow[]): number {
  return rows.filter((r) => !r.active).length;
}

/**
 * Average day rate, rounded (labor.jsx L39 `Math.round(Sum(wage)/rows.length)`). A null
 * rate is summed as 0 (faithful to the prototype formula, which divided by the full row
 * count); an empty set yields 0 (no division-by-zero fabrication).
 */
export function avgWage(rows: readonly WorkerRow[]): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((s, r) => s + (r.dayRate ?? 0), 0);
  return Math.round(sum / rows.length);
}

/**
 * Estimated total day wage if every ACTIVE worker attends (labor.jsx L40
 * `Sum(active wage)`). Null rates count as 0.
 */
export function estimatedDayWage(rows: readonly WorkerRow[]): number {
  return rows.filter((r) => r.active).reduce((s, r) => s + (r.dayRate ?? 0), 0);
}

/* --------------------------------------------------------------------------- */
/* Status badge (labor.jsx L63) — active -> approved, inactive -> draft          */
/* --------------------------------------------------------------------------- */

/** The ds.jsx STATUS key the row badge uses: active -> approved, else draft. */
export function statusKind(active: boolean): "approved" | "draft" {
  return active ? "approved" : "draft";
}

/* --------------------------------------------------------------------------- */
/* Number formatting (labor.jsx uses ds.jsx fmt)                                 */
/* --------------------------------------------------------------------------- */

/**
 * Group a FULL-unit amount with thousands separators ("450000" -> "450,000"), matching
 * the prototype's Intl fmt (ds.jsx th-TH, maximumFractionDigits 0). ASCII digits + comma
 * only; NaN / non-finite -> "0". Mirrors land-bank-rows.formatMoney.
 */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
