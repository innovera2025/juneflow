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
 * budget over non-closed plots), and the card tenure badge tone/label mapping. All are
 * server-derived (client DISPLAY math over server money, like land-bank's totalValue KPI);
 * nothing is fabricated and no write lives here (read/display port).
 */
import { toPlotRow, plotValue, type PlotRow } from "./land-bank-rows";
import type { DictKey } from "@juneflow/i18n";

// Re-export the shared display helpers the pipeline view also consumes (from the same
// prototype file, land.jsx) so the screen imports one row-logic surface.
export {
  toPlotRow,
  areaRai,
  totalRai,
  plotValue,
  raiText,
  millionsText,
  formatMoney,
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
 */
export function totalBudget(rows: readonly PlotRow[]): number {
  return rows.filter((p) => p.stage !== CLOSE_STAGE).reduce((s, p) => s + plotValue(p), 0);
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
