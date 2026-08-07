/*
 * land-pipeline-rows unit tests (P3-WEB, gate G3) — the pure LandPipeline display logic
 * narrowed from land.jsx LandPipeline. Guards the LA-2 row narrowing (title/amphoe/prov),
 * the 7-stage domain constant, the per-stage grouping, the three kanban KPI aggregates
 * (in-pipeline count / pending count / total budget over non-closed plots), and the card
 * tenure badge tone/label + location composition. The reused money/area helpers
 * (plotValue / totalRai / raiText / millionsText) are covered by land-bank-rows.test.ts;
 * a couple of assertions here confirm the re-export wiring only.
 */
import { describe, it, expect } from "vitest";
import {
  toPipelinePlot,
  LAND_STAGES,
  CLOSE_STAGE,
  PENDING_STAGES,
  plotsInStage,
  pipelineCount,
  pendingCount,
  totalBudget,
  tenureToneHex,
  tenureLabelKey,
  locationText,
  plotValue,
  totalRai,
  raiText,
  millionsText,
  type PipelinePlot,
} from "./land-pipeline-rows";

/** A fully-specified pipeline plot for the aggregate/mapping tests. */
function plot(over: Partial<PipelinePlot> = {}): PipelinePlot {
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
    // SERVER money (plotWire.total_value / deal_deposit): 18.6 rai x 4.2M = 78,120,000.
    totalValue: 78120000,
    dealDeposit: 7812000,
    // B-319: fee/SBT are SERVER money too (plotWire.transfer_fee / sbt, 2% / 3.3%).
    transferFee: 1562400,
    sbt: 2577960,
    // ASCII placeholders (the narrowing/composition is language-agnostic; the real wire
    // values are Thai server data — kept out of .ts per B-073, mirror land-bank-rows.test).
    title: "Plot Bangbuathong Zone C",
    amphoe: "Bangbuathong",
    prov: "Nonthaburi",
    ...over,
  };
}

