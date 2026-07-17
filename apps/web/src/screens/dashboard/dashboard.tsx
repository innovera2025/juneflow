/*
 * Dashboard — the app landing screen, ported from pototype/dashboard.jsx Dashboard
 * (L192-556). Route `dashboard` (docs/extract/NAV-ROUTES.md L14, default landing);
 * visual-gate reference gallery/g1/01-s.jpg.
 *
 * §0 fidelity (rule 1): the layout is the prototype's, verbatim — the two-crumb topbar
 * (juneflow · Dashboard) with the 4 role pills + report action, the page header (title +
 * status badge + type badge + as-of/sync subtitle + range switch + date picker), the role
 * focus banner, the type-aware KPI row, the budget-vs-actual chart card with legend + cost
 * breakdown, the approval inbox, the phase-progress + alerts/health row, and the cashflow +
 * contractors + activity row. Role gating (RF map) and project-type KPI branches match.
 *
 * Data (§0 rule 3 + C10): the prototype's RANGE_DATA / approvals / phases / alerts /
 * cashflow / contractors / activity mock is DROPPED. Every widget reads its real
 * GET /dashboard/* operation via the generated client (use-dashboard.ts), scoped to the
 * ProjectSwitcher active project (?project_id). Pure parse/format/config logic lives in
 * dashboard-agg.ts (gate G3).
 *
 * WIRE GAPS (reported honestly, never fabricated — see dashboard.ts DATA GAPS):
 *  1. budget-actual has NO time-bucketed series on the seed → the chart renders empty
 *     (structure only); the real part is the cost-category breakdown (boq-group budget/used).
 *  2. approvals-inbox rows carry no title/requester/urgency and no doc id → those fields are
 *     omitted, and the row's approve button routes to the doc-type list (where the real
 *     per-doc approve lives) instead of a dashboard-local write (none exists).
 *  3. phase-progress budget_used + status are wire gaps → em-dash / no status pill.
 *  4. alerts + cashflow-forecast are honest-empty on the seed → empty states, never the
 *     mock's 3 alerts / -18.4M.
 *  5. summary.health_score is a single budget-utilisation ratio (not the mock's opaque
 *     "5-indicator" score) → the donut shows the real %, the qualitative descriptor is —.
 *  6. There is NO recent-activity endpoint in the contract → that card is an empty state.
 *  7. KPI deltas the seed cannot derive (edit-count, MoM, committed doc-count, remain-days)
 *     are omitted rather than reproduced; the derivable ones (over/below-plan, work-progress
 *     on-plan/start) are shown from real figures.
 *  8. The date picker's month-start / year-start quick jumps + its no-value placeholder are
 *     omitted — that copy has NO i18n key (§0 rule 2 -> BLOCKERS: the month-start, year-start,
 *     and "choose a date" strings; the picker always has a value so the placeholder is unused).
 *  9. Role selection is local state (the prototype persisted ctx.tweaks.dashRole; the web
 *     Tweaks type has no such field) → it resets on remount.
 *
 * i18n (§0 rule 2): every string is a dashboard.* / common.* / project.* dict key (t), or a
 * dashboard-strings.json phrase (tp) verified present in i18n-full.json. Comments are
 * English-only (CLAUDE.md); Thai lives only in the keys / server data. Tokens back every
 * colour (rule 6); status-dot hexes are prototype-verbatim (B-037(a)).
 */
import { useEffect, useState, type ReactNode } from "react";
import type { DictKey, PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { ChartCanvas } from "../../ui/chart";
import { DatePicker, formatThaiShort } from "../../ui/date-picker";
import { RangeSwitch } from "../../ui/range-switch";
import { TopBar } from "../../shell/topbar";
import { TypeBadge } from "../../shell/type-badge";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects, resolveActiveProject } from "../../shell/use-shell-data";
import {
  useDashboardSummary,
  useDashboardBudgetActual,
  useDashboardApprovals,
  useDashboardPhaseProgress,
  useDashboardAlerts,
  useDashboardCashflow,
  useDashboardContractors,
} from "./use-dashboard";
import {
  buildBudgetActualConfig,
  donutGeometry,
  millions1,
  formatInt,
  pctOf,
  avgSold,
  roleVisibility,
  statusKind,
  kpiBranch,
  type DashRole,
  type DashSummary,
  type ApprovalItem,
  type PhaseRow,
  type ContractorRow,
  type CashflowRow,
} from "./dashboard-agg";
import strings from "./dashboard-strings.json" with { type: "json" };

