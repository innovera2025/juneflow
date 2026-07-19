/*
 * Unit tests for exec-agg.ts (group-C Wave-2b, gate G3) — the pure logic behind the
 * Executive Dashboard screen: the opaque-Entity readers, the GET /analytics/portfolio
 * parser (incl. honest-null health/sold gaps), the millions money formatter, the
 * health-tone map (incl. null), the over-spend colouring rule, the actual-of-budget +
 * distinct-type KPI derivations, and the bar-fill (type-mix) math.
 *
 * The stored health labels are compared against raw Thai here (test files are exempt
 * from the i18n-guard) to prove healthTone matches the byte-exact \u constants in
 * exec-agg.ts.
 */
import { describe, it, expect } from "vitest";
import {
  entNum,
  entNumOrNull,
  entStr,
  entArr,
  parsePortfolio,
  fmtMillions,
  healthTone,
  overSpend,
  actualPctOfBudget,
  distinctTypeCount,
  barPct,
  type Ent,
} from "./exec-agg";

const GOOD = "ดี";
const WATCH = "เฝ้าระวัง";

/** A representative GET /analytics/portfolio body (opaque Entity). */
const RESP: Ent = {
  totals: {
    budget_total: 428_000_000,
    actual_total: 303_000_000,
    avg_progress: 42,
    at_risk_count: 1,
    currency_code: "THB",
  },
  projects: [
    { project_id: "p1", name: "Alpha", type_key: "realestate", budget: 248_000_000, actual: 162_000_000, progress_pct: 64, health: GOOD, sold_pct: 65 },
    { project_id: "p2", name: "Beta", type_key: "solar", budget: 84_000_000, actual: 80_000_000, progress_pct: 9, health: WATCH, sold_pct: null },
    { project_id: "p3", name: "Gamma", type_key: "realestate", budget: 96_000_000, actual: 61_000_000, progress_pct: 52, health: null, sold_pct: null },
  ],
  type_mix: [
    { type_key: "realestate", budget_sum: 344_000_000 },
    { type_key: "solar", budget_sum: 84_000_000 },
  ],
};

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

  it("entArr returns the array or []", () => {
    expect(entArr({ a: [{ x: 1 }] }, "a")).toEqual([{ x: 1 }]);
    expect(entArr({ a: "nope" }, "a")).toEqual([]);
    expect(entArr(undefined, "a")).toEqual([]);
  });
});

describe("parsePortfolio", () => {
  it("returns null for a missing body", () => {
    expect(parsePortfolio(undefined)).toBeNull();
  });

  it("maps totals / projects / type_mix from the stubbed response", () => {
    const pf = parsePortfolio(RESP)!;
    expect(pf.totals).toEqual({
      budgetTotal: 428_000_000,
      actualTotal: 303_000_000,
      avgProgress: 42,
      atRiskCount: 1,
      currencyCode: "THB",
    });
    expect(pf.projects).toHaveLength(3);
    expect(pf.projects[0]).toEqual({
      projectId: "p1",
      name: "Alpha",
      typeKey: "realestate",
      budget: 248_000_000,
      actual: 162_000_000,
      progressPct: 64,
      health: GOOD,
      soldPct: 65,
    });
    // Honest-null wire gaps preserved (health uncurated, no sales units).
    expect(pf.projects[2].health).toBeNull();
    expect(pf.projects[2].soldPct).toBeNull();
    expect(pf.projects[1].soldPct).toBeNull();
    expect(pf.typeMix).toEqual([
      { typeKey: "realestate", budgetSum: 344_000_000 },
      { typeKey: "solar", budgetSum: 84_000_000 },
    ]);
  });

  it("defaults totals to zeros when the totals object is absent", () => {
    const pf = parsePortfolio({ projects: [], type_mix: [] })!;
    expect(pf.totals).toEqual({
      budgetTotal: 0,
      actualTotal: 0,
      avgProgress: 0,
      atRiskCount: 0,
      currencyCode: null,
    });
    expect(pf.projects).toEqual([]);
    expect(pf.typeMix).toEqual([]);
  });
});

describe("fmtMillions", () => {
  it("scales THB by 1e6 and rounds to a whole millions figure", () => {
    expect(fmtMillions(248_000_000)).toBe("248");
    expect(fmtMillions(248_600_000)).toBe("249"); // rounds
    expect(fmtMillions(248_400_000)).toBe("248");
    expect(fmtMillions(0)).toBe("0");
  });

  it("groups thousands (separator-agnostic) and guards non-finite", () => {
    expect(fmtMillions(1_290_000_000).replace(/[^0-9]/g, "")).toBe("1290");
    expect(fmtMillions(Number.NaN)).toBe("0");
    expect(fmtMillions(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("healthTone", () => {
  it("maps the stored good / watch labels, else danger", () => {
    expect(healthTone(GOOD)).toBe("var(--ok)");
    expect(healthTone(WATCH)).toBe("var(--warn)");
    expect(healthTone("something-else")).toBe("var(--danger)");
  });

  it("treats a null (uncurated) health as neutral, not a value", () => {
    expect(healthTone(null)).toBe("var(--text-3)");
  });
});

describe("overSpend (exec-audit.jsx:89 actual > budget * 0.9)", () => {
  it("is strict: exactly 90% of budget is not over", () => {
    expect(overSpend(90, 100)).toBe(false);
    expect(overSpend(91, 100)).toBe(true);
    expect(overSpend(80, 100)).toBe(false);
    expect(overSpend(100, 100)).toBe(true);
  });
});

describe("actualPctOfBudget", () => {
  it("is the whole-percent actual/budget ratio (0-guarded)", () => {
    expect(actualPctOfBudget(60, 100)).toBe(60);
    expect(actualPctOfBudget(1, 3)).toBe(33);
    expect(actualPctOfBudget(303_000_000, 428_000_000)).toBe(71);
    expect(actualPctOfBudget(5, 0)).toBe(0);
    expect(actualPctOfBudget(Number.NaN, 100)).toBe(0);
  });
});

describe("distinctTypeCount", () => {
  it("counts distinct non-null type keys", () => {
    const pf = parsePortfolio(RESP)!;
    expect(distinctTypeCount(pf.projects)).toBe(2); // realestate + solar
  });

  it("ignores null type keys and dedupes", () => {
    const pf = parsePortfolio({
      totals: {},
      projects: [
        { project_id: "a", type_key: "civil" },
        { project_id: "b", type_key: "civil" },
        { project_id: "c", type_key: null },
      ],
      type_mix: [],
    })!;
    expect(distinctTypeCount(pf.projects)).toBe(1);
  });
});

describe("barPct (type-mix bar math)", () => {
  it("is value/max*100, clamped to [0,100], 0 on non-positive max", () => {
    expect(barPct(50, 100)).toBe(50);
    expect(barPct(150, 100)).toBe(100); // clamped
    expect(barPct(1, 4)).toBe(25);
    expect(barPct(5, 0)).toBe(0);
    // a type's budget share of the portfolio total.
    expect(barPct(84_000_000, 428_000_000)).toBeCloseTo(19.63, 1);
  });
});
