/*
 * Structure lock for REPORT_CATS (gate G3). The catalogue is static UI config
 * ported 1:1 from pototype/extra-screens.jsx REPORT_CATS (L51-64); this test
 * pins its shape so accidental drift (a dropped item, a mis-wired route, a
 * duplicate key) fails fast.
 */
import { describe, expect, it } from "vitest";
import { REPORT_CATS } from "./reports-cats";

describe("REPORT_CATS", () => {
  it("has the prototype's 7 categories in order", () => {
    expect(REPORT_CATS.map((c) => c.labelKey)).toEqual([
      "nav.sec.fin",
      "reports.catBoq",
      "reports.catProcure",
      "nav.sales",
      "reports.catPm",
      "dashboard.roleExec",
      "reports.catQc",
    ]);
  });

  it("carries all 32 report items", () => {
    const total = REPORT_CATS.reduce((n, c) => n + c.items.length, 0);
    expect(total).toBe(32);
  });

  it("keeps per-category item counts (8/4/4/4/4/4/4)", () => {
    expect(REPORT_CATS.map((c) => c.items.length)).toEqual([8, 4, 4, 4, 4, 4, 4]);
  });

  it("routes only the 4 live-screen items (opex x2, accept x2)", () => {
    const routed = REPORT_CATS.flatMap((c) => c.items)
      .filter((i) => i.route)
      .map((i) => i.route);
    expect(routed).toEqual(["opex", "opex", "accept", "accept"]);
  });

  it("has no duplicate item keys across the catalogue", () => {
    const keys = REPORT_CATS.flatMap((c) => c.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