/** Phrase-key accessor for dashboard-strings.json (Thai phrase IS the key -> tp). */
const P = (k: keyof typeof strings) => strings[k] as PhraseKey;
/** Honest placeholder for any figure the wire does not carry (§0 rule 3, never invented). */
const DASH = "—";
/** Thai baht glyph (U+0E3F) as an escape — no raw Thai byte in source (B-073). */
const BAHT = "\u0E3F";

/** Fill "{token}" placeholders in a template value (i18n has no interpolation, B-017). */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/* ── Presentational primitives (view-only, inlined like other ported screens) ──── */

/** Bar — ported from ds.jsx Bar (168-190). */
function Bar({ value, max, danger, height = 6 }: { value: number; max: number; danger?: boolean; height?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = value > max;
  const color = over || danger ? "var(--danger)" : pct > 85 ? "var(--warn)" : "var(--brand)";
  return (
    <div style={{ width: "100%", height, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999, transition: "width .3s" }} />
    </div>
  );
}

/** Approved-tone status badge (ds.jsx StatusBadge, L93; dashboard only uses "approved"). */
function StatusBadge({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        borderRadius: 4,
        background: "var(--ok-soft)",
        color: "var(--ok)",
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        letterSpacing: "-0.005em",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: "#16A34A" }} />
      {children}
    </span>
  );
}

/** Donut — ported from dashboard.jsx Donut (76-89); value is the real health_score. */
function Donut({ value, size = 90, stroke = 10, color = "var(--accent)" }: { value: number; size?: number; stroke?: number; color?: string }) {
  const g = donutGeometry(value, size, stroke);
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={g.radius} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={g.radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={g.circumference}
        strokeDashoffset={g.offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 + 2} fontSize="18" fontWeight="700" textAnchor="middle" dominantBaseline="middle" fill="var(--text)" className="num">
        {value}%
      </text>
    </svg>
  );
}

type DeltaTone = "danger" | "ok" | "neutral";
interface KpiProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  deltaTone?: DeltaTone;
  accent?: string;
  foot?: ReactNode;
}

/** Kpi card — ported from dashboard.jsx Kpi (93-114). */
function Kpi({ label, value, unit, sub, delta, deltaTone = "neutral", accent, foot }: KpiProps) {
  return (
    <Card pad={18}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</div>
        {delta != null && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: deltaTone === "danger" ? "var(--danger)" : deltaTone === "ok" ? "var(--ok)" : "var(--text-3)",
              background: deltaTone === "danger" ? "var(--danger-soft)" : deltaTone === "ok" ? "var(--ok-soft)" : "var(--surface-3)",
              padding: "2px 7px",
              borderRadius: 999,
            }}
          >
            {delta}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent || "var(--text)" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub != null && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
      {foot}
    </Card>
  );
}

/** Centered honest em-dash empty state (used where a widget's seed source is empty). */
function EmptyState({ height = 60 }: { height?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height, color: "var(--text-3)", fontSize: 13 }}>
      {DASH}
    </div>
  );
}

/* ── Screen ───────────────────────────────────────────────────────────────────── */

