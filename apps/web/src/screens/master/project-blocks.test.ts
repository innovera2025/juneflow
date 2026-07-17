/*
 * project-blocks unit tests (P1-WEB-09, gate G3) — the pure phase/block/unit-grid
 * logic ported from master.jsx MasterProject (toBlocks/unitStatus/blockTotals/
 * builtPct/typeHierarchy). Guards the unit-cell threshold algorithm and the
 * model-join against regression.
 */
import { describe, it, expect } from "vitest";
import {
  toBlocks,
  modelsById,
  toModelLite,
  blockTotals,
  unitStatus,
  builtPct,
  unitCode,
  typeHierarchy,
  phaseHead,
  hierarchyLabels,
  type Block,
} from "./project-blocks";

/** Real-estate seed shape: RJP hierarchy has phases + Block B (84 units) + C/D (0). */
const NODES: Record<string, unknown>[] = [
  { id: "ph1", kind: "phase", name: "เฟส 1 · Block A", units: 0, sold: 0, built: 0 },
  { id: "bB", kind: "block", name: "Block B", code: "B", model_id: "mB", units: 84, sold: 57, built: 54 },
  { id: "u1", kind: "unit", name: "B-01", code: "B-01", status: "soldBuilt" },
  { id: "bC", kind: "block", name: "Block C", code: "C", model_id: "mC", units: 0, sold: 0, built: 0 },
  { id: "bD", kind: "block", name: "Block D", code: "D", model_id: "mMissing", units: 36, sold: 6, built: 8 },
];

const MODELS: Record<string, unknown>[] = [
  { id: "mB", code: "B-1", type: "ทาวน์โฮม 2 ชั้น", color: "#0F766E" },
  { id: "mC", code: "C-1", type: "ทาวน์โฮม 3 ชั้น", color: "#1D4ED8" },
];

describe("toModelLite / modelsById", () => {
  it("narrows opaque model rows and indexes them by id", () => {
    expect(toModelLite({ id: "m", code: "A-1", type: "บ้าน", color: "#000", extra: 1 })).toEqual({
      id: "m",
      code: "A-1",
      type: "บ้าน",
      color: "#000",
    });
    const map = modelsById(MODELS);
    expect(map.size).toBe(2);
    expect(map.get("mB")?.code).toBe("B-1");
  });
});

describe("toBlocks", () => {
  const blocks = toBlocks(NODES, modelsById(MODELS));

  it("keeps only kind=block nodes, in order", () => {
    expect(blocks.map((b) => b.code)).toEqual(["B", "C", "D"]);
  });

  it("joins model_id -> model for the label and left-border colour", () => {
    expect(blocks[0]).toMatchObject({
      name: "Block B",
      model: "B-1 (ทาวน์โฮม 2 ชั้น)",
      color: "#0F766E",
      units: 84,
      sold: 57,
      built: 54,
    });
  });

  it("leaves model/colour blank when the model_id does not resolve", () => {
    expect(blocks[2]).toMatchObject({ code: "D", model: "", color: "" });
  });
});

describe("blockTotals", () => {
  it("sums units/sold/built across blocks (header line)", () => {
    const blocks = toBlocks(NODES, modelsById(MODELS));
    expect(blockTotals(blocks)).toEqual({ units: 84 + 0 + 36, sold: 57 + 0 + 6, built: 54 + 0 + 8 });
  });
});

describe("unitStatus", () => {
  // sold=57, built=54 -> 0..53 soldBuilt, 54..56 sold, none built-only, 57.. empty.
  it("marks a cell soldBuilt only inside both counts", () => {
    expect(unitStatus(0, 57, 54)).toBe("soldBuilt");
    expect(unitStatus(53, 57, 54)).toBe("soldBuilt");
  });
  it("marks a cell sold when inside sold beyond built", () => {
    expect(unitStatus(54, 57, 54)).toBe("sold");
    expect(unitStatus(56, 57, 54)).toBe("sold");
  });
  it("marks a cell built when inside built beyond sold", () => {
    expect(unitStatus(2, 2, 5)).toBe("built");
  });
  it("marks a cell empty past both counts", () => {
    expect(unitStatus(57, 57, 54)).toBe("empty");
    expect(unitStatus(83, 57, 54)).toBe("empty");
  });
});

describe("builtPct", () => {
  it("rounds built/units to a percent, 0 when no units", () => {
    expect(builtPct({ units: 84, built: 62 })).toBe(74);
    expect(builtPct({ units: 0, built: 0 })).toBe(0);
  });
});

describe("unitCode", () => {
  it("builds {blockCode}-{NN} with 2-digit padding", () => {
    expect(unitCode("B", 0)).toBe("B-01");
    expect(unitCode("B", 83)).toBe("B-84");
  });
});

describe("typeHierarchy", () => {
  const TYPES: Record<string, unknown>[] = [
    { id: "t1", key: "realestate", hierarchy: ["โครงการ", "เฟส", "บล็อก / อาคาร", "ยูนิต", "Model / แบบ"] },
    { id: "t2", key: "solar", hierarchy: ["ไซต์", "โซน / Array"] },
  ];
  it("returns the WBS labels for a type key", () => {
    expect(typeHierarchy(TYPES, "realestate")).toEqual([
      "โครงการ",
      "เฟส",
      "บล็อก / อาคาร",
      "ยูนิต",
      "Model / แบบ",
    ]);
  });
  it("returns [] for an unknown/absent type", () => {
    expect(typeHierarchy(TYPES, "nope")).toEqual([]);
    expect(typeHierarchy(TYPES, undefined)).toEqual([]);
  });
});

describe("phaseHead", () => {
  it("takes the first ' · ' segment of a phase name", () => {
    expect(phaseHead("เฟส 1 · Block A (บ้านเดี่ยว)")).toBe("เฟส 1");
    expect(phaseHead(undefined)).toBe("");
  });
});

describe("hierarchyLabels (B-087 over-strict gate fix)", () => {
  const UNIT = "UNIT_FALLBACK";

  it("returns H[0..3] verbatim when the type has >= 4 levels (layout unchanged)", () => {
    expect(hierarchyLabels(["Project", "Phase", "Block", "Unit", "Model"], UNIT)).toEqual([
      "Project",
      "Phase",
      "Block",
      "Unit",
    ]);
    // The unit fallback is never consulted when H already carries the unit slot.
    expect(hierarchyLabels(["A", "B", "C", "D"], UNIT)[3]).toBe("D");
  });

  it("pads the missing unit slot for a 3-level type (the civil/service seed case)", () => {
    // Real seed shape: [project, section/phase, WBS] with no explicit unit label.
    expect(hierarchyLabels(["Project", "Section", "WBS"], UNIT)).toEqual([
      "Project",
      "Section",
      "WBS",
      UNIT,
    ]);
  });

  it("pads block + unit for a 2-level type (never blanks, never undefined)", () => {
    const [p, ph, b, u] = hierarchyLabels(["Site", "Zone"], UNIT);
    expect(p).toBe("Site");
    expect(ph).toBe("Zone");
    expect(b).toBe("");
    expect(u).toBe(UNIT);
    // No slot is ever undefined (would render "undefined" in the template strings).
    expect([p, ph, b, u].every((x) => typeof x === "string")).toBe(true);
  });
});

// Compile-time: Block is the exported shape the view consumes.
const _sample: Block = {
  id: "b",
  name: "Block B",
  code: "B",
  model: "",
  color: "",
  units: 0,
  sold: 0,
  built: 0,
};
void _sample;
