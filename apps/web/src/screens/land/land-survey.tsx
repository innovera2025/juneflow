/*
 * LandSurvey — Survey report + type-aware Feasibility, ported from pototype/land2.jsx
 * LandSurvey (L21-107) + the shared SurveyRow (L6-16) and FeasStat (L114-124). Route
 * land.survey (docs/extract/NAV-ROUTES.md L19, parent `land`, prototype file land2.jsx).
 *
 * READ + CLIENT-DERIVED (LA-3, no write bundle). The read-side wire (GET /land/plots,
 * apps/api/src/routes/land-sales.ts plotWire) returns
 *   { id, project_id, deed_no, area_sqm, gps, price_per_rai, currency_code, stage,
 *     tenure, created_at }
 * — the same wire land.bank consumes; this screen reuses its useLandPlots hook and its
 * area/money/narrowing helpers (never duplicated). So the screen ships:
 *   - the breadcrumb / title / subtitle are the prototype's (i18n keys, B-153);
 *   - a plot SELECTOR over the real register (label `${id} · —`, title em-dashed = LA-2);
 *   - a SURVEY REPORT card whose labels are real (land.survey.row*) but whose VALUES have
 *     no wire/derivable source (the prototype fabricated them from isSolar + plot.prov, a
 *     LA-2 field) — so every survey value renders the em-dash, exactly like land.bank's
 *     location column. It never invents terrain/slope/flood findings;
 *   - a FEASIBILITY card whose figures are REAL client-derivations from the plot's stored
 *     area_sqm / price_per_rai (LA-3, land-survey-rows.ts, unit-tested) — NOT em-dash;
 *   - a type-aware branch: the SELECTED plot's project type resolves from its project_id
 *     via GET /projects (projectTypeById); "solar" -> MWp/MWh/payback metrics, else the
 *     residential unit/area/value metrics. An unresolvable type defaults to residential;
 *   - the two write actions (Export, and the openSurveyForm "open survey" button) are
 *     honest-DISABLED — there is no export endpoint and no survey-persist handler (the
 *     modal was a dropped mock, §0 rule 3), so neither is a functional button that would
 *     404 / open a mock;
 *   - the "go to Due Diligence" nav button stays functional (ctx.navigate("land.dd")).
 *
 * i18n (§0 rule 2): every visible string is a land.survey.* DICT key (t, B-153) or a reuse
 * of an existing land.* / common.* dict key (land.bc.root, land.action.export, land.unit.rai).
 * The FeasStat UNIT suffixes the land.* dict does not cover are consumed only, never minted:
 * the four Thai/baht units (million-baht / year / units / sqm / baht) reuse existing
 * PHRASES keys via land-survey-strings.json (tp), like land-bank-strings.json; the two
 * ASCII units MWp/MWh reuse the existing dashboard.unitMWp/unitMWh DICT keys (t). No
 * Thai/baht literal sits in this source (B-073, baht U+0E3F is guarded); tokens back every
 * colour (§0 rule 6); numeric
 * cells carry class `num` (§0 rule 7). The FeasStat accent hex #B45309 is prototype-verbatim
 * (land2.jsx L82), like land-bank's KPI accents (B-037(a)).
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { TypeBadge } from "../../shell/type-badge";
import { useProjects } from "../../shell/use-shell-data";
import { toPlotRow, areaText, areaRai, type PlotRow } from "./land-bank-rows";
import {
  projectTypeById,
  isSolarType,
  unitsDevelopable,
  mwpInstallable,
  netSellableText,
  projectValueMText,
  landCostPerUnitText,
  annualMWhText,
  revenueMText,
  paybackText,
} from "./land-survey-rows";
import { useLandPlots } from "./use-land-bank";
import landSurveyStrings from "./land-survey-strings.json" with { type: "json" };

/** The literal em-dash the screen renders for every LA-2 / no-derivable-source field. */
const DASH = "—";

/**
 * SurveyRow — ported 1:1 from land2.jsx SurveyRow (L6-16). icon chip + label + value.
 * The prototype's per-row `tone` is dropped here: every value is the em-dash (no wire
 * source), so tinting the chip/value would falsely signal a (green/warn) finding.
 */
function SurveyRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: "var(--surface-2)",
          color: "var(--text-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name={icon} size={15} />
      </div>
      <span style={{ fontSize: 12.5, color: "var(--text-2)", flex: 1 }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{value}</span>
    </div>
  );
}

