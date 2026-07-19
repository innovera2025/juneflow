/*
 * Pure aggregation + transform logic for the Dashboard screen (P1-WEB-07, gate G3).
 *
 * The prototype (pototype/dashboard.jsx) is a MOCK: RANGE_DATA / approvals / phases /
 * alerts / cashflow / contractors / activity are all hardcoded. Per §0 rule 3 + C10
 * (PLAN.md Appendix C) none of those mock numbers are reproduced. This module instead
 * parses the OPAQUE Entity JSON returned by the 7 real GET /dashboard/* handlers
 * (apps/api/src/routes/dashboard.ts, B-049 / P1-BE-15) into typed rows, plus the pure
 * formatters, project-type/role config, donut geometry and Chart.js config the view
 * consumes. No React, no i18n, no fetch here — all lookups stay unit-testable (G3).
 *
 * WIRE REALITY (honest, never fabricated): most handlers return honest-empty on the
 * current seed (empty time-series, empty alerts/cashflow, null budget_used/status/
 * title/requester/urgent). The parsers surface those as empty arrays / null so the
 * view can render honest em-dash / empty states instead of the mock values.
 */
import type { ChartConfiguration } from "chart.js";
import { baseChartOpts, type ChartTheme } from "../../ui/chart";

/** The Thai baht glyph (U+0E3F) as an escape — no raw Thai byte in source (B-073). */
const BAHT = "\u0E3F";

/** An opaque contract Entity — every /dashboard/* body is `{ [k]: unknown }`. */
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

/** Boolean at `key`, else null (honest "unknown"). */
export function entBoolOrNull(e: Ent | undefined, key: string): boolean | null {
  const v = e?.[key];
  return typeof v === "boolean" ? v : null;
}

/** Array of Entities at `key`, else []. */
export function entArr(e: Ent | undefined, key: string): Ent[] {
  const v = e?.[key];
  return Array.isArray(v) ? (v as Ent[]) : [];
}

/* ── Parsed row types ────────────────────────────────────────────────────────── */

/** GET /dashboard/summary — header meta + type-aware KPIs + health donut. */
export interface DashSummary {
  projectId: string | null;
  projectName: string | null;
  projectType: string | null;
  activePhaseLabel: string | null;
  asOf: string | null;
  statusLabel: string | null;
  /** "budget" | "solar" — which KPI set the handler populated. */
  kpiKind: string;
  budgetTotal: number;
  actualTotal: number;
  committedTotal: number;
  remainingTotal: number;
  installedCapacity: number | null;
  energyYtd: number | null;
  performanceRatio: number | null;
  currencyCode: string | null;
  healthScore: number;
  range: string;
}

export interface CostCategory {
  /** boq_group name (server data — dynamic, rendered as-is, not an i18n key). */
  label: string | null;
  actual: number;
  plan: number;
}

/** GET /dashboard/budget-actual — time-series (honest-empty on seed) + breakdown. */
export interface BudgetActual {
  range: string;
  rangeLabel: string;
  periodLabel: string[];
  budget: number[];
  actual: number[];
  plan: number[];
  costCategories: CostCategory[];
  currencyCode: string | null;
}

/** One row of GET /dashboard/approvals-inbox (title/requester/urgent are wire gaps). */
export interface ApprovalItem {
  kind: string;
  docNo: string | null;
  title: string | null;
  requester: string | null;
  amount: number | null;
  currencyCode: string | null;
  urgent: boolean | null;
}

/** One row of GET /dashboard/phase-progress (budgetUsed/status are wire gaps → null). */
export interface PhaseRow {
  name: string | null;
  units: number;
  sold: number;
  built: number;
  budgetUsed: number | null;
  status: string | null;
}

/** One row of GET /dashboard/alerts (honest-empty on seed). */
export interface AlertRow {
  tone: string;
  code: string;
  title: string | null;
  sub: string;
}

export interface CashflowRow {
  dueDate: string;
  label: string | null;
  amount: number;
}

/** GET /dashboard/cashflow-forecast — 7-day net + line items (empty on seed). */
export interface Cashflow {
  netTotal: number;
  currencyCode: string | null;
  rows: CashflowRow[];
}

/** One row of GET /dashboard/contractors (workScope is a wire gap → null). */
export interface ContractorRow {
  vendorName: string | null;
  workScope: string | null;
  progressPct: number;
  retentionAmount: number;
  currencyCode: string | null;
}

