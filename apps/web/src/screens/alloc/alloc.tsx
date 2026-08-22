/*
 * alloc — Cost Allocation (petty-alloc.jsx AllocateCost L123-303). Route `alloc`
 * (docs/extract/NAV-ROUTES.md, component AllocateCost).
 *
 * THE SHAPE OF THIS PORT IS A WEI RULING. B-232 = ค: "the AllocateCost screen is READ-ONLY
 * (no POST) -> NO backend endpoint from me... ports the variance report thin from existing
 * reads", pointing at B-229's subcon.progress precedent — port every element an existing read
 * backs, em-dash the rest. So:
 *
 *   BACKED, and rendered in full: the six work-category rows, their Standard and Actual
 *   figures, the grouped bar chart, the variance table with its diverging bar and status
 *   badge, and the column totals. All of it derives from GET /dashboard/budget-actual, which
 *   the dashboard screen already reads — the SAME hook and the SAME parser, not a second one.
 *
 *   DROPPED, because nothing in the schema carries it (B-433 names each one): the "Block B"
 *   scope button, the per-unit cost tiles, the month-over-month delta chips, and the tfoot's
 *   unit count. cbs_budget hangs off boq_group -> boq_doc -> project with no project_node
 *   link, and no table anywhere carries a per-unit cost.
 *
 *   EM-DASHED, not dropped: the "average cost per unit" KPI keeps its position and label and
 *   shows the honest-unknown marker, the way subcon.progress em-dashes its un-backed KPIs.
 *
 * THE RECALCULATE BUTTON IS INERT, deliberately. In the prototype it only fires ctx.notify —
 * there is no recalculation behind it and B-232 says there will be no endpoint. Firing a
 * "recalculated" toast would claim work that did not happen, so the button renders (it is part
 * of the design) and does nothing, the gl-cashflow / boq-archive Export precedent.
 *
 * PROVENANCE THE SCREEN CANNOT FIX (B-434): the served `actual_value` is cbs_budget.used, which
 * the seed writes once and no handler ever updates — it is NOT the "cut from PO/WO/GR/Petty"
 * the prototype's subtitle claims. That subtitle is therefore NOT rendered and NOT minted; the
 * claim is filed rather than printed. The figure itself is shown because it is what the server
 * serves and the merged dashboard already displays the same numbers.
 *
 * i18n (§0 rule 2): every visible string is an alloc-strings.json phrase (tp) or an alloc.* /
 * shared dict key (t). Copy that embeds mock data is absent by design (B-433). Tokens back
 * every colour (§0 rule 6). No Thai/baht literal in this .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import type { PhraseKey } from "@juneflow/i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { ChartCanvas } from "../../ui/chart";
import { Page } from "../../shell/page";
import { useProjects } from "../../shell/use-shell-data";
import { useDashboardBudgetActual } from "../dashboard/use-dashboard";
import {
  allocTotals,
  barHalfWidth,
  statusOf,
  toAllocRow,
  type AllocRow,
  type AllocStatus,
} from "./alloc-rows";
import strings from "./alloc-strings.json" with { type: "json" };

/** The screen's honest-unknown marker. */
const DASH = "—";

/** The prototype's verbatim ASCII labels (gl-jv.tsx:217 precedent for ASCII-only copy). */
const LABEL_STANDARD_COST = "Standard Cost (BOQ)";
const LABEL_VARIANCE_PCT = "% Variance";
const LABEL_VARIANCE = "Variance";
const DATASET_STANDARD = "Standard (BOQ)";
const DATASET_ACTUAL = "Actual";

/** The dashboard range this screen reads. `ytd` matches the prototype's year-to-date framing. */
const RANGE = "ytd";

const P = (k: keyof typeof strings): PhraseKey => strings[k] as PhraseKey;

/** ds.jsx th() / td(). */
const th = (w?: number): CSSProperties => ({
  padding: "10px 12px",
  textAlign: "start",
  fontWeight: 600,
  fontSize: 11,
  ...(w ? { width: w } : {}),
});
const TD: CSSProperties = { padding: "12px", verticalAlign: "middle" };

