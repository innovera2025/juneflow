/*
 * Shell data-resolver tests (P0-WEB-05, gate G3). Pure helpers only (no network).
 */
import { describe, it, expect } from "vitest";
import {
  resolveActiveProject,
  resolveActiveCompany,
  entityStr,
  pkgMenuAllowed,
  packageMenus,
} from "./use-shell-data";
import type { components } from "@juneflow/contracts";

type Project = components["schemas"]["Project"];
type Company = components["schemas"]["Company"];

const projects: Project[] = [
  { id: "p1", name: "Alpha", type: "realestate", status: "active", company_id: "c2" },
  { id: "p2", name: "Beta", type: "solar", status: "active" },
];

const companies: Company[] = [
  { id: "c1", name: "First Co", short: "FC" },
  { id: "c2", name: "Second Co", short: "SC" },
];

describe("resolveActiveProject", () => {
  it("defaults to the first row when no tweak is set (not a mock id)", () => {
    expect(resolveActiveProject(projects, undefined)?.id).toBe("p1");
  });

  it("resolves the tweaked project id (phase suffix stripped)", () => {
    expect(resolveActiveProject(projects, "p2.phaseX")?.id).toBe("p2");
  });

  it("falls back to the first row for an unknown id", () => {
    expect(resolveActiveProject(projects, "ghost")?.id).toBe("p1");
  });

  it("is undefined with no projects", () => {
    expect(resolveActiveProject([], "p1")).toBeUndefined();
    expect(resolveActiveProject(undefined, "p1")).toBeUndefined();
  });
});

describe("entityStr", () => {
  it("reads a string field off an opaque entity", () => {
    expect(entityStr({ name: "somchai" }, "name")).toBe("somchai");
  });
  it("returns '' for missing / non-string / null", () => {
    expect(entityStr({ n: 5 }, "n")).toBe("");
    expect(entityStr(undefined, "name")).toBe("");
    expect(entityStr(null, "name")).toBe("");
  });
});

describe("resolveActiveCompany (B-041)", () => {
  it("prefers an explicit company tweak", () => {
    expect(resolveActiveCompany(companies, "c2", undefined)?.id).toBe("c2");
  });
  it("falls back to the active project's owning company", () => {
    expect(resolveActiveCompany(companies, undefined, projects[0])?.id).toBe("c2");
  });
  it("falls back to the first company when nothing else resolves", () => {
    expect(resolveActiveCompany(companies, undefined, projects[1])?.id).toBe("c1");
    expect(resolveActiveCompany(companies, "ghost", undefined)?.id).toBe("c1");
  });
  it("is undefined with no companies", () => {
    expect(resolveActiveCompany([], "c1", undefined)).toBeUndefined();
    expect(resolveActiveCompany(undefined, "c1", undefined)).toBeUndefined();
  });
});

describe("pkgMenuAllowed (B-043 · pkg-builder.jsx:237)", () => {
  const M = ["dashboard", "boq", "proc", "gl"];
  it("always allows dashboard + sub regardless of the list", () => {
    expect(pkgMenuAllowed("dashboard", [])).toBe(true);
    expect(pkgMenuAllowed("sub", [])).toBe(true);
  });
  it('"*" allows every menu', () => {
    expect(pkgMenuAllowed("sales", ["*"])).toBe(true);
    expect(pkgMenuAllowed("anything", ["*"])).toBe(true);
  });
  it("otherwise the id must be in the allow-list", () => {
    expect(pkgMenuAllowed("boq", M)).toBe(true);
    expect(pkgMenuAllowed("sales", M)).toBe(false);
    expect(pkgMenuAllowed("labor", M)).toBe(false);
  });
  it("no list = no gating (allow all, prototype `if (!p) return true`)", () => {
    expect(pkgMenuAllowed("sales", undefined)).toBe(true);
  });
});

describe("packageMenus", () => {
  it("reads the menu allow-list off the opaque package entity", () => {
    expect(packageMenus({ package: { menus: ["dashboard", "boq"] } } as never)).toEqual(["dashboard", "boq"]);
  });
  it("is undefined when absent / non-array", () => {
    expect(packageMenus({ package: {} } as never)).toBeUndefined();
    expect(packageMenus(undefined)).toBeUndefined();
  });
});
