/*
 * Item-Master row helpers for InventoryItems (route inv.items), pure/i18n-free/
 * ASCII-only logic derived from pototype/inventory.jsx InventoryItems (L14-111).
 *
 * §0 rule 3: the prototype's local ITEMS array (L3-12) is dropped — the list is the
 * real server catalogue (GET /inventory/items, itemWire, inventory.ts L311-331):
 *   { id, code, cat, name, unit, price, currency_code, low_point, status,
 *     warehouse_id, on_hand, stock(=on_hand), value, created_at }
 * The wire has NO warehouse_name (only warehouse_id -> resolved via GET
 * /inventory/warehouses, inv-shared warehouseNameById) and NO stock-status enum
 * (status = lifecycle "active", NOT ok/low/out — the badge is DERIVED client-side
 * from on_hand vs low_point, inv-shared stockStatusKind).
 */
import { num, numOrNull, str } from "./inv-shared";

/** An item-master row as the table consumes it (narrowed from the opaque wire). */
export interface ItemRow {
  id: string;
  code: string;
  /** Category free-text ("Material" | "Tool" — SERVER DATA, not i18n). */
  cat: string;
  name: string;
  unit: string;
  /** Standard price (money, SERVER-owned; 0 -> "—" per prototype L93). */
  price: number;
  currencyCode: string;
  /** Reorder threshold (nullable) — drives the derived stock-status badge. */
  lowPoint: number | null;
  /** Lifecycle status ("active") — NOT the stock-status badge (see stockStatusKind). */
  status: string;
  /** FK to the warehouse (resolved to a name via GET /inventory/warehouses). */
  warehouseId: string;
  /** SERVER-authoritative on-hand (Σ stock_ledger) — 0 until a movement posts. */
  onHand: number;
  /** Standard-cost value (round2(price x on_hand), SERVER). */
  value: number;
}

/**
 * Narrow an opaque /inventory/items Entity row to the ItemRow the table needs.
 * Multi-word fields accept snake_case (server) or camelCase for robustness. `stock`
 * mirrors `on_hand` on the wire; on_hand is preferred (falls back to stock).
 */
export function toItemRow(e: Record<string, unknown>): ItemRow {
  return {
    id: str(e.id),
    code: str(e.code),
    cat: str(e.cat),
    name: str(e.name),
    unit: str(e.unit),
    price: num(e.price),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    lowPoint: numOrNull(e.low_point ?? e.lowPoint),
    status: str(e.status),
    warehouseId: str(e.warehouse_id ?? e.warehouseId),
    onHand: num(e.on_hand ?? e.onHand ?? e.stock),
    value: num(e.value),
  };
}

/** Category tallies for KPI-1 (total + Material/Tool split from the loaded page). */
export interface CatCounts {
  total: number;
  material: number;
  tool: number;
}

/** Count total rows + the Material/Tool split (real derivation, kpiTotalSub params). */
export function catCounts(rows: readonly ItemRow[]): CatCounts {
  let material = 0;
  let tool = 0;
  for (const r of rows) {
    if (r.cat === "Material") material += 1;
    else if (r.cat === "Tool") tool += 1;
  }
  return { total: rows.length, material, tool };
}

/**
 * Free-text search over code + name + resolved warehouse name (the prototype's
 * search input, wired client-side over the loaded page like gr-list). Empty query
 * means "no filter". The category/warehouse/status filters stay presentational (recon).
 */
export function filterItems(
  rows: readonly ItemRow[],
  q: string,
  warehouseNames: Map<string, string>,
): ItemRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((r) => {
    const wh = r.warehouseId ? warehouseNames.get(r.warehouseId) ?? "" : "";
    return (r.code + r.name + wh).toLowerCase().includes(needle);
  });
}
