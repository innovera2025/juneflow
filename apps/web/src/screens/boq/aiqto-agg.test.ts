/*
 * Unit tests for aiqto-agg.ts (P2-WEB-08, gate G3) — the pure AI-QTO take-off aggregation
 * that backs the CAD/BIM AI take-off screen (boq.aiqto). Covers cat narrowing, the opaque
 * item parse (incl. the stub's dropped/invalid rows), row-amount, grand total, per-category
 * total + whole-percent share (incl. the empty/zero guards), the mean confidence + low-conf
 * count, the 02 / 03-04 / 05 code grouping order, the millions formatter, and the
 * create-BOQ mappings shape. Representative rows stand in for the real take-off engine
 * (PLAN.md §12) so the derivations are proven for the day that endpoint returns real data.
 */
import { describe, it, expect } from "vitest";
import {
  QTO_CAT_ORDER,
  LOW_CONF_THRESHOLD,
  toQtoCat,
  parseQtoItem,
  parseQtoItems,
  rowAmount,
  qtoTotal,
  qtoCatTotal,
  qtoCatPct,
  avgConfidence,
  lowConfCount,
  groupByCode,
  millions2,
  toMappings,
  type QtoRow,
} from "./aiqto-agg";

const row = (over: Partial<QtoRow> = {}): QtoRow => ({
  id: "r1",
  elem: "Wall",
  code: "02-C01",
  name: "concrete column",
  unit: "cu.m.",
  qty: 10,
  price: 2850,
  cat: "M",
  conf: 98,
  eid: "IFC#C-1",
  group: "02 structural",
  ...over,
});

describe("QTO_CAT_ORDER", () => {
  it("is Material, Labor, lump-Sum in the prototype's byCat order", () => {
    expect(QTO_CAT_ORDER).toEqual(["M", "L", "S"]);
  });
});

describe("toQtoCat", () => {
  it("accepts the enum codes", () => {
    expect(toQtoCat("M")).toBe("M");
    expect(toQtoCat("L")).toBe("L");
    expect(toQtoCat("S")).toBe("S");
  });
  it("accepts the English words the backend CAT_MAP tolerates", () => {
    expect(toQtoCat("material")).toBe("M");
    expect(toQtoCat(" labor ")).toBe("L");
    expect(toQtoCat("subcon")).toBe("S");
  });
  it("returns null for anything else", () => {
    expect(toQtoCat("X")).toBeNull();
    expect(toQtoCat("")).toBeNull();
    expect(toQtoCat(undefined)).toBeNull();
    expect(toQtoCat(42)).toBeNull();
  });
});

describe("parseQtoItem / parseQtoItems", () => {
  it("narrows an opaque take-off item into a typed row", () => {
    const parsed = parseQtoItem({
      code: "02-C01",
      name: "concrete column",
      unit: "cu.m.",
      qty: "86",
      price: 2850,
      cat: "M",
      confidence: 98,
      group: "02 structural",
    });
    expect(parsed).toMatchObject({
      code: "02-C01",
      qty: 86,
      price: 2850,
      cat: "M",
      conf: 98,
      group: "02 structural",
    });
  });

  it("drops a row that carries no valid category", () => {
    expect(parseQtoItem({ code: "x", cat: "??" })).toBeNull();
    expect(parseQtoItem(null)).toBeNull();
    expect(parseQtoItem("nope")).toBeNull();
  });

  it("synthesises an id from code when absent", () => {
    expect(parseQtoItem({ code: "02-C01", cat: "M" })?.id).toBe("qto-02-C01");
  });

  it("reads element_id / elementId as the eid alias", () => {
    expect(parseQtoItem({ cat: "M", element_id: "IFC#W-1" })?.eid).toBe("IFC#W-1");
    expect(parseQtoItem({ cat: "M", elementId: "IFC#W-2" })?.eid).toBe("IFC#W-2");
  });

  it("filters an array to only valid rows", () => {
    const rows = parseQtoItems([
      { code: "02-C01", cat: "M" },
      { code: "bad", cat: "zzz" },
      { code: "05-E01", cat: "L" },
      null,
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.code)).toEqual(["02-C01", "05-E01"]);
  });

  it("returns [] for a non-array (e.g. the stub returned no items)", () => {
    expect(parseQtoItems(undefined)).toEqual([]);
    expect(parseQtoItems({})).toEqual([]);
  });
});