/* ── Parsers (opaque Entity → typed) ──────────────────────────────────────────── */

export function parseSummary(e: Ent | undefined): DashSummary | null {
  if (!e) return null;
  return {
    projectId: entStr(e, "project_id"),
    projectName: entStr(e, "project_name"),
    projectType: entStr(e, "project_type"),
    activePhaseLabel: entStr(e, "active_phase_label"),
    asOf: entStr(e, "as_of"),
    statusLabel: entStr(e, "status_label"),
    kpiKind: entStr(e, "kpi_kind") ?? "budget",
    budgetTotal: entNum(e, "budget_total"),
    actualTotal: entNum(e, "actual_total"),
    committedTotal: entNum(e, "committed_total"),
    remainingTotal: entNum(e, "remaining_total"),
    installedCapacity: entNumOrNull(e, "installed_capacity"),
    energyYtd: entNumOrNull(e, "energy_ytd"),
    performanceRatio: entNumOrNull(e, "performance_ratio"),
    currencyCode: entStr(e, "currency_code"),
    healthScore: entNum(e, "health_score"),
    range: entStr(e, "range") ?? "year",
  };
}

export function parseBudgetActual(e: Ent | undefined): BudgetActual | null {
  if (!e) return null;
  const strArr = (key: string): string[] =>
    (Array.isArray(e[key]) ? (e[key] as unknown[]) : []).map((v) => String(v));
  const numArr = (key: string): number[] =>
    (Array.isArray(e[key]) ? (e[key] as unknown[]) : []).map((v) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    });
  return {
    range: entStr(e, "range") ?? "year",
    rangeLabel: entStr(e, "range_label") ?? "",
    periodLabel: strArr("period_label"),
    budget: numArr("budget_amount"),
    actual: numArr("actual_amount"),
    plan: numArr("plan_amount"),
    costCategories: entArr(e, "cost_categories").map((c) => ({
      label: entStr(c, "category_label"),
      actual: entNum(c, "actual_value"),
      plan: entNum(c, "plan_value"),
    })),
    currencyCode: entStr(e, "currency_code"),
  };
}

export function parseApprovals(rows: Ent[]): ApprovalItem[] {
  return rows.map((r) => ({
    kind: entStr(r, "kind") ?? "",
    docNo: entStr(r, "doc_no"),
    title: entStr(r, "title"),
    requester: entStr(r, "requester"),
    amount: entNumOrNull(r, "amount"),
    currencyCode: entStr(r, "currency_code"),
    urgent: entBoolOrNull(r, "urgent"),
  }));
}

export function parsePhaseRows(rows: Ent[]): PhaseRow[] {
  return rows.map((r) => ({
    name: entStr(r, "name"),
    units: entNum(r, "units"),
    sold: entNum(r, "sold"),
    built: entNum(r, "built"),
    budgetUsed: entNumOrNull(r, "budget_used"),
    status: entStr(r, "status"),
  }));
}

export function parseAlerts(rows: Ent[]): AlertRow[] {
  return rows.map((r) => ({
    tone: entStr(r, "tone") ?? "warn",
    code: entStr(r, "code") ?? "",
    title: entStr(r, "title"),
    sub: entStr(r, "sub") ?? "",
  }));
}

export function parseCashflow(e: Ent | undefined): Cashflow | null {
  if (!e) return null;
  return {
    netTotal: entNum(e, "net_total"),
    currencyCode: entStr(e, "currency_code"),
    rows: entArr(e, "rows").map((r) => ({
      dueDate: entStr(r, "due_date") ?? "",
      label: entStr(r, "label"),
      amount: entNum(r, "amount"),
    })),
  };
}

export function parseContractors(rows: Ent[]): ContractorRow[] {
  return rows.map((r) => ({
    vendorName: entStr(r, "vendor_name"),
    workScope: entStr(r, "work_scope"),
    progressPct: entNum(r, "progress_pct"),
    retentionAmount: entNum(r, "retention_amount"),
    currencyCode: entStr(r, "currency_code"),
  }));
}

/* ── Activity feed (GET /audit-log → typed rows) ──────────────────────────────────
 * The prototype's recent-activity card (pototype/dashboard.jsx L531-550) is a 5-row
 * MOCK; this reads the real GET /audit-log (B-014 envelope, rows newest-first). Each
 * row is `{ id, user_id, user_name, action, entity, at }` (apps/api/src/routes/
 * audit-log.ts). `action` is classified to a known verb (label rendered by the view
 * via i18n — no Thai here); `entity` (doc) is shown RAW (Wei ruling C-127, no mapping);
 * an unknown action keeps its raw string honestly (§0 rule 3, never invented).
 */

