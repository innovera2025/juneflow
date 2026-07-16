/*
 * Pure AI-QTO take-off aggregation for the CAD/BIM AI take-off screen (boq.aiqto,
 * P2-WEB-08, gate G3) — i18n-free, ASCII-only logic derived from pototype/ai-qto.jsx
 * (QTOReview lowConf L231, QTOSummary total/byCat/groups L300-306, the createBOQ
 * traceability map L315).
 *
 * The prototype hard-codes the AI take-off rows (ai-qto.jsx QTO_ROWS_SEED L32-43) and the
 * detected elements (QTO_ELEMENTS_FOUND L22-29). Neither is a real take-off: the AI-QTO
 * backend (apps/api/src/routes/ai-qto.ts) is an explicit STUB (B-070 / PLAN.md §12) that
 * does NO IFC/RVT/DWG parse — GET /ai-qto/{job} returns canned sample data stamped
 * `stub:true` + a note reading "canned ... NOT extracted from any uploaded model". So per
 * PLAN.md §0 rule 3 (never copy the mock mechanic) + C10 (never fabricate AI output), the
 * screen seeds ZERO take-off rows: the review/summary tables render their real (initially
 * empty) QtoRow[] and em-dash every figure that has no real source, exactly like
 * boq-bom-agg.ts. The user can still add manual rows (their own data — honest), and these
 * aggregators run over whatever rows exist.
 *
 * parseQtoItems() narrows the opaque GET /ai-qto/{job} `items` into typed QtoRow[] so the
 * moment §12 ships a real take-off engine (real parse, real quantities) the tables light up
 * unchanged — the derivations here are unit-tested against representative rows for that day.
 */

/** Take-off line category — Material / Labor / lump-Sum (boq_item_cat enum M/L/S). */
export type QtoCat = "M" | "L" | "S";

/** Summary category render order (ai-qto.jsx QTOSummary byCat L301 = Material/Labor/Sum). */
export const QTO_CAT_ORDER: readonly QtoCat[] = ["M", "L", "S"];

/** Confidence threshold below which a row should be reviewed (ai-qto.jsx `r.conf < 80`). */
export const LOW_CONF_THRESHOLD = 80;

/** One reviewed/mapped take-off row (ai-qto.jsx QTO_ROWS_SEED row shape L33). */
export interface QtoRow {
  id: string;
  /** AI element source label (e.g. "Wall ...") — "" when unknown. */
  elem: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  price: number;
  cat: QtoCat;
  /** AI confidence percent (0-100). */
  conf: number;
  /** Element traceability id (e.g. "IFC#W-1001..") — "" when unknown. */
  eid: string;
  /** Summary group label carried from the take-off (e.g. "02 ..."). */
  group: string;
}

/** A code-prefix group used by the summary (ai-qto.jsx QTOSummary groups L302-306). */
export type QtoGroupKey = "g02" | "g0304" | "g05";

/** One summary group: its rows + the group total (ai-qto.jsx group `gv` L351). */
export interface QtoGroup {
  key: QtoGroupKey;
  rows: QtoRow[];
  total: number;
}

/** Read a string field off an opaque row; "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Narrow an unknown category to M/L/S. The wired take-off (ai-qto.ts STUB_TAKEOFF.items)
 * already uses the enum codes, so this accepts the codes + the English words the backend
 * CAT_MAP tolerates (ai-qto.ts L78-82). Unknown -> null (dropped by the parser).
 */
export function toQtoCat(v: unknown): QtoCat | null {
  switch (str(v).trim()) {
    case "M":
    case "material":
      return "M";
    case "L":
    case "labor":
      return "L";
    case "S":
    case "subcon":
      return "S";
    default:
      return null;
  }
}

/**
 * Narrow one opaque take-off item (a GET /ai-qto/{job} `items` element) into a typed
 * QtoRow, or null when it carries no valid M/L/S category. Missing fields default
 * (0 / ""); `id` falls back to a code+index key when absent.
 */
export function parseQtoItem(raw: unknown, index = 0): QtoRow | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const cat = toQtoCat(o.cat);
  if (!cat) return null;
  return {
    id: str(o.id) || `qto-${str(o.code) || index}`,
    elem: str(o.elem),
    code: str(o.code),
    name: str(o.name),
    unit: str(o.unit),
    qty: num(o.qty),
    price: num(o.price),
    cat,
    conf: num(o.confidence ?? o.conf),
    eid: str(o.eid ?? o.element_id ?? o.elementId),
    group: str(o.group),
  };
}

