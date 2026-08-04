/*
 * gl-projectpl-rows unit tests (gate G3) — the pure per-project P&L logic ported from
 * accounting-extra2.jsx GLProjectPL (toProjectPlRow / toProjectPlTotals / toProjectPl + pickBest /
 * losingNames / sgaInterest + formatMoney / formatParen / formatMillions / formatMargin /
 * marginBarPct). Guards the opaque EntityOk narrowing, the server-authoritative figure passthrough
 * (nothing recomputed), HONEST-NULL margins at 0 revenue, the central (null-project) bucket, the
 * best-margin SELECTION, the losing-name list, and the sign / parentheses / millions / margin /
 * bar-scale formatting against regression. ASCII-only (B-073).
 *
 * The wire figures mirror apps/api/src/routes/gl.test.ts "computes a per-project P&L …": revenue
 * 1,000,000 · cogs 600,000 · gross_profit 400,000 · sga 100,000 · interest 50,000 · pre_tax 250,000
 * · tax 50,000 · net_income 200,000 · gross_margin 40 · net_margin 20 (percents, server).
 */
import { describe, it, expect } from "vitest";
import {
  toProjectPlRow,
  toProjectPlTotals,
  toProjectPl,
  pickBest,
  losingNames,
  sgaInterest,
  formatMoney,
  formatParen,
  formatMillions,
  formatMargin,
  marginBarPct,
} from "./gl-projectpl-rows";

const DASH = "—";

/** A representative two-project payload: proj-a is profitable, proj-b is a 0-revenue loss (honest
 *  null margins), plus a central (null-project) bucket — mirrors the backend's real shape. */
function samplePayload() {
  return {
    projects: [
      {
        project_id: "proj-a",
        project_name: "Project A",
        revenue: 1_000_000,
        cogs: 600_000,
        gross_profit: 400_000,
        sga: 100_000,
        interest: 50_000,
        pre_tax: 250_000,
        tax: 50_000,
        net_income: 200_000,
        gross_margin: 40,
        net_margin: 20,
      },
      {
        project_id: "proj-b",
        project_name: "Project B",
        revenue: 0,
        cogs: 300_000,
        gross_profit: -300_000,
        sga: 0,
        interest: 0,
        pre_tax: -300_000,
        tax: 0,
        net_income: -300_000,
        gross_margin: null,
        net_margin: null,
      },
      {
        project_id: null,
        project_name: null,
        revenue: 200_000,
        cogs: 50_000,
        gross_profit: 150_000,
        sga: 20_000,
        interest: 0,
        pre_tax: 130_000,
        tax: 26_000,
        net_income: 104_000,
        gross_margin: 75,
        net_margin: 52,
      },
    ],
    totals: {
      revenue: 1_200_000,
      cogs: 950_000,
      gross_profit: 250_000,
      sga: 120_000,
      interest: 50_000,
      net_income: 4_000,
      net_margin: 0.33,
      project_count: 3,
      losing_count: 1,
    },
    currency_code: "THB",
  };
}

describe("toProjectPlRow", () => {
  it("reads every server figure straight off the wire (nothing recomputed)", () => {
    const r = toProjectPlRow(samplePayload().projects[0]);
    expect(r).toEqual({
      projectId: "proj-a",
      projectName: "Project A",
      revenue: 1_000_000,
      cogs: 600_000,
      grossProfit: 400_000,
      sga: 100_000,
      interest: 50_000,
      preTax: 250_000,
      tax: 50_000,
      netIncome: 200_000,
      grossMargin: 40,
      netMargin: 20,
    });
  });

  it("keeps HONEST-NULL margins (0-revenue project) — never coerced to 0", () => {
    const r = toProjectPlRow(samplePayload().projects[1]);
    expect(r.revenue).toBe(0);
    expect(r.netIncome).toBe(-300_000);
    expect(r.grossMargin).toBeNull();
    expect(r.netMargin).toBeNull();
  });

  it("maps a null project_id to the central bucket (id null, name '')", () => {
    const r = toProjectPlRow(samplePayload().projects[2]);
    expect(r.projectId).toBeNull();
    expect(r.projectName).toBe("");
    expect(r.netIncome).toBe(104_000);
  });
});

