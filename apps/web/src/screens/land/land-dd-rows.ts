/*
 * Land Due-Diligence deal helpers for LandDueDiligence (P3-WEB, read + derive) — pure,
 * i18n-free, ASCII-only logic narrowed from pototype/land2.jsx LandDueDiligence (L140-275).
 *
 * §0 rule 3 (no mock mechanic): the prototype hardcoded the deal onto plot "L-071"
 * (LAND_PLOTS.find(p => p.id === 'L-071')) and computed every buy term from that fixed
 * mock row. Here the deal operates on a REAL plot from GET /land/plots (the same wire the
 * Land Bank register reads, use-land-bank.ts). {@link pickDealPlot} selects the plot in
 * due diligence for the active project; the buy terms are derived CLIENT-SIDE from that
 * plot's assessed price (the prototype's plotPrice x fixed rates, ported verbatim).
 *
 * DERIVED TERMS ARE REAL, the rest is honestly absent. The prototype's buy tab mixed four
 * price-derived DealFields (total / deposit / transfer-fee / SBT) with two hardcoded mock
 * strings (contract type + a fixed "25 Jul 2569" transfer appointment) and a whole lease
 * tab of hardcoded figures (32,000 / 85,000 baht-per-rai, "~104.0M baht", ...). Only the
 * four price-derived terms have a real source (the plot's price_per_rai x area); this
 * module derives ONLY those. The mock contract-type / appointment / lease figures have no
 * wire and are surfaced as an em-dash in the screen — never fabricated here.
 *
 * NO WRITE: there is no deal / PV / contract endpoint merged (the P3 write batch is mid-
 * rework), so this module holds no create logic — the screen honest-disables every deal
 * action (make-PV, confirm-transfer, save-lease, view-draft). The Cost-Center options
 * below back the (inert) selector the prototype bound to the disabled make-PV flow; they
 * are a genuine read of GET /cost-centers, scoped to the active project like the prototype's
 * costCentersFor(project).
 */
import { plotValue, type PlotRow } from "./land-bank-rows";

/** Round to 2 decimals — the deal total's precision before the derived fee rounding. */
export function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/**
 * The four price-derived deal terms (FULL currency units), narrowed from land2.jsx
 * LandDueDiligence buy tab (L240-244). All four flow from the plot's assessed value:
 *   total       = round2(area_sqm / 1600 x price_per_rai)   (= land-bank plotValue, round2)
 *   deposit     = round(total x 0.10)                       (10% deposit)
 *   transferFee = round(total x 0.02)                       (2% transfer fee)
 *   sbt         = round(total x 0.033)                      (3.3% specific business tax)
 */
export interface DealTerms {
  total: number;
  deposit: number;
  transferFee: number;
  sbt: number;
}

/**
 * Derive the buy-deal terms from a real plot (land2.jsx L240-244, rates ported verbatim).
 * `total` mirrors land-bank's plotValue (area-in-rai x price/rai) rounded to 2 dp; the
 * deposit / transfer-fee / SBT are whole-baht rounds of the fixed statutory rates. Returns
 * null when no plot is available so the screen renders the honest-empty deal (em-dash).
 */
export function dealTerms(plot: PlotRow | undefined | null): DealTerms | null {
  if (!plot) return null;
  const total = round2(plotValue(plot));
  return {
    total,
    deposit: Math.round(total * 0.1),
    transferFee: Math.round(total * 0.02),
    sbt: Math.round(total * 0.033),
  };
}

/**
 * Pick the plot the deal terms describe (§0 rule 3: replaces the prototype's fixed
 * 'L-071'). Preference: within the active project's plots, the one in due diligence
 * (stage "dd"), else that project's first plot; if the project has no plots, fall back to
 * the register's dd-stage plot, else its first row. undefined when the register is empty
 * (the screen then renders the honest-empty deal). Deterministic (first match wins).
 */
export function pickDealPlot(
  plots: readonly PlotRow[],
  activeProjectId: string,
): PlotRow | undefined {
  if (plots.length === 0) return undefined;
  const scoped = activeProjectId ? plots.filter((p) => p.projectId === activeProjectId) : [];
  const pool = scoped.length > 0 ? scoped : plots;
  return pool.find((p) => p.stage === "dd") ?? pool[0];
}

/* --------------------------------------------------------------------------- */
/* Cost-Center options (land2.jsx costCentersFor(project) -> Dropdown, L150-152)*/
/* --------------------------------------------------------------------------- */

/** Read a string field off an opaque /cost-centers row; "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** A cost-center as the DD selector consumes it (code · name, plus its owning project). */
export interface CcOption {
  code: string;
  name: string;
  /** Owning project id — the selector is scoped to the active project (prototype parity). */
  projectId: string;
}

/** Narrow an opaque /cost-centers row to a CcOption (snake_case or camelCase project id). */
export function toCcOption(e: Record<string, unknown>): CcOption {
  return {
    code: str(e.code),
    name: str(e.name),
    projectId: str(e.project_id ?? e.projectId),
  };
}

/**
 * Cost-center options for the active project (land2.jsx costCentersFor(proj.name), L150).
 * Maps the opaque /cost-centers rows, drops code-less rows, and — when an active project
 * is known — narrows to that project's centers (else returns all). Never fabricates: an
 * empty result means the project has no cost centers and the selector renders empty.
 */
export function ccOptionsForProject(
  rows: readonly Record<string, unknown>[],
  activeProjectId: string,
): CcOption[] {
  const opts = rows.map(toCcOption).filter((o) => o.code !== "");
  return activeProjectId ? opts.filter((o) => o.projectId === activeProjectId) : opts;
}
