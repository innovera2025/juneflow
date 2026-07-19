/*
 * Unit tests for boq-reports-agg.ts (group-C W2b/W3b, gate G3) — the pure logic
 * behind the BOQ Reports screen: opaque-Entity parsers (incl. honest-null wire
 * gaps + the synthetic unattributed Non-BOQ row), the millions/percent formatters,
 * the prototype threshold-colour rules, the variance status classifier, and the
 * RPT-001 bar / RPT-003 M-S-L bar / RPT-005 EVM S-curve geometry builders (empty +
 * non-empty).
 */
import { describe, it, expect } from "vitest";
import {
  entNum,
  entNumOrNull,
  entStr,
  entArr,
  entObj,
  parseBoqVsNonboq,
  parseCostType,
  parseVariance,
  parseEvm,
  millions1,
  millions2,
  formatPct1,
  pctOverBadge,
  varianceDevBadge,
  varianceColor,
  spiGood,
  varianceStatusKey,
  classifyVarianceRow,
  buildBoqBars,
  buildMslBar,
  buildEvmChart,
  evmMaxMillions,
  DASH,
  type CostTypeReport,
  type VarianceRow,
  type EvmPoint,
} from "./boq-reports-agg";

describe("opaque-Entity field readers", () => {
  it("entNum coerces / defaults to 0", () => {
    expect(entNum({ a: 5 }, "a")).toBe(5);
    expect(entNum({ a: "12.5" }, "a")).toBe(12.5);
    expect(entNum({ a: null }, "a")).toBe(0);
    expect(entNum(undefined, "a")).toBe(0);
    expect(entNum({ a: "x" }, "a")).toBe(0);
  });

  it("entNumOrNull keeps null distinct from 0", () => {
    expect(entNumOrNull({ a: 0 }, "a")).toBe(0);
    expect(entNumOrNull({ a: null }, "a")).toBeNull();
    expect(entNumOrNull({}, "a")).toBeNull();
    expect(entNumOrNull({ a: "3" }, "a")).toBe(3);
  });

  it("entStr returns non-empty string or null", () => {
    expect(entStr({ a: "hi" }, "a")).toBe("hi");
    expect(entStr({ a: "" }, "a")).toBeNull();
    expect(entStr({ a: 3 }, "a")).toBeNull();
  });

  it("entArr / entObj return the array / object or the empty fallback", () => {
    expect(entArr({ a: [{ x: 1 }] }, "a")).toEqual([{ x: 1 }]);
    expect(entArr({ a: "nope" }, "a")).toEqual([]);
    expect(entObj({ a: { x: 1 } }, "a")).toEqual({ x: 1 });
    expect(entObj({ a: [1, 2] }, "a")).toEqual({});
    expect(entObj(undefined, "a")).toEqual({});
  });
});

describe("parseBoqVsNonboq (RPT-001)", () => {
  it("maps category rows + the synthetic unattributed (null) row + totals", () => {
    const rep = parseBoqVsNonboq({
      rows: [
        {
          group_id: "g1",
          category_label: "02 Structure",
          boq: 4_840_000,
          non_boq: 0,
          total_actual: 4_840_000,
          pct_over: 0,
        },
        {
          group_id: null,
          category_label: null,
          boq: 0,
          non_boq: 0,
          total_actual: 0,
          pct_over: null,
        },
      ],
      totals: { boq: 4_840_000, non_boq: 0, total_actual: 4_840_000, pct_over: 0 },
      currency_code: "THB",
    });
    expect(rep).not.toBeNull();
    expect(rep!.rows).toHaveLength(2);
    expect(rep!.rows[0].categoryLabel).toBe("02 Structure");
    expect(rep!.rows[0].boq).toBe(4_840_000);
    // synthetic unattributed row: null group + null category + null pct_over (honest).
    expect(rep!.rows[1].groupId).toBeNull();
    expect(rep!.rows[1].categoryLabel).toBeNull();
    expect(rep!.rows[1].pctOver).toBeNull();
    expect(rep!.totals.boq).toBe(4_840_000);
    expect(parseBoqVsNonboq(undefined)).toBeNull();
  });
});