/** Thousands-separated integer baht, the prototype's fmt(). */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Signed integer baht — the prototype prefixes a "+" on an overspend only. */
function signed(n: number): string {
  return (n > 0 ? "+" : "") + fmt(n);
}

/** Millions to one decimal — the prototype's KPI scaling. */
function millions(n: number): string {
  return (n / 1e6).toFixed(2);
}

/** Signed percent to one decimal, or the honest marker when there is none. */
function pct(v: number | null): string {
  return v == null ? DASH : (v > 0 ? "+" : "") + v.toFixed(1) + "%";
}

/** KPI card, inlined from dashboard.jsx Kpi — the props this screen uses. */
function Kpi({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card pad={18}>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent ?? "var(--text)" }}>{value}</span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/** Tone token for a status band. */
function toneOf(s: AllocStatus): { fg: string; bg: string } {
  if (s === "over") return { fg: "var(--danger)", bg: "var(--danger-soft)" };
  if (s === "under") return { fg: "var(--warn)", bg: "var(--warn-soft)" };
  if (s === "normal") return { fg: "var(--ok)", bg: "var(--ok-soft)" };
  return { fg: "var(--text-3)", bg: "var(--surface-2)" };
}

/**
 * The centre-zero diverging bar (prototype L221-241): a track with a centre line, and a fill
 * that grows left for an underspend and right for an overspend.
 */
