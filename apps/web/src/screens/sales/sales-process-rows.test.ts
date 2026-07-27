/*
 * Unit tests (G3) for sales-process-rows.ts — the pure grid/overlay/count logic of
 * the SalesProcess port. Covers: hierarchy narrowing, unit filtering, the
 * booked/contract status overlays + precedence, the recomputed counts (C10), the
 * sales_unit-id lookup for the contract action, and the money helpers.
 */
import { describe, expect, it } from "vitest";
import {
  cellShortLabel,
  defaultSelectedId,
  findCell,
  formatMoney,
  parseAmount,
  round2,
  salesUnitIdByUnitId,
  toCustomerOption,
  toHierNode,
  unitCells,
  unitCounts,
  unitIdSet,
  type HierNode,
} from "./sales-process-rows";

/** A small pre-order hierarchy: one phase, one block, four units of varied status. */
const NODES: HierNode[] = [
  { id: "ph1", kind: "phase", name: "Phase 1", code: "", status: "" },
  { id: "bk1", kind: "block", name: "Block B", code: "B", status: "" },
  { id: "u1", kind: "unit", name: "B-01", code: "B-01", status: "soldBuilt" },
  { id: "u2", kind: "unit", name: "B-02", code: "B-02", status: "sold" },
  { id: "u3", kind: "unit", name: "B-03", code: "B-03", status: "built" },
  { id: "u4", kind: "unit", name: "B-04", code: "B-04", status: "empty" },
];

describe("toHierNode", () => {
  it("narrows snake_case and camelCase fields, defaulting missing to empty string", () => {
    expect(toHierNode({ id: "x", kind: "unit", name: "B-09", code: "B-09", status: "built" })).toEqual({
      id: "x",
      kind: "unit",
      name: "B-09",
      code: "B-09",
      status: "built",
    });
    // A phase node without code/status: those fields collapse to "".
    expect(toHierNode({ id: "p", kind: "phase", name: "P1" })).toEqual({
      id: "p",
      kind: "phase",
      name: "P1",
      code: "",
      status: "",
    });
  });
});

describe("unitIdSet", () => {
  it("collects unit_id (node ids) and skips blanks; tolerates undefined", () => {
    const set = unitIdSet([{ unit_id: "u3" }, { unit_id: "" }, { unitId: "u4" }]);
    expect([...set].sort()).toEqual(["u3", "u4"]);
    expect(unitIdSet(undefined).size).toBe(0);
  });
});

describe("unitCells", () => {
  it("drops non-unit nodes and keeps pre-order; selectable only for built/empty", () => {
    const cells = unitCells(NODES, new Set(), new Set());
    expect(cells.map((c) => c.id)).toEqual(["u1", "u2", "u3", "u4"]);
    expect(cells.map((c) => c.status)).toEqual(["soldBuilt", "sold", "built", "empty"]);
    expect(cells.map((c) => c.selectable)).toEqual([false, false, true, true]);
  });

  it("overlays a booking as 'booked' only on a built/empty unit", () => {
    const cells = unitCells(NODES, new Set(["u3"]), new Set());
    expect(findCell(cells, "u3")?.status).toBe("booked");
    expect(findCell(cells, "u3")?.selectable).toBe(false);
  });

  it("overlays a contract as 'sold' and outranks a concurrent booking", () => {
    // u4 is both booked and contracted -> contract wins ("sold").
    const cells = unitCells(NODES, new Set(["u4"]), new Set(["u4"]));
    expect(findCell(cells, "u4")?.status).toBe("sold");
    expect(findCell(cells, "u4")?.selectable).toBe(false);
  });

  it("never downgrades a delivered (soldBuilt) unit via an overlay", () => {
    const cells = unitCells(NODES, new Set(["u1"]), new Set(["u1"]));
    expect(findCell(cells, "u1")?.status).toBe("soldBuilt");
  });

  it("falls back to 'empty' for an unknown status value", () => {
    const cells = unitCells(
      [{ id: "ux", kind: "unit", name: "B-99", code: "B-99", status: "weird" }],
      new Set(),
      new Set(),
    );
    expect(cells[0]?.status).toBe("empty");
    expect(cells[0]?.selectable).toBe(true);
  });
});

describe("unitCounts (C10 recompute)", () => {
  it("counts sold={sold,soldBuilt}, booked, and available=rest", () => {
    const cells = unitCells(NODES, new Set(["u3"]), new Set());
    // u1 soldBuilt + u2 sold -> sold 2; u3 booked -> booked 1; u4 empty -> available 1.
    expect(unitCounts(cells)).toEqual({ total: 4, sold: 2, booked: 1, available: 1 });
  });

  it("is zero-safe for an empty grid", () => {
    expect(unitCounts([])).toEqual({ total: 0, sold: 0, booked: 0, available: 0 });
  });
});

describe("salesUnitIdByUnitId", () => {
  it("maps a node id to the first-seen sales_unit ROW id", () => {
    const map = salesUnitIdByUnitId([
      { id: "row-a", unit_id: "u3" },
      { id: "row-b", unit_id: "u3" },
      { id: "", unit_id: "u4" },
    ]);
    expect(map.get("u3")).toBe("row-a");
    expect(map.has("u4")).toBe(false);
  });
});

describe("defaultSelectedId", () => {
  it("prefers the first selectable cell, else the first cell, else empty string", () => {
    const cells = unitCells(NODES, new Set(), new Set());
    expect(defaultSelectedId(cells)).toBe("u3");
    // All non-selectable -> first cell.
    const allSold = unitCells(
      [{ id: "s", kind: "unit", name: "B-1", code: "B-1", status: "sold" }],
      new Set(),
      new Set(),
    );
    expect(defaultSelectedId(allSold)).toBe("s");
    expect(defaultSelectedId([])).toBe("");
  });
});

describe("cellShortLabel", () => {
  it("strips the block prefix, else returns the whole code", () => {
    expect(cellShortLabel("B-19")).toBe("19");
    expect(cellShortLabel("A-08")).toBe("08");
    expect(cellShortLabel("42")).toBe("42");
    expect(cellShortLabel("B-")).toBe("B-");
  });
});

describe("toCustomerOption", () => {
  it("narrows id + name (label)", () => {
    expect(toCustomerOption({ id: "c1", name: "Acme" })).toEqual({ id: "c1", label: "Acme" });
  });
});

describe("money helpers", () => {
  it("round2 rounds half-up and is non-finite safe", () => {
    expect(round2(50000.005)).toBe(50000.01);
    expect(round2(Number.NaN)).toBe(0);
  });

  it("formatMoney groups thousands as integers", () => {
    expect(formatMoney(50000)).toBe("50,000");
    expect(formatMoney(4735000)).toBe("4,735,000");
    expect(formatMoney(Number.NaN)).toBe("0");
  });

  it("parseAmount strips commas and rejects non-positive input", () => {
    expect(parseAmount("50,000")).toBe(50000);
    expect(parseAmount("-3")).toBe(0);
    expect(parseAmount("abc")).toBe(0);
  });
});
