/*
 * Land Bank list-row helpers for LandBank (P3-WEB, read helpers) — pure, i18n-free,
 * ASCII-only logic narrowed from pototype/land.jsx LandBank (L137-220) + the shared
 * plot helpers (plotArea/plotPrice/areaText L29-31, tenureStatus/tenureStLabel L155-156)
 * and the ds.jsx STATUS map the prototype's <StatusBadge> reads.
 *
 * The prototype held plots in a local LAND_PLOTS array (land.jsx L17-26) whose rows
 * carried denormalised display strings (title/tambon/amphoe/prov/owner/project) +
 * rai-ngan-wa + a per-rai price. §0 rule 3: that mock is dropped — the list is the real
 * server catalogue (GET /land/plots, use-land-bank.ts) whose plot wire is
 *   { id, project_id, deed_no, area_sqm, gps, price_per_rai, currency_code, stage,
 *     tenure, created_at }   (apps/api/src/routes/land-sales.ts plotWire)
 * The project NAME resolves from project_id via GET /projects (§0 rule 3, FK-as-string
 * -> real id join, mirrors boq-rows projectNameById). area_sqm is the real stored area
 * (the seed stores rai*1600 + ngan*400 + wa*4, so the Thai rai-ngan-wa breakdown is an
 * EXACT reconstruction, never a fabricated value); price_per_rai is money -> currency_code.
 *
 * VIEW GAP (reported, never fabricated): the LA-2 title / tambon / amphoe / prov / owner
 * columns now exist on plotWire, but the LandBank TABLE does not consume them yet — the
 * location cell still renders an em-dash and the free-text search narrows to the wire-backed
 * fields the view reads (id + deedNo); this module never invents the missing columns. A
 * future view-enrich round wires the location columns into the table read.
 *
 * READ helpers only: POST /land/plots is now wired (the add-plot form in land-bank.tsx /
 * land-plot-form.tsx -> use-land-bank.ts useCreatePlot). The client id is dropped (the
 * server generates it, §0 rule 3). No create logic lives in THIS pure-logic module.
 */

