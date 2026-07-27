/*
 * land-dd-rows unit tests (P3-WEB, gate G3) — the pure LandDueDiligence deal logic
 * narrowed from land2.jsx LandDueDiligence. Guards the 2-decimal rounding, the four
 * price-derived buy terms (total / 10% deposit / 2% transfer fee / 3.3% SBT), the real
 * deal-plot selection (replacing the prototype's fixed 'L-071'), and the cost-center
 * option narrowing + active-project scoping. The mock contract-type / appointment /
 * lease figures carry no logic here (they are literal em-dash in the screen).
 */
import { describe, it, expect } from "vitest";
import type { PlotRow } from "./land-bank-rows";
import {
  round2,
  dealTerms,
  pickDealPlot,
  toCcOption,
  ccOptionsForProject,
} from "./land-dd-rows";

/** A fully-specified plot row for the deal-term / selection tests. */
function plot(over: Partial<PlotRow> = {}): PlotRow {
  return {
    id: "L-071",
    projectId: "p1",
    deedNo: "11902",
    areaSqm: 38400, // 24 rai
    gps: "13.8, 100.4",
    pricePerRai: 6800000,
    currencyCode: "THB",
    stage: "dd",
    tenure: "buy",
    ...over,
  };
}

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(3.14159)).toBe(3.14);
    expect(round2(100)).toBe(100);
    expect(round2(0)).toBe(0);
  });

  it("coerces non-finite input to 0 (never fabricates)", () => {
    expect(round2(Number.NaN)).toBe(0);
    expect(round2(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("dealTerms", () => {
  it("derives the four buy terms from the plot's assessed value (24 rai x 6.8M)", () => {
    // plotValue = 24 x 6,800,000 = 163,200,000
    expect(dealTerms(plot())).toEqual({
      total: 163200000,
      deposit: 16320000, // round(total x 0.10)
      transferFee: 3264000, // round(total x 0.02)
      sbt: 5385600, // round(total x 0.033)
    });
  });

  it("mirrors land-bank plotValue for a fractional-rai plot (18.6 rai x 4.2M)", () => {
    // 29760 sqm = 18.6 rai -> 78,120,000
    expect(dealTerms(plot({ areaSqm: 29760, pricePerRai: 4200000 }))).toEqual({
      total: 78120000,
      deposit: 7812000,
      transferFee: 1562400,
      sbt: 2577960,
    });
  });

  it("rounds each derived fee to whole units", () => {
    // 1 rai x 333 -> total 333; 10%=33.3->33, 2%=6.66->7, 3.3%=10.989->11
    expect(dealTerms(plot({ areaSqm: 1600, pricePerRai: 333 }))).toEqual({
      total: 333,
      deposit: 33,
      transferFee: 7,
      sbt: 11,
    });
  });

  it("returns null for an absent plot (honest-empty deal)", () => {
    expect(dealTerms(undefined)).toBeNull();
    expect(dealTerms(null)).toBeNull();
  });

  it("returns zeros for a price-less plot (never fabricates)", () => {
    expect(dealTerms(plot({ areaSqm: 0, pricePerRai: 0 }))).toEqual({
      total: 0,
      deposit: 0,
      transferFee: 0,
      sbt: 0,
    });
  });
});

describe("pickDealPlot", () => {
  it("returns undefined for an empty register", () => {
    expect(pickDealPlot([], "p1")).toBeUndefined();
  });

  it("prefers the active project's dd-stage plot", () => {
    const rows = [
      plot({ id: "A", projectId: "p1", stage: "nego" }),
      plot({ id: "B", projectId: "p1", stage: "dd" }),
      plot({ id: "C", projectId: "p2", stage: "dd" }),
    ];
    expect(pickDealPlot(rows, "p1")?.id).toBe("B");
  });

  it("falls back to the active project's first plot when none are at dd", () => {
    const rows = [
      plot({ id: "A", projectId: "p1", stage: "nego" }),
      plot({ id: "B", projectId: "p1", stage: "feas" }),
    ];
    expect(pickDealPlot(rows, "p1")?.id).toBe("A");
  });

  it("falls back to the register's dd plot when the project has no plots", () => {
    const rows = [
      plot({ id: "A", projectId: "p2", stage: "nego" }),
      plot({ id: "B", projectId: "p3", stage: "dd" }),
    ];
    expect(pickDealPlot(rows, "p1")?.id).toBe("B");
  });

  it("uses the register's dd plot (else first) when no active project is set", () => {
    const rows = [
      plot({ id: "A", projectId: "p2", stage: "nego" }),
      plot({ id: "B", projectId: "p3", stage: "dd" }),
    ];
    expect(pickDealPlot(rows, "")?.id).toBe("B");
    expect(pickDealPlot([plot({ id: "A", stage: "nego" })], "")?.id).toBe("A");
  });
});

describe("toCcOption / ccOptionsForProject", () => {
  it("narrows a snake_case cost-center row", () => {
    expect(toCcOption({ code: "CC-01", name: "Site A", project_id: "p1" })).toEqual({
      code: "CC-01",
      name: "Site A",
      projectId: "p1",
    });
  });

  it("accepts a camelCase project id and defaults absent fields", () => {
    expect(toCcOption({ code: "CC-02", projectId: "p2" })).toEqual({
      code: "CC-02",
      name: "",
      projectId: "p2",
    });
    expect(toCcOption({})).toEqual({ code: "", name: "", projectId: "" });
  });

  const rows = [
    { code: "CC-01", name: "Site A", project_id: "p1" },
    { code: "CC-02", name: "Site B", project_id: "p2" },
    { code: "", name: "no code", project_id: "p1" }, // dropped (code-less)
    { code: "CC-03", name: "Site C", project_id: "p1" },
  ];

  it("scopes options to the active project and drops code-less rows", () => {
    expect(ccOptionsForProject(rows, "p1").map((o) => o.code)).toEqual(["CC-01", "CC-03"]);
  });

  it("returns every coded option when no active project is set", () => {
    expect(ccOptionsForProject(rows, "").map((o) => o.code)).toEqual(["CC-01", "CC-02", "CC-03"]);
  });

  it("is empty when the project has no cost centers (never fabricates)", () => {
    expect(ccOptionsForProject(rows, "p9")).toEqual([]);
  });
});
