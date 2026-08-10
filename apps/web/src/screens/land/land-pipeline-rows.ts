/*
 * Land Pipeline row/aggregate helpers for LandPipeline (P3-WEB, read-only) — pure,
 * i18n-free, ASCII-only logic narrowed from pototype/land.jsx LandPipeline (L62-132) +
 * the shared plot helpers it reads (LAND_STAGES L6-14, TENURE_LABEL L28, plotArea/plotPrice
 * L29-30).
 *
 * The prototype held plots in a local LAND_PLOTS array (land.jsx L17-26); §0 rule 3 drops
 * that mock — the kanban is the real server catalogue (GET /land/plots, use-land-bank.ts)
 * whose plot wire (apps/api/src/routes/land-sales.ts plotWire) now carries the LA-2
 * display columns:
 *   { id, project_id, deed_no, area_sqm, gps, price_per_rai, currency_code, stage,
 *     tenure, title, amphoe, prov, created_at }
 * title/amphoe/prov ARE wire-backed for the pipeline (LA-2 merged) — unlike land-bank's
 * still-stale em-dash note for the same columns, the pipeline card renders them from the
 * wire (title = card title line; amphoe · prov = card location line).
 *
 * The base narrowing + the money/area/format helpers (toPlotRow / plotValue / areaRai /
 * totalRai / raiText / millionsText) are REUSED verbatim from land-bank-rows.ts (same
 * prototype file, identical math) and re-exported here so the screen pulls one row module.
 * This module adds only the pipeline-specific pieces: the 7-stage domain constant, the
 * per-stage grouping, the 3 kanban aggregates (in-pipeline count, pending count, total
 * budget over non-closed plots), the card tenure badge tone/label mapping, and the card's
 * compact price cell (cardValueText). All are server-derived (client DISPLAY math over
 * server money, like land-bank's totalValue KPI); nothing is fabricated and no write lives
 * here (read/display port).
 *
 * NO local money survives here: cardValueText (the card cell) and totalBudget (KPI3) both
 * read plotWire.total_value. KPI3 summed the LOCAL plotValue until 2026-08-10, deferred on
 * the stated ground that moving it "would change a rendered figure for any plot whose
 * total_value is null". That ground was FALSE, which is worth recording rather than quietly
 * deleting: total_value is null EXACTLY when area_sqm or price_per_rai is NULL (the server's
 * `priced` test is presence-only, land-sales.ts:296), and both of those reach the client
 * through num() as 0 — so the local product was already exactly 0 in every null case. There
 * was no figure to change and no G5 consequence to defer. The KPI now adds server terms;
 * the ADDING is still client-side (there is no server aggregate for it), which is why the
 * screen header calls the KPI strip client-AGGREGATED rather than client-derived.
 */
import { toPlotRow, areaRai, areaText, millionsText, type PlotRow } from "./land-bank-rows";
import type { DictKey } from "@juneflow/i18n";

// Re-export the shared display helpers the pipeline view also consumes (from the same
// prototype file, land.jsx) so the screen imports one row-logic surface.
export {
  toPlotRow,
  areaRai,
  areaText,
  totalRai,
  plotValue,
  raiText,
  millionsText,
  formatMoney,
  projectNameById,
  type PlotRow,
} from "./land-bank-rows";

/* --------------------------------------------------------------------------- */
/* Pipeline row shape — base PlotRow + the LA-2 display columns the card needs   */
/* --------------------------------------------------------------------------- */

/**
 * A land plot as the KANBAN card consumes it: the shared PlotRow fields plus the LA-2
 * display columns (title / amphoe / prov) that the pipeline card renders from the wire.
 */
