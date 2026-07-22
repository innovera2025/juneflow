/*
 * GLTrialBalance — the Trial Balance screen, ported from pototype/gl.jsx GLTrialBalance
 * (L511-576). Route gl.trial (docs/extract/NAV-ROUTES.md L62, section "acct").
 *
 * Design fidelity (PLAN.md §0 rule 1): the three-part breadcrumb (finance section, GL module,
 * trial-balance screen), the title, the Export-Excel header action, the 4-card MiniKpi strip
 * (assets / liabilities / revenue / expense), and the 6-column table (code · name · carry ·
 * debit · credit · balance) with the "Dr = Cr" totals footer are the prototype's.
 *
 * Data (§0 rule 3): the prototype's local TRIAL mock is dropped — the rows are the REAL
 * per-account Dr/Cr sums the server aggregates from jv_line grouped by account
 * (GET /gl/reports/trial-balance, use-gl-trial.ts). The wire is the opaque EntityOk OBJECT
 * { rows: [{ account_code, account_name, debit, credit }], totals: { total_debit,
 * total_credit }, currency_code }; the pure narrowing / balance / KPI logic lives in
 * gl-trial-rows.ts (unit-tested, G3).
 *
 * HONEST DIVERGENCES (reported, never fabricated) — flagged here + in gl-trial-rows.ts:
 *   - carry / opening balance (the carry column): NO wire field (the aggregation is period
 *     movement only) -> the carry column em-dashes EVERY row.
 *   - balance (the balance column): computed as `debit - credit` (period NET), NOT `carry +
 *     debit - credit` as the mock did -> this is a period-net figure, NOT a true carried-
 *     forward running balance (F-GL2). The Dr/Cr suffix mirrors the prototype's sign+type expr.
 *   - the 4 KPI account groups are derived by account_code PREFIX (Thai COA: 1=asset,
 *     2=liability, 4=revenue, 5=expense; 3=equity is NOT a KPI) — no explicit account_type is
 *     on the wire (F-GL2). Values are shown ABS in M-baht.
 *   - subtitle: the prototype subtitle embeds a false fixed period (a hardcoded "May 2569"
 *     month); the backend does NOT filter by period (C-180 deferred) and there is NO honest
 *     period-free gl.trial.subtitle dict key -> the subtitle is OMITTED (reported), never
 *     minted, so no false period is asserted.
 *   - the prototype's period/project Filter chips are RENDERED presentationally (gl-jv.tsx
 *     FilterChip precedent): value = "all" (t(common.all) / subcon.kpiAllProjects), since the
 *     backend applies no period/project filter (C-180) — the chips assert NO specific period.
 *   - only accounts with jv_line activity appear (gl.ts) — mock-only accounts legitimately do
 *     not show (expected §0 divergence, classed honest at G5).
 *
 * i18n (§0 rule 2): every string is a gl.trial.* dict key or an existing reuse key (t):
 * cc.thCode (code header), fin.breadcrumbFinance (breadcrumb), subcon.unitMBaht (M-baht unit),
 * subcon.exportExcelBtn (Export label). "GL" is the prototype's verbatim ASCII module crumb.
 * The mock KPI count-captions ("14 accounts" / "YTD sales" / "YTD") are DROPPED — no accounts-
 * unit dict key exists and the YTD/sales captions were mock (never fabricated). Tokens back
 * every colour (§0 rule 6). NO Thai/baht in this .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  toTrialBalance,
  rowBalance,
  balanceSuffix,
  kpiSum,
  formatMoney,
  millionsAbs,
} from "./gl-trial-rows";
import { useTrialBalance } from "./use-gl-trial";

const DASH = "—";

/** Table header cell style (ds.jsx th(), mirrors gl-jv). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td(), mirrors gl-jv). */
const td: CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };

/** MiniKpi card, inlined from ds.jsx MiniKpi (with the M-baht unit span). */
function MiniKpi({
  label,
  value,
  unit,
  tone,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  tone: string;
  icon: IconName;
}) {
  return (
    <div
      style={{
        padding: 18,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `color-mix(in srgb, ${tone} 10%, var(--surface))`,
            color: tone,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={15} strokeWidth={1.5} />
        </div>
        <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 500, letterSpacing: "-0.003em" }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 700, color: tone, letterSpacing: "-0.018em" }}>
          {value}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{unit}</span>
      </div>
    </div>
  );
}

/** Presentational filter chip (mirrors gl-jv.tsx FilterChip) — a label:value pill,
 *  no active filter applied to the query (C-180: gl.trial is NOT period-filtered). */