describe("parseCostType (RPT-003)", () => {
  it("maps rows + totals + integer ratio", () => {
    const rep = parseCostType({
      rows: [
        {
          group_id: "g1",
          category_label: "02 Structure",
          material: 2_640_000,
          subcon: 2_160_000,
          labor: 280_000,
          total: 5_080_000,
          currency_code: "THB",
        },
      ],
      totals: { material: 2_640_000, subcon: 2_160_000, labor: 280_000, grand: 5_080_000 },
      ratio: { material_pct: 52, subcon_pct: 43, labor_pct: 6 },
      currency_code: "THB",
    });
    expect(rep!.rows[0].subcon).toBe(2_160_000);
    expect(rep!.totals.grand).toBe(5_080_000);
    expect(rep!.ratio.materialPct).toBe(52);
  });

  it("honest-null ratio when grand = 0", () => {
    const rep = parseCostType({
      rows: [],
      totals: { material: 0, subcon: 0, labor: 0, grand: 0 },
      ratio: { material_pct: null, subcon_pct: null, labor_pct: null },
      currency_code: "THB",
    });
    expect(rep!.ratio.materialPct).toBeNull();
    expect(rep!.ratio.laborPct).toBeNull();
  });
});

describe("parseVariance (RPT-004)", () => {
  it("keeps null actual/variance/pct_dev for pending periods", () => {
    const rep = parseVariance({
      rows: [
        { period_label: "งวด 1", plan: 2_800_000, actual: 2_720_000, variance: -80_000, pct_dev: -2.9, status: "done" },
        { period_label: "งวด 5", plan: 2_700_000, actual: null, variance: null, pct_dev: null, status: "pending" },
      ],
      currency_code: "THB",
    });
    expect(rep!.rows[0].actual).toBe(2_720_000);
    expect(rep!.rows[0].variance).toBe(-80_000);
    expect(rep!.rows[1].actual).toBeNull();
    expect(rep!.rows[1].pctDev).toBeNull();
    expect(rep!.rows[1].status).toBe("pending");
    expect(parseVariance(undefined)).toBeNull();
  });
});

describe("parseEvm (RPT-005)", () => {
  it("maps the series + spi/cpi (null when unavailable)", () => {
    const rep = parseEvm({
      series: [
        { period_label: "2026-02", pv: 2_800_000, ev: 2_700_000, ac: 2_720_000 },
        { period_label: "2026-03", pv: 5_200_000, ev: 5_000_000, ac: 5_300_000 },
      ],
      spi: 0.96,
      cpi: 0.94,
      currency_code: "THB",
    });
    expect(rep!.series).toHaveLength(2);
    expect(rep!.series[1].ev).toBe(5_000_000);
    expect(rep!.spi).toBe(0.96);
    const empty = parseEvm({ series: [], spi: null, cpi: null, currency_code: "THB" });
    expect(empty!.series).toEqual([]);
    expect(empty!.spi).toBeNull();
  });
});

describe("formatters", () => {
  it("millions2 / millions1", () => {
    expect(millions2(4_840_000)).toBe("4.84");
    expect(millions2(0)).toBe("0.00");
    expect(millions2(Number.NaN)).toBe("0.00");
    expect(millions1(11_600_000)).toBe("11.6");
    expect(millions1(Number.POSITIVE_INFINITY)).toBe("0.0");
  });

  it("formatPct1", () => {
    expect(formatPct1(7.1)).toBe("7.1");
    expect(formatPct1(0)).toBe("0.0");
    expect(formatPct1(Number.NaN)).toBe("0.0");
  });
});

