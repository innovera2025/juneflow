/*
 * LandPipeline — the land-acquisition pipeline (kanban, 7 stages), ported from
 * pototype/land.jsx LandPipeline (L62-132) + the shared LandKpi (L41-57) and ds.jsx Tag
 * (L273-281). Route land.pipeline (docs/extract/NAV-ROUTES.md, parent `land`, prototype
 * file land.jsx). Previously unwired: registered in routes/registry.ts (L88) but absent
 * from router.tsx — this port adds the import + PORTED_SCREENS entry.
 *
 * READ-ONLY display (no write bundle wired). The read-side wire (GET /land/plots,
 * apps/api/src/routes/land-sales.ts plotWire) returns
 *   { id, project_id, deed_no, area_sqm, gps, price_per_rai, currency_code, stage,
 *     tenure, title, amphoe, prov, created_at }
 * (title/amphoe/prov = the merged LA-2 display columns). This screen ships the honest
 * kanban:
 *   - breadcrumb / title / subtitle are the prototype's (land.pipeline.* dict keys);
 *   - the two header actions (Export / add-plot) are honest-DISABLED — Export has no
 *     endpoint (dropped mock, mirror land-bank) and the add-plot form is out of this read
 *     scope (POST /land/plots exists but the write round wires the form later);
 *   - the 4 KPI cards are REAL, client-derived from the loaded plots (in-pipeline count =
 *     stage != close, total area in rai, total budget = summed value over non-closed plots,
 *     pending deals = stage in {nego, deal, dd});
 *   - the 7 kanban columns come from the local LAND_STAGES domain constant; each column
 *     groups the plots by stage and renders a static card (id / tenure badge / title /
 *     amphoe · prov / area in rai / compact millions price);
 *   - loading = token skeleton columns; an empty catalogue shows every column's own
 *     empty-state cell (land.pipeline.emptyCol) — naturally honest.
 *
 * Divergences from the prototype's mock mechanics (§0 rule 3): the card onClick detail
 * drawer + advance-stage action are DROPPED (cards render static, non-interactive); the
 * `pin` glyph is UNDEFINED in ds.jsx (renders invisible) and absent from the IconName union,
 * so the location line renders WITHOUT a pin (matching the prototype's blank null render),
 * with an 11px spacer preserving the 4px-gap layout.
 *
 * i18n (§0 rule 2): every visible string is an existing land.* dict key via t() (breadcrumb
 * root land.bc.root, the land.pipeline.* labels/subs, the 7 land.stage.* column headers, the
 * land.tenure.* card badges, land.unit.plot / land.unit.rai) — none minted. The ONE non-dict
 * string, the KPI-3 unit "million baht", reuses the existing phrases key via
 * land-pipeline-strings.json (tp), exactly like land-bank-strings.json. The compact card
 * price carries a trailing ASCII "M" magnitude glyph (land.jsx L121) rendered as a chrome
 * literal — it has no i18n key and is B-073-safe (ASCII 'M' is not Thai). Tokens back every
 * colour (§0 rule 6); the per-stage + KPI-accent + card-badge hexes are prototype-verbatim
 * (land.jsx L6-14 / L94-97 / L115; no matching token, B-037(a)); numeric cells carry class
 * `num` (§0 rule 7). No Thai/baht literal sits in this source (B-073).
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useLandPlots } from "./use-land-bank";
import {
  toPipelinePlot,
  areaRai,
  totalRai,
  plotValue,
  raiText,
  millionsText,
  LAND_STAGES,
  plotsInStage,
  pipelineCount,
  pendingCount,
  totalBudget,
  tenureToneHex,
  tenureLabelKey,
  locationText,
  type PipelinePlot,
} from "./land-pipeline-rows";
import landPipelineStrings from "./land-pipeline-strings.json" with { type: "json" };

/** The literal em-dash the screen renders for an absent title / location (honest-empty). */
const DASH = "—";