describe("rowAmount / qtoTotal", () => {
  it("multiplies qty x price", () => {
    expect(rowAmount(row({ qty: 10, price: 2850 }))).toBe(28500);
  });
  it("sums every row amount", () => {
    expect(qtoTotal([row({ qty: 2, price: 100 }), row({ qty: 3, price: 100 })])).toBe(500);
  });
  it("is 0 for an empty take-off (the honest em-dashed state)", () => {
    expect(qtoTotal([])).toBe(0);
  });
});

describe("qtoCatTotal / qtoCatPct", () => {
  const rows = [
    row({ cat: "M", qty: 1, price: 600 }),
    row({ cat: "L", qty: 1, price: 300 }),
    row({ cat: "S", qty: 1, price: 100 }),
  ];
  it("totals one category", () => {
    expect(qtoCatTotal(rows, "M")).toBe(600);
    expect(qtoCatTotal(rows, "L")).toBe(300);
  });
  it("computes the whole-percent share", () => {
    expect(qtoCatPct(rows, "M")).toBe(60);
    expect(qtoCatPct(rows, "L")).toBe(30);
    expect(qtoCatPct(rows, "S")).toBe(10);
  });
  it("guards a zero/empty total to 0 (never NaN)", () => {
    expect(qtoCatPct([], "M")).toBe(0);
    expect(qtoCatPct([row({ qty: 0, price: 0 })], "M")).toBe(0);
  });
});

describe("avgConfidence / lowConfCount", () => {
  it("means the confidence, whole-percent", () => {
    expect(avgConfidence([row({ conf: 90 }), row({ conf: 80 })])).toBe(85);
  });
  it("is 0 for an empty set", () => {
    expect(avgConfidence([])).toBe(0);
  });
  it("counts rows below the low-confidence threshold", () => {
    expect(LOW_CONF_THRESHOLD).toBe(80);
    expect(lowConfCount([row({ conf: 74 }), row({ conf: 80 }), row({ conf: 68 })])).toBe(2);
  });
});

describe("groupByCode", () => {
  it("groups by the 02 / 03-04 / 05 code prefix in order, dropping empties", () => {
    const rows = [
      row({ id: "a", code: "05-E01" }),
      row({ id: "b", code: "02-C01" }),
      row({ id: "c", code: "03-W01" }),
      row({ id: "d", code: "04-D01" }),
    ];
    const groups = groupByCode(rows);
    expect(groups.map((g) => g.key)).toEqual(["g02", "g0304", "g05"]);
    expect(groups.find((g) => g.key === "g0304")?.rows).toHaveLength(2);
  });
  it("omits a group with no rows", () => {
    expect(groupByCode([row({ code: "02-C01" })]).map((g) => g.key)).toEqual(["g02"]);
  });
});

describe("millions2", () => {
  it("formats full baht to a bare 2-dp millions string", () => {
    expect(millions2(1_234_500)).toBe("1.23");
    expect(millions2(0)).toBe("0.00");
  });
  it("guards NaN / negative to 0.00", () => {
    expect(millions2(Number.NaN)).toBe("0.00");
    expect(millions2(-5)).toBe("0.00");
  });
});

describe("toMappings", () => {
  it("shapes the rows into the create-BOQ payload, carrying eid as element_id", () => {
    const mappings = toMappings([row({ code: "02-C01", eid: "IFC#C-1", cat: "M" })]);
    expect(mappings).toEqual([
      {
        group: "02 structural",
        code: "02-C01",
        name: "concrete column",
        unit: "cu.m.",
        qty: 10,
        price: 2850,
        cat: "M",
        element_id: "IFC#C-1",
      },
    ]);
  });
  it("is [] for an empty take-off", () => {
    expect(toMappings([])).toEqual([]);
  });
});
