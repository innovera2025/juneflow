/*
 * land-survey-rows unit tests (P3-WEB, gate G3) — the pure client-derived feasibility
 * logic ported VERBATIM from land2.jsx LandSurvey (L29-35, L80-94). Guards the project-
 * type resolver, every numeric derivation (from the REAL area_sqm / price_per_rai), and
 * the exact prototype display formatting (fmt / toFixed). The survey-report values carry
 * no logic (they are literal em-dash in the screen), so there is nothing to test for them.
 */
import { describe, it, expect } from "vitest";
import type { PlotRow } from "./land-bank-rows";
import {
  projectTypeById,
  isSolarType,
  round1,
  unitsDevelopable,
  netSellableSqm,
  mwpInstallable,
  annualMWh,
  annualRevenue,
  annualRevenueM,
  paybackYears,
  landCost,
  landCostPerUnit,
  netSellableText,
  projectValueMText,
  landCostPerUnitText,
  annualMWhText,
  revenueMText,
  paybackText,
} from "./land-survey-rows";

/** A fully-specified plot row (24-0-0 = 38400 sqm = 24 rai, 6.8M baht/rai). */
function plot(over: Partial<PlotRow> = {}): PlotRow {
  return {
    id: "L-071",
    projectId: "p2",
    deedNo: "11902",
    areaSqm: 38400, // 24 rai
    gps: "13.8, 100.4",
    pricePerRai: 6800000,
    currencyCode: "THB",
    stage: "feas",
    tenure: "buy",
    // SERVER money (plotWire.total_value / deal_deposit): 24 rai x 6.8M = 163,200,000.
    totalValue: 163200000,
    dealDeposit: 16320000,
    ...over,
  };
}

describe("projectTypeById / isSolarType", () => {
  it("maps project id -> type, skipping rows with no id/type", () => {
    const map = projectTypeById([
      { id: "p1", type: "realestate" },
      { id: "p2", type: "solar" },
      { id: "", type: "civil" },
      { id: "p4" },
    ]);
    expect(map.get("p1")).toBe("realestate");
    expect(map.get("p2")).toBe("solar");
    expect(map.has("")).toBe(false);
    expect(map.has("p4")).toBe(false);
  });

  it("is empty for undefined input", () => {
    expect(projectTypeById(undefined).size).toBe(0);
  });

  it("isSolarType only for the solar branch", () => {
    expect(isSolarType("solar")).toBe(true);
    expect(isSolarType("realestate")).toBe(false);
    expect(isSolarType(undefined)).toBe(false);
  });
});

describe("round1", () => {
  it("rounds to one decimal (prototype +(x).toFixed(1))", () => {
    expect(round1(4.32)).toBe(4.3);
    expect(round1(4.25)).toBeCloseTo(4.3, 5);
    expect(round1(Number.NaN)).toBe(0);
  });
});

describe("residential derivations (land2.jsx L30/L90-92)", () => {
  it("unitsDevelopable = floor(area_sqm * 0.55 / 120)", () => {
    // 38400 * 0.55 / 120 = 176 exactly
    expect(unitsDevelopable(38400)).toBe(176);
    // 29760 * 0.55 / 120 = 136.4 -> floor 136
    expect(unitsDevelopable(29760)).toBe(136);
    expect(unitsDevelopable(0)).toBe(0);
    expect(unitsDevelopable(Number.NaN)).toBe(0);
  });

  it("netSellableSqm = round(area_sqm * 0.55)", () => {
    expect(netSellableSqm(38400)).toBe(21120);
    expect(netSellableSqm(29760)).toBe(16368);
  });

  it("landCost = area_rai * price_per_rai (plotValue); landCostPerUnit = round(landCost / max(1, units))", () => {
    // 24 rai * 6,800,000 = 163,200,000 ; / 176 units = 927,272.7 -> round 927,273
    expect(landCost(plot())).toBeCloseTo(163200000, 2);
    expect(landCostPerUnit(plot())).toBe(927273);
  });

  it("landCostPerUnit guards zero units (max(1, units))", () => {
    // tiny area -> 0 units -> divide by 1, not 0/Infinity
    const tiny = plot({ areaSqm: 100, pricePerRai: 1000000 });
    expect(unitsDevelopable(100)).toBe(0);
    expect(Number.isFinite(landCostPerUnit(tiny))).toBe(true);
  });

  it("display strings match the prototype fmt / toFixed", () => {
    expect(netSellableText(38400)).toBe("21,120"); // fmt(21120)
    expect(projectValueMText(38400)).toBe("616"); // (176 * 3.5).toFixed(0)
    expect(landCostPerUnitText(plot())).toBe("927,273"); // fmt(round(...))
  });
});

describe("solar derivations (land2.jsx L31-35/L82-85)", () => {
  it("mwpInstallable = round1(area_rai * 0.18)", () => {
    // 24 rai * 0.18 = 4.32 -> 4.3
    expect(mwpInstallable(38400)).toBe(4.3);
  });

  it("annualMWh = round(mwp * 1450)", () => {
    // 4.3 * 1450 = 6235
    expect(annualMWh(38400)).toBe(6235);
  });

  it("annualRevenue = round(annualMWh * 1000 * 4.12); annualRevenueM = /1e6", () => {
    // 6235 * 1000 * 4.12 = 25,688,200
    expect(annualRevenue(38400)).toBe(25688200);
    expect(annualRevenueM(38400)).toBeCloseTo(25.6882, 4);
  });

  it("paybackYears = mwp*31 / (revM - mwp*1.2), finite for a real plot", () => {
    // 4.3*31 / (25.6882 - 4.3*1.2) = 133.3 / 20.5282 = 6.49...
    expect(paybackYears(38400)).toBeCloseTo(6.4933, 3);
  });

  it("display strings match the prototype fmt / toFixed", () => {
    expect(annualMWhText(38400)).toBe("6,235"); // fmt(6235)
    expect(revenueMText(38400)).toBe("25.7"); // (25688200/1e6).toFixed(1)
    expect(paybackText(38400)).toBe("6.5"); // toFixed(1)
  });

  it("paybackText renders em-dash for a non-finite (degenerate zero-area) result", () => {
    // area 0 -> mwp 0 -> 0 / (0 - 0) = NaN -> em-dash (defensive display guard)
    expect(Number.isFinite(paybackYears(0))).toBe(false);
    expect(paybackText(0)).toBe("—");
  });
});
