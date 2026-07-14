/*
 * nav-tree parity + lookup tests (P0-WEB-05, gate G3).
 *
 * The sidebar tree (nav-tree.json, a faithful chrome.jsx NAV transcription) must not
 * drift from the structural route registry: every leaf/sub id here has to equal
 * SIDEBAR_ROUTES 1:1 in the same order, so the label/icon/grouping layer stays locked
 * to the NAV-ROUTES.md source of truth (which check-nav-parity.mjs pins to registry.ts).
 */
import { describe, it, expect } from "vitest";
import { allNavRouteIds, navLabelForRoute, NAV_TREE, NAV_SECTIONS } from "./nav-tree";
import { SIDEBAR_ROUTES } from "../routes/registry";

describe("nav-tree parity with registry", () => {
  it("leaf/sub ids equal SIDEBAR_ROUTES ids, in order", () => {
    const navIds = allNavRouteIds();
    const regIds = SIDEBAR_ROUTES.map((r) => r.id);
    expect(navIds).toEqual(regIds);
  });

  it("covers all 100 sidebar routes with no duplicates", () => {
    const navIds = allNavRouteIds();
    expect(navIds).toHaveLength(100);
    expect(new Set(navIds).size).toBe(100);
  });

  it("has the 7 section headers in NAV order", () => {
    const sections = NAV_TREE.filter((n) => n.kind === "section").map((n) => (n as { sectionId: string }).sectionId);
    expect(sections).toEqual(["main", "energy", "acct", "sales", "system", "usage", "platform"]);
    expect(Object.keys(NAV_SECTIONS)).toHaveLength(7);
  });
});

describe("navLabelForRoute", () => {
  it("resolves a leaf and a sub route to a label key", () => {
    expect(navLabelForRoute("dashboard")).toBeTruthy();
    expect(navLabelForRoute("boq.overview")).toBeTruthy();
  });

  it("returns undefined for a non-sidebar route (extra/legacy)", () => {
    expect(navLabelForRoute("login")).toBeUndefined();
    expect(navLabelForRoute("pr.form")).toBeUndefined();
  });
});

describe("badges are count-source ids, never the mock numbers (C10)", () => {
  it("no badge field carries a numeric literal", () => {
    for (const n of NAV_TREE) {
      if (n.kind !== "item") continue;
      if (n.badge !== undefined) expect(typeof n.badge).toBe("string");
      for (const s of n.sub ?? []) {
        if (s.badge !== undefined) expect(typeof s.badge).toBe("string");
      }
    }
  });
});