/** Known audit verbs (pototype/exec-audit.jsx AUDIT_ACT, L177-180). */
export type AuditVerb = "create" | "edit" | "approve" | "delete" | "post" | "sync";

const KNOWN_VERBS: readonly AuditVerb[] = ["create", "edit", "approve", "delete", "post", "sync"];

/** A raw action string → known verb, else null (unknown → view shows the raw action). */
export function classifyVerb(action: string): AuditVerb | null {
  return (KNOWN_VERBS as readonly string[]).includes(action) ? (action as AuditVerb) : null;
}

/**
 * Status-dot colour by verb — transcribed from the prototype's 5 mock row tones
 * (pototype/dashboard.jsx L535-539: create=var(--brand) · approve=#15803D ·
 * sync=#1D4ED8 · delete=#B91C1C · edit/post neutral #475569). An unknown verb takes
 * the neutral tone. Hexes are prototype-verbatim (mirrors B-037(a) status-dot rule).
 */
const AUDIT_DOT: Record<AuditVerb, string> = {
  create: "var(--brand)",
  approve: "#15803D",
  sync: "#1D4ED8",
  delete: "#B91C1C",
  edit: "#475569",
  post: "#475569",
};
const AUDIT_DOT_DEFAULT = "#475569";

export function auditDotColor(verb: AuditVerb | null): string {
  return verb ? AUDIT_DOT[verb] : AUDIT_DOT_DEFAULT;
}

/** One parsed activity-feed row (i18n/time-ago applied by the view, not here). */
export interface ActivityRow {
  id: string;
  /** users.name resolved by the API (the system-actor label for system rows; null when unresolved). */
  who: string | null;
  verb: AuditVerb | null;
  /** Raw action string — shown honestly when `verb` is null (unknown action). */
  actionRaw: string;
  /** entity RAW as stored (Wei ruling C-127 — no display mapping). */
  doc: string;
  /** ISO timestamp; the view derives time-ago against the current clock. */
  atIso: string;
}

/**
 * Map the newest `limit` audit rows (API is already newest-first) to typed feed rows.
 * The prototype shows 5 (L534-539), so `limit` defaults to 5.
 */
export function parseActivity(rows: Ent[], limit = 5): ActivityRow[] {
  return rows.slice(0, limit).map((r) => {
    const action = entStr(r, "action") ?? "";
    return {
      id: entStr(r, "id") ?? "",
      who: entStr(r, "user_name"),
      verb: classifyVerb(action),
      actionRaw: action,
      doc: entStr(r, "entity") ?? "",
      atIso: entStr(r, "at") ?? "",
    };
  });
}

/** Time-ago quantity + unit (pototype/dashboard.jsx L535-539, e.g. "5 min" / "1 hr"). */
export interface TimeAgo {
  n: number;
  unit: "min" | "hr";
}

/**
 * Whole-unit time-ago of `atIso` before `nowMs`, rounded down. Under 60 min → minutes
 * (floor, min 1 — never a zero-minute label); otherwise hours (floor). The seed feed
 * spans 0-16h, so minute/hour cover it — no day unit is invented (not in the i18n set).
 */
export function timeAgo(atIso: string, nowMs: number): TimeAgo {
  const atMs = Date.parse(atIso);
  const diffMin = Number.isFinite(atMs) ? Math.floor((nowMs - atMs) / 60000) : 0;
  if (diffMin < 60) return { n: Math.max(1, diffMin), unit: "min" };
  return { n: Math.floor(diffMin / 60), unit: "hr" };
}

/* ── Formatters ───────────────────────────────────────────────────────────────── */

/** Baht → "millions, 1 decimal" (prototype KPI shows "284.5"), NaN/∞ → "0.0". */
export function millions1(baht: number): string {
  if (!Number.isFinite(baht)) return "0.0";
  return (baht / 1e6).toFixed(1);
}

/** Group a full-unit amount with thousands separators (ASCII digits + comma). */
export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Whole-percent `part` is of `whole` (0-guard) — mirrors the prototype ratios. */
export function pctOf(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) return 0;
  return Math.round((100 * part) / whole);
}

/* ── Project-type + role config (pure maps, no i18n) ──────────────────────────── */

