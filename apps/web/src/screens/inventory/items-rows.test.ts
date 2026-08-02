/*
 * Unit tests for items-rows.ts (gate G3) — the pure Item-Master helpers: opaque
 * /inventory/items narrowing (snake_case + null low_point), the total + Material/Tool
 * KPI tallies, and the client-side free-text filter over code/name/warehouse.
 *
 * Fixtures are ASCII-only (§0 rule 2 keeps Thai out of .ts); the narrowing/filter
 * logic is value-agnostic, so ASCII mocks exercise it identically to server data.
 */
import { describe, it, expect } from "vitest";
import { toItemRow, catCounts, filterItems, type ItemRow } from "./items-rows";

const wire = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  code: "MAT-CEM-001",
  cat: "Material",
  name: "Cement",
  unit: "bag",
  price: 168.5,
  currency_code: "THB",
  low_point: 200,
  status: "active",
  warehouse_id: "w1",
  on_hand: 1240,
  stock: 1240,
  value: 208940,
  ...over,
});

describe("toItemRow", () => {
  it("narrows the itemWire shape, keeping null low_point distinct from 0", () => {
    const r = toItemRow(wire());
    expect(r).toEqual<ItemRow>({
      id: "i1",
      code: "MAT-CEM-001",
      cat: "Material",
      name: "Cement",
      unit: "bag",
      price: 168.5,
      currencyCode: "THB",
      lowPoint: 200,
      status: "active",
      warehouseId: "w1",
      onHand: 1240,
      value: 208940,
    });
  });

  it("prefers on_hand but falls back to the mirrored stock scalar", () => {
    expect(toItemRow(wire({ on_hand: undefined, stock: 88 })).onHand).toBe(88);
  });

  it("keeps a null low_point (not 0)", () => {
    expect(toItemRow(wire({ low_point: null })).lowPoint).toBeNull();
  });

  it("defaults missing fields", () => {
    const r = toItemRow({});
    expect(r.code).toBe("");
    expect(r.price).toBe(0);
    expect(r.onHand).toBe(0);
    expect(r.lowPoint).toBeNull();
  });
});

describe("catCounts", () => {
  it("tallies total + Material/Tool split", () => {
    const rows = [
      toItemRow(wire({ cat: "Material" })),
      toItemRow(wire({ cat: "Tool" })),
      toItemRow(wire({ cat: "Material" })),
      toItemRow(wire({ cat: "Consumable" })),
    ];
    expect(catCounts(rows)).toEqual({ total: 4, material: 2, tool: 1 });
  });

  it("is zero for an empty page", () => {
    expect(catCounts([])).toEqual({ total: 0, material: 0, tool: 0 });
  });
});

describe("filterItems", () => {
  const rows = [
    toItemRow(wire({ id: "a", code: "MAT-CEM-001", name: "Cement", warehouse_id: "w1" })),
    toItemRow(wire({ id: "b", code: "TOOL-MIX-001", name: "Mixer", warehouse_id: "w2" })),
  ];
  const whNames = new Map([
    ["w1", "WH Central"],
    ["w2", "WH Tool Site"],
  ]);

  it("returns all rows for an empty query", () => {
    expect(filterItems(rows, "  ", whNames)).toHaveLength(2);
  });

  it("matches on code (case-insensitive)", () => {
    expect(filterItems(rows, "tool-mix", whNames).map((r) => r.id)).toEqual(["b"]);
  });

  it("matches on the resolved warehouse name", () => {
    expect(filterItems(rows, "central", whNames).map((r) => r.id)).toEqual(["a"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterItems(rows, "zzz", whNames)).toHaveLength(0);
  });
});
