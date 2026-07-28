/*
 * solar.roi list-row helpers (read-only) — pure, i18n-free, ASCII-only logic narrowed from
 * pototype/solar.jsx SolarROI (L164-219). The prototype held the cashflow year rows in a
 * local array (L169-176); §0 rule 3 drops that mock — the real server rows are
 *   /solar/roi : { id, project_id, year, revenue, opex, cumulative, currency_code, created_at }
 * (apps/api/src/routes/solar.ts). All four ROI KPIs (CAPEX / net-cashflow / payback / IRR)
 * are fixed illustrative EPC-model figures the seed roi rows cannot model, so they are
 * rendered verbatim in the screen; only the per-year table rows come from the wire.
 *
 * The center-anchored cumulative bar geometry mirrors solar.jsx L207-212 VERBATIM,
 * including the prototype's fixed /800 scale divisor — the brief resolves that the seed's
 * raw magnitudes are illustrative and must NOT be rescaled, so a larger cumulative simply
 * saturates the bar (the container clips via overflow:hidden), exactly as the math dictates.
 */
import { str, num, formatMoney } from "./solar-shared";

/** A ROI cashflow row as the table consumes it (GET /solar/roi row). */
export interface RoiRow {
  id: string;
  /** Reporting year (server stored; 0 when absent). */
  year: number;
  /** Revenue in FULL currency units (money -> currencyCode; 0 when absent). */
  revenue: number;
  /** Operating expense in FULL currency units (rendered with a leading minus). */
  opex: number;
  /** Cumulative net cashflow in FULL currency units (may be negative). */
  cumulative: number;
  currencyCode: string;
}

/** Narrow an opaque /solar/roi row to RoiRow (snake_case wire / camelCase fallback). */
export function toRoiRow(e: Record<string, unknown>): RoiRow {
  return {
    id: str(e.id),
    year: num(e.year),
    revenue: num(e.revenue),
    opex: num(e.opex),
    cumulative: num(e.cumulative),
    currencyCode: str(e.currency_code ?? e.currencyCode),
  };
}

/**
 * Cumulative-cell text (solar.jsx L206): a "+" is prefixed for a non-negative value; a
 * negative value keeps formatMoney's own leading "-". ASCII-only (never a glyph). The
 * leading opex minus glyph is applied in the screen, next to the em-dash.
 */
export function cumulativeText(cum: number): string {
  return (cum >= 0 ? "+" : "") + formatMoney(cum);
}

/** Cumulative colour kind (solar.jsx L206): non-negative -> ok, negative -> danger. */
export function cumColorKind(cum: number): "ok" | "danger" {
  return cum >= 0 ? "ok" : "danger";
}

/**
 * Bar left offset (solar.jsx L210): a non-negative bar starts at the 50% center line; a
 * negative bar starts left of center by its scaled magnitude. The /800 scale divisor is
 * prototype-verbatim (do not rescale — seed magnitudes are illustrative).
 */
export function barLeftPct(cum: number): string {
  return cum >= 0 ? "50%" : `${50 + (cum / 800) * 50}%`;
}

/** Bar width (solar.jsx L210): scaled magnitude, /800 verbatim (clips at 100% via overflow). */
export function barWidthPct(cum: number): string {
  return `${(Math.abs(cum) / 800) * 50}%`;
}
