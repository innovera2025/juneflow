/*
 * sales.dashboard — Sales Dashboard (sales-crm.jsx SalesDashboard L7-179). Route
 * `sales.dashboard` (docs/extract/NAV-ROUTES.md, mod sales_re).
 *
 * B-222 DEFERRED THIS SCREEN ON 2026-08-03 because "most of the screen is unbacked".
 * Re-measured against the live stack, most of that is no longer true: the unit-status
 * donut, the sales funnel and the transfer schedule all have real sources today. So
 * this is the thin-honest port Wei's own precedents call for — subcon.progress
 * (B-229) and alloc (B-232): render every element an existing read backs, em-dash a
 * value that is missing, and DROP an element whose entire content would be invented.
 * What is dropped is named in B-442 rather than approximated.
 *
 * BUILT, and what backs it:
 *   donut     every unit node across every project carries a real `status`, and its
 *             five values are exactly the prototype's five legend rows. Aggregated
 *             across ALL projects because the card's own title says so.
 *   funnel    GET /sales/leads `stage` gives the first FIVE stages. The sixth is a
 *             sale-side state and `lead` has no key into `sales_unit`, so the box
 *             keeps its place and shows the honest marker instead of a number taken
 *             from a different population.
 *   transfers GET /sales/contracts `transfer_at` + `contract`, earliest first.
 *   KPIs      cumulative sales, downs collected and awaiting-transfer are real sums.
 *             Sales-this-month and walk-in/booking em-dash: `sales_unit` records no
 *             sale date, and nothing tracks a walk-in.
 *
 * DROPPED (B-442): the sales-vs-target bar chart (measured across all 89 tables, the
 * only `target` column in the database is a subcon acceptance quantity), the Top-5 rep
 * card (`sales_unit` has no user column at all, so a sale cannot be attributed to
 * anyone), and the activity feed (/audit-log stores the request PATH, so it can say
 * "read /api/v1/admin/subscribers" and never "closed unit B-12").
 *
 * i18n (§0 rule 2): a sales.dashboard.* namespace with 26 keys already existed, so
 * this port mints NOTHING. Strings come from that namespace, from the existing
 * sales.process and sales.crm keys for the status and stage labels, or from a
 * sales-dashboard-strings.json phrase. Tokens
 * back every colour (§0 rule 6). No Thai/baht literal in this .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import type { PhraseKey } from "@juneflow/i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { ChartCanvas, baseChartOpts, type ChartTheme, type ChartColorKey } from "../../ui/chart";
import { Page } from "../../shell/page";
import {
  awaitingTransfer,
  funnelCounts,
  funnelPct,
  soldPct,
  sumContracts,
  sumDowns,
  toContract,
  transferSchedule,
  unitStatusCounts,
  unitTotal,
  unitsSold,
  FUNNEL_STAGES,
  UNIT_STATUS_ORDER,
  type LeadStage,
  type UnitStatus,
} from "./sales-dashboard-rows";
import {
  useAllProjectUnits,
  useSalesContractRows,
  useSalesLeadRows,
  useSalesProjects,
} from "./use-sales-dashboard";
import strings from "./sales-dashboard-strings.json" with { type: "json" };

/** The screen's honest-unknown marker. */
const DASH = "—";

const P = (k: keyof typeof strings): PhraseKey => strings[k] as PhraseKey;

/**
 * The prototype's own colour per unit status (sales-crm.jsx L74-78), as tokens.
 *
 * TWO SPELLINGS OF ONE TABLE, AND B-446 IS WHY THERE ARE TWO. The legend swatches are
 * DOM nodes, where `var(--ok)` resolves. The doughnut is a CANVAS, where it does not:
 * `fillStyle = "var(--ok)"` is an invalid assignment, canvas silently ignores it, and
 * the segment keeps its initial black. The screen shipped that way and the first G5
 * capture caught it — a chart with five solid-black arcs beside a legend showing the
 * five correct colours, with no console error anywhere, because nothing threw.
 *
 * So the canvas gets values already resolved by chartTheme(). Keeping ONE table keyed
 * by token name and deriving both spellings from it is the point: a future status
 * added to one list and not the other is a compile error, not a black wedge.
 */
const STATUS_TOKEN: Record<UnitStatus, { css: string; theme: ChartColorKey }> = {
  soldBuilt: { css: "--ok", theme: "ok" },
  sold: { css: "--info", theme: "info" },
  booked: { css: "--warn", theme: "warn" },
  built: { css: "--accent", theme: "accent" },
  empty: { css: "--surface-3", theme: "grid" },
};

