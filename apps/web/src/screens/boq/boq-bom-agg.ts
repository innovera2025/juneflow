/*
 * Pure BOM-line aggregation for the BOM Templates screen (P2-WEB-05, gate G3) —
 * i18n-free, ASCII-only logic ported 1:1 from pototype/bom.jsx (bomTotal L52-54,
 * bomCatTotal L55-57, the ["M","S","L"] category grouping L166-196, the cost-per-house
 * millions display Kpi L138).
 *
 * The prototype hard-codes BOM_LINES (bom.jsx:30-50) per house model; here the BOM line
 * detail is the real server record (§0 rule 3 / C10 — never the mock rows). A model's BOM
 * lines live in the boms.items jsonb keyed by unit_type = model code (packages/db schema
 * `bom`); parseBomLines() narrows that opaque jsonb into the typed BomLine[] this module
 * aggregates over.
 *
 * WIRE (corrected): the lines ARE served — GET /models/{id}/bom (contract operationId
 * getModelBom, handler apps/api/src/routes/models.ts) returns boms.items in the B-014
 * envelope; use-model-bom.ts fetches it and parseBomLines() narrows the rows here. An earlier
 * header in this file and in boq-bom.tsx claimed no such endpoint existed — that was true when
 * the screen was first ported and is stale now, so the aggregators below run on the real server
 * record. GET /models still exposes only bom_item_count (the length), which stays the
 * server-derived has-BOM / item-count source.
 *
 * MONEY: the wire carries per-line `qty` + `price` only — it exposes NO server-computed BOM
 * total, per-category subtotal, or block value. Every figure below is therefore a pure DISPLAY
 * derivation of those server fields (the prototype's own arithmetic, bom.jsx L52-57), never an
 * originated amount: nothing here is written back, posted, or sent to the server. Same pattern
 * as the sibling boq-editor-agg.sumLineTotals. Prefer a server-computed total the day one lands.
 */

/** BOM line category — Material / Subcontractor / Labor (bom.jsx BOM_CAT L4-8). */
export type BomCat = "M" | "S" | "L";

/** Fixed render order of the category bands (bom.jsx L166 `["M","S","L"]`). */
export const BOM_CAT_ORDER: readonly BomCat[] = ["M", "S", "L"];

/** One BOM line per 1 house (bom.jsx BOM_LINES row shape L31-49). */
export interface BomLine {
  cat: BomCat;
  code: string;
  name: string;
  /** Secondary description under the name (bom.jsx `detail`). */
  detail: string;
  unit: string;
  qty: number;
  price: number;
}

/** A category band: its rows + the band total + row count (bom.jsx L170-179). */
export interface BomCatGroup {
  cat: BomCat;
  rows: BomLine[];
  total: number;
  count: number;
}

/** Read a string field off an opaque row; "" when absent. */
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

/** Narrow an unknown category to M/S/L, or null when it is none of them. */
function toCat(v: unknown): BomCat | null {
  return v === "M" || v === "S" || v === "L" ? v : null;
}

/**
 * Narrow one opaque BOM-line record (a boms.items element) into a typed BomLine, or
 * null when it carries no valid M/S/L category. Multi-word tolerance is unnecessary
 * (single-word fields), missing fields default (0 / "").
 */
export function parseBomLine(raw: unknown): BomLine | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const cat = toCat(o.cat);
  if (!cat) return null;
  return {
    cat,
    code: str(o.code),
    name: str(o.name),
    detail: str(o.detail),
    unit: str(o.unit),
    qty: num(o.qty),
    price: num(o.price),
  };
}

/** Narrow an opaque jsonb array into BomLine[], dropping rows without a valid category. */
export function parseBomLines(raw: unknown): BomLine[] {
  if (!Array.isArray(raw)) return [];
  const out: BomLine[] = [];
  for (const r of raw) {
    const line = parseBomLine(r);
    if (line) out.push(line);
  }
  return out;
}

/** One line's amount = qty x price (bom.jsx `l.qty * l.price`). */
export function lineAmount(line: BomLine): number {
  return line.qty * line.price;
}

/** Total cost per 1 house = sum of every line amount (bom.jsx bomTotal L52-54). */
export function bomTotal(lines: BomLine[]): number {
  return lines.reduce((sum, l) => sum + lineAmount(l), 0);
}

/**
 * Block value = the per-house BOM total x the block's unit count (bom.jsx L207 info-formula
 * `total * model.units`, reused by the generate-BOQ confirm L110). Both inputs are server
 * fields (line qty/price + the derived unit_count); this is display arithmetic only.
 * A non-positive / non-finite unit count contributes nothing -> 0 (never NaN).
 */
export function bomBlockValue(lines: BomLine[], unitCount: number): number {
  if (!Number.isFinite(unitCount) || unitCount <= 0) return 0;
  return bomTotal(lines) * unitCount;
}

/** Cost of one category = sum of its lines (bom.jsx bomCatTotal L55-57). */
export function bomCatTotal(lines: BomLine[], cat: BomCat): number {
  return lines.reduce((sum, l) => (l.cat === cat ? sum + lineAmount(l) : sum), 0);
}

/**
 * Whole-percent share of a category (bom.jsx Kpi `Math.round(catTotal/total*100)`).
 * Guards total <= 0 -> 0 (never NaN) so an empty/unpriced set reads as 0, not "NaN%".
 */
export function bomCatPct(lines: BomLine[], cat: BomCat): number {
  const total = bomTotal(lines);
  if (total <= 0) return 0;
  return Math.round((bomCatTotal(lines, cat) / total) * 100);
}

/**
 * Group lines into the fixed M/S/L band order, dropping empty bands (bom.jsx L166-196
 * `if (!rows.length) return null`). Each band carries its rows, band total, and count.
 */
export function groupByCat(lines: BomLine[]): BomCatGroup[] {
  const groups: BomCatGroup[] = [];
  for (const cat of BOM_CAT_ORDER) {
    const rows = lines.filter((l) => l.cat === cat);
    if (rows.length === 0) continue;
    groups.push({ cat, rows, total: bomTotal(rows), count: rows.length });
  }
  return groups;
}

/**
 * Full-baht -> millions, a bare 2-dp string (bom.jsx Kpi `(total/1e6).toFixed(2)`).
 * The "million baht" unit is appended in the view (phrase key), so this stays ASCII.
 * NaN / negative -> "0.00" (guarded boundary).
 */
export function millions2(baht: number): string {
  if (!Number.isFinite(baht) || baht < 0) return "0.00";
  return (baht / 1_000_000).toFixed(2);
}