/** LandKpi, ported 1:1 from land.jsx LandKpi (L41-57). color-mix + white verbatim. */
function LandKpi({
  label,
  value,
  unit,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
  accent: string;
  icon: IconName;
}) {
  return (
    <Card pad={16}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: `color-mix(in srgb, ${accent} 14%, white)`,
            color: accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={16} />
        </div>
        <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span className="num" style={{ fontSize: 23, fontWeight: 800, letterSpacing: "-0.02em" }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/** Tag chip, inlined 1:1 from pototype/ds.jsx Tag (L273-281) — NOT a shared primitive. */
function Tag({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 9px",
        borderRadius: 6,
        background: `color-mix(in srgb, ${tone} 13%, white)`,
        color: tone,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Kanban loading skeleton — 7 token column blocks, no invented copy (mirror land-bank). */
function PipelineSkeleton() {
  return (
    <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
      {LAND_STAGES.map((stage) => (
        <div key={stage.id} style={{ minWidth: 230, width: 230, flexShrink: 0 }}>
          <div
            style={{
              height: 34,
              marginBottom: 8,
              borderRadius: 8,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[0, 1].map((c) => (
              <div
                key={c}
                style={{
                  height: 92,
                  borderRadius: 10,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function LandPipeline() {
  const { t, tp } = useI18n();

  const plotsQ = useLandPlots();
  const rows = useMemo<PipelinePlot[]>(
    () => (plotsQ.data ?? []).map(toPipelinePlot),
    [plotsQ.data],
  );

  const unitPlot = t("land.unit.plot");
  const unitRai = t("land.unit.rai");
  const unitMillion = tp(landPipelineStrings.unitMillionBaht as PhraseKey);

  return (
    <Page
      breadcrumbs={[t("land.bc.root"), t("land.pipeline.bc")]}
      title={t("land.pipeline.title")}
      subtitle={t("land.pipeline.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Honest-DISABLED: no export endpoint / the export modal is a dropped mock. */}
          <Btn kind="outline" size="md" icon="download" disabled>
            {t("land.action.export")}
          </Btn>
          {/* Honest-DISABLED for this READ port: the add-plot form is out of read scope. */}
          <Btn kind="primary" size="md" icon="plus" disabled>
            {t("land.pipeline.addBtn")}
          </Btn>
        </div>
      }
    >
      {/* KPI strip (4) — all REAL, client-derived from the loaded plots. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 18 }}>
        <LandKpi
          label={t("land.pipeline.kpiInPipeline")}
          value={String(pipelineCount(rows))}
          unit={unitPlot}
          sub={t("land.pipeline.kpiInPipelineSub").replace("{n}", String(rows.length))}
          accent="var(--brand)"
          icon="landplot"
        />
        <LandKpi
          label={t("land.pipeline.kpiAreaTotal")}
          value={raiText(totalRai(rows))}
          unit={unitRai}
          // KPI-2 sub is a composed count + the plot unit ("{count} {unit}"), not new copy (land.jsx L95).
          sub={`${rows.length} ${unitPlot}`}
          accent="#0F766E"
          icon="grid"
        />
        <LandKpi
          label={t("land.pipeline.kpiBudgetTotal")}
          value={millionsText(totalBudget(rows))}
          unit={unitMillion}
          sub={t("land.pipeline.kpiBudgetTotalSub")}
          accent="#B45309"
          icon="cash"
        />
        <LandKpi
          label={t("land.pipeline.kpiPendingDeals")}
          value={String(pendingCount(rows))}
          unit={t("land.pipeline.kpiPendingUnit")}
          sub={t("land.pipeline.kpiPendingSub")}
          accent="#7C3AED"
          icon="handshake"
        />
      </div>

      {/* Kanban — 7 fixed columns (LAND_STAGES), horizontal scroller. */}
      {plotsQ.isLoading ? (
        <PipelineSkeleton />
      ) : (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
          {LAND_STAGES.map((stage) => {
            const col = plotsInStage(rows, stage.id);
            return (
              <div key={stage.id} style={{ minWidth: 230, width: 230, flexShrink: 0 }}>
                {/* Column header — surface-2 pill, stage-coloured top border + count pill. */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "var(--surface-2)",
                    marginBottom: 8,
                    borderTop: `2px solid ${stage.color}`,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>
                    {t(stage.labelKey)}
                  </span>
                  <span
                    className="num"
                    style={{
                      marginLeft: "auto",
                      fontSize: 11,
                      fontWeight: 700,
                      color: stage.color,
                      background: `color-mix(in srgb, ${stage.color} 14%, white)`,
                      padding: "1px 7px",
                      borderRadius: 999,
                    }}
                  >
                    {col.length}
                  </span>
                </div>

                {/* Column body — cards, or the honest empty-state cell. */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {col.length === 0 && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-3)",
                        textAlign: "center",
                        padding: "16px 0",
                        border: "1px dashed var(--border)",
                        borderRadius: 8,
                      }}
                    >
                      {t("land.pipeline.emptyCol")}
                    </div>
                  )}
                  {col.map((p) => {
                    const labelKey = tenureLabelKey(p.tenure);
                    const loc = locationText(p);
                    return (
                      // Static card (§0 rule 3): the mock detail/advance actions are dropped.
                      <div
                        key={p.id}
                        style={{
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 11,
                          // Verbatim prototype shadow (land.jsx L112; no matching token, B-037(a)).
                          boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 5,
                          }}
                        >
                          <span className="num" style={{ fontSize: 11, fontWeight: 700, color: "var(--brand)" }}>
                            {p.id}
                          </span>
                          <Tag tone={tenureToneHex(p.tenure)}>{labelKey ? t(labelKey) : DASH}</Tag>
                        </div>
                        {/* title — LA-2 wire (server data, rendered raw). */}
                        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 5, lineHeight: 1.3 }}>
                          {p.title || DASH}
                        </div>
                        {/* location — amphoe · prov (LA-2 wire); pin glyph omitted (see header note). */}
                        <div
                          style={{
                            fontSize: 10.5,
                            color: "var(--text-3)",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span style={{ width: 11, height: 11, flexShrink: 0 }} aria-hidden="true" />
                          {loc || DASH}
                        </div>
                        {/* footer — area (rai) left, compact millions price right. */}
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginTop: 7,
                            paddingTop: 7,
                            borderTop: "1px solid var(--border)",
                          }}
                        >
                          <span className="num" style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 600 }}>
                            {areaRai(p.areaSqm).toFixed(1)} {unitRai}
                          </span>
                          {/* Compact price: (area x price/rai) in millions. Trailing "M" is an ASCII
                              magnitude glyph literal (land.jsx L121) — no i18n key, B-073-safe chrome. */}
                          <span className="num" style={{ fontSize: 11.5, fontWeight: 700 }}>
                            {millionsText(plotValue(p))}M
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}