describe("toPipelinePlot", () => {
  it("narrows the base fields + the LA-2 display columns from a snake_case wire row", () => {
    expect(
      toPipelinePlot({
        id: "L-071",
        project_id: "p2",
        deed_no: "11902",
        area_sqm: "38400",
        gps: "13.8, 100.4",
        price_per_rai: "6800000",
        currency_code: "THB",
        stage: "dd",
        tenure: "buy",
        title: "Plot Ratchaphruek Phase 4",
        amphoe: "Bangkruai",
        prov: "Nonthaburi",
        total_value: 163200000,
        deal_deposit: 16320000,
        transfer_fee: 3264000,
        sbt: 5385600,
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
      title: "Plot Ratchaphruek Phase 4",
      amphoe: "Bangkruai",
      prov: "Nonthaburi",
      totalValue: 163200000,
      dealDeposit: 16320000,
      transferFee: 3264000,
      sbt: 5385600,
    });
  });

  it("accepts camelCase fallbacks for the base fields", () => {
    const r = toPipelinePlot({ id: "x", areaSqm: 1600, pricePerRai: 100, currencyCode: "USD" });
    expect(r.areaSqm).toBe(1600);
    expect(r.pricePerRai).toBe(100);
    expect(r.currencyCode).toBe("USD");
  });

  it("defaults absent LA-2 columns to '' (never fabricates)", () => {
    const r = toPipelinePlot({ id: "y" });
    expect(r.title).toBe("");
    expect(r.amphoe).toBe("");
    expect(r.prov).toBe("");
  });

  it("does not consume created_at (not a card field)", () => {
    const r = toPipelinePlot({ id: "a", created_at: "x" });
    expect(Object.keys(r)).not.toContain("createdAt");
    expect(Object.keys(r)).not.toContain("created_at");
  });
});

describe("LAND_STAGES", () => {
  it("is the fixed 7-stage pipeline in prototype order", () => {
    expect(LAND_STAGES.map((s) => s.id)).toEqual([
      "source",
      "survey",
      "feas",
      "dd",
      "nego",
      "deal",
      "close",
    ]);
  });

  it("carries the prototype-verbatim per-stage colours (land.jsx L6-14)", () => {
    expect(LAND_STAGES.map((s) => s.color)).toEqual([
      "#64748B",
      "#0F766E",
      "#1D4ED8",
      "#B45309",
      "#7C3AED",
      "#0B2A4A",
      "#16803D",
    ]);
  });

  it("maps each stage to its land.stage.* dict key", () => {
    expect(LAND_STAGES.map((s) => s.labelKey)).toEqual([
      "land.stage.source",
      "land.stage.survey",
      "land.stage.feas",
      "land.stage.dd",
      "land.stage.nego",
      "land.stage.deal",
      "land.stage.close",
    ]);
  });

  it("agrees with the aggregate stage constants", () => {
    expect(CLOSE_STAGE).toBe("close");
    expect([...PENDING_STAGES].sort()).toEqual(["dd", "deal", "nego"]);
  });
});

describe("plotsInStage", () => {
  const rows = [
    plot({ id: "a", stage: "source" }),
    plot({ id: "b", stage: "nego" }),
    plot({ id: "c", stage: "nego" }),
    plot({ id: "d", stage: "close" }),
  ];

  it("returns only the plots in the given column", () => {
    expect(plotsInStage(rows, "nego").map((p) => p.id)).toEqual(["b", "c"]);
    expect(plotsInStage(rows, "source").map((p) => p.id)).toEqual(["a"]);
  });

  it("returns an empty array for a stage with no plots", () => {
    expect(plotsInStage(rows, "feas")).toEqual([]);
  });
});

describe("KPI aggregates", () => {
  const rows = [
    plot({ id: "a", stage: "source", areaSqm: 29760, pricePerRai: 4200000 }), // 78,120,000
    plot({ id: "b", stage: "dd", areaSqm: 38400, pricePerRai: 6800000 }), // 163,200,000
    plot({ id: "c", stage: "nego", areaSqm: 1600, pricePerRai: 1000000 }), // 1,000,000
    plot({ id: "d", stage: "deal", areaSqm: 1600, pricePerRai: 2000000 }), // 2,000,000
    plot({ id: "e", stage: "close", areaSqm: 1600, pricePerRai: 9000000 }), // excluded from KPI1/3
  ];

  it("pipelineCount counts every plot except close (land.jsx L94)", () => {
    expect(pipelineCount(rows)).toBe(4);
    expect(pipelineCount([plot({ stage: "close" })])).toBe(0);
  });

  it("pendingCount counts stage in {nego, deal, dd} (land.jsx L66)", () => {
    expect(pendingCount(rows)).toBe(3); // b(dd) + c(nego) + d(deal)
  });

  it("totalBudget sums assessed value over the non-closed plots (land.jsx L65)", () => {
    // 78,120,000 + 163,200,000 + 1,000,000 + 2,000,000 (close plot excluded).
    expect(totalBudget(rows)).toBeCloseTo(244320000, 2);
  });

  it("totalBudget excludes the close plot's value", () => {
    const closedOnly = [plot({ stage: "close", areaSqm: 1600, pricePerRai: 9000000 })];
    expect(totalBudget(closedOnly)).toBe(0);
  });
});

describe("tenureToneHex / tenureLabelKey", () => {
  it("maps tenure -> card badge tone (land.jsx L115)", () => {
    expect(tenureToneHex("lease")).toBe("#B45309");
    expect(tenureToneHex("negotiate")).toBe("#7C3AED");
    expect(tenureToneHex("buy")).toBe("#0F766E");
    expect(tenureToneHex("own")).toBe("#0F766E");
    expect(tenureToneHex("anything")).toBe("#0F766E");
  });

  it("maps every known tenure code -> its land.tenure.* key (land.jsx TENURE_LABEL)", () => {
    expect(tenureLabelKey("buy")).toBe("land.tenure.buy");
    expect(tenureLabelKey("lease")).toBe("land.tenure.lease");
    expect(tenureLabelKey("negotiate")).toBe("land.tenure.negotiate");
    expect(tenureLabelKey("own")).toBe("land.tenure.own");
    expect(tenureLabelKey("study")).toBe("land.tenure.study");
  });

  it("returns null for an unknown tenure (view renders an em-dash, never fabricates)", () => {
    expect(tenureLabelKey("mystery")).toBeNull();
    expect(tenureLabelKey("")).toBeNull();
  });
});

describe("locationText", () => {
  it("composes 'amphoe · prov' from the LA-2 wire fields (land.jsx L118)", () => {
    expect(locationText({ amphoe: "Bangbuathong", prov: "Nonthaburi" })).toBe("Bangbuathong · Nonthaburi");
  });

  it("drops an empty field so no bare middot is left", () => {
    expect(locationText({ amphoe: "Bangbuathong", prov: "" })).toBe("Bangbuathong");
    expect(locationText({ amphoe: "", prov: "Nonthaburi" })).toBe("Nonthaburi");
  });

  it("returns '' when both fields are absent (view falls back to an em-dash)", () => {
    expect(locationText({ amphoe: "", prov: "" })).toBe("");
  });
});

describe("re-exported display helpers (wiring check)", () => {
  it("plotValue = area(rai) x price/rai", () => {
    expect(plotValue(plot({ areaSqm: 38400, pricePerRai: 6800000 }))).toBeCloseTo(163200000, 2);
  });

  it("totalRai / raiText / millionsText render the prototype display strings", () => {
    expect(raiText(totalRai([plot({ areaSqm: 29760 }), plot({ areaSqm: 38400 })]))).toBe("42.6");
    expect(millionsText(78120000)).toBe("78.1");
  });
});
