/*
 * solar-roi-rows unit tests (gate G3) — the pure SolarROI display logic narrowed from
 * solar.jsx SolarROI. Guards the opaque-row narrowing, the cumulative sign text, the
 * colour kind, and the center-anchored bar geometry (prototype-verbatim /800 scale).
 */
import { describe, it, expect } from "vitest";
import { toRoiRow, cumulativeText, cumColorKind, barLeftPct, barWidthPct } from "./solar-roi-rows";

describe("toRoiRow", () => {
  it("narrows a snake_case wire row to RoiRow", () => {
    expect(
      toRoiRow({ id: "roi-1", project_id: "p", year: "2569", revenue: "8000000.00", opex: "1000000.00", cumulative: "7000000.00", currency_code: "THB", created_at: "z" }),
    ).toEqual({ id: "roi-1", year: 2569, revenue: 8000000, opex: 1000000, cumulative: 7000000, currencyCode: "THB" });
  });

  it("defaults absent fields and preserves a negative cumulative", () => {
    expect(toRoiRow({ id: "y" })).toEqual({ id: "y", year: 0, revenue: 0, opex: 0, cumulative: 0, currencyCode: "" });
    expect(toRoiRow({ id: "z", cumulative: -199 }).cumulative).toBe(-199);
  });
});

describe("cumulativeText / cumColorKind", () => {
  it("prefixes '+' for a non-negative value, keeps the native '-' for a negative", () => {
    expect(cumulativeText(7_000_000)).toBe("+7,000,000");
    expect(cumulativeText(0)).toBe("+0");
    expect(cumulativeText(-199)).toBe("-199");
  });

  it("colours non-negative ok, negative danger", () => {
    expect(cumColorKind(7_000_000)).toBe("ok");
    expect(cumColorKind(0)).toBe("ok");
    expect(cumColorKind(-1)).toBe("danger");
  });
});

describe("bar geometry (solar.jsx L210, /800 verbatim)", () => {
  it("anchors a non-negative bar at the 50% center", () => {
    expect(barLeftPct(99)).toBe("50%");
    expect(barLeftPct(0)).toBe("50%");
    // width = |cum|/800*50 -> 99/800*50 = 6.1875%
    expect(barWidthPct(99)).toBe(`${(99 / 800) * 50}%`);
  });

  it("offsets a negative bar left of center by its scaled magnitude", () => {
    // left = 50 + cum/800*50 -> 50 + (-199)/800*50 = 37.5625%
    expect(barLeftPct(-199)).toBe(`${50 + (-199 / 800) * 50}%`);
    expect(barWidthPct(-199)).toBe(`${(199 / 800) * 50}%`);
  });

  it("saturates (does not rescale) for a large seed magnitude", () => {
    // 7,000,000/800*50 = 437500% -> clipped by the container's overflow:hidden.
    expect(barWidthPct(7_000_000)).toBe(`${(7_000_000 / 800) * 50}%`);
    expect(barLeftPct(7_000_000)).toBe("50%");
  });
});