/** FeasStat — ported 1:1 from land2.jsx FeasStat (L114-124). Value carries class `num`. */
function FeasStat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  accent: string;
}) {
  return (
    <div style={{ padding: 12, borderRadius: 10, background: "var(--surface-2)" }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="num" style={{ fontSize: 20, fontWeight: 800, color: accent }}>
          {value}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{unit}</span>
      </div>
    </div>
  );
}

/** Card section header (land2.jsx L55-57 / L76-78): brand-tinted icon + bold title. */
function CardHeader({ icon, title }: { icon: IconName; title: string }) {
  return (
    <div
      style={{
        padding: "14px 18px",
        borderBottom: "1px solid var(--border)",
        fontSize: 13.5,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Icon name={icon} size={16} color="var(--brand)" />
      {title}
    </div>
  );
}

/** Native select styled like the prototype Dropdown mode="select" (ds.jsx), full-width. */
const selectStyle: CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "inherit",
  cursor: "pointer",
  outline: "none",
};

export function LandSurvey() {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const plotsQ = useLandPlots();
  const projectsQ = useProjects();

  const [sel, setSel] = useState("");

  const docs = useMemo<PlotRow[]>(() => (plotsQ.data ?? []).map(toPlotRow), [plotsQ.data]);
  const typeById = useMemo(() => projectTypeById(projectsQ.data), [projectsQ.data]);

  // Selected plot: the chosen id, else the first row (prototype `plots[0]`). Undefined
  // only while the register is empty (handled by the empty-state branch below).
  const plot = docs.find((p) => p.id === sel) ?? docs[0];
  const plotType = plot?.projectId ? typeById.get(plot.projectId) : undefined;
  const isSolar = isSolarType(plotType);

  // FeasStat unit suffixes (consume-only): Thai/baht via reused PHRASES keys (tp); the
  // ASCII MWp/MWh via reused dashboard.* DICT keys (t). None minted for land.survey.
  const unitMillion = tp(landSurveyStrings.unitMillionBaht as PhraseKey);
  const unitYear = tp(landSurveyStrings.unitYear as PhraseKey);
  const unitUnits = tp(landSurveyStrings.unitUnits as PhraseKey);
  const unitSqm = tp(landSurveyStrings.unitSqm as PhraseKey);
  const unitBaht = tp(landSurveyStrings.unitBaht as PhraseKey);
  const unitMwp = t("dashboard.unitMWp");
  const unitMwh = t("dashboard.unitMWh");

  const subtitle: ReactNode = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <TypeBadge type={plotType ?? ""} size="sm" />
      <span>
        {t("land.survey.subtitle")}
        {isSolar ? ` ${t("land.survey.subtitleSolarMode")}` : ""}
      </span>
    </span>
  );

  const actions: ReactNode = (
    <div style={{ display: "flex", gap: 8 }}>
      {/* Honest-DISABLED: no export endpoint — no functional button that would 404. */}
      <Btn kind="outline" size="md" icon="download" disabled>
        {t("land.action.export")}
      </Btn>
      {/* Honest-DISABLED: no survey-persist handler; the openSurveyForm modal is a dropped mock. */}
      <Btn kind="primary" size="md" icon="ruler" disabled>
        {t("land.survey.openBtn")}
      </Btn>
    </div>
  );

  return (
    <Page
      breadcrumbs={[t("land.bc.root"), t("land.survey.title")]}
      title={t("land.survey.title")}
      subtitle={subtitle}
      actions={actions}
    >
      {plotsQ.isLoading ? (
        // Loading skeleton — token blocks, no invented copy (mirror land-bank / boq-list).
        <div>
          <div style={{ height: 36, width: 340, marginBottom: 16, borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[0, 1].map((n) => (
              <div key={n} style={{ height: 320, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--border)" }} />
            ))}
          </div>
        </div>
      ) : docs.length === 0 ? (
        // Empty register — copy-less placeholder (land.bank set the precedent of a
        // message-free empty catalogue; no land.survey empty key exists and none is minted).
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0", color: "var(--text-3)" }}>
            <Icon name="landplot" size={40} />
          </div>
        </Card>
      ) : (
        <>
          {/* Plot selector (land2.jsx L44-50). Label `${id} · —` (title = LA-2 em-dash). */}
          <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-2)" }}>{t("land.survey.selectPlot")}</span>
            <div style={{ width: 340 }}>
              <select
                value={plot.id}
                onChange={(e) => setSel(e.target.value)}
                aria-label={t("land.survey.selectPlot")}
                style={selectStyle}
              >
                {docs.map((p) => (
                  <option key={p.id} value={p.id}>{`${p.id} · ${DASH}`}</option>
                ))}
              </select>
            </div>
            {/* area (rai-ngan-wa + rai) = REAL from area_sqm; amphoe/prov = LA-2 em-dash. */}
            <span className="num" style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              {areaText(plot.areaSqm)} {t("land.survey.areaUnitLabel")} · {areaRai(plot.areaSqm).toFixed(1)}{" "}
              {t("land.unit.rai")} · {DASH}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Survey report (land2.jsx L54-71) — labels real, values em-dash (no source). */}
            <Card pad={0}>
              <CardHeader icon="compass" title={t("land.survey.reportHeader")} />
              <div style={{ padding: "4px 18px 14px" }}>
                <SurveyRow icon="landplot" label={t("land.survey.rowTerrain")} value={DASH} />
                <SurveyRow icon="trend" label={t("land.survey.rowSlope")} value={DASH} />
                <SurveyRow icon="arrowR" label={t("land.survey.rowAccess")} value={DASH} />
                <SurveyRow icon="cash" label={t("land.survey.rowElectric")} value={DASH} />
                <SurveyRow icon="water" label={t("land.survey.rowWater")} value={DASH} />
                <SurveyRow icon="water" label={t("land.survey.rowFloodRisk")} value={DASH} />
                {isSolar && (
                  <>
                    <SurveyRow icon="sun" label={t("land.survey.rowIrradiance")} value={DASH} />
                    <SurveyRow icon="trend" label={t("land.survey.rowGridDistance")} value={DASH} />
                    <SurveyRow icon="cash" label={t("land.survey.rowSubstation")} value={DASH} />
                  </>
                )}
              </div>
            </Card>

            {/* Feasibility + assessment (land2.jsx L74-107). */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Card pad={0}>
                <CardHeader icon="pie" title={t("land.survey.feasHeader")} />
                <div style={{ padding: 18 }}>
                  {isSolar ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <FeasStat label={t("land.survey.feasMwp")} value={String(mwpInstallable(plot.areaSqm))} unit={unitMwp} accent="#B45309" />
                      <FeasStat label={t("land.survey.feasAnnualEnergy")} value={annualMWhText(plot.areaSqm)} unit={unitMwh} accent="var(--info)" />
                      <FeasStat label={t("land.survey.feasRevenue")} value={revenueMText(plot.areaSqm)} unit={unitMillion} accent="var(--ok)" />
                      <FeasStat label={t("land.survey.feasPayback")} value={paybackText(plot.areaSqm)} unit={unitYear} accent="var(--brand)" />
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <FeasStat label={t("land.survey.feasUnits")} value={String(unitsDevelopable(plot.areaSqm))} unit={unitUnits} accent="var(--brand)" />
                      <FeasStat label={t("land.survey.feasNetSaleable")} value={netSellableText(plot.areaSqm)} unit={unitSqm} accent="var(--info)" />
                      <FeasStat label={t("land.survey.feasProjectValue")} value={projectValueMText(plot.areaSqm)} unit={unitMillion} accent="var(--ok)" />
                      <FeasStat label={t("land.survey.feasLandCostPerUnit")} value={landCostPerUnitText(plot)} unit={unitBaht} accent="var(--accent)" />
                    </div>
                  )}
                </div>
              </Card>

              <Card>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>{t("land.survey.assessHeader")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9, background: "var(--ok-soft)" }}>
                  <Icon name="check" size={18} color="var(--ok)" />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ok)" }}>{t("land.survey.assessPass")}</div>
                    <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>
                      {isSolar
                        ? t("land.survey.assessSolarDetail").replace("{mwp}", String(mwpInstallable(plot.areaSqm)))
                        : t("land.survey.assessStdDetail").replace("{units}", String(unitsDevelopable(plot.areaSqm)))}
                    </div>
                  </div>
                </div>
                {/* Functional nav (land2.jsx L106) — the DD screen exists as a route. */}
                <Btn
                  kind="primary"
                  size="md"
                  icon="arrowR"
                  style={{ width: "100%", marginTop: 12, justifyContent: "center" }}
                  onClick={() => ctx.navigate("land.dd")}
                >
                  {t("land.survey.gotoDD")}
                </Btn>
              </Card>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