/** Narrow an opaque take-off `items` array into QtoRow[], dropping invalid rows. */
export function parseQtoItems(raw: unknown): QtoRow[] {
  if (!Array.isArray(raw)) return [];
  const out: QtoRow[] = [];
  raw.forEach((r, i) => {
    const row = parseQtoItem(r, i);
    if (row) out.push(row);
  });
  return out;
}

/** One row's amount = qty x price (ai-qto.jsx `r.qty * r.price`). */
export function rowAmount(row: QtoRow): number {
  return row.qty * row.price;
}

/** Grand total = sum of every row amount (ai-qto.jsx QTOSummary total L300). */
export function qtoTotal(rows: QtoRow[]): number {
  return rows.reduce((sum, r) => sum + rowAmount(r), 0);
}

/** Total for one category (ai-qto.jsx byCat `filter(cat).reduce` L301). */
export function qtoCatTotal(rows: QtoRow[], cat: QtoCat): number {
  return rows.reduce((sum, r) => (r.cat === cat ? sum + rowAmount(r) : sum), 0);
}

/**
 * Whole-percent share of a category (ai-qto.jsx cost-bar `Math.round(b.v/total*100)`
 * L337). Guards total <= 0 -> 0 (never NaN).
 */
export function qtoCatPct(rows: QtoRow[], cat: QtoCat): number {
  const total = qtoTotal(rows);
  if (total <= 0) return 0;
  return Math.round((qtoCatTotal(rows, cat) / total) * 100);
}

/**
 * Mean confidence, whole-percent (ai-qto.jsx KPI
 * `Math.round(rows.reduce(conf)/rows.length)` L326). Empty set -> 0 (the view em-dashes
 * an empty set rather than showing "0%").
 */
export function avgConfidence(rows: QtoRow[]): number {
  if (rows.length === 0) return 0;
  return Math.round(rows.reduce((sum, r) => sum + r.conf, 0) / rows.length);
}

/** Count of rows below the low-confidence threshold (ai-qto.jsx lowConf L231 / KPI L327). */
export function lowConfCount(rows: QtoRow[]): number {
  return rows.filter((r) => r.conf < LOW_CONF_THRESHOLD).length;
}

/** Code-prefix -> group key matchers (ai-qto.jsx groups L302-306). */
const GROUP_MATCHERS: readonly { key: QtoGroupKey; test: (code: string) => boolean }[] = [
  { key: "g02", test: (c) => c.startsWith("02") },
  { key: "g0304", test: (c) => c.startsWith("03") || c.startsWith("04") },
  { key: "g05", test: (c) => c.startsWith("05") },
];

/**
 * Group rows into the fixed 02 / 03-04 / 05 order, dropping empty groups (ai-qto.jsx
 * groups `.filter(x => x.items.length)` L306). Each group carries its rows + total.
 */
export function groupByCode(rows: QtoRow[]): QtoGroup[] {
  const out: QtoGroup[] = [];
  for (const m of GROUP_MATCHERS) {
    const gr = rows.filter((r) => m.test(r.code));
    if (gr.length === 0) continue;
    out.push({ key: m.key, rows: gr, total: qtoTotal(gr) });
  }
  return out;
}

/**
 * Full-baht -> millions, a bare 2-dp string (ai-qto.jsx KPI `(total/1e6).toFixed(2)`
 * L325). The million-baht unit is appended in the view (phrase key), so this stays ASCII.
 * NaN / negative -> "0.00" (guarded boundary).
 */
export function millions2(baht: number): string {
  if (!Number.isFinite(baht) || baht < 0) return "0.00";
  return (baht / 1_000_000).toFixed(2);
}

/**
 * The reviewed rows -> the create-BOQ `mappings` payload (ai-qto.jsx createBOQ
 * traceability L315). Each mapping is the opaque shape POST /ai-qto/{job}/create-boq
 * consumes ({group,code,name,unit,qty,price,cat,element_id}); the backend maps cat +
 * derives the doc. element_id carries the eid so real uuids light up traceability the day
 * an element registry lands (§12) — the mock's textual eid is dropped server-side.
 */
export function toMappings(rows: QtoRow[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    group: r.group,
    code: r.code,
    name: r.name,
    unit: r.unit,
    qty: r.qty,
    price: r.price,
    cat: r.cat,
    element_id: r.eid,
  }));
}
