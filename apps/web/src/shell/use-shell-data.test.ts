/*
 * Shell data-resolver tests (P0-WEB-05, gate G3). Pure helpers only (no network).
 */
import { describe, it, expect } from "vitest";
import { resolveActiveProject, entityStr, useBadgeCount } from "./use-shell-data";
import type { components } from "@juneflow/contracts";

type Project = components["schemas"]["Project"];

const projects: Project[] = [
  { id: "p1", name: "Alpha", type: "realestate", status: "active" },
  { id: "p2", name: "Beta", type: "solar", status: "active" },
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

describe("useBadgeCount (C10)", () => {
  it("returns undefined until a real count endpoint exists (never the mock number)", () => {
    expect(useBadgeCount("boq")).toBeUndefined();
    expect(useBadgeCount("pr.list")).toBeUndefined();
  });
});
