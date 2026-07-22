/*
 * FADepreciation — the Depreciation screen, ported from pototype/fa.jsx FADepreciation (L444-519).
 * Route fa.depr (docs/extract/NAV-ROUTES.md L86, section "acct"). Mirrors the just-merged
 * gl-inbox.tsx (dict t() keys, generated client + unwrap, inlined primitives, honest wiring).
 *
 * Design fidelity (PLAN.md section 0 rule 1): the three-part breadcrumb (finance section, assets
 * module, depreciation screen), the title/subtitle, the header actions, the 4-card KPI strip, and
 * the per-asset depreciation table (code / name / method / brought-forward / this-month / remainder
 * / cost-center) are the prototype's.
 *
 * Data (rule 8): GET /fa/assets (use-fa-depr.ts) via the generated client — the prototype's local
 * ASSETS seed becomes the real server catalogue. The MONTHLY figure is the SERVER-authoritative
 * straight-line (cost - salvage)/life/12 (fa-depr-rows), NOT the prototype's cost/(life*12) MOCK
 * (which drops salvage, fa.jsx L491). The client renders that formula as a PREVIEW; the Run action
 * -> POST /fa/run-depreciation is the authority that posts the JV (depr-run-form.tsx).
 *
 * REAL vs em-dash (honest, never fabricated):
 *   - table -> the depreciable assets (active, life>0, cost>salvage, not fully depreciated); each
 *     row's book value is the real server book_value, the monthly + remainder are the real
 *     straight-line projection, the method + cost-center are real wire data (em-dash when absent).
 *   - the per-row posting-account sub-line uses the prototype's keyed label (fa.depr.acctDeprLine
 *     "5301"); the ACTUAL server posts Dr 5100 admin-expense / Cr 1210 PP&E (COA_SEED stand-ins,
 *     fa.ts) — reported as a prototype-vs-server account divergence.
 *   - KPIs: "this month" is the real Sigma of the monthly projection; YTD / JV-count / internal-rent
 *     have NO wire on the asset list -> em-dash (mirrors gl-jv's honest KPI treatment).
 *   - the header period filter is PRESENTATIONAL (the asset list is not period-scoped) -> it shows
 *     "all", like gl-jv's presentational chips. Export has NO /fa/export endpoint and no honest
 *     export-toast key -> it renders DISABLED (gl-coa's honest no-endpoint-action analogue), both
 *     reported.
 *
 * i18n (rule 2): every string resolves via t() from the DICT (i18n-full.json) — the fa.depr.* keys
 * plus reused keys (fin.breadcrumbFinance / fa.breadcrumbAssets / pm.colCode / fa.colName /
 * fa.colMethod / subcon.colPeriod / subcon.unitBaht / vendor.btnExport / common.all /
 * gl.inbox.emptyFiltered). The depreciation breadcrumb has NO dedicated fa.breadcrumbDepr key, so
 * it reuses the byte-identical gl.stmt.rowDepreciation ("depreciation") — reported. Tokens back
 * every colour (rule 6). ZERO Thai/baht in this .tsx (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import {
  depreciableAssets,
  formatMoney,
  sumMonthly,
  toDeprRow,
  toFaAsset,
  type FaAsset,
} from "./fa-depr-rows";
import { useFaAssetList } from "./use-fa-depr";
import { DeprRunForm } from "./depr-run-form";

const DASH = "—";

/** Table header cell style (ds.jsx th()). */
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

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };

/** Kpi card, inlined from dashboard.jsx Kpi (L93-115) — web has no shared Kpi (gl-coa precedent). */
function Kpi({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
}) {
  return (
    <Card pad={18}>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 500, marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          className="num"
          style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: accent ?? "var(--text)" }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>{unit}</span>}
      </div>
    </Card>
  );
}

/** Presentational header filter pill (ds.jsx Filter muted look) — label:value + chevron, no query. */
function PeriodFilter({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 6px 4px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--surface-2)",
        fontSize: 11.5,
        color: "var(--text)",
        height: 34,
      }}
    >
      <span style={{ color: "var(--text-3)" }}>{label}:</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
      <Icon name="chevD" size={11} color="var(--text-3)" />
    </div>
  );
}

