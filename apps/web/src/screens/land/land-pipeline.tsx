/*
 * LandPipeline — the land-acquisition pipeline (kanban, 7 stages), ported from
 * pototype/land.jsx LandPipeline (L62-132) + the shared LandKpi (L41-57) and ds.jsx Tag
 * (L273-281). Route land.pipeline (docs/extract/NAV-ROUTES.md, parent `land`, prototype
 * file land.jsx). Previously unwired: registered in routes/registry.ts (L88) but absent
 * from router.tsx — this port adds the import + PORTED_SCREENS entry.
 *
 * The read-side wire (GET /land/plots, apps/api/src/routes/land-sales.ts plotWire) returns
 *   { id, project_id, deed_no, area_sqm, gps, price_per_rai, currency_code, total_value,
 *     stage, tenure, title, tambon, amphoe, prov, owner, created_at }
 * (title/tambon/amphoe/prov/owner = the merged LA-2 display columns). This screen ships the
 * honest kanban:
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
 * WRITE PATH — card detail + advance-stage (wired here; previously deferred).
 * The earlier port dropped the card onClick as "mock mechanics", but only the DRAWER was
 * mock: the advance action behind it has been a merged endpoint since 2026-07-27. The card
 * now opens PlotDetail (land.jsx openPlotDetail L279-317) and its primary action posts
 *   POST /land/plots/{id}/advance-stage   (use-land-bank.ts useAdvancePlotStage)
 * with NO body — the SERVER owns the stage order and the terminal 409 (§0 rule 3: the
 * prototype's local `setPlots(... next.id)` is the dropped part, not the button). The toast
 * labels the stage the SERVER returned, never a client-predicted next stage; the register is
 * invalidated so the card actually moves columns. The action is not rendered at the terminal
 * stage (land.jsx L311 `plot.stage !== "close"`).
 * STILL honest-DISABLED, and each for its own reason: Export (no endpoint anywhere) and
 * add-plot (POST /land/plots exists, but LandPlotForm is a separate port).
 *
 * Detail rows with NO wire source render an em-dash, never a plausible default: the project
 * name resolves through GET /projects (never a raw uuid) and the plot id is the server uuid,
 * not the prototype's human "L-068" code.
 *
 * The `pin` glyph is UNDEFINED in ds.jsx (renders invisible) and absent from the IconName
 * union, so the location line renders WITHOUT a pin (matching the prototype's blank null
 * render), with an 11px spacer preserving the 4px-gap layout.
 *
 * i18n (§0 rule 2): every visible string is an existing land.* dict key via t() (breadcrumb
 * root land.bc.root, the land.pipeline.* labels/subs, the 7 land.stage.* column headers, the
 * land.tenure.* card badges, land.unit.plot / land.unit.rai, and for the detail modal the 8
 * row labels land.field.deed / land.detail.rowArea / land.bank.colGps /
 * land.detail.rowPricePerRai / land.detail.rowTotalValue / land.detail.rowFormerOwner /
 * land.common.project / land.bank.filterTenureHint, the 3 actions land.detail.btnSurvey /
 * land.stage.dd / land.detail.btnAdvance, and the toasts land.pipeline.toastAdvance /
 * land.pipeline.toastClosed) — NONE minted; every one was verified byte-exact against
 * docs/extract/i18n-full.json before use. The two non-dict strings, the KPI-3 unit "million
 * baht" and the baht sign on the price rows, reuse existing phrases keys via
 * land-pipeline-strings.json (tp), exactly like land-bank-strings.json. The compact card
 * price carries a trailing ASCII "M" magnitude glyph (land.jsx L121) rendered as a chrome
 * literal — it has no i18n key and is B-073-safe (ASCII 'M' is not Thai). Tokens back every
 * colour (§0 rule 6); the per-stage + KPI-accent + card-badge hexes are prototype-verbatim
 * (land.jsx L6-14 / L94-97 / L115 / L296; no matching token, B-037(a)); numeric cells carry
 * class `num` (§0 rule 7). No Thai/baht literal sits in this source (B-073).
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { PhraseKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Card } from "../../ui/card";
import { Btn } from "../../ui/button";
import { Icon, type IconName } from "../../ui/icon";
import { Page } from "../../shell/page";
import { useShellCtx } from "../../shell/shell-context";
import { useProjects } from "../../shell/use-shell-data";
import { useLandPlots, useAdvancePlotStage } from "./use-land-bank";
import {
  toPipelinePlot,
  areaRai,
  areaDetailText,
  totalRai,
  plotValue,
  raiText,
  millionsText,
  formatMoney,
  projectNameById,
  LAND_STAGES,
  plotsInStage,
  pipelineCount,
  pendingCount,
  totalBudget,
  tenureToneHex,
  detailTenureToneHex,
  tenureLabelKey,
  locationText,
  detailTitle,
  detailSubtitle,
  stageById,
  stageLabelKey,
  canAdvance,
  advanceErrorKind,
  advanceErrorMessage,
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

/* --------------------------------------------------------------------------- */
/* PlotDetail — the card-click detail modal (land.jsx openPlotDetail L279-317)   */
/* --------------------------------------------------------------------------- */

