/*
 * Module-gating tests (P0-WEB-05, gate G3).
 *
 * The active project's type drives which sidebar modules render (chrome.jsx moduleOn).
 * These lock the ported gating to pototype/project-types.jsx: a real-estate project
 * hides the solar/energy modules (confirmed in gallery/g1/01); a solar project shows them.
 */
import { describe, it, expect } from "vitest";
import { moduleOn, routeModuleOf, routeAllowedForType, projectTypeMeta } from "./project-types";

describe("moduleOn", () => {
  it("null/undefined module is always on", () => {
    expect(moduleOn(null, "realestate")).toBe(true);
    expect(moduleOn(undefined, "solar")).toBe(true);
  });

  it("real-estate hides the solar/energy modules", () => {
    expect(moduleOn("om", "realestate")).toBe(false);
    expect(moduleOn("ppa", "realestate")).toBe(false);
    expect(moduleOn("sales_re", "realestate")).toBe(true);
  });

  it("solar enables the energy modules and hides real-estate sales", () => {
    expect(moduleOn("om", "solar")).toBe(true);
    expect(moduleOn("ppa", "solar")).toBe(true);
    expect(moduleOn("sales_re", "solar")).toBe(false);
  });

  it("service enables only its limited module set", () => {
    expect(moduleOn("boq", "service")).toBe(false);
    expect(moduleOn("timeline", "service")).toBe(true);
    expect(moduleOn("subcon", "service")).toBe(false);
  });

  it("unknown type falls back to real-estate (prototype behaviour)", () => {
    expect(moduleOn("sales_re", "nope")).toBe(true);
    expect(projectTypeMeta("nope").id).toBe("realestate");
  });
});

describe("routeModuleOf / routeAllowedForType", () => {
  it("maps route prefixes to their gating module", () => {
    expect(routeModuleOf("solar.ppa")).toBe("ppa");
    expect(routeModuleOf("boq.overview")).toBe("boq");
    expect(routeModuleOf("pr.list")).toBe("proc");
    expect(routeModuleOf("dashboard")).toBeNull();
  });

  it("a solar route is disallowed under a real-estate project", () => {
    expect(routeAllowedForType("solar.ppa", "realestate")).toBe(false);
    expect(routeAllowedForType("solar.ppa", "solar")).toBe(true);
    expect(routeAllowedForType("dashboard", "realestate")).toBe(true);
  });
});