export interface PipelinePlot extends PlotRow {
  /** Plot title / name (card title line; "" when absent). Server data (Thai), rendered raw. */
  title: string;
  /** Amphoe (district) — card location line, left of the middot ("" when absent). */
  amphoe: string;
  /** Province — card location line, right of the middot ("" when absent). */
  prov: string;
  /** Tambon (sub-district) — detail-modal subtitle only ("" when absent). LA-2 wire. */
  tambon: string;
  /** Former owner — detail-modal row (land.detail.rowFormerOwner); "" when absent. LA-2 wire. */
  owner: string;
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * Narrow an opaque /land/plots Entity row to the PipelinePlot the card needs — the shared
 * base narrowing (toPlotRow) plus title/amphoe/prov from the LA-2 wire (snake_case server
 * convention, camelCase fallback for robustness). Missing fields default to "".
 */
export function toPipelinePlot(e: Record<string, unknown>): PipelinePlot {
  const base = toPlotRow(e);
  return {
    ...base,
    title: str(e.title),
    amphoe: str(e.amphoe),
    prov: str(e.prov),
    tambon: str(e.tambon),
    owner: str(e.owner),
  };
}

/* --------------------------------------------------------------------------- */
/* LAND_STAGES — the fixed 7-stage pipeline definition (land.jsx L6-14)          */
/* Domain constant (not server data): the kanban column axis + per-stage colour. */
/* --------------------------------------------------------------------------- */

/** One kanban column definition. */
export interface LandStage {
  /** Stage code (matches plotWire.stage — the group-by-stage axis). */
  id: string;
  /** land.stage.* dict key for the column header (no Thai literal lives here). */
  labelKey: DictKey;
  /** Prototype-verbatim per-stage colour (land.jsx L6-14; no matching token, B-037(a)). */
  color: string;
}

/** The 7 pipeline stages, ported 1:1 from land.jsx LAND_STAGES (L6-14). */
export const LAND_STAGES: readonly LandStage[] = [
  { id: "source", labelKey: "land.stage.source", color: "#64748B" },
  { id: "survey", labelKey: "land.stage.survey", color: "#0F766E" },
  { id: "feas", labelKey: "land.stage.feas", color: "#1D4ED8" },
  { id: "dd", labelKey: "land.stage.dd", color: "#B45309" },
  { id: "nego", labelKey: "land.stage.nego", color: "#7C3AED" },
  { id: "deal", labelKey: "land.stage.deal", color: "#0B2A4A" },
  { id: "close", labelKey: "land.stage.close", color: "#16803D" },
];

/** The terminal stage (closed/transferred) — excluded from the in-pipeline + budget KPIs. */
export const CLOSE_STAGE = "close";

/** Stages counted by the "deals pending decision" KPI (land.jsx L66). */
export const PENDING_STAGES: readonly string[] = ["nego", "deal", "dd"];

/* --------------------------------------------------------------------------- */
/* Kanban grouping + KPI aggregates (land.jsx L64-66 / L102)                     */
/* --------------------------------------------------------------------------- */

/** The plots that sit in a given kanban column (land.jsx L102). */
export function plotsInStage<T extends PlotRow>(rows: readonly T[], stageId: string): T[] {
  return rows.filter((p) => p.stage === stageId);
}

/** KPI1 — plots still in the pipeline (every stage except close, land.jsx L94). */
export function pipelineCount(rows: readonly PlotRow[]): number {
  return rows.filter((p) => p.stage !== CLOSE_STAGE).length;
}

/** KPI4 — deals awaiting a decision (stage in {nego, deal, dd}, land.jsx L66). */
export function pendingCount(rows: readonly PlotRow[]): number {
  return rows.filter((p) => PENDING_STAGES.includes(p.stage)).length;
}

/**
 * KPI3 — total acquisition budget in FULL units: the summed assessed value of every plot
 * NOT yet closed/transferred (land.jsx totalBudget, L65). The millions display + unit are
 * applied in the view (millionsText + the tp million-baht phrase).
 *
 * money = SERVER, same rule and same source as cardValueText: every term is the server's
 * total_value. A null term adds 0 — which is not a guess dressed as a number, because a null
 * total_value means a NULL area_sqm or price_per_rai, and the local formula this replaced
 * scored those exactly 0 too (num() reads a missing number as 0). Whether an aggregate over
 * a partly-unpriced set should render at all is a product question the prototype answers by
 * summing (land.jsx L65); it is not re-decided here.
 *
 * Display-neutral: the only difference a term can carry is the server's per-plot round2
 * (land-sales.ts:117), under half a satang, which cannot survive /1e6 + toFixed(1). On the
 * seed it is not even that — the one plot whose product needs the rounding (51680 sqm x
 * 6,500,000) is the `close` plot this KPI excludes, so both sums are bit-identical at
 * 725,032,500 -> "725.0".
 */
export function totalBudget(rows: readonly PlotRow[]): number {
  return rows.filter((p) => p.stage !== CLOSE_STAGE).reduce((s, p) => s + (p.totalValue ?? 0), 0);
}

/* --------------------------------------------------------------------------- */
/* Card footer cells — area (land.jsx L120) + compact price (L121)               */
/* --------------------------------------------------------------------------- */

/**
 * The kanban card's area cell as a rai TEXT ("18.6"), or null when the plot carries no
 * area — the view then renders an em-dash and drops the rai unit WITH the number, the same
 * way the price cell drops its "M".
 *
 * The guard is `areaDetailText`'s, deliberately: that helper is the SAME plot's area row in
 * the detail modal, and until 2026-08-10 the two disagreed — the modal em-dashed an arealess
 * plot while the card beside it printed a confident "0.0 rai" off `areaRai(0).toFixed(1)`.
 * That is the card-vs-modal contradiction the price cell had (B-316/A2), reachable the same
 * way: createLandPlot stores `areaSqm: area == null ? null : String(area)`
 * (land-sales.ts:465), and the client's num() reads a missing area as 0.
 *
 * Area is NOT money, so this is not a money=SERVER change — area_sqm is the wire field and
 * rai is a fixed unit conversion (1 rai = 1600 sqm), computed here as it always was. What
 * changed is only that an ABSENT area stops rendering as a measurement.
 */
export function cardAreaText(p: { areaSqm: number }): string | null {
  if (!Number.isFinite(p.areaSqm) || p.areaSqm <= 0) return null;
  return areaRai(p.areaSqm).toFixed(1);
}

/**
 * The kanban card's compact price cell as a millions TEXT ("83.4"), or null when the plot
 * carries no priced valuation (the view renders an em-dash, and drops the "M" glyph with
 * the number rather than leaving a bare magnitude suffix).
 *
 * money = SERVER: the source is plotWire.total_value. Until 2026-08-10 this cell rendered
 * `millionsText(plotValue(p))` — a LOCAL areaRai x pricePerRai re-derivation, which is the
 * exact thing the detail modal's total-value row forbids in writing (B-316/A2). The two
 * disagreed on one screen: an unpriced plot's card read "0.0M" while its own modal said
 * em-dash for both total value and price/rai.
 *
 * `> 0` and not `!= null`, for the same reason the modal row uses `> 0`: the server's
 * `priced` test is PRESENCE-only (land-sales.ts:296), so a stored price_per_rai = 0 yields
 * total_value: 0, not null (:306). A genuine zero-value plot is not something this screen
 * can distinguish from an unpriced one, and never-0 wins over never-hide.
 *
 * Display-neutral wherever a price exists: the server rounds to 2 dp (plotTotalValue,
 * land-sales.ts:117) and the local formula did not, a difference of under half a satang
 * that cannot survive `/1e6` + `toFixed(1)`.
 */
export function cardValueText(p: PlotRow): string | null {
  return p.totalValue != null && p.totalValue > 0 ? millionsText(p.totalValue) : null;
}

/* --------------------------------------------------------------------------- */
/* Card tenure badge (land.jsx L115 / TENURE_LABEL L28)                          */
/* --------------------------------------------------------------------------- */

/**
 * Card tenure-badge tone (land.jsx L115): lease -> amber, negotiate -> violet, everything
 * else -> teal. Prototype-verbatim hexes (no matching token, B-037(a), like the KPI accents).
 */
export function tenureToneHex(tenure: string): string {
  if (tenure === "lease") return "#B45309";
  if (tenure === "negotiate") return "#7C3AED";
  return "#0F766E";
}

/**
 * Which land.tenure.* label the card badge renders for a tenure code (land.jsx TENURE_LABEL,
 * L28). Returns the dict key kind so no Thai lives here; an unknown code returns null (the
 * prototype's TENURE_LABEL[code] would be undefined -> blank, which the view renders as an
 * em-dash rather than fabricating a label).
 */
/**
 * DETAIL-modal tenure-badge tone (land.jsx openPlotDetail L296). Deliberately NOT the same
 * mapping as the card's (tenureToneHex): the detail badge is a two-branch
 * `lease ? amber : teal` — `negotiate` renders TEAL there and VIOLET on the card. Kept
 * separate rather than "unified" because unifying them would silently redesign one of the
 * two (§0 rule 1).
 */
export function detailTenureToneHex(tenure: string): string {
  return tenure === "lease" ? "#B45309" : "#0F766E";
}

export function tenureLabelKey(tenure: string): DictKey | null {
  switch (tenure) {
    case "buy":
      return "land.tenure.buy";
    case "lease":
      return "land.tenure.lease";
    case "negotiate":
      return "land.tenure.negotiate";
    case "own":
      return "land.tenure.own";
    case "study":
      return "land.tenure.study";
    default:
      return null;
  }
}

/* --------------------------------------------------------------------------- */
/* Card location line (land.jsx L118) — LA-2 wire fields amphoe + prov           */
/* --------------------------------------------------------------------------- */

/** Middot separator — the shared non-Thai glyph (pm checklist-picker MIDDOT precedent). */
const MIDDOT = "·";

/**
 * Card location line "amphoe · prov" (land.jsx L118), composed from the LA-2 wire fields.
 * Empty fields drop out so a missing amphoe/prov never leaves a bare middot; "" when both
 * are absent (the view falls back to an em-dash — honest-empty, never fabricated).
 */
export function locationText(p: { amphoe: string; prov: string }): string {
  return [p.amphoe, p.prov].filter(Boolean).join(` ${MIDDOT} `);
}

/* --------------------------------------------------------------------------- */
/* Plot-detail modal + advance-stage (land.jsx openPlotDetail L279-317 /        */
/* LandPipeline advance L69-75) — the card-click drawer this port now wires.    */
/* --------------------------------------------------------------------------- */

/**
 * The stage definition for a stored stage code, or undefined for a code that is not one
 * of the 7 (the stage pill then falls back to the first stage's colour and renders the
 * raw code, never a fabricated label). Mirrors land.jsx openPlotDetail L280.
 */
export function stageById(stageId: string): LandStage | undefined {
  return LAND_STAGES.find((s) => s.id === stageId);
}

/**
 * Which land.stage.* dict key labels a stage code, or null when the code is unknown.
 * Used by the stage pill AND by the advance toast, which labels the stage the SERVER
 * returned (never a client-predicted next stage) — an unknown code renders raw.
 */
export function stageLabelKey(stageId: string): DictKey | null {
  return stageById(stageId)?.labelKey ?? null;
}

/**
 * Whether the plot-detail modal renders the advance action (land.jsx L311:
 * `opts.onAdvance && plot.stage !== "close"`). The terminal stage has nowhere to go —
 * the backend answers 409 there (land-sales.ts advanceLandPlotStage) — so the control is
 * not rendered rather than rendered-and-rejected.
 */
export function canAdvance(stage: string): boolean {
  return stage !== CLOSE_STAGE;
}

/**
 * Detail-modal title (land.jsx L282: `${plot.id} · ${plot.title}`). A plot with no title
 * renders the id alone — never a bare separator and never a fabricated name.
 */
export function detailTitle(p: { id: string; title: string }): string {
  return [p.id, p.title].filter(Boolean).join(` ${MIDDOT} `);
}

/**
 * Detail-modal subtitle (land.jsx L283: `${tambon} · ${amphoe} · ${prov}`), composed from
 * the LA-2 wire fields. Absent parts drop out so a missing tambon never leaves a dangling
 * middot; "" when all three are absent (the view falls back to an em-dash).
 */
export function detailSubtitle(p: { tambon: string; amphoe: string; prov: string }): string {
  return [p.tambon, p.amphoe, p.prov].filter(Boolean).join(` ${MIDDOT} `);
}

/**
 * The area row's value (land.jsx L300: `${areaText(plot)} (${plotArea(plot).toFixed(1)} <rai>)`),
 * composed from area_sqm alone — areaText is the EXACT rai-ngan-wa reconstruction, so no
 * wire field is missing here. "" when the plot carries no area (the view renders an em-dash
 * rather than a confident "0-0-0 (0.0)").
 */
export function areaDetailText(areaSqm: number, raiUnit: string): string {
  if (!Number.isFinite(areaSqm) || areaSqm <= 0) return "";
  return `${areaText(areaSqm)} (${areaRai(areaSqm).toFixed(1)} ${raiUnit})`;
}

/**
 * Classify an advance-stage rejection so the toast reports what the SERVER said.
 *
 * The handler emits exactly ONE 409 on this route — `conflict(reply, "land plot is already
 * at the final stage (closed)")`, flat body `{ code: "INVALID_STATE", message }` — so an
 * INVALID_STATE rejection means "already terminal" and nothing else. That is the prototype's
 * land.pipeline.toastClosed branch (land.jsx L70 ctx.notify), reached here from the
 * server's answer instead of the prototype's client-side `idx >= LAND_STAGES.length - 1`
 * guess: the card in front of the user can be stale, the database cannot.
 *
 * Everything else ("error") is surfaced with the server's own message — never swallowed,
 * and never dressed up as the terminal case.
 */
export function advanceErrorKind(err: unknown): "terminal" | "error" {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: unknown }).code
      : undefined;
  return code === "INVALID_STATE" ? "terminal" : "error";
}

/** Server error message off an unknown rejection ("" when none) — land-bank plotErr precedent. */
export function advanceErrorMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}