function FilterChip({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: muted ? "transparent" : "var(--surface-2)", fontSize: 11.5, color: "var(--text)", height: 32 }}>
      <span style={{ color: "var(--text-3)" }}>{label}:</span>
      <span style={{ fontWeight: 600, color: muted ? "var(--text-3)" : "var(--text)" }}>{value}</span>
      <Icon name="chevD" size={11} color="var(--text-3)" />
    </div>
  );
}

export function GLTrialBalance() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const q = useTrialBalance();
  const tb = useMemo(() => toTrialBalance(q.data), [q.data]);
  const { rows, totals } = tb;

  // KPI value unit (M-baht) — reuse subcon.unitMBaht; groups summed by code prefix (F-GL2).
  const kpiUnit = t("subcon.unitMBaht");

  return (
    <Page
      // Subtitle intentionally omitted — no honest period-free gl.trial.subtitle key (see header).
      breadcrumbs={[t("fin.breadcrumbFinance"), "GL", t("gl.trial.crumbScreen")]}
      title={t("gl.trial.title")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Presentational filter chips (gl-jv precedent) — value = "all", no active period/project filter (C-180). */}
          <FilterChip label={t("subcon.colPeriod")} value={t("common.all")} />
          <FilterChip label={t("subcon.fieldProject")} value={t("subcon.kpiAllProjects")} muted />
          <Btn kind="primary" size="md" icon="download" onClick={() => ctx.notify(t("gl.trial.exportToast"))}>
            {t("subcon.exportExcelBtn")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4): each group summed by code prefix (F-GL2); count-subs dropped (no accounts-unit key). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniKpi label={t("gl.trial.kpiAssets")} value={millionsAbs(kpiSum(rows, "asset"))} unit={kpiUnit} tone="var(--brand)" icon="ledger" />
        <MiniKpi label={t("gl.trial.kpiLiabilities")} value={millionsAbs(kpiSum(rows, "liability"))} unit={kpiUnit} tone="var(--accent)" icon="ledger" />
        <MiniKpi label={t("gl.trial.kpiRevenue")} value={millionsAbs(kpiSum(rows, "revenue"))} unit={kpiUnit} tone="var(--ok)" icon="trend" />
        <MiniKpi label={t("gl.trial.kpiExpense")} value={millionsAbs(kpiSum(rows, "expense"))} unit={kpiUnit} tone="var(--warn)" icon="cart" />
      </div>

      <Card pad={0}>
        {q.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div
                key={n}
                style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th style={th(80)}>{t("cc.thCode")}</th>
                <th style={th()}>{t("gl.trial.colName")}</th>
                <th style={th(140, true)}>{t("gl.trial.colCarry")}</th>
                <th style={th(140, true)}>{t("gl.trial.colDrPeriod")}</th>
                <th style={th(140, true)}>{t("gl.trial.colCrPeriod")}</th>
                <th style={th(140, true)}>{t("gl.trial.colBalance")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const bal = rowBalance(r);
                const suffix = balanceSuffix(r.accountCode, bal);
                return (
                  <tr key={r.accountCode || i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td, color: "var(--text-3)" }} className="num">{r.accountCode || DASH}</td>
                    <td style={{ ...td, fontWeight: 500 }}>{r.accountName || DASH}</td>
                    {/* carry: NO wire field -> em-dash every row (prototype carry===0 branch uses text-2, gl.jsx L556) */}
                    <td style={{ ...td, textAlign: "right", color: "var(--text-2)" }} className="num">{DASH}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                      {r.debit === 0 ? DASH : formatMoney(r.debit)}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }} className="num">
                      {r.credit === 0 ? DASH : formatMoney(r.credit)}
                    </td>
                    {/* balance: period NET (debit - credit), NOT a carried running balance (F-GL2) */}
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: bal < 0 ? "var(--danger)" : "var(--text)" }} className="num">
                      {formatMoney(Math.abs(bal))}{suffix ? ` ${suffix}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot style={{ background: "var(--ok-soft)", borderTop: "2px solid var(--ok)" }}>
              <tr>
                {/* footTotal already carries the leading check + "Dr = Cr" text */}
                <td colSpan={3} style={{ ...td, fontWeight: 700, textAlign: "right", color: "var(--ok)" }}>
                  {t("gl.trial.footTotal")}
                </td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">{formatMoney(totals.totalDebit)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700 }} className="num">{formatMoney(totals.totalCredit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
    </Page>
  );
}
