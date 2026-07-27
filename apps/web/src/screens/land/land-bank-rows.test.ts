/*
 * land-bank-rows unit tests (P3-WEB, gate G3) — the pure LandBank display logic narrowed
 * from land.jsx LandBank. Guards the opaque-row narrowing, the toolbar filter (search
 * over the wire-backed fields + tenure equality), the EXACT rai-ngan-wa reconstruction
 * from area_sqm, the KPI/tfoot aggregates, the tenure status/label mapping, and the
 * number formatting. The LA-2 columns carry no logic here (they are literal em-dash in
 * the screen), so there is nothing to test for them.
 */
import { describe, it, expect } from "vitest";
import {
  toPlotRow,
  filterPlots,
  sqmToRaiNganWa,
  areaText,
  areaRai,
  plotValue,
  totalRai,
  totalSqm,
  totalValue,
  plotCount,
  tenureStatusKind,
  tenureLabelKind,
  statusTone,
  formatMoney,
  raiText,
  millionsText,
  sqmText,
  projectNameById,
  type PlotRow,
} from "./land-bank-rows";

/** A fully-specified plot row for the aggregate/mapping tests. */
function plot(over: Partial<PlotRow> = {}): PlotRow {
  return {
    id: "L-068",
    projectId: "p1",
    deedNo: "24517",
    areaSqm: 29760, // 18-2-40 (18.6 rai)
    gps: "13.9182, 100.4023",
    pricePerRai: 4200000,
    currencyCode: "THB",
    stage: "nego",
    tenure: "negotiate",
    ...over,
  };
}

describe("toPlotRow", () => {
  it("narrows a snake_case wire row to the PlotRow shape", () => {
    expect(
      toPlotRow({
        id: "L-071",
        project_id: "p2",
        deed_no: "11902",
        area_sqm: "38400",
        gps: "13.8, 100.4",
        price_per_rai: "6800000",
        currency_code: "THB",
        stage: "dd",
        tenure: "buy",
        created_at: "2026-07-01T00:00:00Z",
      }),
    ).toEqual({
      id: "L-071",
      projectId: "p2",
      deedNo: "11902",
      areaSqm: 38400,
      gps: "13.8, 100.4",
      pricePerRai: 6800000,
      currencyCode: "THB",
      stage: "dd",
      tenure: "buy",
    });
  });

  it("accepts camelCase fallbacks", () => {
    const r = toPlotRow({ id: "x", projectId: "p", deedNo: "d", areaSqm: 1600, pricePerRai: 100, currencyCode: "USD" });
    expect(r.projectId).toBe("p");
    expect(r.deedNo).toBe("d");
    expect(r.areaSqm).toBe(1600);
    expect(r.pricePerRai).toBe(100);
    expect(r.currencyCode).toBe("USD");
  });

  it("defaults absent / null fields (never fabricates)", () => {
    expect(toPlotRow({ id: "y" })).toEqual({
      id: "y",
      projectId: "",
      deedNo: "",
      areaSqm: 0,
      gps: "",
      pricePerRai: 0,
      currencyCode: "",
      stage: "",
      tenure: "",
    });
    expect(toPlotRow({ id: "z", area_sqm: null, price_per_rai: null }).areaSqm).toBe(0);
  });

  it("does not consume created_at (not a table field)", () => {
    const r = toPlotRow({ id: "a", created_at: "x" });
    expect(Object.keys(r)).not.toContain("createdAt");
    expect(Object.keys(r)).not.toContain("created_at");
  });
});

describe("filterPlots", () => {
  const rows = [
    plot({ id: "L-068", deedNo: "24517", tenure: "negotiate" }),
    plot({ id: "L-071", deedNo: "11902", tenure: "buy" }),
    plot({ id: "L-080", deedNo: "442", tenure: "lease" }),
  ];

  it("returns every row when both fields are empty", () => {
    expect(filterPlots(rows, { q: "", tenure: "" })).toHaveLength(3);
  });

  it("matches the free-text query against id", () => {
    expect(filterPlots(rows, { q: "l-071", tenure: "" }).map((p) => p.id)).toEqual(["L-071"]);
  });

  it("matches the free-text query against deed_no", () => {
    expect(filterPlots(rows, { q: "24517", tenure: "" }).map((p) => p.id)).toEqual(["L-068"]);
  });

  it("filters by tenure equality", () => {
    expect(filterPlots(rows, { q: "", tenure: "lease" }).map((p) => p.id)).toEqual(["L-080"]);
  });

  it("combines query + tenure (AND)", () => {
    expect(filterPlots(rows, { q: "l-0", tenure: "buy" }).map((p) => p.id)).toEqual(["L-071"]);
  });

  it("never matches the LA-2 fields (they are not on the row)", () => {
    // A term that lives only in the (dropped) title/tambon/owner columns must miss now —
    // the predicate is id + deedNo only. "zone" is not in any id/deed here.
    expect(filterPlots(rows, { q: "zone", tenure: "" })).toHaveLength(0);
  });
});