export function Dashboard() {
  const ctx = useShellCtx();
  const { t, tp } = useI18n();

  // Active project (ProjectSwitcher selection) — the dashboard scope + header identity.
  const projectsQ = useProjects();
  const active = resolveActiveProject(projectsQ.data, ctx.tweaks.project);
  const phaseId = (ctx.tweaks.project ?? "").split(".")[1];
  const activePhase = (active?.phases ?? []).find((ph) => ph.id === phaseId) ?? (active?.phases ?? [])[0];
  const projectId = active?.id;
  const typeKey = active?.type ?? null;

  const [range, setRange] = useState("year");
  const [role, setRole] = useState<DashRole>("manager");
  const [asOf, setAsOf] = useState<Date | null>(null);

  const summaryQ = useDashboardSummary(projectId, range);
  const baQ = useDashboardBudgetActual(projectId, range);
  const approvalsQ = useDashboardApprovals(projectId);
  const phaseQ = useDashboardPhaseProgress(projectId);
  const alertsQ = useDashboardAlerts(projectId);
  const cashflowQ = useDashboardCashflow(projectId);
  const contractorsQ = useDashboardContractors(projectId);

  const summary = summaryQ.data ?? null;
  const budgetActual = baQ.data ?? null;
  const approvals = approvalsQ.data ?? [];
  const phaseRows = phaseQ.data ?? [];
  const alerts = alertsQ.data ?? [];
  const cashflow = cashflowQ.data ?? null;
  const contractors = contractorsQ.data ?? [];

  const vis = roleVisibility(role);

  // as-of date defaults to the server's real as_of (once loaded); user can re-pick.
  useEffect(() => {
    if (asOf == null && summary?.asOf) setAsOf(new Date(summary.asOf));
  }, [asOf, summary?.asOf]);
  const asOfDate = asOf ?? (summary?.asOf ? new Date(summary.asOf) : new Date());
  const asOfTime = summary?.asOf
    ? (() => {
        const d = new Date(summary.asOf);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      })()
    : DASH;

  const ROLE_LABELS: { v: DashRole; l: ReactNode }[] = [
    { v: "exec", l: t("dashboard.roleExec") },
    { v: "manager", l: tp(P("roleManager")) },
    { v: "accountant", l: tp(P("roleAccountant")) },
    { v: "engineer", l: t("dashboard.roleEngineer") },
  ];
  const ROLE_BANNER: Record<DashRole, DictKey> = {
    exec: "dashboard.roleBannerExec",
    manager: "dashboard.roleBannerManager",
    accountant: "dashboard.roleBannerAccountant",
    engineer: "dashboard.roleBannerEngineer",
  };

  // Status badge label (presentational, by project type — mock STATUS_LABEL).
  const sk = statusKind(typeKey);
  const statusLabel = sk === "construction" ? tp(P("statusConstruction")) : sk === "solarCOD" ? t("dashboard.statusSolarCOD") : t("dashboard.statusOperating");

  // Range switch options + the chart/KPI range label (rangeTitle*).
  const RANGE_OPTS = [
    { v: "week", l: tp(P("rangeWeek")) },
    { v: "month", l: tp(P("rangeMonth")) },
    { v: "quarter", l: tp(P("rangeQuarter")) },
    { v: "year", l: tp(P("rangeYear")) },
  ];
  const rangeTitleKey: DictKey =
    range === "week"
      ? "dashboard.rangeTitleWeek"
      : range === "month"
        ? "dashboard.rangeTitleMonth"
        : range === "quarter"
          ? "dashboard.rangeTitleQuarter"
          : "dashboard.rangeTitleYear";
  const rangeLabel = t(rangeTitleKey);

  // Progress card title/sub by project type.
  const progressTitle =
    typeKey === "realestate"
      ? tp(P("progressTitleRealestate"))
      : typeKey === "solar"
        ? t("dashboard.progressTitleSolar")
        : typeKey === "civil"
          ? t("dashboard.progressTitleCivil")
          : typeKey === "service"
            ? t("dashboard.progressTitleService")
            : t("dashboard.progressTitleDefault");
  const progressSub =
    typeKey === "realestate"
      ? tp(P("progressSubRealestate"))
      : typeKey === "solar"
        ? t("dashboard.progressSubSolar")
        : typeKey === "civil"
          ? t("dashboard.progressSubCivil")
          : typeKey === "service"
            ? t("dashboard.progressSubService")
            : "";

  const avgProgress = avgSold(phaseRows);
  const phaseCount = phaseRows.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <TopBar
        breadcrumbs={["juneflow", "Dashboard"]}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", background: "var(--surface-2)", borderRadius: 8, padding: 3, gap: 2 }}>
              {ROLE_LABELS.map((rr) => (
                <button
                  key={rr.v}
                  onClick={() => setRole(rr.v)}
                  style={{
                    padding: "6px 11px",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 11.5,
                    fontWeight: 700,
                    background: role === rr.v ? "var(--brand)" : "transparent",
                    color: role === rr.v ? "#fff" : "var(--text-2)",
                  }}
                >
                  {rr.l}
                </button>
              ))}
            </div>
            <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("dashboard.reportNotify"))}>
              {tp(P("reportBtn"))}
            </Btn>
          </div>
        }
      />

      <div style={{ flex: 1, overflow: "auto", padding: "var(--pad-page)" }}>
        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>{tp(P("pageTitle"))}</h1>
              <StatusBadge>{statusLabel}</StatusBadge>
              {typeKey && <TypeBadge type={typeKey} size="sm" />}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-2)" }}>
              {active?.name ?? DASH}
              {/* Null-guard the wire-sourced phase name before .split (mirrors the
                  prototype `(activePhase.l || "").split` and project-blocks phaseHead
                  `(name ?? "")`): a null/missing name yields "" instead of a crash (B-087). */}
              {activePhase ? ` · ${(activePhase.name ?? "").split(" · ")[0]}` : ""}
              {` · ${fill(t("dashboard.tplAsOf"), { date: formatThaiShort(asOfDate), time: asOfTime })}`}
              <span style={{ color: "var(--text-3)", marginLeft: 8 }}>
                {` · ${t("dashboard.syncSource")} `}
                <span style={{ color: "var(--ok)" }}>{t("dashboard.syncOnline")}</span>
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <RangeSwitch value={range} onChange={setRange} options={RANGE_OPTS} />
            <DatePicker value={asOfDate} onChange={setAsOf} todayLabel={tp(P("dpToday"))} />
          </div>
        </div>

        {/* Role focus banner */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", marginBottom: 14, background: "var(--brand-soft)", border: "1px solid var(--brand-line)", borderRadius: 9 }}>
          <Icon name="eye" size={15} color="var(--brand)" />
          <span style={{ fontSize: 12, color: "var(--brand-ink)", fontWeight: 600 }}>{t(ROLE_BANNER[role])}</span>
        </div>

        {/* KPI row (project-type aware) */}
        <KpiRow branch={kpiBranch(typeKey)} summary={summary} rangeLabel={rangeLabel} avgProgress={avgProgress} phaseCount={phaseCount} t={t} tp={tp} P={P} />

        {/* Main grid: budget-vs-actual chart + approval inbox */}
        <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16, marginBottom: 16 }}>
          <Card pad={20}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{tp(P("chartTitle"))}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{rangeLabel}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11, color: "var(--text-2)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--brand-soft)", border: "1px solid #B6C5DA" }} /> {t("dashboard.legendBudgetShort")}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--brand)" }} /> {tp(P("legendActual"))}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 16, height: 0, borderTop: "2px dashed var(--brand)" }} /> {tp(P("legendPlan"))}
                </span>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              {budgetActual && (
                <ChartCanvas
                  height={240}
                  deps={[range, budgetActual.periodLabel.length]}
                  build={(theme) =>
                    buildBudgetActualConfig(theme, budgetActual, {
                      budget: tp(P("datasetBudget")),
                      actual: tp(P("legendActual")),
                      plan: tp(P("legendPlan")),
                    })
                  }
                />
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              {(budgetActual?.costCategories ?? []).slice(0, 4).map((c, i) => {
                const tone = c.actual > c.plan ? "warn" : "ok";
                return (
                  <div key={i}>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.label ?? DASH}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                      <span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{millions1(c.actual)}M</span>
                      <span className="num" style={{ fontSize: 10.5, color: tone === "ok" ? "var(--ok)" : "var(--warn)" }}>/ {millions1(c.plan)}M</span>
                    </div>
                  </div>
                );
              })}
              {(budgetActual?.costCategories ?? []).length === 0 && <EmptyState height={40} />}
            </div>
          </Card>

          {/* Approval inbox */}
          <Card pad={0}>
            <div style={{ padding: "18px 20px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                  {tp(P("approvalTitle"))}
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, background: "var(--warn-soft)", color: "var(--warn)", fontWeight: 700 }} className="num">
                    {approvals.length}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{tp(P("approverTier"))}</div>
              </div>
              <button onClick={() => ctx.navigate("pr.list")} style={{ fontSize: 11.5, color: "var(--brand)", background: "none", border: "none", fontWeight: 600, cursor: "pointer" }}>
                {tp(P("viewAllArrow"))}
              </button>
            </div>
            <div style={{ padding: "0 20px 12px" }}>
              {approvals.length === 0 ? <EmptyState /> : approvals.map((d, i) => <ApprovalRow key={i} doc={d} onApprove={() => ctx.navigate(listRouteForKind(d.kind))} approveLabel={t("common.approve")} />)}
            </div>
          </Card>
        </div>

        {/* Second row: phase progress + alerts/health (role.progress) */}
        {vis.progress && (
          <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16, marginBottom: 16 }}>
            <Card pad={20}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{progressTitle}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{progressSub}</div>
                </div>
                <Btn kind="ghost" size="sm" icon="grid" onClick={() => ctx.navigate("master.project")}>
                  {t("project.unitViewBtn")}
                </Btn>
              </div>
              <div style={{ marginTop: 8 }}>
                {phaseRows.length === 0 ? (
                  <EmptyState />
                ) : (
                  phaseRows.map((p, i) => <PhaseProgressRow key={i} row={p} labels={{ built: tp(P("phaseBuilt")), sold: tp(P("phaseSold")), budgetUsed: tp(P("phaseBudgetUsed")), units: tp(P("unitsLabel")) }} />)
                )}
              </div>
            </Card>

            {/* Alerts + health */}
            <Card pad={20}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{tp(P("alertsTitle"))}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{DASH}</div>
                </div>
              </div>
              {alerts.length === 0 ? (
                <EmptyState />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {alerts.map((a, i) => (
                    <div key={i} style={{ padding: "12px 14px", background: a.tone === "danger" ? "var(--danger-soft)" : "var(--warn-soft)", borderRadius: 10, borderLeft: `3px solid ${a.tone === "danger" ? "var(--danger)" : "var(--warn)"}` }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <Icon name="warn" size={16} color={a.tone === "danger" ? "var(--danger)" : "var(--warn)"} style={{ marginTop: 1, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", lineHeight: 1.4 }}>{a.title ?? DASH}</div>
                          <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3 }}>{a.sub}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 14, padding: "14px", background: "var(--surface-2)", borderRadius: 10, display: "flex", alignItems: "center", gap: 14 }}>
                <Donut value={summary?.healthScore ?? 0} color="var(--accent)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 2 }}>{tp(P("healthIndex"))}</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{DASH}</div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Cashflow + contractors + activity (role.cashflow) */}
        {vis.cashflow && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <Card pad={18}>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 8 }}>{tp(P("cashflowTitle"))}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 12 }}>
                <span className="num" style={{ fontSize: 24, fontWeight: 700 }}>{cashflow ? millions1(cashflow.netTotal) : DASH}</span>
                <span style={{ fontSize: 13, color: "var(--text-3)" }}>{tp(P("unitMillionBaht"))}</span>
              </div>
              {(cashflow?.rows.length ?? 0) === 0 ? (
                <EmptyState />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {cashflow!.rows.map((r, i) => (
                    <CashflowLine key={i} row={r} />
                  ))}
                </div>
              )}
            </Card>

            <Card pad={18}>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 8 }}>{tp(P("contractorsTitle"))}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 12 }}>
                <span className="num" style={{ fontSize: 24, fontWeight: 700 }}>{contractors.length}</span>
                <span style={{ fontSize: 13, color: "var(--text-3)" }}>{tp(P("contractsOpen"))}</span>
              </div>
              {contractors.length === 0 ? (
                <EmptyState />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {contractors.map((c, i) => (
                    <ContractorLine key={i} row={c} />
                  ))}
                </div>
              )}
            </Card>

            {/* Recent activity — NO endpoint in the contract → honest empty state. */}
            <Card pad={18}>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 8 }}>{tp(P("activityTitle"))}</div>
              <EmptyState />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Row / branch sub-components ────────────────────────────────────────────────── */

