/*
 * coa-rows unit tests (P2-WEB-13, gate G3) — the pure chart-of-accounts logic ported from
 * accounting-extra.jsx GLChartOfAccounts (toCoaRow / classOf / natureOf / filterCoa /
 * groupByClass). Guards the opaque-row narrowing, the class-from-code derivation, the Dr/Cr
 * nature map, and the search/group behaviour against regression. ASCII-only test data (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toCoaRow,
  classOf,
  coaClass,
  natureOf,
  filterCoa,
  groupByClass,
  COA_CLASSES,
  type CoaRow,
} from "./coa-rows";

const row = (code: string, name = "acct"): CoaRow => ({
  id: `id-${code}`,
  code,
  name,
  parentId: "",
  createdAt: "",
});

describe("toCoaRow", () => {
  it("narrows a full opaque /gl/coa row", () => {
    expect(
      toCoaRow({
        id: "a1",
        code: "1010",
        name: "Cash",
        parent_id: "root",
        created_at: "2026-05-01T00:00:00.000Z",
        extra: "ignored",
      }),
    ).toEqual({
      id: "a1",
      code: "1010",
      name: "Cash",
      parentId: "root",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
  });

  it("accepts camelCase and defaults missing fields to empty strings", () => {
    expect(toCoaRow({ code: "2010", parentId: "p9" })).toEqual({
      id: "",
      code: "2010",
      name: "",
      parentId: "p9",
      createdAt: "",
    });
  });
});

describe("classOf", () => {
  it("returns the code's leading digit when it is a known class", () => {
    expect(classOf("1010")).toBe("1");
    expect(classOf("5200")).toBe("5");
  });

  it("returns '' for a code with no valid class digit", () => {
    expect(classOf("0100")).toBe(""); // 0 is not one of classes 1-5
    expect(classOf("X999")).toBe("");
    expect(classOf("")).toBe("");
  });
});

describe("coaClass / natureOf", () => {
  it("maps each class id to its Dr/Cr nature", () => {
    expect(natureOf("1")).toBe("Dr");
    expect(natureOf("2")).toBe("Cr");
    expect(natureOf("3")).toBe("Cr");
    expect(natureOf("4")).toBe("Cr");
    expect(natureOf("5")).toBe("Dr");
  });

  it("returns '' / undefined for an unknown class id", () => {
    expect(natureOf("9")).toBe("");
    expect(coaClass("9")).toBeUndefined();
  });

  it("exposes exactly the 5 account classes", () => {
    expect(COA_CLASSES.map((c) => c.id)).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("filterCoa", () => {
  const rows = [row("1010", "Cash"), row("1020", "Bank"), row("2010", "Payables")];

  it("filters by class id", () => {
    expect(filterCoa(rows, "", "1").map((r) => r.code)).toEqual(["1010", "1020"]);
    expect(filterCoa(rows, "", "2").map((r) => r.code)).toEqual(["2010"]);
  });

  it("filters by code or name, case-insensitively", () => {
    expect(filterCoa(rows, "bank", "").map((r) => r.code)).toEqual(["1020"]);
    expect(filterCoa(rows, "20", "").map((r) => r.code)).toEqual(["1020", "2010"]);
  });

  it("combines class and query", () => {
    // class 1 AND name "cash" -> only 1010 (1020 is "Bank", 2010 is class 2).
    expect(filterCoa(rows, "cash", "1").map((r) => r.code)).toEqual(["1010"]);
  });
});

describe("groupByClass", () => {
  it("groups into class order and sorts each group by code, omitting empty classes", () => {
    const rows = [row("2010"), row("1020"), row("1010")];
    const groups = groupByClass(rows, "");
    expect(groups.map((g) => g.cls.id)).toEqual(["1", "2"]);
    expect(groups[0]?.rows.map((r) => r.code)).toEqual(["1010", "1020"]);
    expect(groups[1]?.rows.map((r) => r.code)).toEqual(["2010"]);
  });

  it("honours a class filter", () => {
    const rows = [row("2010"), row("1010")];
    expect(groupByClass(rows, "2").map((g) => g.cls.id)).toEqual(["2"]);
  });
});