describe("sqmToRaiNganWa / areaText / areaRai", () => {
  it("reconstructs rai-ngan-wa EXACTLY from area_sqm (seed = rai*1600+ngan*400+wa*4)", () => {
    expect(sqmToRaiNganWa(29760)).toEqual({ rai: 18, ngan: 2, wa: 40 });
    expect(areaText(29760)).toBe("18-2-40");
    expect(areaRai(29760)).toBeCloseTo(18.6, 5);
  });

  it("handles whole rai (24-0-0 = 38400 sqm)", () => {
    expect(sqmToRaiNganWa(38400)).toEqual({ rai: 24, ngan: 0, wa: 0 });
    expect(areaText(38400)).toBe("24-0-0");
  });

  it("handles zero / non-finite area safely", () => {
    expect(sqmToRaiNganWa(0)).toEqual({ rai: 0, ngan: 0, wa: 0 });
    expect(areaRai(Number.NaN)).toBe(0);
  });
});

describe("plotValue / aggregates", () => {
  const rows = [
    plot({ areaSqm: 29760, pricePerRai: 4200000 }), // 18.6 rai -> 78,120,000
    plot({ areaSqm: 38400, pricePerRai: 6800000 }), // 24 rai   -> 163,200,000
  ];

  it("plotValue = area(rai) x price/rai", () => {
    expect(plotValue(plot({ areaSqm: 38400, pricePerRai: 6800000 }))).toBeCloseTo(163200000, 2);
  });

  it("totalRai sums the plots' rai", () => {
    expect(totalRai(rows)).toBeCloseTo(42.6, 5);
  });

  it("totalSqm sums the plots' area_sqm", () => {
    expect(totalSqm(rows)).toBe(68160);
  });

  it("totalValue sums the plots' assessed value", () => {
    expect(totalValue(rows)).toBeCloseTo(241320000, 2);
  });

  it("plotCount is the row length", () => {
    expect(plotCount(rows)).toBe(2);
    expect(plotCount([])).toBe(0);
  });
});

describe("tenureStatusKind / tenureLabelKind", () => {
  it("maps tenure -> badge colour kind (land.jsx tenureStatus)", () => {
    expect(tenureStatusKind("own")).toBe("approved");
    expect(tenureStatusKind("lease")).toBe("pending");
    expect(tenureStatusKind("buy")).toBe("pending");
    expect(tenureStatusKind("negotiate")).toBe("draft");
    expect(tenureStatusKind("anything")).toBe("draft");
  });

  it("maps stage+tenure -> label kind (land.jsx tenureStLabel)", () => {
    expect(tenureLabelKind(plot({ stage: "close" }))).toBe("own");
    expect(tenureLabelKind(plot({ stage: "dd", tenure: "lease" }))).toBe("lease");
    expect(tenureLabelKind(plot({ stage: "nego", tenure: "negotiate" }))).toBe("negotiate");
    expect(tenureLabelKind(plot({ stage: "source", tenure: "buy" }))).toBe("study");
    expect(tenureLabelKind(plot({ stage: "feas", tenure: "buy" }))).toBe("study");
    expect(tenureLabelKind(plot({ stage: "survey", tenure: "buy" }))).toBe("study");
    expect(tenureLabelKind(plot({ stage: "deal", tenure: "buy" }))).toBe("negotiate");
  });
});

describe("statusTone", () => {
  it("returns tokened bg/fg + verbatim dot per kind", () => {
    expect(statusTone("approved").dot).toBe("#16A34A");
    expect(statusTone("pending").dot).toBe("#D97706");
    expect(statusTone("draft").dot).toBe("#94A3B8");
    expect(statusTone("unknown").fg).toBe("var(--draft)");
  });
});

describe("number formatting", () => {
  it("formatMoney groups thousands (ASCII)", () => {
    expect(formatMoney(4200000)).toBe("4,200,000");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(Number.NaN)).toBe("0");
  });

  it("raiText / millionsText render one decimal", () => {
    expect(raiText(42.6)).toBe("42.6");
    expect(millionsText(241320000)).toBe("241.3");
  });

  it("sqmText groups the rounded sqm total", () => {
    expect(sqmText(68160)).toBe("68,160");
  });
});

describe("projectNameById", () => {
  it("builds an id -> name map, skipping empty ids", () => {
    const map = projectNameById([
      { id: "p1", name: "Juneflow Bangbuathong" },
      { id: "", name: "skip" },
    ]);
    expect(map.get("p1")).toBe("Juneflow Bangbuathong");
    expect(map.has("")).toBe(false);
  });

  it("is empty for undefined input", () => {
    expect(projectNameById(undefined).size).toBe(0);
  });
});
