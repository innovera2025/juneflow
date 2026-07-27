/*
 * GLStatements — the Financial Statements screen (Balance Sheet + P&L), ported from
 * pototype/gl.jsx GLStatements (L582-735: BalanceSheet L644-684 + ProfitLoss L686-735).
 * Route gl.statements (docs/extract/NAV-ROUTES.md L63, section "acct").
 *
 * Design fidelity (PLAN.md §0 rule 1): the three-part breadcrumb (finance section, GL module,
 * statements screen), the title/subtitle, the two presentational Filter chips + print action,
 * the Card(pad=0) + 3-tab TabBar (Balance Sheet / P&L / Cash Flow), the Balance-Sheet section
 * stack with the green balance banner, and the P&L two-column statement + margin rail are the
 * prototype's.
 *
 * Data (§0 rule 3): the prototype's local literals (fixed Thai labels + hardcoded 2569/2568
 * figures) are dropped — every figure is the REAL server aggregation from GET
 * /gl/reports/statements (use-gl-statements.ts). The wire is the opaque EntityOk OBJECT
 * { balance_sheet, income_statement, currency_code }; the pure narrowing / asset-split / section
 * logic lives in gl-statements-rows.ts (unit-tested, G3).
 *
 * MONEY AUTHORITY (§0 + apps/web/CLAUDE.md): the server owns 100% of the authoritative figures.
 * All amounts, the liabilities/equity/revenue/expense subtotals, total_assets,
 * total_liabilities_equity, net_income and the `balanced` flag come STRAIGHT off the wire — the
 * client never computes an authoritative total. The one client computation is the CURRENT vs
 * NON-CURRENT asset split (a presentation re-bucketing of server row amounts; F-STMT1).
 *
 * HONEST DIVERGENCES (reported, never fabricated) — flagged here + in gl-statements-rows.ts:
 *   - PRIOR-period column (F-STMT2): every prior_* is null (all JVs are 2026, no prior year) ->
 *     the prior amount column em-dashes EVERY row + subtotal. No prior figure is invented.
 *   - amount-column period headers: the prototype header cells assert a specific Thai month/year
 *     period; the backend applies NO period filter (C-180) and there is no honest period-free
 *     column-header dict key -> the amount-column headers are OMITTED (reported), never minted,
 *     so no false period is asserted (mirrors gl-trial dropping its false-period subtitle). The
 *     row-label header uses the pm.unitItems dict key.
 *   - period/project Filter chips: RENDERED presentationally (gl-trial FilterChip precedent),
 *     value = "all" (common.all / subcon.kpiAllProjects), since the backend applies no
 *     period/project filter (C-180) — the chips assert NO specific period.
 *   - P&L margin rail (grossMargin / netMargin / profitPerUnit): those are analytics with NO
 *     wire field -> the VALUES em-dash and the prototype's "+X ppt" sub-deltas are omitted. Only
 *     the static labels remain (never fabricated).
 *   - balance banner: driven by the REAL server `balanced` boolean (ok+check when true;
 *     danger+alert when false). The only banner text key (gl.stmt.balanceBanner) asserts balance
 *     and there is no "unbalanced" message key; when unbalanced the danger tone + alert icon +
 *     the two visibly-unequal figures signal the mismatch. Reported as a possible i18n gap.
 *
 * i18n (§0 rule 2): every visible string is a gl.stmt.* dict key or an existing reuse key
 * (fin.breadcrumbFinance, subcon.colPeriod / .fieldProject / .kpiAllProjects / .printToast,
 * common.all / .total, pm.unitItems). "GL" is the prototype's verbatim ASCII module crumb.
 * Tokens back every colour (§0 rule 6). NO Thai/baht literal in this .tsx (B-073).
 */
import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { toStatements, formatMoney, type StmtRowVM } from "./gl-statements-rows";
import { useStatements } from "./use-gl-statements";

const DASH = "—";

type StmtTab = "bs" | "pl" | "cf";

/** The 3-column statement grid template (label | current | prior), shared by header + rows. */
const STMT_COLS = "1fr 140px 140px";

/** Presentational filter chip (mirrors gl-trial.tsx FilterChip) — a label:value pill, no active
 *  filter applied to the query (C-180: gl.statements is NOT period/project-filtered). */
function FilterChip({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: muted ? "transparent" : "var(--surface-2)", fontSize: 11.5, color: "var(--text)", height: 32 }}>
      <span style={{ color: "var(--text-3)" }}>{label}:</span>
      <span style={{ fontWeight: 600, color: muted ? "var(--text-3)" : "var(--text)" }}>{value}</span>
      <Icon name="chevD" size={11} color="var(--text-3)" />
    </div>
  );
}