/** A land plot as the table consumes it (GET /land/plots row, narrowed from the wire). */
export interface PlotRow {
  id: string;
  /** Owning project id (resolved to a name via GET /projects in the view; "" when unbound). */
  projectId: string;
  /** Deed / Nor-Sor number (free text; "" when absent). */
  deedNo: string;
  /** Plot area in square metres (server stored; 0 when absent). 1 rai = 1600 sqm. */
  areaSqm: number;
  /** GPS "lat, lng" free text ("" when absent). */
  gps: string;
  /** Assessed price per rai in FULL currency units (money -> currencyCode; 0 when absent). */
  pricePerRai: number;
  currencyCode: string;
  /** Acquisition-pipeline stage (source|survey|feas|dd|nego|deal|close, not enumerated). */
  stage: string;
  /** Tenure code (buy|lease|negotiate|own, not enumerated) — drives the status badge. */
  tenure: string;
  /**
   * SERVER-computed total assessed value in FULL units (plotWire.total_value =
   * round2(area-in-rai x price/rai)). null when the plot carries no area/price -- the
   * screen renders an em-dash for a null and never substitutes a locally-derived figure
   * (B-316/A2, money=SERVER).
   */
  totalValue: number | null;
  /**
   * SERVER-computed 10% buy-deal deposit in FULL units (plotWire.deal_deposit). This is
   * the SAME value POST /land/plots/:id/deal posts to the Dr 1150 / Cr 2010 JV, so the
   * number land.dd shows is the number the ledger books. null when unpriced (em-dash).
   */
  dealDeposit: number | null;
  /**
   * SERVER-computed land-transfer fee in FULL units (plotWire.transfer_fee = 2% of the
   * plot total, the rate held in @juneflow/tax-engine/thailand THAILAND_RATES). Before
   * B-319 the browser computed this off a `TRANSFER_FEE_RATE = 0.02` literal that lived
   * in a screen file and nowhere else in the system. null when unpriced (em-dash).
   */
  transferFee: number | null;
  /**
   * SERVER-computed specific business tax in FULL units (plotWire.sbt = 3.3% of the plot
   * total, rate from THAILAND_RATES). See transferFee. null when unpriced (em-dash).
   */
  sbt: number | null;
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Read a finite MONEY field off an opaque row; null when absent/invalid.
 *
 * Deliberately NOT num(): a money field that the server did not send is unknown, not
 * zero. Coercing it to 0 would render a confident "0" where the truth is "no figure"
 * (B-316/A2). Callers surface the null as an em-dash.
 */
function moneyOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Narrow an opaque /land/plots Entity row to the PlotRow the table needs. Multi-word
 * fields accept snake_case (server convention, plotWire) or camelCase for robustness
 * (mirrors boq-rows.toBoqRow). Missing fields default (0 / "" / null for money).
 */
export function toPlotRow(e: Record<string, unknown>): PlotRow {
  return {
    id: str(e.id),
    projectId: str(e.project_id ?? e.projectId),
    deedNo: str(e.deed_no ?? e.deedNo),
    areaSqm: num(e.area_sqm ?? e.areaSqm),
    gps: str(e.gps),
    pricePerRai: num(e.price_per_rai ?? e.pricePerRai),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    stage: str(e.stage),
    tenure: str(e.tenure),
    // money=SERVER (B-316/A2, B-319) — read, never derived.
    totalValue: moneyOrNull(e.total_value ?? e.totalValue),
    dealDeposit: moneyOrNull(e.deal_deposit ?? e.dealDeposit),
    transferFee: moneyOrNull(e.transfer_fee ?? e.transferFee),
    sbt: moneyOrNull(e.sbt),
  };
}

/* --------------------------------------------------------------------------- */
/* Toolbar filter (land.jsx LandBank rows filter, L141-145)                     */
/* --------------------------------------------------------------------------- */

/** Filter inputs for the toolbar (free-text query + tenure code). */
export interface PlotFilter {
  q: string;
  tenure: string;
}

/**
 * Filter the plots like land.jsx:141-145 — a tenure equality filter and a free-text
 * query. The prototype searched id + title + deed + tambon + amphoe + prov + owner;
 * title/tambon/amphoe/prov/owner are NOT on plotWire (LA-2 gap), so the query narrows
 * to the wire-backed fields (id + deedNo) and never matches against fabricated data.
 * An empty field means "no filter on that field".
 */
export function filterPlots(rows: readonly PlotRow[], f: PlotFilter): PlotRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((p) => {
    if (q && !(p.id + p.deedNo).toLowerCase().includes(q)) return false;
    if (f.tenure && p.tenure !== f.tenure) return false;
    return true;
  });
}

/* --------------------------------------------------------------------------- */
/* Area conversion (Thai land units) — EXACT reconstruction from area_sqm       */
/* 1 sq-wah = 4 sqm · 1 ngan = 100 sq-wah = 400 sqm · 1 rai = 4 ngan = 1600 sqm */
/* --------------------------------------------------------------------------- */

/** Split an area in sqm into whole rai-ngan-wa (land.jsx areaText source, L31). */
export function sqmToRaiNganWa(areaSqm: number): { rai: number; ngan: number; wa: number } {
  const totalWa = Math.round((Number.isFinite(areaSqm) ? areaSqm : 0) / 4); // 1 sq-wah = 4 sqm
  const rai = Math.floor(totalWa / 400);
  const remAfterRai = totalWa - rai * 400;
  const ngan = Math.floor(remAfterRai / 100);
  const wa = remAfterRai - ngan * 100;
  return { rai, ngan, wa };
}

/** "rai-ngan-wa" text (land.jsx areaText, L31), e.g. 29760 sqm -> "18-2-40". */
export function areaText(areaSqm: number): string {
  const { rai, ngan, wa } = sqmToRaiNganWa(areaSqm);
  return `${rai}-${ngan}-${wa}`;
}

/** Area in rai (land.jsx plotArea, L29). 1 rai = 1600 sqm. */
export function areaRai(areaSqm: number): number {
  return (Number.isFinite(areaSqm) ? areaSqm : 0) / 1600;
}

/** A plot's assessed value in FULL units (land.jsx plotPrice, L30 = area x price/rai). */
export function plotValue(row: PlotRow): number {
  return areaRai(row.areaSqm) * row.pricePerRai;
}

/* --------------------------------------------------------------------------- */
/* Aggregates (land.jsx LandBank KPI + tfoot, L146-147 / L166-168 / L210-211)   */
/* --------------------------------------------------------------------------- */