/** Map an inbox row's doc kind to the list route where its real approve lives. */
function listRouteForKind(kind: string): string {
  if (kind === "PO") return "po.list";
  if (kind === "WO") return "wo.list";
  return "pr.list";
}

function ApprovalRow({ doc, onApprove, approveLabel }: { doc: ApprovalItem; onApprove: () => void; approveLabel: string }) {
  const kindBg = doc.kind === "PR" ? "var(--brand-soft)" : doc.kind === "PO" ? "var(--accent-soft)" : "var(--info-soft)";
  const kindFg = doc.kind === "PR" ? "var(--brand)" : doc.kind === "PO" ? "var(--accent)" : "var(--info)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, padding: "12px 4px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: kindBg, color: kindFg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
        {doc.kind}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2 }} className="num">
          {doc.docNo ?? DASH}
          {doc.title && <span style={{ color: "var(--text-3)", fontWeight: 500 }}> {"·"} {doc.title}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "var(--text-3)" }}>
          {doc.requester && <span>{doc.requester}</span>}
          {doc.amount != null && (
            <span className="num">
              {formatInt(doc.amount)} {BAHT}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Btn kind="ok" size="sm" icon="check" onClick={onApprove}>
          {approveLabel}
        </Btn>
      </div>
    </div>
  );
}