/** TabBar, inlined from ds.jsx TabBar (the no-count variant GLStatements uses). */
function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: StmtTab; label: string }[];
  active: StmtTab;
  onChange: (id: StmtTab) => void;
}) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 18px" }}>
      {tabs.map((tab) => {
        const on = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            style={{
              padding: "15px 14px",
              background: "none",
              border: "none",
              borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -1,
              fontSize: 12.5,
              fontWeight: on ? 700 : 500,
              color: on ? "var(--brand)" : "var(--text-2)",
              letterSpacing: "-0.005em",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One statement section, inlined from ds.jsx StmtSection (gl.jsx L612-642). Rows are the REAL
 * account rows (label = the DB account_name, em-dash when absent); the current amount shows ABS
 * with a danger colour when negative (prototype L624); the PRIOR column em-dashes every row +
 * the subtotal (F-STMT2, all prior_* null). The subtotal row always renders (honest-empty
 * sections are structurally present with a real 0).
 */
function StmtSection({
  title,
  rows,
  subtotal,
  totalLabel,
  tone = "var(--brand)",
  strong,
}: {
  title: string;
  rows: readonly StmtRowVM[];
  subtotal: number;
  totalLabel: string;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, padding: "0 4px" }}>
        {title}
      </div>
      {rows.map((r, i) => (
        <div
          key={r.code || `${i}`}
          style={{ display: "grid", gridTemplateColumns: STMT_COLS, padding: "8px 14px", fontSize: 12.5, borderBottom: "1px solid var(--border)" }}
        >
          <span style={{ paddingInlineStart: 18, fontWeight: 400, color: "var(--text-2)" }}>{r.label || DASH}</span>
          <span className="num" style={{ textAlign: "right", color: r.amount < 0 ? "var(--danger)" : "var(--text)", fontWeight: 600 }}>
            {formatMoney(Math.abs(r.amount))}
          </span>
          {/* PRIOR: no prior-year data on the wire -> em-dash every row (F-STMT2). */}
          <span className="num" style={{ textAlign: "right", color: "var(--text-3)" }}>{DASH}</span>
        </div>
      ))}
      <div
        style={{ display: "grid", gridTemplateColumns: STMT_COLS, padding: "10px 14px", fontSize: 13, borderTop: `2px solid ${tone}`, background: `color-mix(in srgb, ${tone} 8%, var(--surface))` }}
      >
        <span style={{ fontWeight: 700, color: tone }}>{totalLabel}</span>
        <span className="num" style={{ textAlign: "right", fontWeight: 800, color: tone, fontSize: strong ? 15 : 13 }}>{formatMoney(subtotal)}</span>
        <span className="num" style={{ textAlign: "right", fontWeight: 600, color: "var(--text-3)" }}>{DASH}</span>
      </div>
    </div>
  );
}

/** The statement column-header row (row-label header only; amount-column period headers are
 *  omitted — no honest period-free key, C-180). */
function StmtHeader({ label }: { label: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: STMT_COLS, padding: "0 14px 8px", fontSize: 11, color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
      <span>{label}</span>
      {/* amount-column period headers omitted (no honest period-free dict key, C-180). */}
      <span />
      <span />
    </div>
  );
}

export function GLStatements() {
  const { t } = useI18n();
  const ctx = useShellCtx();
  const [tab, setTab] = useState<StmtTab>("bs");

  const q = useStatements();
  const vm = useMemo(() => toStatements(q.data), [q.data]);
  const { balanceSheet: bs, profitLoss: pl } = vm;

  // Equity rows = the DB member rows plus the synthetic current-period-profit line (its label is
  // resolved here from i18n; the amount is the server net_income folded into equity.subtotal).
  const equityRows: StmtRowVM[] = [
    ...bs.equity.members,
    { code: "", label: t("gl.stmt.rowCurrentProfit"), amount: bs.equity.netIncome },
  ];

  // Balance banner — driven by the REAL server `balanced` boolean (F: only "balanced" text key
  // exists; danger tone + alert icon + the two figures signal a mismatch when false).
  const bannerTone = bs.balanced ? "var(--ok)" : "var(--danger)";
  const bannerBg = bs.balanced ? "var(--ok-soft)" : "var(--danger-soft)";
  const bannerIcon: IconName = bs.balanced ? "check" : "alert";
  const bannerText = t("gl.stmt.balanceBanner")
    .replace("{assets}", formatMoney(bs.totalAssets))
    .replace("{liabEquity}", formatMoney(bs.totalLiabilitiesEquity));

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

  const balanceSheetBody = (
    <div style={{ padding: "20px 0 24px" }}>
      <StmtHeader label={t("pm.unitItems")} />
      <StmtSection title={t("gl.stmt.secCurrentAssets")} rows={bs.currentAssets.rows} subtotal={bs.currentAssets.subtotal} totalLabel={t("common.total")} />
      <StmtSection title={t("gl.stmt.secNonCurrentAssets")} rows={bs.nonCurrentAssets.rows} subtotal={bs.nonCurrentAssets.subtotal} totalLabel={t("common.total")} />
      <StmtSection title={t("gl.stmt.secCurrentLiab")} rows={bs.currentLiab.rows} subtotal={bs.currentLiab.subtotal} totalLabel={t("common.total")} tone="var(--warn)" />
      <StmtSection title={t("gl.stmt.secEquity")} rows={equityRows} subtotal={bs.equity.subtotal} totalLabel={t("gl.stmt.totalEquity")} tone="var(--ok)" />
      <div style={{ margin: "18px 14px 0", padding: 14, background: bannerBg, border: `1px solid ${bannerTone}`, borderRadius: 10, display: "flex", alignItems: "center", gap: 12 }}>
        <Icon name={bannerIcon} size={18} color={bannerTone} />
        <div style={{ fontSize: 12.5, fontWeight: 700, color: bannerTone, flex: 1 }}>{bannerText}</div>
      </div>
    </div>
  );

  const profitLossBody = (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, padding: 18 }}>
      <div>
        <StmtHeader label={t("pm.unitItems")} />
        <StmtSection title={t("gl.stmt.secRevenue")} rows={pl.revenue.rows} subtotal={pl.revenue.subtotal} totalLabel={t("gl.stmt.totalRevenue")} tone="var(--ok)" />
        <StmtSection title={t("gl.stmt.secCosts")} rows={pl.expense.rows} subtotal={pl.expense.subtotal} totalLabel={t("gl.stmt.totalCosts")} tone="var(--warn)" />
        {/* Net income (server) — the brand box; prior column em-dash (F-STMT2). */}
        <div style={{ marginTop: 8, padding: "14px 18px", background: "var(--brand)", color: "#fff", borderRadius: 10, display: "grid", gridTemplateColumns: "1fr 160px 160px", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{t("gl.stmt.netProfitBeforeTax")}</span>
          <span className="num" style={{ fontSize: 18, fontWeight: 800, textAlign: "right" }}>{formatMoney(pl.netIncome)}</span>
          <span className="num" style={{ fontSize: 13, opacity: 0.8, textAlign: "right" }}>{DASH}</span>
        </div>
      </div>

      {/* Margin rail — analytics with NO wire field: labels only, values em-dash (never fabricated). */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {[t("gl.stmt.grossMarginLabel"), t("gl.stmt.netMarginLabel"), t("gl.stmt.profitPerUnitLabel")].map((label) => (
          <Card key={label} pad={16}>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 6 }}>{label}</div>
            <div className="num" style={{ fontSize: 26, fontWeight: 800, color: "var(--text-3)" }}>{DASH}</div>
          </Card>
        ))}
      </div>
    </div>
  );

  const cashFlowBody = (
    <div style={{ padding: 60, textAlign: "center", color: "var(--text-3)" }}>
      <Icon name="info" size={28} />
      <div style={{ marginTop: 10 }}>{t("gl.stmt.cfComingSoon")}</div>
    </div>
  );

  const tabBody = tab === "bs" ? balanceSheetBody : tab === "pl" ? profitLossBody : cashFlowBody;

  return (
    <Page
      breadcrumbs={[t("fin.breadcrumbFinance"), "GL", t("gl.stmt.crumbScreen")]}
      title={t("gl.stmt.title")}
      subtitle={t("gl.stmt.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Presentational filter chips (gl-trial precedent) — value = "all", no active period/project filter (C-180). */}
          <FilterChip label={t("subcon.colPeriod")} value={t("common.all")} />
          <FilterChip label={t("subcon.fieldProject")} value={t("subcon.kpiAllProjects")} muted />
          <Btn kind="primary" size="md" icon="print" onClick={() => ctx.notify(t("subcon.printToast"))}>
            {t("gl.stmt.printBtn")}
          </Btn>
        </div>
      }
    >
      <Card pad={0}>
        <TabBar
          tabs={[
            { id: "bs", label: t("gl.stmt.tabBs") },
            { id: "pl", label: t("gl.stmt.tabPl") },
            { id: "cf", label: t("gl.stmt.tabCf") },
          ]}
          active={tab}
          onChange={setTab}
        />
        {q.isLoading ? skeleton : tabBody}
      </Card>
    </Page>
  );
}