describe("threshold-colour rules", () => {
  it("pctOverBadge: >10 danger, >5 warn, else ok", () => {
    expect(pctOverBadge(11).fg).toBe("var(--danger)");
    expect(pctOverBadge(7).fg).toBe("var(--warn)");
    expect(pctOverBadge(5).fg).toBe("var(--ok)");
    expect(pctOverBadge(0).fg).toBe("var(--ok)");
  });

  it("varianceDevBadge: >5 danger, 0<pct<=5 warn, else ok", () => {
    expect(varianceDevBadge(6).fg).toBe("var(--danger)");
    expect(varianceDevBadge(5).fg).toBe("var(--warn)");
    expect(varianceDevBadge(0.1).fg).toBe("var(--warn)");
    expect(varianceDevBadge(0).fg).toBe("var(--ok)");
    expect(varianceDevBadge(-3).fg).toBe("var(--ok)");
  });

  it("varianceColor: over-plan danger, else ok", () => {
    expect(varianceColor(120)).toBe("var(--danger)");
    expect(varianceColor(-40)).toBe("var(--ok)");
    expect(varianceColor(0)).toBe("var(--ok)");
  });

  it("spiGood: >= 1", () => {
    expect(spiGood(1)).toBe(true);
    expect(spiGood(1.05)).toBe(true);
    expect(spiGood(0.94)).toBe(false);
  });
});

describe("variance status classification", () => {
  it("varianceStatusKey maps the known done/pending vocabulary", () => {
    expect(varianceStatusKey("done", true)).toBe("boq.repStatusDone");
    expect(varianceStatusKey("Completed", true)).toBe("boq.repStatusDone");
    expect(varianceStatusKey("pending", false)).toBe("boq.repStatusPending");
    expect(varianceStatusKey("planned", false)).toBe("boq.repStatusPending");
  });

  it("unknown non-empty code → null (view renders raw + flags)", () => {
    expect(varianceStatusKey("frozen", true)).toBeNull();
  });

  it("absent status → mirrors the actual-presence heuristic", () => {
    expect(varianceStatusKey(null, true)).toBe("boq.repStatusDone");
    expect(varianceStatusKey(null, false)).toBe("boq.repStatusPending");
    expect(varianceStatusKey("", false)).toBe("boq.repStatusPending");
  });

  it("classifyVarianceRow marks pending + passes the raw status through", () => {
    const done: VarianceRow = {
      periodLabel: "งวด 1",
      plan: 100,
      actual: 90,
      variance: -10,
      pctDev: -10,
      status: "done",
    };
    const pending: VarianceRow = {
      periodLabel: "งวด 5",
      plan: 100,
      actual: null,
      variance: null,
      pctDev: null,
      status: "pending",
    };
    const unknown: VarianceRow = {
      periodLabel: "งวด X",
      plan: 100,
      actual: 50,
      variance: -50,
      pctDev: -50,
      status: "frozen",
    };
    expect(classifyVarianceRow(done)).toEqual({
      pending: false,
      statusKey: "boq.repStatusDone",
      rawStatus: "done",
    });
    expect(classifyVarianceRow(pending).pending).toBe(true);
    expect(classifyVarianceRow(unknown)).toEqual({
      pending: false,
      statusKey: null,
      rawStatus: "frozen",
    });
  });
});