/** One label/value row of the detail grid (land.jsx openPlotDetail `row`, L286-291). */
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const cell: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "9px 0",
    borderBottom: "1px solid var(--border)",
  };
  return (
    <div style={cell}>
      <span style={{ fontSize: 12, color: "var(--text-3)" }}>{label}</span>
      <span
        className={mono ? "num" : undefined}
        style={{ fontSize: 12.5, fontWeight: 600, textAlign: "right" }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The plot-detail modal body. Every value is wire-backed or an em-dash — nothing here is
 * derived from a fallback: `totalValue` is the SERVER's total_value (money = SERVER; null
 * renders an em-dash and is NEVER recomputed locally from area x price), and the project
 * name comes from GET /projects so a raw uuid is never shown.
 *
 * The advance action posts the bodiless POST and closes the modal; the toast fires off the
 * SETTLED promise, because closing the modal unmounts this body before the POST resolves
 * (the admin-subs / B-200b precedent). A rejection surfaces the server's own message rather
 * than a swallowed catch — the whole point of the round is that a control never reports a
 * success it did not get.
 */
function PlotDetail({
  plot,
  projectName,
  onClose,
  onAdvance,
}: {
  plot: PipelinePlot;
  projectName: string;
  onClose: () => void;
  onAdvance: () => void;
}) {
  const { t, tp } = useI18n();
  const ctx = useShellCtx();

  const stage = stageById(plot.stage);
  const stageColor = stage?.color ?? LAND_STAGES[0]!.color;
  const stageLabel = stage ? t(stage.labelKey) : plot.stage || DASH;
  const tenureKey = tenureLabelKey(plot.tenure);
  const unitRai = t("land.unit.rai");
  const baht = tp(landPipelineStrings.unitBaht as PhraseKey);

  return (
    <div>
      {/* stage pill + tenure badge (land.jsx L294-297) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            padding: "4px 11px",
            borderRadius: 999,
            background: `color-mix(in srgb, ${stageColor} 14%, white)`,
            color: stageColor,
          }}
        >
          {stageLabel}
        </span>
        <Tag tone={detailTenureToneHex(plot.tenure)}>{tenureKey ? t(tenureKey) : DASH}</Tag>
      </div>

      {/* 8 rows, two columns (land.jsx L298-308) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
        <DetailRow label={t("land.field.deed")} value={plot.deedNo || DASH} mono />
        <DetailRow label={t("land.detail.rowArea")} value={areaDetailText(plot.areaSqm, unitRai) || DASH} mono />
        <DetailRow label={t("land.bank.colGps")} value={plot.gps || DASH} mono />
        <DetailRow
          label={t("land.detail.rowPricePerRai")}
          value={plot.pricePerRai > 0 ? `${formatMoney(plot.pricePerRai)} ${baht}` : DASH}
          mono
        />
        {/* money = SERVER: plotWire.total_value. null (unpriced plot) -> em-dash, never a
            locally re-derived area x price (B-316/A2). */}
        <DetailRow
          label={t("land.detail.rowTotalValue")}
          value={plot.totalValue == null ? DASH : `${formatMoney(plot.totalValue)} ${baht}`}
          mono
        />
        <DetailRow label={t("land.detail.rowFormerOwner")} value={plot.owner || DASH} />
        {/* project — resolved from project_id via GET /projects (never a raw uuid). */}
        <DetailRow label={t("land.common.project")} value={projectName || DASH} />
        <DetailRow
          label={t("land.bank.filterTenureHint")}
          value={tenureKey ? t(tenureKey) : DASH}
        />
      </div>

      {/* actions (land.jsx L309-313) */}
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Btn
          kind="outline"
          size="md"
          icon="compass"
          onClick={() => {
            onClose();
            ctx.navigate("land.survey");
          }}
        >
          {t("land.detail.btnSurvey")}
        </Btn>
        <Btn
          kind="outline"
          size="md"
          icon="shield"
          onClick={() => {
            onClose();
            ctx.navigate("land.dd");
          }}
        >
          {t("land.stage.dd")}
        </Btn>
        {/* Not rendered at the terminal stage (land.jsx L311) — the server 409s there. */}
        {canAdvance(plot.stage) && (
          <Btn
            kind="primary"
            size="md"
            icon="arrowR"
            onClick={() => {
              onAdvance();
              onClose();
            }}
          >
            {t("land.detail.btnAdvance")}
          </Btn>
        )}
      </div>
    </div>
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
  const ctx = useShellCtx();

  const plotsQ = useLandPlots();
  const projectsQ = useProjects();
  const advance = useAdvancePlotStage();
  const rows = useMemo<PipelinePlot[]>(
    () => (plotsQ.data ?? []).map(toPipelinePlot),
    [plotsQ.data],
  );
  const projectNames = useMemo(() => projectNameById(projectsQ.data), [projectsQ.data]);

  const unitPlot = t("land.unit.plot");
  const unitRai = t("land.unit.rai");
  const unitMillion = tp(landPipelineStrings.unitMillionBaht as PhraseKey);

  /**
   * Advance one plot (land.jsx LandPipeline advance, L69-75). The POST carries no body —
   * the server picks the next stage — and the toast labels the stage the SERVER returned.
   * PlotDetail closes before the POST settles (single modal slot), so the toast fires off
   * the settled promise, not a mutate-scoped onSuccess bound to a dead observer.
   */
  const advancePlot = (plot: PipelinePlot) => {
    advance.mutateAsync(plot.id).then(
      (res) => {
        const nextStage = typeof res.stage === "string" ? res.stage : "";
        const key = stageLabelKey(nextStage);
        ctx.notify(
          t("land.pipeline.toastAdvance")
            .replace("{id}", plot.id)
            .replace("{stage}", key ? t(key) : nextStage || DASH),
        );
      },
      (err: unknown) => {
        // The server's own answer decides the message: its single 409 on this route means
        // the plot is already terminal (the prototype's "closed" toast); anything else
        // surfaces the server message as a failure, never a swallowed catch.
        if (advanceErrorKind(err) === "terminal") {
          ctx.notify(t("land.pipeline.toastClosed").replace("{id}", plot.id));
          return;
        }
        ctx.notify(advanceErrorMessage(err) || DASH, "danger");
      },
    );
  };

  const openDetail = (plot: PipelinePlot) => {
    const stage = stageById(plot.stage);
    ctx.openModal({
      title: detailTitle(plot) || DASH,
      subtitle: detailSubtitle(plot) || DASH,
      icon: "landplot",
      iconTone: stage?.color ?? LAND_STAGES[0]!.color,
      size: "lg",
      body: ({ close }: { close: () => void }) => (
        <PlotDetail
          plot={plot}
          projectName={plot.projectId ? (projectNames.get(plot.projectId) ?? "") : ""}
          onClose={close}
          onAdvance={() => advancePlot(plot)}
        />
      ),
    });
  };

  return (
    <Page
      breadcrumbs={[t("land.bc.root"), t("land.pipeline.bc")]}
      title={t("land.pipeline.title")}
      subtitle={t("land.pipeline.subtitle")}
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          {/* Honest-DISABLED — but NOT because the contract has no export. It HAS one:
              openapi.yaml:4235 declares POST /exports (operationId createExport, body
              {type, params} -> 202 Job) and :4262 declares GET /exports/{id} (getExport),
              and both are generated into packages/contracts types + a whole Dart client.
              NOTHING MOUNTS THEM: apps/api/src/app.ts registers no exports route (every
              other door is registered at :227-280) and the only "/exports" anywhere in
              apps/api/src is a design comment, worker.ts:6. A contract-following caller
              therefore gets a 404 on the ordinary path — declared-but-never-mounted, the
              same shape as B-282 reset-password, which is the defect class this round
              exists to close. Filed as B-351. The control stays disabled for that reason,
              not for the one this comment used to give. (The prototype's openExportModal
              is a mock file-picker either way, §0 rule 3.) */}
          <Btn kind="outline" size="md" icon="download" disabled>
            {t("land.action.export")}
          </Btn>
          {/* Honest-DISABLED: POST /land/plots IS merged (use-land-bank.ts useCreatePlot),
              but the add affordance is the LandPlotForm modal (land.jsx L~230), a separate
              port — the endpoint is NOT the blocker here, the unported form is. */}
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
                      // Card click opens the plot-detail modal (land.jsx L113 onClick ->
                      // openPlotDetail), whose primary action posts the real advance-stage.
                      <div
                        key={p.id}
                        onClick={() => openDetail(p)}
                        style={{
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 11,
                          cursor: "pointer",
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
