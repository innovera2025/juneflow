/*
 * Unit tests for stock-rows.ts (gate G3) — the pure Stock helpers: opaque
 * /inventory/stock + /inventory/warehouses narrowing, the per-warehouse card
 * aggregation (distinct item count + Σ value across EVERY warehouse), the
 * client-side warehouse selection, and the value sum.
 */
import { describe, it, expect } from "vitest";
import {
  toStockRow,
  toWarehouseRow,
  warehouseCards,
  stockForWarehouse,
  sumValue,
} from "./stock-rows";

const stockWire = (over: Record<string, unknown> = {}) => ({
  item_id: "i1",
  warehouse_id: "w1",
  item_code: "MAT-CEM-001",
  item_name: "Cement",
  unit: "bag",
  warehouse_name: "WH Central",
  price: 168.5,
  currency_code: "THB",
  on_hand: 1240,
  value: 208940,
  ...over,
});

describe("toStockRow / toWarehouseRow", () => {
  it("narrows the stockWire shape", () => {
    const r = toStockRow(stockWire());
    expect(r.itemId).toBe("i1");
    expect(r.warehouseId).toBe("w1");
    expect(r.itemName).toBe("Cement");
    expect(r.onHand).toBe(1240);
    expect(r.value).toBe(208940);
  });

  it("narrows the warehouse wire, keeping a null capacity distinct from 0", () => {
    expect(toWarehouseRow({ id: "w1", name: "WH", capacity: 1000 })).toEqual({
      id: "w1",
      name: "WH",
      capacity: 1000,
    });
    expect(toWarehouseRow({ id: "w2", name: "WH2", capacity: null }).capacity).toBeNull();
  });
});

describe("warehouseCards", () => {
  const warehouses = [
    toWarehouseRow({ id: "w1", name: "Central", capacity: 1000 }),
    toWarehouseRow({ id: "w2", name: "Block B", capacity: null }),
    toWarehouseRow({ id: "w3", name: "Empty", capacity: 500 }),
  ];
  const stock = [
    toStockRow(stockWire({ item_id: "i1", warehouse_id: "w1", value: 100 })),
    toStockRow(stockWire({ item_id: "i2", warehouse_id: "w1", value: 50 })),
    toStockRow(stockWire({ item_id: "i1", warehouse_id: "w1", value: 25 })), // dup item -> not double-counted
    toStockRow(stockWire({ item_id: "i9", warehouse_id: "w2", value: 200 })),
  ];

  it("counts distinct items + sums value per warehouse, including empty warehouses (0/0)", () => {
    const cards = warehouseCards(warehouses, stock);
    expect(cards).toEqual([
      { id: "w1", name: "Central", itemCount: 2, value: 175, capacity: 1000 },
      { id: "w2", name: "Block B", itemCount: 1, value: 200, capacity: null },
      { id: "w3", name: "Empty", itemCount: 0, value: 0, capacity: 500 },
    ]);
  });

  it("returns all warehouses with 0/0 when the ledger is unseeded", () => {
    const cards = warehouseCards(warehouses, []);
    expect(cards.every((c) => c.itemCount === 0 && c.value === 0)).toBe(true);
  });
});

describe("stockForWarehouse / sumValue", () => {
  const stock = [
    toStockRow(stockWire({ warehouse_id: "w1", value: 100 })),
    toStockRow(stockWire({ warehouse_id: "w2", value: 200 })),
    toStockRow(stockWire({ warehouse_id: "w1", value: 25 })),
  ];

  it("filters the loaded rows to the selected warehouse", () => {
    expect(stockForWarehouse(stock, "w1")).toHaveLength(2);
    expect(stockForWarehouse(stock, "w2")).toHaveLength(1);
  });

  it("returns [] for an empty selection", () => {
    expect(stockForWarehouse(stock, "")).toHaveLength(0);
  });

  it("sums the standard-cost value", () => {
    expect(sumValue(stockForWarehouse(stock, "w1"))).toBe(125);
    expect(sumValue([])).toBe(0);
  });
});