describe("toProjectPlTotals", () => {
  it("passes the wire totals through (net_margin honest-null-capable)", () => {
    const t = toProjectPlTotals(samplePayload().totals);
    expect(t.revenue).toBe(1_200_000);
    expect(t.netIncome).toBe(4_000);
    expect(t.netMargin).toBe(0.33);
    expect(t.projectCount).toBe(3);
    expect(t.losingCount).toBe(1);
  });

  it("null net_margin (0 total revenue) stays null", () => {
    const t = toProjectPlTotals({ revenue: 0, net_margin: null });
    expect(t.netMargin).toBeNull();
    expect(t.revenue).toBe(0);
  });
});

describe("toProjectPl", () => {
  it("narrows the opaque EntityOk object end to end", () => {
    const vm = toProjectPl(samplePayload());
    expect(vm.rows).toHaveLength(3);
    expect(vm.totals.projectCount).toBe(3);
    expect(vm.currencyCode).toBe("THB");
  });

  it("an empty / missing payload yields no rows, zero totals, THB default (nothing fabricated)", () => {
    const vm = toProjectPl(undefined);
    expect(vm.rows).toEqual([]);
    expect(vm.totals.revenue).toBe(0);
    expect(vm.totals.projectCount).toBe(0);
    expect(vm.currencyCode).toBe("THB");
  });
});

describe("pickBest (SELECTION over server margins, never a computation)", () => {
  it("selects the highest server net_margin row, skipping null-margin rows", () => {
    const vm = toProjectPl(samplePayload());
    const best = pickBest(vm.rows);
    expect(best?.projectId).toBeNull(); // central bucket, net_margin 52 (highest)
    expect(best?.netMargin).toBe(52);
  });

  it("returns null when there are no eligible (non-null-margin) rows", () => {
    expect(pickBest([])).toBeNull();
    const allNull = toProjectPl({ projects: [samplePayload().projects[1]] }).rows;
    expect(pickBest(allNull)).toBeNull();
  });
});

describe("losingNames", () => {
  it("lists the names of the net_income < 0 projects", () => {
    const vm = toProjectPl(samplePayload());
    expect(losingNames(vm.rows)).toEqual(["Project B"]);
  });

  it("falls back to an em-dash for a losing central (nameless) bucket", () => {
    const rows = toProjectPl({
      projects: [{ project_id: null, project_name: null, net_income: -5 }],
    }).rows;
    expect(losingNames(rows)).toEqual([DASH]);
  });
});

describe("sgaInterest (display GROUPING of two server cost fields, not a P&L result)", () => {
  it("sums sga + interest", () => {
    expect(sgaInterest({ sga: 100_000, interest: 50_000 })).toBe(150_000);
    expect(sgaInterest({ sga: 120_000, interest: 50_000 })).toBe(170_000);
  });
});

describe("formatMoney / formatParen / formatMillions", () => {
  it("groups full baht with thousands separators, no decimals/symbol", () => {
    expect(formatMoney(1_000_000)).toBe("1,000,000");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(-600_000)).toBe("-600,000");
    expect(formatMoney(Number.NaN)).toBe("0");
  });

  it("wraps negatives in parentheses (accounting style)", () => {
    expect(formatParen(200_000)).toBe("200,000");
    expect(formatParen(-300_000)).toBe("(300,000)");
    expect(formatParen(0)).toBe("0");
  });

  it("display-scales to millions at 1dp", () => {
    expect(formatMillions(1_200_000)).toBe("1.2");
    expect(formatMillions(4_000)).toBe("0.0");
  });
});

describe("formatMargin / marginBarPct (honest-null aware)", () => {
  it("formats a server percent to 1dp + '%'", () => {
    expect(formatMargin(40)).toBe("40.0%");
    expect(formatMargin(0.33)).toBe("0.3%");
  });

  it("shows an em-dash for an HONEST-NULL margin (never a fabricated 0.0%)", () => {
    expect(formatMargin(null)).toBe(DASH);
  });

  it("scales the GP-margin bar to the fixed max=50% scale, clamped [0,100]", () => {
    expect(marginBarPct(25)).toBe(50); // 25/50 -> 50%
    expect(marginBarPct(40)).toBe(80);
    expect(marginBarPct(80)).toBe(100); // clamped
    expect(marginBarPct(-10)).toBe(0); // negative clamped to 0
    expect(marginBarPct(null)).toBe(0); // honest-null -> no bar
  });
});
