/*
 * GLCashFlow — the DIRECT-method Cash Flow Statement screen, ported from
 * pototype/accounting-extra2.jsx GLCashFlow (L270-340). Route gl.cashflow
 * (docs/extract/NAV-ROUTES.md L65, section "acct").
 *
 * Design fidelity (PLAN.md §0 rule 1): the three-part breadcrumb (finance section, GL module, cash
 * flow screen), the title/subtitle, the presentational period chip + Export/print header actions,
 * the 4 KPI cards (CFO / CFI / CFF / closing cash), the Card(pad=0) with its centered report
 * header, the 3 activity Sections (title row + line items + a net row) and the net-change /
 * opening / closing rows + footnote are the prototype's.
 *
 * Method (B-134 = option A): the screen renders the DIRECT method. The prototype's visible copy says
 * INDIRECT, but the DIRECT wording already lives in the gl.cf.* dict keys (subtitle / kpiCfoSub /
 * footNote) — those are consumed verbatim, never reworded here.
 *
 * Data (§0 rule 3): the prototype's local CASHFLOW_DATA (fixed Thai labels + hardcoded per-period
 * figures + client-side net/net-change/closing math) is dropped — every figure is the REAL server
 * aggregation from GET /gl/reports/cashflow (use-gl-cashflow.ts). The wire is the opaque EntityOk
 * OBJECT { operating, investing, financing, opening_cash, net_change, closing_cash, currency_code };
 * the pure narrowing + millions/parens/sign formatting lives in gl-cashflow-rows.ts (unit-tested, G3).
 *
 * MONEY AUTHORITY (§0 + apps/web/CLAUDE.md): the server owns 100% of the authoritative figures.
 * Each section `net`, opening_cash, net_change and closing_cash come STRAIGHT off the wire — the
 * client never computes an authoritative total. The only client work is presentational: the
 * millions display-scaling for the KPI values, the sign/parentheses formatting for the statement
 * rows, and the "+/-delta" text in the closing-cash KPI sub.
 *
 * HONEST DIVERGENCES (reported, never fabricated) — flagged here + in gl-cashflow-rows.ts:
 *   - honest-empty investing / financing (F-CF1): no cash JV against the investing/financing COA
 *     codes in the seed -> the wire returns { lines: [], net: 0 }. Each section renders
 *     structurally present (title + net 0, no rows) — never dropped, never fabricated.
 *   - opening_cash = 0 (F-CF2): no opening-balance JV exists -> opening is an honest 0 and
 *     closing_cash == net_change. No opening figure is invented.
 *   - period selector (F-CF3): the prototype's Dropdown asserts a specific mock period (a fixed
 *     month / YTD). The backend applies NO period filter (C-180), so it is replaced by a
 *     presentational, non-asserting FilterChip (value = common.all, the gl-statements / gl-trial
 *     precedent) and the card header period line is the honest unit-only gl.cf.reportPeriodLine.
 *   - section header tones (F-CF4): the prototype's decorative teal/amber/violet hex tones have no
 *     token equivalents (§0 rule 6 tokens-only) -> mapped to semantic tokens (ok / warn / accent),
 *     mirroring gl-statements' per-section semantic-token choice.
 *   - Export action: no ported export modal + no cash-flow export dict key -> a no-op stub button
 *     (boq-archive / boq-overview Export precedent), never a fabricated toast.
 *
 * i18n (§0 rule 2): every visible string is a gl.cf.* dict key or an existing reuse key
 * (fin.breadcrumbFinance, gl.stmt.tabCf, pm.unitMillion, subcon.colPeriod, common.all/export/print).
 * "GL" is the prototype's verbatim ASCII module crumb. Tokens back every colour (§0 rule 6). NO
 * Thai/baht literal in this .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toCashFlow,
  formatMoney,
  formatParen,
  formatMillions,
  formatDelta,
  type CfSectionVM,
} from "./gl-cashflow-rows";
import { useCashFlow } from "./use-gl-cashflow";

const DASH = "—";

/** Shared statement-table cell padding (ds.jsx td()). */
const TD: CSSProperties = { padding: "14px", verticalAlign: "middle" };

/** Presentational filter chip (mirrors gl-statements.tsx / gl-trial.tsx FilterChip) — a
 *  label:value pill, no active filter applied to the query (C-180: gl.cashflow is NOT
 *  period-filtered). */
function FilterChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", fontSize: 11.5, color: "var(--text)", height: 32 }}>
      <span style={{ color: "var(--text-3)" }}>{label}:</span>
      <span style={{ fontWeight: 600, color: "var(--text)" }}>{value}</span>
      <Icon name="chevD" size={11} color="var(--text-3)" />
    </div>
  );
}

/** KPI card, inlined from dashboard.jsx Kpi (L93) — the props GLCashFlow actually uses
 *  (label / value / unit / sub / accent); the delta-pill/foot variants are dropped. */
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 }}>{label}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent || "var(--text)" }}>{value}</span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/**
 * One activity section, inlined from the prototype Section (accounting-extra2.jsx L278-294): a
 * tinted title row, the REAL wire `lines` (account_name label em-dashed when absent; amount in
 * parentheses when negative = cash out, danger colour), then the section net row. An honest-empty
 * section (lines: []) still renders the title + a real 0 net row (F-CF1) — never dropped.
 */