function DivergingBar({ row }: { row: AllocRow }) {
  const half = barHalfWidth(row);
  const over = row.variance > 0;
  return (
    <div style={{ flex: 1, height: 6, background: "var(--surface-3)", borderRadius: 999, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", insetBlock: 0, insetInlineStart: "50%", width: 1, background: "var(--border-strong)" }} />
      <div
        style={{
          position: "absolute",
          insetInlineStart: over ? "50%" : `${50 - half}%`,
          width: `${half}%`,
          insetBlock: 0,
          background: over ? "var(--danger)" : "var(--ok)",
        }}
      />
    </div>
  );
}

export function AllocateCost() {
  const { t, tp } = useI18n();
  const projects = useProjects();
  const projectId = projects.data?.[0]?.id;
  const budget = useDashboardBudgetActual(projectId, RANGE);

  const rows: AllocRow[] = useMemo(
    () => (budget.data?.costCategories ?? []).map((c) => toAllocRow(c)),
    [budget.data],
  );
  const totals = allocTotals(rows);

  const statusLabel = (s: AllocStatus): string => {
    if (s === "over") return t("alloc.statusOver");
    if (s === "under") return t("alloc.statusUnder");
    if (s === "normal") return tp(P("statusNormal"));
    return DASH;
  };

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), tp(P("crumbScreen"))]}
      title={t("alloc.title")}
      subtitle={t("alloc.subtitle")}
      actions={
        /* Inert by ruling: B-232 says no endpoint will exist, and the prototype's own handler
           only fired a toast. A "recalculated" toast would claim work that did not happen. */
        <Btn kind="primary" size="md" icon="sync">
          {t("alloc.btnRecalc")}
        </Btn>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <Kpi
          label={LABEL_STANDARD_COST}
          value={millions(totals.standard)}
          unit={tp(P("unitMillionBaht"))}
          accent="var(--brand)"
        />
        <Kpi label={t("alloc.kpiActual")} value={millions(totals.actual)} unit={tp(P("unitMillionBaht"))} />
        <Kpi
          label={t("alloc.kpiVariance")}
          value={signed(totals.variance)}
          sub={pct(totals.variancePct)}
          accent={totals.variance > 0 ? "var(--danger)" : "var(--ok)"}
        />
        {/* No per-unit cost exists in the schema (B-433) — the KPI keeps its position and
            em-dashes its figure, the subcon.progress precedent. */}
        <Kpi label={t("alloc.kpiPerUnit")} value={DASH} unit={t("alloc.unitPerHouse")} />
      </div>

      <Card pad={20} style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{t("alloc.chartTitle")}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{t("alloc.chartSubtitle")}</div>
        </div>
        <ChartCanvas
          height={260}
          deps={[rows.length, totals.standard, totals.actual]}
          build={(theme) => ({
            type: "bar",
            data: {
              labels: rows.map((r) => r.name || DASH),
              datasets: [
                {
                  label: DATASET_STANDARD,
                  data: rows.map((r) => r.standard / 1e6),
                  backgroundColor: theme.brand,
                  borderRadius: 4,
                  borderSkipped: false,
                },
                {
                  label: DATASET_ACTUAL,
                  data: rows.map((r) => r.actual / 1e6),
                  backgroundColor: rows.map((r) => (r.variance > 0 ? theme.danger : theme.accent)),
                  borderRadius: 4,
                  borderSkipped: false,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { grid: { display: false }, ticks: { color: theme.text } },
                y: { grid: { color: theme.grid }, beginAtZero: true, ticks: { color: theme.text } },
              },
            },
          })}
        />
      </Card>

      <Card pad={0}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{t("alloc.tableTitle")}</div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
              <th scope="col" style={th(50)}>{tp(P("colCode"))}</th>
              <th scope="col" style={th()}>{tp(P("colCategory"))}</th>
              <th scope="col" style={{ ...th(130), textAlign: "end" }}>{t("alloc.colStandard")}</th>
              <th scope="col" style={{ ...th(130), textAlign: "end" }}>{t("alloc.colActual")}</th>
              <th scope="col" style={{ ...th(130), textAlign: "end" }}>{LABEL_VARIANCE}</th>
              <th scope="col" style={th(140)}>{LABEL_VARIANCE_PCT}</th>
              <th scope="col" style={th(120)}>{tp(P("colStatus"))}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = statusOf(r);
              const tone = toneOf(s);
              return (
                <tr key={`${r.code}-${r.name}`} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="num" style={{ ...TD, color: "var(--text-3)" }}>{r.code || DASH}</td>
                  <td style={{ ...TD, fontWeight: 500 }}>{r.name || DASH}</td>
                  <td className="num" style={{ ...TD, textAlign: "end" }}>{fmt(r.standard)}</td>
                  <td className="num" style={{ ...TD, textAlign: "end", fontWeight: 600 }}>{fmt(r.actual)}</td>
                  <td className="num" style={{ ...TD, textAlign: "end", fontWeight: 700, color: r.variance > 0 ? "var(--danger)" : "var(--ok)" }}>
                    {signed(r.variance)}
                  </td>
                  <td style={TD}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <DivergingBar row={r} />
                      <span className="num" style={{ fontSize: 11.5, fontWeight: 700, minWidth: 50, textAlign: "end", color: r.variance > 0 ? "var(--danger)" : "var(--ok)" }}>
                        {pct(r.variancePct)}
                      </span>
                    </div>
                  </td>
                  <td style={TD}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: tone.bg, color: tone.fg }}>
                      {statusLabel(s)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
            <tr>
              {/* The prototype's "รวม Block B (84 ยูนิต)" embeds a mock unit count and a block
                  scope with no data path, so the shared total label is used instead (B-433). */}
              <td colSpan={2} style={{ ...TD, fontWeight: 700 }}>{t("common.total")}</td>
              <td className="num" style={{ ...TD, textAlign: "end", fontWeight: 700 }}>{fmt(totals.standard)}</td>
              <td className="num" style={{ ...TD, textAlign: "end", fontWeight: 700 }}>{fmt(totals.actual)}</td>
              <td className="num" style={{ ...TD, textAlign: "end", fontWeight: 700, color: totals.variance > 0 ? "var(--danger)" : "var(--ok)" }}>
                {signed(totals.variance)}
              </td>
              <td className="num" style={{ ...TD, fontWeight: 700 }}>{pct(totals.variancePct)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </Card>
    </Page>
  );
}
