/*
 * Stock-by-warehouse row helpers for InventoryStock (route inv.stock), pure/
 * i18n-free/ASCII-only logic derived from pototype/inventory.jsx InventoryStock
 * (L113-204). GOTCHA: the component ends BEFORE `const TRANSFERS` (L206) — the
 * swallowed TRANSFERS array is NOT part of this screen.
 *
 * §0 rule 3: the prototype's hardcoded WH array (L114-120) + the ITEMS.slice(0,6)
 * table body are dropped. The warehouse cards derive from GET /inventory/warehouses
 * (name/capacity) + a client aggregation of GET /inventory/stock (per-warehouse item
 * count + Σ value). The detail panel binds the real GET /inventory/stock balances
 * (stockWire, inventory.ts L347-368): { item_id, warehouse_id, item_code, item_name,
 * unit, warehouse_name, price, currency_code, on_hand, value }.
 *
 * WIRE GAPS (reported, never fabricated): stockWire emits NO reorder point, NO
 * usage/month, NO stock-status, NO last-movement, and no per-warehouse alert count
 * or utilisation field — those cells/segments render an em-dash / are omitted.
 */
import { num, str } from "./inv-shared";

/** A per-(item,warehouse) balance row as the detail table consumes it. */
export interface StockRow {
  itemId: string;
  warehouseId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  warehouseName: string;
  price: number;
  currencyCode: string;
  onHand: number;
  /** Standard-cost value (round2(price x on_hand), SERVER). */
  value: number;
}

/** Narrow an opaque /inventory/stock Entity row to a StockRow. */
export function toStockRow(e: Record<string, unknown>): StockRow {
  return {
    itemId: str(e.item_id ?? e.itemId),
    warehouseId: str(e.warehouse_id ?? e.warehouseId),
    itemCode: str(e.item_code ?? e.itemCode),
    itemName: str(e.item_name ?? e.itemName),
    unit: str(e.unit),
    warehouseName: str(e.warehouse_name ?? e.warehouseName),
    price: num(e.price),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    onHand: num(e.on_hand ?? e.onHand),
    value: num(e.value),
  };
}

/** A warehouse as the KPI card consumes it (from GET /inventory/warehouses). */
export interface WarehouseRow {
  id: string;
  name: string;
  /** Item-count capacity (nullable) — util is only derivable when present. */
  capacity: number | null;
}

/** Narrow an opaque /inventory/warehouses Entity row to a WarehouseRow. */
export function toWarehouseRow(e: Record<string, unknown>): WarehouseRow {
  const cap = e.capacity;
  return {
    id: str(e.id),
    name: str(e.name),
    capacity: typeof cap === "number" && Number.isFinite(cap) ? cap : cap == null ? null : num(cap),
  };
}

/** A warehouse KPI card: real name + derived item-count + Σ value from the ledger. */
export interface WarehouseCard {
  id: string;
  name: string;
  /** Distinct item count in this warehouse (derived from the stock rows). */
  itemCount: number;
  /** Σ standard-cost value for this warehouse (derived from the stock rows). */
  value: number;
  capacity: number | null;
}

/**
 * Build the warehouse cards: EVERY warehouse (from GET /inventory/warehouses),
 * with itemCount = distinct items and value = Σ value from the stock balances of
 * that warehouse (both 0 when the ledger is unseeded — honest, not fabricated).
 */
export function warehouseCards(
  warehouses: readonly WarehouseRow[],
  stock: readonly StockRow[],
): WarehouseCard[] {
  const items = new Map<string, Set<string>>();
  const value = new Map<string, number>();
  for (const s of stock) {
    if (!s.warehouseId) continue;
    const set = items.get(s.warehouseId) ?? new Set<string>();
    if (s.itemId) set.add(s.itemId);
    items.set(s.warehouseId, set);
    value.set(s.warehouseId, (value.get(s.warehouseId) ?? 0) + s.value);
  }
  return warehouses.map((w) => ({
    id: w.id,
    name: w.name,
    itemCount: items.get(w.id)?.size ?? 0,
    value: value.get(w.id) ?? 0,
    capacity: w.capacity,
  }));
}

/** The stock balances of one warehouse (client-side selection over the loaded page). */
export function stockForWarehouse(stock: readonly StockRow[], warehouseId: string): StockRow[] {
  if (!warehouseId) return [];
  return stock.filter((s) => s.warehouseId === warehouseId);
}

/** Σ standard-cost value across a set of stock rows (panel-header summary). */
export function sumValue(rows: readonly StockRow[]): number {
  return rows.reduce((acc, r) => acc + r.value, 0);
}