/** A right-aligned money cell (className num, optional tone). */
function money(value: number, tone?: string, weight = 600): ReactNode {
  return (
    <span className="num" style={{ fontWeight: weight, color: tone }}>
      {formatMoney(value)}
    </span>
  );
}

export function FADepreciation() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const assetsQ = useFaAssetList();
  const assets = useMemo<FaAsset[]>(() => (assetsQ.data ?? []).map(toFaAsset), [assetsQ.data]);
  const rows = useMemo(() => depreciableAssets(assets).map(toDeprRow), [assets]);
  const monthTotal = useMemo(() => sumMonthly(assets), [assets]);

  const openRun = () => {
    ctx.openModal({
      title: t("fa.run.title"),
      subtitle: t("fa.run.subtitle"),
      icon: "sync",
      iconTone: "var(--accent)",
      size: "md",
      body: ({ close }: { close: () => void }) => <DeprRunForm onClose={close} />,
    });
  };

  return (
    <Page
      breadcrumbs={[
        t("fin.breadcrumbFinance"),
        t("fa.breadcrumbAssets"),
        // No dedicated fa.breadcrumbDepr key -> reuse the byte-identical "depreciation" term.
        t("gl.stmt.rowDepreciation"),
      ]}
      title={t("fa.depr.title")}
      subtitle={t("fa.depr.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <PeriodFilter label={t("subcon.colPeriod")} value={t("common.all")} />
          {/* Export: no /fa/export endpoint + no honest fa export-toast key -> disabled (honest). */}
          <Btn kind="outline" size="md" icon="download" disabled>
            {t("vendor.btnExport")}
          </Btn>
          <Btn kind="primary" size="md" icon="sync" onClick={openRun}>
            {t("fa.depr.btnRun")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4): "this month" is the real Sigma projection; YTD / JV / rent have no wire. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <Kpi label={t("fa.depr.kpiMonth")} value={formatMoney(monthTotal)} unit={t("subcon.unitBaht")} accent="var(--warn)" />
        <Kpi label={t("fa.depr.kpiYtd")} value={DASH} />
        <Kpi label={t("fa.depr.kpiJv")} value={DASH} />
        <Kpi label={t("fa.depr.kpiRent")} value={DASH} accent="var(--info)" />
      </div>

      <Card pad={0}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t("fa.depr.tableTitle")}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{t("fa.depr.tableSub")}</div>
        </div>

        {assetsQ.isLoading ? (
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
                <th style={th(100)}>{t("pm.colCode")}</th>
                <th style={th()}>{t("fa.colName")}</th>
                <th style={th(110)}>{t("fa.colMethod")}</th>
                <th style={th(120, true)}>{t("fa.depr.colBroughtFwd")}</th>
                <th style={th(110, true)}>{t("fa.depr.colMonthDepr")}</th>
                <th style={th(120, true)}>{t("fa.depr.colRemain")}</th>
                <th style={th(140)}>{t("fa.depr.colCcPosting")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
                    {t("gl.inbox.emptyFiltered")}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td, fontWeight: 600 }} className="num">
                      <span style={{ color: "var(--brand)" }}>{r.id}</span>
                    </td>
                    <td style={td}>{r.name || DASH}</td>
                    <td style={{ ...td, fontSize: 11.5 }}>
                      {r.method || <span style={{ color: "var(--text-3)" }}>{DASH}</span>}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{money(r.book)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{money(r.monthly, "var(--warn)", 700)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{money(r.remain, "var(--ok)", 700)}</td>
                    <td style={{ ...td, fontSize: 11 }}>
                      {r.ccId ? (
                        <div className="num" style={{ color: "var(--brand)", fontWeight: 600 }}>{r.ccId}</div>
                      ) : (
                        <div style={{ color: "var(--text-3)" }}>{DASH}</div>
                      )}
                      <div style={{ color: "var(--text-3)" }}>{t("fa.depr.acctDeprLine")}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot style={{ background: "var(--surface-2)", borderTop: "2px solid var(--border-strong)" }}>
              <tr>
                <td colSpan={4} style={{ padding: 12, textAlign: "right", fontWeight: 700 }}>
                  {t("fa.depr.footerTotal")}
                </td>
                <td className="num" style={{ padding: 12, textAlign: "right", fontWeight: 700, color: "var(--warn)" }}>
                  {formatMoney(monthTotal)}
                </td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
    </Page>
  );
}