function PhaseProgressRow({ row, labels }: { row: PhaseRow; labels: { built: string; sold: string; budgetUsed: string; units: string } }) {
  const cell = (label: string, value: number | null) => (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 4 }}>{label}</div>
      <Bar value={value ?? 0} max={100} />
      <div className="num" style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3, fontWeight: 600 }}>
        {value == null ? DASH : `${value}%`}
      </div>
    </div>
  );
  return (
    <div style={{ padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="building" size={16} color="var(--brand)" />
          <div style={{ fontSize: 13, fontWeight: 600 }}>{row.name ?? DASH}</div>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {"·"} <span className="num">{row.units}</span> {labels.units}
          </span>
        </div>
        {/* status is a wire gap (no per-phase schedule) → honest em-dash, not a fake pill. */}
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)" }}>{DASH}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, alignItems: "center" }}>
        {cell(labels.built, row.built)}
        {cell(labels.sold, row.sold)}
        {cell(labels.budgetUsed, row.budgetUsed)}
      </div>
    </div>
  );
}

function CashflowLine({ row }: { row: CashflowRow }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
      <div>
        <div style={{ color: "var(--text-3)", fontSize: 10.5 }} className="num">
          {row.dueDate}
        </div>
        <div style={{ color: "var(--text)", marginTop: 1 }}>{row.label ?? DASH}</div>
      </div>
      <span className="num" style={{ fontWeight: 600, color: row.amount < 0 ? "var(--danger)" : "var(--ok)" }}>
        {row.amount < 0 ? "" : "+"}
        {formatInt(row.amount)}
      </span>
    </div>
  );
}