function CfSection({
  title,
  netLabel,
  section,
  tone,
}: {
  title: string;
  netLabel: string;
  section: CfSectionVM;
  tone: string;
}) {
  return (
    <>
      <tr style={{ background: `color-mix(in srgb, ${tone} 8%, var(--surface))`, borderTop: `2px solid color-mix(in srgb, ${tone} 30%, var(--surface))` }}>
        <td colSpan={2} style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 800, color: tone }}>{title}</td>
      </tr>
      {section.lines.map((r, i) => (
        <tr key={r.code || `${i}`} style={{ borderTop: "1px solid var(--border)" }}>
          <td style={{ ...TD, paddingLeft: 30 }}>{r.label || DASH}</td>
          <td className="num" style={{ ...TD, textAlign: "right", fontWeight: 600, color: r.amount < 0 ? "var(--danger)" : "var(--text)" }}>
            {formatParen(r.amount)}
          </td>
        </tr>
      ))}
      <tr style={{ borderTop: "1px solid var(--border-strong)", background: "var(--surface-2)" }}>
        <td style={{ ...TD, fontWeight: 700 }}>{netLabel}</td>
        <td className="num" style={{ ...TD, textAlign: "right", fontWeight: 800, color: section.net < 0 ? "var(--danger)" : "var(--ok)" }}>
          {formatParen(section.net)}
        </td>
      </tr>
    </>
  );
}

export function GLCashFlow() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const q = useCashFlow();
  const vm = useMemo(() => toCashFlow(q.data), [q.data]);

  const skeleton = (
    <div style={{ padding: 20 }}>
      {[0, 1, 2, 3, 4].map((n) => (
        <div
          key={n}
          style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
        />
      ))}
    </div>
  );

  const statementBody = (
    <>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{t("gl.cf.title")}</div>
        <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{t("gl.cf.reportPeriodLine")}</div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <tbody>
          <CfSection title={t("gl.cf.secOperating")} netLabel={t("gl.cf.netOperating")} section={vm.operating} tone="var(--ok)" />
          <CfSection title={t("gl.cf.secInvesting")} netLabel={t("gl.cf.netInvesting")} section={vm.investing} tone="var(--warn)" />
          <CfSection title={t("gl.cf.secFinancing")} netLabel={t("gl.cf.netFinancing")} section={vm.financing} tone="var(--accent)" />
          {/* Net change (server) — bold, tinted by sign. */}
          <tr style={{ borderTop: "2px solid var(--border-strong)" }}>
            <td style={{ ...TD, fontWeight: 800 }}>{t("gl.cf.netChangeRow")}</td>
            <td className="num" style={{ ...TD, textAlign: "right", fontWeight: 800, color: vm.netChange < 0 ? "var(--danger)" : "var(--ok)" }}>
              {formatParen(vm.netChange)}
            </td>
          </tr>
          {/* Opening cash (server; honest 0 in the seed, F-CF2). */}
          <tr style={{ borderTop: "1px solid var(--border)" }}>
            <td style={{ ...TD, color: "var(--text-2)" }}>{t("gl.cf.openingRow")}</td>
            <td className="num" style={{ ...TD, textAlign: "right", fontWeight: 600 }}>{formatMoney(vm.openingCash)}</td>
          </tr>
          {/* Closing cash (server) — the brand-emphasized bottom line. */}
          <tr style={{ borderTop: "2px solid var(--brand)", background: "var(--brand-soft)" }}>
            <td style={{ ...TD, fontWeight: 800, color: "var(--brand-ink, var(--brand))" }}>{t("gl.cf.closingRow")}</td>
            <td className="num" style={{ ...TD, textAlign: "right", fontWeight: 800, color: "var(--brand)" }}>{formatMoney(vm.closingCash)}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-3)", display: "flex", gap: 6, alignItems: "center" }}>
        <Icon name="info" size={13} /> {t("gl.cf.footNote")}
      </div>
    </>
  );

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), "GL", t("gl.stmt.tabCf")]}
      title={t("gl.cf.title")}
      subtitle={t("gl.cf.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Presentational period chip (gl-statements / gl-trial precedent) — value = "all", no
              active period filter applied to the query (C-180, F-CF3). */}
          <FilterChip label={t("subcon.colPeriod")} value={t("common.all")} />
          {/* Export = no-op stub (no ported export modal + no cash-flow export dict key; boq-archive
              Export precedent) — never a fabricated toast. */}
          <Btn kind="outline" size="md" icon="download">
            {t("common.export")}
          </Btn>
          <Btn kind="ghost" size="md" icon="print" onClick={() => ctx.notify(t("gl.cf.printToast"))}>
            {t("common.print")}
          </Btn>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <Kpi label={t("gl.cf.kpiCfoLabel")} value={formatMillions(vm.operating.net)} unit={t("pm.unitMillion")} sub={t("gl.cf.kpiCfoSub")} accent={vm.operating.net >= 0 ? "var(--ok)" : "var(--danger)"} />
        <Kpi label={t("gl.cf.kpiCfiLabel")} value={formatMillions(vm.investing.net)} unit={t("pm.unitMillion")} sub={t("gl.cf.kpiCfiSub")} accent={vm.investing.net >= 0 ? "var(--ok)" : "var(--danger)"} />
        <Kpi label={t("gl.cf.kpiCffLabel")} value={formatMillions(vm.financing.net)} unit={t("pm.unitMillion")} sub={t("gl.cf.kpiCffSub")} accent={vm.financing.net >= 0 ? "var(--ok)" : "var(--danger)"} />
        <Kpi label={t("gl.cf.kpiCloseLabel")} value={formatMillions(vm.closingCash)} unit={t("pm.unitMillion")} sub={t("gl.cf.kpiCloseSub").replace("{delta}", formatDelta(vm.netChange))} accent="var(--brand)" />
      </div>

      <Card pad={0}>{q.isLoading ? skeleton : statementBody}</Card>
    </Page>
  );
}
