/*
 * Unit tests for boq-bom-agg.ts (P2-WEB-05, gate G3) — the pure BOM-line aggregation
 * that backs the BOM Templates screen. Covers line-amount, per-house total, per-category
 * total, whole-percent share (incl. the empty/zero guards), the M/S/L grouping order,
 * the opaque jsonb parse, the block value, and the millions formatter.
 *
 * The last block exercises the REAL GET /models/{id}/bom payload shape (the served
 * boms.items rows) end-to-end through parse -> derive -> group, so a wire-shape change
 * breaks a test here rather than silently emptying the screen.
 */
import { describe, it, expect } from "vitest";
import {
  BOM_CAT_ORDER,
  parseBomLine,
  parseBomLines,
  lineAmount,
  bomTotal,
  bomBlockValue,
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

describe("bomBlockValue", () => {
  it("multiplies the per-house total by the block's unit count", () => {
    expect(bomBlockValue(sample, 84)).toBe(700 * 84);
  });
  it("is 0 for a non-positive / non-finite unit count (never NaN)", () => {
    expect(bomBlockValue(sample, 0)).toBe(0);
    expect(bomBlockValue(sample, -3)).toBe(0);
    expect(bomBlockValue(sample, Number.NaN)).toBe(0);
  });
  it("is 0 when there are no lines", () => {
    expect(bomBlockValue([], 84)).toBe(0);
  });
});

/*
 * The REAL GET /models/{id}/bom payload — the `data` rows are the boms.items elements
 * verbatim, as asserted by apps/api/src/routes/models.test.ts ("returns the model's BOM
 * template lines (keyed by unit_type = code)": `expect(body.data).toEqual(lines)`) and as
 * seeded in packages/db/src/seed/index.ts BOM_LINES_B1. This fixture is that shape (a
 * three-line excerpt of the B-1 seed; the non-Latin name/detail/unit text is replaced with
 * ASCII so this .ts stays ASCII-only per the port rules — only the FIELD NAMES, the
 * category codes and the numbers are load-bearing here).
 */
const wirePayload = [
  { cat: "M", code: "01-001", name: "bored pile", detail: "21m deep", unit: "each", qty: 18, price: 4200 },
  { cat: "S", code: "S-01", name: "structure subcontract", detail: "lump sum", unit: "lot", qty: 1, price: 420000 },
  { cat: "L", code: "L-01", name: "masonry labour", detail: "whole house", unit: "sqm", qty: 720, price: 220 },
];

describe("the GET /models/{id}/bom wire shape", () => {
  it("parses the served row shape without dropping a line", () => {
    const lines = parseBomLines(wirePayload);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({
      cat: "M",
      code: "01-001",
      name: "bored pile",
      detail: "21m deep",
      unit: "each",
      qty: 18,
      price: 4200,
    });
  });

  it("derives the per-row, per-category and per-house figures off it", () => {
    const lines = parseBomLines(wirePayload);
    expect(lineAmount(lines[0]!)).toBe(75_600); // 18 x 4200
    expect(bomCatTotal(lines, "M")).toBe(75_600);
    expect(bomCatTotal(lines, "S")).toBe(420_000);
    expect(bomCatTotal(lines, "L")).toBe(158_400); // 720 x 220
    expect(bomTotal(lines)).toBe(654_000);
    expect(millions2(bomTotal(lines))).toBe("0.65");
    expect(bomCatPct(lines, "S")).toBe(64); // 420000/654000 = 64.2 -> 64
    expect(bomBlockValue(lines, 84)).toBe(54_936_000);
  });

  it("renders the M/S/L bands in prototype order off it", () => {
    expect(groupByCat(parseBomLines(wirePayload)).map((g) => g.cat)).toEqual(["M", "S", "L"]);
  });

  it("treats the empty-BOM response as no lines (view em-dashes, never a fabricated 0 row)", () => {
    // models.ts returns `data: []` for a model whose code matches no bom row.
    const lines = parseBomLines([]);
    expect(lines).toEqual([]);
    expect(groupByCat(lines)).toEqual([]);
    expect(bomTotal(lines)).toBe(0);
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
