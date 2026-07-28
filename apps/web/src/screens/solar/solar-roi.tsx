/*
 * SolarROI — the ROI / cumulative-cashflow screen (route solar.roi), ported from
 * pototype/solar.jsx SolarROI (L164-219) + the shared SolarKpi (L6-22). Section module
 * `roi` (registry.ts L126). READ-ONLY (solar.ts is GET-only, no write bundle filed).
 *
 * Design fidelity (§0 rule 1): the two-crumb breadcrumb, the title + TypeBadge subtitle,
 * the Export-Model header action, the 4-card KPI strip, and the cumulative-cashflow table
 * with its center-anchored bar column are the prototype's.
 *
 * DATA (rule 3): GET /solar/roi (use-solar.ts) via the generated client — the prototype's
 * local array becomes the server catalogue. Pure narrowing / sign+colour + bar geometry
 * lives in solar-roi-rows.ts (unit-tested, G3).
 *
 * KPIs: ALL FOUR (CAPEX 248 / net-cashflow 49.2 / payback 5.0 / IRR 14.8) are fixed
 * illustrative EPC-model figures the seed roi rows cannot model, so they are rendered
 * verbatim as display constants (numbers, so no B-073 issue) — the brief's "IRR/NPV/ROI
 * figures verbatim" rule.
 *
 * HONEST DIVERGENCES (rule 4 — flagged, never fabricated):
 *   - Export-Model has no endpoint -> the prototype's client-intent toast
 *     (solar.roi.toastExportModel).
 *   - the per-year revenue/opex/cumulative render the RAW returned magnitudes via the app
 *     money formatter (the seed stores full-baht integers, not the prototype's millions);
 *     the bar's /800 scale is prototype-verbatim (not rescaled), so a larger cumulative
 *     saturates the bar — the honest consequence of the illustrative seed magnitudes.
 *
 * i18n (rule 2): every visible string is a solar.roi.* dict key (t) — consume-only, no key
 * minted here. No Thai literal lives in source (B-073); tokens back every colour except the
 * KPI accent hex #B45309 (prototype-verbatim, solar.jsx L185, B-037(a)); numeric cells carry
 * class `num` (rule 7). The em-dash / minus glyphs are prototype-verbatim punctuation
 * (ds.jsx DASH precedent), not translatable words.
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Page } from "../../shell/page";
import { TypeBadge } from "../../shell/type-badge";
import { useShellCtx } from "../../shell/shell-context";
import { SolarKpi } from "./solar-kpi";
import { formatMoney } from "./solar-shared";
import { toRoiRow, cumulativeText, cumColorKind, barLeftPct, barWidthPct, type RoiRow } from "./solar-roi-rows";
import { useSolarRoi } from "./use-solar";

/** Em-dash for an empty cashflow register (never a fabricated value). */
const DASH = "—";
/** Leading minus (U+2212) for the opex cell — prototype-verbatim glyph (solar.jsx L205). */
const MINUS = "−";

/** Table header cell style (ds.jsx th()). */
function th(w?: number, right = false): CSSProperties {
  return {
    textAlign: right ? "right" : "left",
    padding: "12px 14px",
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-3)",
    ...(w ? { width: w } : {}),
  };
}

/** Table body cell style (ds.jsx td()). */
const td: CSSProperties = { padding: "14px", verticalAlign: "middle" };

export function SolarROI() {
  const { t } = useI18n();
  const ctx = useShellCtx();

  const roiQ = useSolarRoi();
  const rows = useMemo<RoiRow[]>(() => (roiQ.data ?? []).map(toRoiRow), [roiQ.data]);

  const yearPrefix = t("solar.roi.rowYearPrefix");

  return (
    <Page
      breadcrumbs={[t("solar.roi.breadcrumbEpc"), t("solar.roi.breadcrumbSelf")]}
      title={t("solar.roi.title")}
      subtitle={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <TypeBadge type="solar" size="sm" />
          <span>{t("solar.roi.subtitle")}</span>
        </span>
      }
      actions={
        <Btn kind="outline" size="md" icon="download" onClick={() => ctx.notify(t("solar.roi.toastExportModel"))}>
          {t("solar.roi.actionExportModel")}
        </Btn>
      }
    >
      {/* KPI strip (4): all fixed illustrative EPC-model figures (verbatim; the seed cannot model them). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
        <SolarKpi label={t("solar.roi.kpiCapexLabel")} value="248" unit={t("solar.roi.kpiCapexUnit")} sub={t("solar.roi.kpiCapexSub")} accent="#B45309" icon="cash" />
        <SolarKpi label={t("solar.roi.kpiNetCashflowLabel")} value="49.2" unit={t("solar.roi.kpiNetCashflowUnit")} sub={t("solar.roi.kpiNetCashflowSub")} accent="var(--ok)" icon="trend" />
        <SolarKpi label={t("solar.roi.kpiPaybackLabel")} value="5.0" unit={t("solar.roi.kpiPaybackUnit")} sub={t("solar.roi.kpiPaybackSub")} accent="var(--info)" icon="clock" />
        <SolarKpi label={t("solar.roi.kpiIrrLabel")} value="14.8" unit={t("solar.roi.kpiIrrUnit")} sub={t("solar.roi.kpiIrrSub")} accent="var(--brand)" icon="pie" />
      </div>

      <Card pad={0}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 13.5, fontWeight: 700 }}>
          {t("solar.roi.tableTitle")}
        </div>
        {roiQ.isLoading ? (
          <div style={{ padding: 20 }}>
            {[0, 1, 2, 3, 4].map((n) => (
              <div key={n} style={{ height: 44, marginBottom: 4, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }} />
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
                <th scope="col" style={th(100)}>{t("solar.roi.colYear")}</th>
                <th scope="col" style={th(140, true)}>{t("solar.roi.colRevenue")}</th>
                <th scope="col" style={th(140, true)}>{t("solar.roi.colOpex")}</th>
                <th scope="col" style={th(180, true)}>{t("solar.roi.colCumulative")}</th>
                <th scope="col" style={th()} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  {/* No dedicated empty-state key exists (no minting) -> honest em-dash. */}
                  <td colSpan={5} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>{DASH}</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td, fontWeight: 600 }}>{`${yearPrefix} ${r.year}`}</td>
                    <td style={{ ...td, textAlign: "right" }} className="num">{formatMoney(r.revenue)}</td>
                    <td style={{ ...td, textAlign: "right", color: "var(--danger)" }} className="num">{MINUS}{formatMoney(r.opex)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: `var(--${cumColorKind(r.cumulative)})` }} className="num">
                      {cumulativeText(r.cumulative)}
                    </td>
                    <td style={td}>
                      <div style={{ height: 8, borderRadius: 999, background: "var(--surface-3)", position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--border-strong)" }} />
                        <div
                          style={{
                            position: "absolute",
                            left: barLeftPct(r.cumulative),
                            width: barWidthPct(r.cumulative),
                            top: 0,
                            bottom: 0,
                            background: `var(--${cumColorKind(r.cumulative)})`,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
