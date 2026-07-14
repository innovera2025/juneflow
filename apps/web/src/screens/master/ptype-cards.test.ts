/*
 * ptype-cards unit tests (P1-WEB-10, gate G3) — the pure project-type-card logic ported
 * from project-type-screen.jsx MasterProjectType (toTypeCard / enabledModules /
 * projectsByType + the ALL_MODULES / MOD_DICT constants).
 *
 * Guards: the FIXED ALL_MODULES render order (PM renders last even though the seed lists
 * `pm` mid-array), the enabled-module filter (drop unknown/absent), the opaque-row
 * narrowing defaults, and the project-usage join — against regression.
 */
import { describe, it, expect } from "vitest";
import {
  ALL_MODULES,
  MOD_DICT,
  toTypeCard,
  enabledModules,
  projectsByType,
  type TypeCard,
} from "./ptype-cards";

describe("ALL_MODULES / MOD_DICT", () => {
  it("holds the 16 module keys in the fixed MODULE_LABELS order (pm last)", () => {
    expect(ALL_MODULES).toEqual([
      "land",
      "boq",
      "proc",
      "subcon",
      "timeline",
      "inv",
      "petty",
      "sales_re",
      "aftersales",
      "lineoa",
      "om",
      "ppa",
      "roi",
      "permit",
      "warranty",
      "pm",
    ]);
    expect(ALL_MODULES[ALL_MODULES.length - 1]).toBe("pm");
  });

  it("maps exactly the 7 DICT-backed module keys to ptype.mod.* keys", () => {
    expect(MOD_DICT).toEqual({
      proc: "ptype.mod.procure",
      timeline: "ptype.mod.timeline",
      sales_re: "ptype.mod.salesRe",
      aftersales: "ptype.mod.aftersales",
      lineoa: "ptype.mod.lineoa",
      om: "ptype.mod.om",
      pm: "ptype.mod.pm",
    });
    // The 7 DICT keys + the 9 phrase-layer keys must partition ALL_MODULES.
    const phraseKeys = ALL_MODULES.filter((m) => !(m in MOD_DICT));
    expect(Object.keys(MOD_DICT).length + phraseKeys.length).toBe(ALL_MODULES.length);
    expect(phraseKeys).toEqual([
      "land",
      "boq",
      "subcon",
      "inv",
      "petty",
      "ppa",
      "roi",
      "permit",
      "warranty",
    ]);
  });
});

describe("toTypeCard", () => {
  it("narrows a full opaque /project-types row to the card shape", () => {
    expect(
      toTypeCard({
        id: "t1",
        key: "solar",
        name: "โซลาเซลล์ / พลังงาน (EPC)",
        hierarchy: ["ไซต์", "โซน / Array", "String", "Inverter"],
        modules: ["land", "boq", "om", "ppa"],
        extra: "ignored",
      }),
    ).toEqual({
      id: "t1",
      key: "solar",
      name: "โซลาเซลล์ / พลังงาน (EPC)",
      hierarchy: ["ไซต์", "โซน / Array", "String", "Inverter"],
      modules: ["land", "boq", "om", "ppa"],
    });
  });

  it("defaults missing fields (strings -> \"\", arrays -> [])", () => {
    expect(toTypeCard({})).toEqual({
      id: "",
      key: "",
      name: "",
      hierarchy: [],
      modules: [],
    });
  });

  it("drops non-string members from hierarchy/modules arrays", () => {
    const c = toTypeCard({ hierarchy: ["A", 2, null, "B"], modules: ["boq", 3, "land"] });
    expect(c.hierarchy).toEqual(["A", "B"]);
    expect(c.modules).toEqual(["boq", "land"]);
  });
});

describe("enabledModules", () => {
  it("orders enabled modules by ALL_MODULES (pm renders last) regardless of server order", () => {
    // realestate seed lists pm mid-array (…petty, pm, sales_re…); the card still renders pm LAST.
    const seed = [
      "land",
      "boq",
      "proc",
      "subcon",
      "timeline",
      "inv",
      "petty",
      "pm",
      "sales_re",
      "aftersales",
      "lineoa",
    ];
    const out = enabledModules(seed);
    expect(out[out.length - 1]).toBe("pm");
    expect(out).toEqual([
      "land",
      "boq",
      "proc",
      "subcon",
      "timeline",
      "inv",
      "petty",
      "sales_re",
      "aftersales",
      "lineoa",
      "pm",
    ]);
  });

  it("keeps only enabled modules and drops unknown/absent keys", () => {
    expect(enabledModules(["boq", "land"])).toEqual(["land", "boq"]);
    expect(enabledModules(["boq", "zzz"])).toEqual(["boq"]);
    expect(enabledModules([])).toEqual([]);
  });

  it("matches the service seed (5 modules, pm last)", () => {
    expect(enabledModules(["land", "proc", "timeline", "petty", "pm"])).toEqual([
      "land",
      "proc",
      "timeline",
      "petty",
      "pm",
    ]);
  });
});

describe("projectsByType", () => {
  it("keeps only the projects whose type matches the key", () => {
    const projects = [
      { id: "a", type: "realestate", name: "RJP" },
      { id: "b", type: "solar", name: "Solar 8MW" },
      { id: "c", type: "realestate", name: "BBT" },
    ];
    expect(projectsByType(projects, "realestate").map((p) => p.name)).toEqual(["RJP", "BBT"]);
    expect(projectsByType(projects, "solar").map((p) => p.name)).toEqual(["Solar 8MW"]);
    expect(projectsByType(projects, "civil")).toEqual([]);
  });
});

// Compile-time: TypeCard is the exported shape the view consumes.
const _sample: TypeCard = {
  id: "t",
  key: "civil",
  name: "",
  hierarchy: [],
  modules: [],
};
void _sample;
