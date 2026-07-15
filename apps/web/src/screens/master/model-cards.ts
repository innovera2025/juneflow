/*
 * Model-card helpers for MasterModel (P1-WEB-13) — pure, i18n-free, ASCII-only
 * logic ported 1:1 from pototype/master.jsx MasterModel (L507-578).
 *
 * The prototype held the model list in local state (MODELS seed, master.jsx:420-432)
 * and derived the BOM line from a MOCK formula (`248 + i*30`, master.jsx:563). Here the
 * model list is the real server catalogue: GET /models returns the opaque Entity rows
 * (additionalProperties), each carrying REAL price / status / colour aggregates plus
 * unit_count and bom_item_count. §0 rule 3: the mock's per-index BOM number is dropped —
 * the BOM line reads the real bom_item_count.
 *
 * Price semantics: the server stores price in FULL baht; the prototype card shows it in
 * millions (`m.price.toFixed(2)` where the seed price IS millions, e.g. 8.24). So the
 * card divides by 1_000_000 for display (the "M baht" suffix is added in the view via
 * the model.priceUnit dict key — never here, so no baht symbol / Thai leaks into this .ts).
 */

/** A house model as the card grid consumes it (GET /models row, narrowed from opaque). */
export interface ModelCard {
  id: string;
  code: string;
  /** House-type display name (e.g. a 2-storey detached house) — opaque row data, as-is. */
  type: string;
  /** Usable area (sq.m). */
  area: number;
  bed: number;
  bath: number;
  parking: number;
  /** Starting price in FULL baht (server system of record). */
  price: number;
  currency_code: string;
  /** Lifecycle status — "active" | "draft" (new models start "draft", B-050). */
  status: string;
  /** Server-assigned colour hex (border/gradient/stroke/text) — B-050. */
  color: string;
  /** Units in projects bound to this model (bottom-right count line). */
  unit_count: number;
  /** Real BOM line-item count (BOM cell) — replaces the mock 248+i*30. */
  bom_item_count: number;
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

/**
 * Narrow an opaque /models Entity row to the ModelCard the grid needs. Multi-word
 * fields accept snake_case (server convention) or camelCase for robustness — mirrors
 * project-blocks.ts's `model_id ?? modelId` dual read. Missing fields default (0 / "").
 */
export function toModelCard(e: Record<string, unknown>): ModelCard {
  return {
    id: str(e.id),
    code: str(e.code),
    type: str(e.type),
    area: num(e.area),
    bed: num(e.bed),
    bath: num(e.bath),
    parking: num(e.parking),
    price: num(e.price),
    currency_code: str(e.currency_code ?? e.currencyCode),
    status: str(e.status),
    color: str(e.color),
    unit_count: num(e.unit_count ?? e.unitCount),
    bom_item_count: num(e.bom_item_count ?? e.bomItemCount),
  };
}

/**
 * Format a FULL-baht price as its millions value, a BARE 2-dp string (master.jsx:559
 * `m.price.toFixed(2)`). The "M baht" unit is appended in the view (model.priceUnit key),
 * so this stays ASCII. NaN / negative price -> "0.00" (guarded boundary); 0 -> "0.00".
 */
export function formatModelPrice(baht: number): string {
  if (!Number.isFinite(baht) || baht < 0) return "0.00";
  return (baht / 1_000_000).toFixed(2);
}

/** A model has a BOM when its real line-item count is positive (master.jsx:563 gate). */
export function hasBom(card: Pick<ModelCard, "bom_item_count">): boolean {
  return card.bom_item_count > 0;
}

/** True when the model is active (vs draft) — drives the badge tone (master.jsx:543-545). */
export function statusActive(card: Pick<ModelCard, "status">): boolean {
  return card.status === "active";
}
