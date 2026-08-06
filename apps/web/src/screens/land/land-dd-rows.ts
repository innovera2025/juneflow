/*
 * Land Due-Diligence deal helpers for LandDueDiligence (P3-WEB, read + derive) — pure,
 * i18n-free, ASCII-only logic narrowed from pototype/land2.jsx LandDueDiligence (L140-275).
 *
 * §0 rule 3 (no mock mechanic): the prototype hardcoded the deal onto plot "L-071"
 * (LAND_PLOTS.find(p => p.id === 'L-071')) and computed every buy term from that fixed
 * mock row. Here the deal operates on a REAL plot from GET /land/plots (the same wire the
 * Land Bank register reads, use-land-bank.ts). {@link pickDealPlot} selects the plot in
 * due diligence for the active project.
 *
 * MONEY = SERVER (B-316/A2). The buy tab's total and 10% deposit are READ off the plot
 * wire (total_value / deal_deposit), computed by land-sales.ts plotTotalValue /
 * plotDealDeposit — the same helper the deal WRITE posts with. So the deposit shown on
 * this screen is, by construction, the deposit the Dr 1150 / Cr 2010 JV books. This
 * module previously kept a second copy of the formula (Math.round(total * 0.1)) whose
 * rounding disagreed with the server's; that copy is gone and must not come back.
 *
 * DERIVED TERMS ARE REAL, the rest is honestly absent. The prototype's buy tab mixed four
 * price-derived DealFields (total / deposit / transfer-fee / SBT) with two hardcoded mock
 * strings (contract type + a fixed "25 Jul 2569" transfer appointment) and a whole lease
 * tab of hardcoded figures (32,000 / 85,000 baht-per-rai, "~104.0M baht", ...). Only the
 * four price-derived terms have a real source; this module surfaces ONLY those. The mock
 * contract-type / appointment / lease figures have no wire and are surfaced as an em-dash
 * in the screen — never fabricated here.
 *
 * NO WRITE: there is no deal / PV / contract endpoint merged (the P3 write batch is mid-
 * rework), so this module holds no create logic — the screen honest-disables every deal
 * action (make-PV, confirm-transfer, save-lease, view-draft). The Cost-Center options
 * below back the (inert) selector the prototype bound to the disabled make-PV flow; they
 * are a genuine read of GET /cost-centers, scoped to the active project like the prototype's
 * costCentersFor(project).
 */
import { type PlotRow } from "./land-bank-rows";

/**
 * The four deal terms (FULL currency units), narrowed from land2.jsx LandDueDiligence
 * buy tab (L240-244). Every field is nullable: null means "the server gave us no figure"
 * and the screen renders an em-dash. Never 0, never NaN.
 *
 *   total       <- plotWire.total_value    SERVER
 *   deposit     <- plotWire.deal_deposit   SERVER (the figure the JV books)
 *   transferFee = round(total x 0.02)      client, 2% transfer fee   [B-316/A2 note below]
 *   sbt         = round(total x 0.033)     client, 3.3% specific business tax
 */
export interface DealTerms {
  total: number | null;
  deposit: number | null;
  transferFee: number | null;
  sbt: number | null;
}

/**
 * Thai land-transfer fee rate, ported verbatim from the prototype (land2.jsx L243).
 *
 * B-316/A2 — UNSOURCED, and knowingly left here. This rate and SBT_RATE have NO server
 * counterpart, no packages/tax-engine entry and no spec anywhere in this repo: they exist
 * only in the prototype and in this file. They stay client-side DELIBERATELY, because
 * moving an invented statutory rate into a route file would launder it, not source it.
 * Establishing their provenance (and then homing them in packages/tax-engine beside
 * VAT/WHT) is its own blocker. Unlike the deposit, neither figure reaches a ledger --
 * both are display-only, and no write on this screen sends either one.
 */
const TRANSFER_FEE_RATE = 0.02;

/** Thai specific-business-tax rate, ported verbatim (land2.jsx L244). See TRANSFER_FEE_RATE. */
const SBT_RATE = 0.033;

/**
 * Read the buy-deal terms off a real plot.
 *
 * money=SERVER (B-316/A2): `total` and `deposit` are READ from the wire, never computed.
 * The deposit is the exact figure POST /land/plots/:id/deal posts to the Dr 1150 /
 * Cr 2010 JV -- both come from land-sales.ts plotDealDeposit -- so the number the user
 * reads here is the number the ledger books. The browser used to keep its own copy,
 * `Math.round(total * 0.1)`, which disagreed with the server's 2-dp rounding by up to
 * 0.50 baht (and by a whole baht in the rendered string ~0.3% of the time).
 *
 * There is deliberately NO fallback formula: when the server sends no figure the term is
 * null and the screen shows an em-dash. `serverValue ?? computeLocally()` would be the
 * same defect wearing a nicer name.
 *
 * Returns null when no plot is available (the screen renders the honest-empty deal).
 */
export function dealTerms(plot: PlotRow | undefined | null): DealTerms | null {
  if (!plot) return null;
  const total = plot.totalValue;
  return {
    total,
    deposit: plot.dealDeposit,
    transferFee: total == null ? null : Math.round(total * TRANSFER_FEE_RATE),
    sbt: total == null ? null : Math.round(total * SBT_RATE),
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