describe("buildBoqBars (RPT-001 stacked bars)", () => {
  it("drops zero-value rows, scales widths to the largest row, empty → []", () => {
    const bars = buildBoqBars([
      { groupId: "g1", categoryLabel: "A", boq: 4_000_000, nonBoq: 0, totalActual: 4_000_000, pctOver: 0 },
      { groupId: "g2", categoryLabel: "B", boq: 2_000_000, nonBoq: 0, totalActual: 2_000_000, pctOver: 0 },
      // synthetic unattributed row (0/0) — dropped from the chart.
      { groupId: null, categoryLabel: null, boq: 0, nonBoq: 0, totalActual: 0, pctOver: null },
    ]);
    expect(bars).toHaveLength(2);
    expect(bars[0].boqPct).toBe(100); // 4M is the max → full track
    expect(bars[1].boqPct).toBe(50); // 2M / 4M
    expect(bars[0].nonPct).toBe(0);
    expect(buildBoqBars([])).toEqual([]);
  });

  it("splits a stacked BOQ + Non-BOQ bar proportionally", () => {
    const bars = buildBoqBars([
      { groupId: "g1", categoryLabel: "A", boq: 3_000_000, nonBoq: 1_000_000, totalActual: 4_000_000, pctOver: 33 },
    ]);
    expect(bars[0].boqPct).toBe(75); // 3M / 4M
    expect(bars[0].nonPct).toBe(25); // 1M / 4M
  });
});

describe("buildMslBar (RPT-003 M/S/L bar)", () => {
  const report: CostTypeReport = {
    rows: [],
    totals: { material: 5_000_000, subcon: 4_000_000, labor: 1_000_000, grand: 10_000_000 },
    ratio: { materialPct: 50, subconPct: 40, laborPct: 10 },
    currencyCode: "THB",
  };

  it("widths from totals, labels from ratio", () => {
    const bar = buildMslBar(report);
    expect(bar.hasData).toBe(true);
    expect(bar.material.widthPct).toBe(50);
    expect(bar.subcon.widthPct).toBe(40);
    expect(bar.labor.widthPct).toBe(10);
    expect(bar.material.labelPct).toBe(50);
  });

  it("grand = 0 → hasData false, zero widths, null labels", () => {
    const empty = buildMslBar({
      rows: [],
      totals: { material: 0, subcon: 0, labor: 0, grand: 0 },
      ratio: { materialPct: null, subconPct: null, laborPct: null },
      currencyCode: "THB",
    });
    expect(empty.hasData).toBe(false);
    expect(empty.material.widthPct).toBe(0);
    expect(empty.material.labelPct).toBeNull();
  });
});

describe("buildEvmChart (RPT-005 S-curve geometry)", () => {
  const series: EvmPoint[] = [
    { periodLabel: "2026-02", pv: 2_800_000, ev: 2_700_000, ac: 2_720_000 },
    { periodLabel: "2026-06", pv: 12_400_000, ev: 11_600_000, ac: 12_300_000 },
  ];

  it("evmMaxMillions = ceil(max M฿), min 1", () => {
    expect(evmMaxMillions(series)).toBe(13); // max 12.4M → 13
    expect(evmMaxMillions([])).toBe(1);
  });

  it("maps points, paths and EV markers; endpoints hit the pad box", () => {
    const geom = buildEvmChart(series, { width: 560, height: 200, pad: 34 });
    expect(geom).not.toBeNull();
    expect(geom!.maxV).toBe(13);
    // first x = pad, last x = width - pad (n-1 span).
    expect(geom!.xLabels[0].x).toBeCloseTo(34, 5);
    expect(geom!.xLabels[1].x).toBeCloseTo(560 - 34, 5);
    expect(geom!.evPoints).toHaveLength(2);
    // 5 gridlines, top label = maxV, bottom = 0.
    expect(geom!.gridLines).toHaveLength(5);
    expect(geom!.gridLines[0].label).toBe("13");
    expect(geom!.gridLines[4].label).toBe("0");
    // paths start with a moveto command.
    expect(geom!.evPath.startsWith("M")).toBe(true);
    expect(geom!.pvPath).toContain("L");
  });

  it("returns null for fewer than 2 points (keeps the EmptyBody shell)", () => {
    expect(buildEvmChart([])).toBeNull();
    expect(buildEvmChart([series[0]])).toBeNull();
  });
});

describe("DASH constant", () => {
  it("is the em-dash marker", () => {
    expect(DASH).toBe("—");
  });
});
