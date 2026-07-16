/*
 * Unit tests for boq-bom-agg.ts (P2-WEB-05, gate G3) — the pure BOM-line aggregation
 * that backs the BOM Templates screen. Covers line-amount, per-house total, per-category
 * total, whole-percent share (incl. the empty/zero guards), the M/S/L grouping order,
 * the opaque jsonb parse, and the millions formatter.
 */
import { describe, it, expect } from "vitest";
import {
  BOM_CAT_ORDER,
  parseBomLine,
  parseBomLines,
  lineAmount,
  bomTotal,
  bomCatTotal,
  bomCatPct,
  groupByCat,
  millions2,
  type BomLine,
} from "./boq-bom-agg";

const line = (over: Partial<BomLine> = {}): BomLine => ({
  cat: "M",
  code: "01-001",
  name: "item",
  detail: "detail",
  unit: "unit",
  qty: 1,
  price: 100,
  ...over,
});

// A representative mixed set: M = 250, S = 300, L = 150, total = 700.
const sample: BomLine[] = [
  line({ cat: "M", code: "01-001", qty: 2, price: 100 }), // 200
  line({ cat: "M", code: "01-002", qty: 1, price: 50 }), //   50
  line({ cat: "S", code: "S-01", qty: 1, price: 300 }), //  300
  line({ cat: "L", code: "L-01", qty: 2, price: 75 }), //   150
];

describe("lineAmount", () => {
  it("multiplies qty by price", () => {
    expect(lineAmount(line({ qty: 3, price: 40 }))).toBe(120);
  });
});

describe("bomTotal", () => {
  it("sums every line amount", () => {
    expect(bomTotal(sample)).toBe(700);
  });
  it("is 0 for an empty set", () => {
    expect(bomTotal([])).toBe(0);
  });
});

describe("bomCatTotal", () => {
  it("sums only the given category", () => {
    expect(bomCatTotal(sample, "M")).toBe(250);
    expect(bomCatTotal(sample, "S")).toBe(300);
    expect(bomCatTotal(sample, "L")).toBe(150);
  });
});

describe("bomCatPct", () => {
  it("rounds each category share to a whole percent", () => {
    expect(bomCatPct(sample, "M")).toBe(36); // 250/700 = 35.71 -> 36
    expect(bomCatPct(sample, "S")).toBe(43); // 300/700 = 42.86 -> 43
    expect(bomCatPct(sample, "L")).toBe(21); // 150/700 = 21.43 -> 21
  });
  it("guards a zero/empty total to 0 (never NaN)", () => {
    expect(bomCatPct([], "M")).toBe(0);
    expect(bomCatPct([line({ qty: 0, price: 0 })], "M")).toBe(0);
  });
});

describe("groupByCat", () => {
  it("emits bands in fixed M/S/L order, each with rows/total/count", () => {
    const groups = groupByCat(sample);
    expect(groups.map((g) => g.cat)).toEqual(["M", "S", "L"]);
    expect(groups[0]).toMatchObject({ cat: "M", count: 2, total: 250 });
    expect(groups[1]).toMatchObject({ cat: "S", count: 1, total: 300 });
    expect(groups[2]).toMatchObject({ cat: "L", count: 1, total: 150 });
  });
  it("drops empty bands", () => {
    const groups = groupByCat([line({ cat: "L" })]);
    expect(groups.map((g) => g.cat)).toEqual(["L"]);
  });
  it("returns [] for no lines", () => {
    expect(groupByCat([])).toEqual([]);
  });
});

describe("BOM_CAT_ORDER", () => {
  it("is M, S, L", () => {
    expect([...BOM_CAT_ORDER]).toEqual(["M", "S", "L"]);
  });
});

describe("parseBomLine", () => {
  it("narrows a valid opaque record", () => {
    expect(
      parseBomLine({ cat: "S", code: "S-02", name: "n", detail: "d", unit: "u", qty: 4, price: 25 }),
    ).toEqual({ cat: "S", code: "S-02", name: "n", detail: "d", unit: "u", qty: 4, price: 25 });
  });
  it("coerces numeric strings and defaults missing fields", () => {
    expect(parseBomLine({ cat: "M", qty: "12", price: "8" })).toEqual({
      cat: "M",
      code: "",
      name: "",
      detail: "",
      unit: "",
      qty: 12,
      price: 8,
    });
  });
  it("rejects a record without a valid M/S/L category", () => {
    expect(parseBomLine({ cat: "X", qty: 1, price: 1 })).toBeNull();
    expect(parseBomLine(null)).toBeNull();
    expect(parseBomLine("nope")).toBeNull();
  });
});

describe("parseBomLines", () => {
  it("narrows an array and drops invalid rows", () => {
    const out = parseBomLines([
      { cat: "M", qty: 1, price: 10 },
      { cat: "bogus" },
      { cat: "L", qty: 2, price: 5 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((l) => l.cat)).toEqual(["M", "L"]);
  });
  it("returns [] for non-array input", () => {
    expect(parseBomLines(undefined)).toEqual([]);
    expect(parseBomLines({})).toEqual([]);
  });
});

describe("millions2", () => {
  it("formats full baht as a 2-dp millions string", () => {
    expect(millions2(1_940_000)).toBe("1.94");
    expect(millions2(0)).toBe("0.00");
  });
  it("guards NaN / negative to 0.00", () => {
    expect(millions2(Number.NaN)).toBe("0.00");
    expect(millions2(-5)).toBe("0.00");
  });
});