/** DOM spelling — legend swatches, where CSS custom properties resolve. */
const STATUS_TONE: Record<UnitStatus, string> = Object.fromEntries(
  (Object.keys(STATUS_TOKEN) as UnitStatus[]).map((s) => [s, `var(${STATUS_TOKEN[s].css})`]),
) as Record<UnitStatus, string>;

/** Canvas spelling — resolved through the same token read every other chart uses. */
export function statusChartTone(theme: ChartTheme, s: UnitStatus): string {
  return theme[STATUS_TOKEN[s].theme];
}

/** The prototype's own colour per funnel stage (sales-crm.jsx L100-105). */
const STAGE_TONE: Record<string, string> = {
  lead: "var(--text-3)",
  visit: "var(--ok)",
  quote: "var(--brand)",
  booking: "var(--info)",
  contract: "var(--ok)",
  transferred: "var(--warn)",
};

/** Thousands-separated integer, the prototype's fmt(). */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Millions to one decimal — the prototype's KPI scaling. */
function millions(n: number): string {
  return (n / 1e6).toFixed(1);
}

/** Percent to one decimal, or the honest marker when there is none. */
function pct(v: number | null): string {
  return v == null ? DASH : `${v.toFixed(1)}%`;
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

const TD: CSSProperties = { padding: "8px 0", fontSize: 12 };

export function SalesDashboard() {
  const { t, tp } = useI18n();
  const contractsQ = useSalesContractRows();
  const leadsQ = useSalesLeadRows();
  const projectsQ = useSalesProjects();
  const projectIds = useMemo(
    () => (projectsQ.data ?? []).map((p) => String(p.id ?? "")).filter((id) => id !== ""),
    [projectsQ.data],
  );
  const units = useAllProjectUnits(projectIds);

  const contracts = useMemo(
    () => (contractsQ.data ?? []).map((e) => toContract(e)),
    [contractsQ.data],
  );
  const statusCounts = useMemo(() => unitStatusCounts(units.nodes), [units.nodes]);
  const funnel = useMemo(() => funnelCounts(leadsQ.data ?? []), [leadsQ.data]);
  const transfers = useMemo(() => transferSchedule(contracts), [contracts]);

  const total = unitTotal(statusCounts);
  const sold = unitsSold(statusCounts);
  const sub = soldPct(statusCounts);

  const stageLabel = (s: LeadStage | "transferred"): string => {
    if (s === "lead") return t("sales.crm.stageLead");
    if (s === "visit") return tp(P("stageVisit"));
    if (s === "quote") return tp(P("stageQuote"));
    if (s === "booking") return tp(P("stageBooking"));
    if (s === "contract") return tp(P("stageContract"));
    return t("sales.dashboard.funnelStageTransferred");
  };

  const statusLabel = (s: UnitStatus): string => {
    if (s === "soldBuilt") return tp(P("unitStatusSoldBuilt"));
    if (s === "sold") return t("sales.dashboard.unitStatusSoldPending");
    if (s === "booked") return tp(P("unitStatusBooked"));
    if (s === "built") return t("sales.dashboard.unitStatusBuiltVacant");
    return t("sales.process.statusAvailablePending");
  };

  return (
    <Page
      breadcrumbs={[tp(P("crumbSection")), t("sales.dashboard.breadcrumb")]}
      title={t("sales.dashboard.title")}
      subtitle={t("sales.dashboard.subtitle")}
      actions={
        /* Report = no-op stub: SalesReportDialog is a dropped mock and no sales-report
           endpoint exists (gl-cashflow / alloc precedent) — never a fabricated toast. */
        <Btn kind="primary" size="md" icon="download">
          {t("sales.dashboard.btnReport")}
        </Btn>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <Kpi
          label={t("sales.dashboard.kpiSalesCumulative")}
          value={millions(sumContracts(contracts))}
          unit={tp(P("unitMillionBaht"))}
          sub={`${fmt(sold)} / ${fmt(total)} ${tp(P("unitLabel"))} · ${pct(sub)}`}
          accent="var(--brand)"
        />
        {/* No sale DATE exists on sales_unit — only created_at, which is the seed's own
            stamp — so a "this month" figure would be an invention (B-442). */}
        <Kpi label={t("sales.dashboard.kpiSalesMonth")} value={DASH} unit={tp(P("unitMillionBaht"))} />
        <Kpi
          label={t("sales.dashboard.kpiDownCollected")}
          value={millions(sumDowns(contracts))}
          unit={tp(P("unitMillionBaht"))}
          accent="var(--accent)"
        />
        <Kpi
          label={t("sales.dashboard.kpiPendingTransfer")}
          value={fmt(awaitingTransfer(contracts))}
          unit={tp(P("unitLabel"))}
        />
        {/* Nothing in the schema records a walk-in (B-442). */}
        <Kpi label={t("sales.dashboard.kpiWalkInBooking")} value={DASH} sub={t("sales.dashboard.kpiWeekSub")} />
      </div>

      <Card pad={20} style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("sales.dashboard.unitStatusTitle")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 24, alignItems: "center" }}>
          <div>
            <ChartCanvas
              height={200}
              deps={[total, sold]}
              build={(theme) => ({
                type: "doughnut",
                data: {
                  labels: UNIT_STATUS_ORDER.map((s) => statusLabel(s)),
                  datasets: [
                    {
                      data: UNIT_STATUS_ORDER.map((s) => statusCounts[s]),
                      // Resolved, NOT `var(--…)` — see STATUS_TOKEN above (B-446).
                      backgroundColor: UNIT_STATUS_ORDER.map((s) => statusChartTone(theme, s)),
                      borderWidth: 0,
                    },
                  ],
                },
                // `cutout` is a doughnut-only option, so it does not fit
                // ChartOptions<keyof ChartTypeRegistry> — the union baseChartOpts
                // returns. Spread it in after, rather than widening the shared
                // helper's type for one screen. `scales: {}` clears the shared x/y
                // axes, which a doughnut has none of.
                options: {
                  ...baseChartOpts(theme, { scales: {} }),
                  cutout: "70%",
                },
              })}
            />
            <div style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", marginTop: 8 }}>
              {`${fmt(sold)} / ${fmt(total)} ${tp(P("unitsSoldLabel"))} · ${pct(sub)}`}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {UNIT_STATUS_ORDER.map((s) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                <span style={{ width: 12, height: 12, background: STATUS_TONE[s], borderRadius: 3, border: s === "empty" ? "1px solid var(--border-strong)" : "none" }} />
                <span style={{ flex: 1 }}>{statusLabel(s)}</span>
                <span className="num" style={{ fontWeight: 700 }}>{fmt(statusCounts[s])}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card pad={20} style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{t("sales.dashboard.funnelTitle")}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{t("sales.dashboard.funnelDesc")}</div>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {`${t("sales.dashboard.funnelConvRate")} · ${pct(funnelPct(funnel, "contract"))}`}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {FUNNEL_STAGES.map((s, i) => {
            const tone = STAGE_TONE[s] ?? "var(--text-3)";
            // The sixth stage has no lead-side source; it keeps its box and shows the
            // marker rather than borrowing a count from the contracts table, which is
            // a different population.
            const known = s !== "transferred";
            const count = known ? funnel[s as LeadStage] : null;
            return (
              <div key={s} style={{ display: "contents" }}>
                <div style={{ flex: 1, padding: "14px 8px", background: `color-mix(in srgb, ${tone} 12%, var(--surface))`, border: `1.5px solid ${tone}`, borderRadius: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>{stageLabel(s)}</div>
                  <div className="num" style={{ fontSize: 20, fontWeight: 800, color: tone }}>
                    {count == null ? DASH : fmt(count)}
                  </div>
                  <div className="num" style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                    {known ? pct(funnelPct(funnel, s as LeadStage)) : DASH}
                  </div>
                </div>
                {i < FUNNEL_STAGES.length - 1 && <Icon name="arrowR" size={14} color="var(--text-3)" />}
              </div>
            );
          })}
        </div>
      </Card>

      <Card pad={18}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{t("sales.dashboard.transferScheduleTitle")}</div>
        {transfers.map((tr) => (
          <div key={tr.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px dashed var(--border)" }}>
            <div className="num" style={{ minWidth: 92, fontSize: 10.5, color: "var(--text-3)", fontWeight: 700 }}>{tr.date || DASH}</div>
            {/* The prototype prints "B-08 · คุณภัทร์รดา". The wire carries unit_id and
                customer_id as uuids and neither this endpoint nor any other resolves
                them to a code or a name, so the cell em-dashes rather than printing a
                uuid at somebody (B-442). */}
            <div style={{ ...TD, flex: 1 }}>{DASH}</div>
            <span className="num" style={{ fontWeight: 700 }}>{fmt(tr.amount)}</span>
          </div>
        ))}
        {transfers.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>{DASH}</div>
        )}
      </Card>
    </Page>
  );
}