export type DashRole = "exec" | "manager" | "accountant" | "engineer";

/** Which optional widget rows a role sees (pototype/dashboard.jsx RF map, L201-206). */
export interface RoleVisibility {
  /** phase-progress + alerts row. */
  progress: boolean;
  /** cashflow + contractors + activity row. */
  cashflow: boolean;
}

const ROLE_VIS: Record<DashRole, RoleVisibility> = {
  exec: { progress: true, cashflow: true },
  manager: { progress: true, cashflow: true },
  accountant: { progress: false, cashflow: true },
  engineer: { progress: true, cashflow: false },
};

export function roleVisibility(role: DashRole): RoleVisibility {
  return ROLE_VIS[role] ?? ROLE_VIS.manager;
}

/** Presentational status-badge kind by project type (mock STATUS_LABEL, L218). */
export type StatusKind = "construction" | "solarCOD" | "operating";

export function statusKind(typeKey: string | null | undefined): StatusKind {
  switch (typeKey) {
    case "realestate":
    case "civil":
      return "construction";
    case "solar":
      return "solarCOD";
    default:
      return "operating";
  }
}

/** Which KPI-branch layout a project type renders (pototype L299-347). */
export type KpiBranch = "solar" | "workProgress" | "budget";

export function kpiBranch(typeKey: string | null | undefined): KpiBranch {
  if (typeKey === "solar") return "solar";
  if (typeKey === "civil" || typeKey === "service") return "workProgress";
  return "budget";
}

/** Average of a phase set's sold% (prototype avgProgress, L217), 0 when empty. */
export function avgSold(rows: PhaseRow[]): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((s, p) => s + (p.sold || 0), 0);
  return Math.round(sum / rows.length);
}

/* ── Donut geometry (pototype/dashboard.jsx Donut, L76-79) ────────────────────── */

export interface DonutGeometry {
  radius: number;
  circumference: number;
  offset: number;
}

export function donutGeometry(value: number, size = 90, stroke = 10): DonutGeometry {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  return { radius: r, circumference: c, offset: c - (clamped / 100) * c };
}

/* ── Budget-vs-actual Chart.js config (pototype BudgetActualChart, L43-73) ─────── */

export interface ChartDatasetLabels {
  budget: string;
  actual: string;
  plan: string;
}

/**
 * Compose the bar+line chart config from the REAL budget-actual series. Mirrors the
 * prototype datasets 1:1 (budget bar = brandSoft, actual bar = brand, danger when a
 * period's actual exceeds its budget, plan = dashed accent line). On the current seed
 * the series is honestly EMPTY (no time-bucketed cost data) → an empty-but-valid chart.
 * Dataset labels come from i18n via the caller (never literal Thai here); `unit` is the
 * ASCII axis suffix ("M"). The tooltip renders an em-dash for null points, never a fake.
 */
export function buildBudgetActualConfig(
  theme: ChartTheme,
  ba: BudgetActual,
  labels: ChartDatasetLabels,
  unit = "M",
): ChartConfiguration {
  return {
    type: "bar",
    data: {
      labels: ba.periodLabel,
      datasets: [
        {
          label: labels.budget,
          data: ba.budget,
          backgroundColor: theme.brandSoft,
          borderColor: theme.brandSoft,
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 0.66,
          categoryPercentage: 0.85,
          order: 3,
        },
        {
          label: labels.actual,
          data: ba.actual,
          backgroundColor: ba.actual.map((v, i) =>
            v != null && v > (ba.budget[i] ?? Infinity) ? theme.danger : theme.brand,
          ),
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 0.45,
          categoryPercentage: 0.6,
          order: 2,
        },
        {
          label: labels.plan,
          data: ba.plan,
          type: "line",
          borderColor: theme.accent,
          backgroundColor: theme.accent,
          borderWidth: 2,
          borderDash: [4, 3],
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          order: 1,
        },
      ],
    },
    options: baseChartOpts(theme, {
      scales: {
        x: { grid: { display: false }, ticks: { color: theme.text } },
        y: {
          grid: { color: theme.grid },
          border: { display: false },
          ticks: { color: theme.text, callback: (v) => `${v}${unit}` },
          beginAtZero: true,
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx) =>
            `${ctx.dataset.label}: ${
              ctx.parsed.y != null ? `${ctx.parsed.y.toFixed(1)}${unit} ${BAHT}` : "—"
            }`,
        },
      },
    }),
  };
}
