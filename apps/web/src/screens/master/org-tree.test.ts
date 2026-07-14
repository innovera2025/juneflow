/*
 * org-tree unit tests (P1-WEB-08, gate G3) — the pure tree logic ported from
 * master.jsx MasterCompany (hasChildren/visibleRows/counts). Guards the collapse
 * hide-stack and the level/id-based nesting against regression.
 */
import { describe, it, expect } from "vitest";
import {
  toOrgNode,
  hasChildren,
  childCount,
  orgCounts,
  visibleRows,
  type OrgNode,
} from "./org-tree";

/** A small pre-order tree: 2 companies, dept d1 with 2 teams, dept d2. */
const TREE: OrgNode[] = [
  { id: "c1", parent_id: null, level: 0, icon: "building", name: "Co 1", code: "C1", note: "" },
  { id: "d1", parent_id: "c1", level: 1, icon: "users", name: "Dept 1", code: "D1", note: "" },
  { id: "t1", parent_id: "d1", level: 2, icon: "user", name: "Team 1", code: "T1", note: "" },
  { id: "t2", parent_id: "d1", level: 2, icon: "user", name: "Team 2", code: "T2", note: "" },
  { id: "d2", parent_id: "c1", level: 1, icon: "users", name: "Dept 2", code: "D2", note: "" },
  { id: "c2", parent_id: null, level: 0, icon: "building", name: "Co 2", code: "C2", note: "" },
];

describe("toOrgNode", () => {
  it("narrows the opaque Entity to the fields the screen reads", () => {
    const n = toOrgNode({
      id: "x",
      parent_id: "p",
      level: 2,
      icon: "user",
      name: "N",
      code: "K",
      note: "hi",
      extra: 1,
    });
    expect(n).toEqual({
      id: "x",
      parent_id: "p",
      level: 2,
      icon: "user",
      name: "N",
      code: "K",
      note: "hi",
    });
  });

  it("defaults missing/absent fields (null parent, empty strings)", () => {
    const n = toOrgNode({ id: "x", level: 0, name: "N", code: "K" });
    expect(n.parent_id).toBeNull();
    expect(n.icon).toBe("");
    expect(n.note).toBe("");
  });
});

describe("hasChildren", () => {
  it("is true when the next pre-order row sits deeper", () => {
    expect(hasChildren(TREE, 0)).toBe(true); // c1 -> d1
    expect(hasChildren(TREE, 1)).toBe(true); // d1 -> t1
  });
  it("is false for a leaf or the last row", () => {
    expect(hasChildren(TREE, 2)).toBe(false); // t1 (next t2 same level)
    expect(hasChildren(TREE, 4)).toBe(false); // d2 (next c2 shallower)
    expect(hasChildren(TREE, 5)).toBe(false); // c2 (last)
  });
});

describe("childCount", () => {
  it("counts direct children by parent_id", () => {
    expect(childCount(TREE, "c1")).toBe(2); // d1, d2
    expect(childCount(TREE, "d1")).toBe(2); // t1, t2
    expect(childCount(TREE, "t1")).toBe(0);
  });
});

describe("orgCounts", () => {
  it("companies = level 0, depts = level >= 1", () => {
    expect(orgCounts(TREE)).toEqual({ companies: 2, depts: 4 });
  });
});

describe("visibleRows", () => {
  it("shows all rows when nothing is collapsed", () => {
    expect(visibleRows(TREE, new Set()).map((v) => v.r.id)).toEqual([
      "c1",
      "d1",
      "t1",
      "t2",
      "d2",
      "c2",
    ]);
  });

  it("collapsing a company hides its whole subtree", () => {
    expect(visibleRows(TREE, new Set(["c1"])).map((v) => v.r.id)).toEqual(["c1", "c2"]);
  });

  it("collapsing a dept hides only its teams", () => {
    expect(visibleRows(TREE, new Set(["d1"])).map((v) => v.r.id)).toEqual([
      "c1",
      "d1",
      "d2",
      "c2",
    ]);
  });

  it("collapsing a childless row has no effect", () => {
    expect(visibleRows(TREE, new Set(["t1"])).map((v) => v.r.id).length).toBe(TREE.length);
  });
});