/** Sum the plots' area in rai (KPI "total area" + tfoot). */
export function totalRai(rows: readonly PlotRow[]): number {
  return rows.reduce((s, p) => s + areaRai(p.areaSqm), 0);
}

/** Sum the plots' area in sqm (KPI sub "~= {n} sqm" = totalRai x 1600, L167). */
export function totalSqm(rows: readonly PlotRow[]): number {
  return rows.reduce((s, p) => s + p.areaSqm, 0);
}

/** Sum the plots' assessed value in FULL units (KPI "total value", L147). */
export function totalValue(rows: readonly PlotRow[]): number {
  return rows.reduce((s, p) => s + plotValue(p), 0);
}

/** Plot count (KPI "in registry" value + tfoot + toolbar count). */
export function plotCount(rows: readonly PlotRow[]): number {
  return rows.length;
}

/* --------------------------------------------------------------------------- */
/* Status badge (land.jsx tenureStatus / tenureStLabel, L155-156)               */
/* --------------------------------------------------------------------------- */

/**
 * Badge colour key from tenure (land.jsx tenureStatus, L155). own -> approved,
 * lease/buy -> pending, negotiate/other -> draft. The label is chosen separately by
 * {@link tenureLabelKind}.
 */
export function tenureStatusKind(tenure: string): "approved" | "pending" | "draft" {
  switch (tenure) {
    case "own":
      return "approved";
    case "lease":
    case "buy":
      return "pending";
    default:
      return "draft";
  }
}

/**
 * Which land.tenure.* label the badge renders (land.jsx tenureStLabel, L156). A closed
 * deal reads "own"; lease/negotiate keep their tenure; an early-stage plot reads "study";
 * anything else falls back to "negotiate". Returns a key kind so no Thai lives here.
 */
export function tenureLabelKind(row: PlotRow): "own" | "lease" | "negotiate" | "study" {
  if (row.stage === "close") return "own";
  if (row.tenure === "lease") return "lease";
  if (row.tenure === "negotiate") return "negotiate";
  if (row.stage === "source" || row.stage === "feas" || row.stage === "survey") return "study";
  return "negotiate";
}

/**
 * Status-badge tone (ds.jsx STATUS map, read by <StatusBadge status={..}>). bg/fg are
 * @juneflow/tokens var() references (rule 6); `dot` is the prototype-verbatim hex (no
 * matching token, B-037(a)). Fed the {@link tenureStatusKind} result (approved/pending/
 * draft); an unknown kind falls back to draft, exactly like the prototype's fallback.
 */
export function statusTone(kind: string): { bg: string; fg: string; dot: string } {
  switch (kind) {
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}

/* --------------------------------------------------------------------------- */
/* Number formatting (land.jsx uses ds.jsx fmt + toFixed)                        */
/* --------------------------------------------------------------------------- */

/**
 * Group a FULL-unit amount with thousands separators ("4200000" -> "4,200,000"),
 * matching the prototype's Intl fmt (ds.jsx th-TH, maximumFractionDigits 0). ASCII
 * digits + comma only; NaN / non-finite -> "0". Mirrors boq-rows formatMoney.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Rai total display "X.X" (land.jsx totalRai.toFixed(1), L167/L211). */
export function raiText(sumRai: number): string {
  return (Number.isFinite(sumRai) ? sumRai : 0).toFixed(1);
}

/** Value-in-millions display "X.X" (land.jsx (totalValue/1e6).toFixed(1), L168). */
export function millionsText(value: number): string {
  return ((Number.isFinite(value) ? value : 0) / 1e6).toFixed(1);
}

/** Grouped sqm integer for the KPI sub "~= {n} sqm" (land.jsx (totalRai*1600), L167). */
export function sqmText(sumSqm: number): string {
  return formatMoney(Math.round(Number.isFinite(sumSqm) ? sumSqm : 0));
}

/* --------------------------------------------------------------------------- */
/* id -> display resolver (real FK join, never a raw UUID leak)                 */
/* --------------------------------------------------------------------------- */

/** Build an id -> project-name map from the /projects rows (the project column). */
export function projectNameById(
  projects: readonly { id: string; name: string }[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of projects ?? []) if (p.id) map.set(p.id, p.name);
  return map;
}