function ContractorLine({ row }: { row: ContractorRow }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600 }}>
        <span>{row.vendorName ?? DASH}</span>
        <span className="num">{row.progressPct}%</span>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 4 }}>{row.workScope ?? DASH}</div>
      <Bar value={row.progressPct} max={100} height={5} />
    </div>
  );
}

/* ── KPI row (project-type branch) ─────────────────────────────────────────────── */

interface KpiRowProps {
  branch: ReturnType<typeof kpiBranch>;
  summary: DashSummary | null;
  rangeLabel: string;
  avgProgress: number;
  phaseCount: number;
  t: (k: DictKey) => string;
  tp: (k: PhraseKey) => string;
  P: (k: keyof typeof strings) => PhraseKey;
}

function KpiRow({ branch, summary, rangeLabel, avgProgress, phaseCount, t, tp, P }: KpiRowProps) {
  const unit = tp(P("unitMillionBaht"));
  const rangeSub = fill(t("dashboard.tplRangeLabel"), { range: rangeLabel });

  if (branch === "solar") {
    // capacity / energy / PR are real from summary; revenue / payback are wire gaps.
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, marginBottom: 16 }}>
        <Kpi label={t("dashboard.kpiSolarCapacity")} value={summary?.installedCapacity ?? DASH} unit={t("dashboard.unitMWp")} delta={summary?.installedCapacity ? t("dashboard.deltaCOD") : undefined} deltaTone="ok" />
        <Kpi label={t("dashboard.kpiSolarEnergy")} value={summary?.energyYtd != null ? formatInt(summary.energyYtd) : DASH} unit={t("dashboard.unitMWh")} />
        <Kpi
          label={t("dashboard.kpiSolarPR")}
          value={summary?.performanceRatio ?? DASH}
          unit="%"
          delta={summary?.performanceRatio != null && summary.performanceRatio >= 80 ? t("dashboard.deltaPass") : undefined}
          deltaTone="ok"
          foot={<div style={{ marginTop: 10 }}><Bar value={summary?.performanceRatio ?? 0} max={100} /></div>}
        />
        <Kpi label={tp(P("kpiSolarRevenue"))} value={DASH} />
        <Kpi label={tp(P("kpiSolarPayback"))} value={DASH} accent="var(--accent)" />
      </div>
    );
  }

  if (branch === "workProgress") {
    // civil / service: budget + actual real; progress from phase rows; milestone is a gap.
    const budget = summary?.budgetTotal ?? 0;
    const actual = summary?.actualTotal ?? 0;
    const avgSub = fill(t(summary?.projectType === "service" ? "dashboard.tplAvgPhase" : "dashboard.tplAvgSection"), { n: phaseCount });
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
        <Kpi label={tp(P("kpiBudgetTotal"))} value={millions1(budget)} unit={unit} sub={rangeSub} />
        <Kpi label={tp(P("kpiActual"))} value={millions1(actual)} unit={unit} sub={fill(t("dashboard.tplPctOfTotalBudget"), { p: pctOf(actual, budget) })} foot={<div style={{ marginTop: 10 }}><Bar value={actual} max={budget} /></div>} />
        <Kpi
          label={t("dashboard.kpiWorkProgress")}
          value={String(avgProgress)}
          unit="%"
          accent="var(--accent)"
          sub={avgSub}
          delta={avgProgress >= 50 ? tp(P("deltaOnPlan")) : tp(P("deltaStart"))}
          deltaTone={avgProgress >= 50 ? "ok" : "neutral"}
          foot={<div style={{ marginTop: 10 }}><Bar value={avgProgress} max={100} /></div>}
        />
        <Kpi label={t("dashboard.kpiNextMilestone")} value={DASH} sub={DASH} />
      </div>
    );
  }

  // budget branch (realestate + default) — the reference (g1/01).
  const budget = summary?.budgetTotal ?? 0;
  const actual = summary?.actualTotal ?? 0;
  const committed = summary?.committedTotal ?? 0;
  const remaining = summary?.remainingTotal ?? 0;
  const overBudget = remaining < 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
      <Kpi label={tp(P("kpiBudgetTotal"))} value={millions1(budget)} unit={unit} sub={rangeSub} />
      <Kpi label={tp(P("kpiActual"))} value={millions1(actual)} unit={unit} sub={fill(t("dashboard.tplPctOfTotalBudget"), { p: pctOf(actual, budget) })} foot={<div style={{ marginTop: 10 }}><Bar value={actual} max={budget} /></div>} />
      <Kpi label={tp(P("kpiCommitted"))} value={millions1(committed)} unit={unit} sub={tp(P("committedSub"))} />
      <Kpi
        label={tp(P("kpiRemaining"))}
        value={millions1(remaining)}
        unit={unit}
        accent={overBudget ? "var(--danger)" : "var(--accent)"}
        sub={DASH}
        delta={overBudget ? tp(P("deltaOverBudget")) : t("dashboard.deltaBelowPlan")}
        deltaTone="danger"
      />
    </div>
  );
}
