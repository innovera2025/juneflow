/*
 * fa-depr-rows unit tests (fa.depr, gate G3) — the pure depreciation logic ported from fa.jsx
 * FADepreciation + DeprRunForm (toFaAsset narrowing / SERVER straight-line (cost-salvage)/life/12
 * / depreciable eligibility / KPI + run totals / period key / run-result narrowing). Guards the
 * salvage-aware formula (the prototype's cost/(life*12) MOCK is NOT used) and the honest gaps
 * against regression. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toFaAsset,
  round2,
  depreciableBase,
  monthlyStraightLine,
  isDepreciable,
  depreciableAssets,
  toDeprRow,
  sumMonthly,
  eligibleCount,
  currentCePeriod,
  formatMoney,
  summarizeRunResult,
  type FaAsset,
} from "./fa-depr-rows";

const asset = (p: Partial<FaAsset> = {}): FaAsset => ({
  id: "a1",
  name: "Mixer",
  cost: 180000,
  currencyCode: "THB",
  lifeYears: 5,
  ccId: "cc1",
  deprMethod: "straight",
  salvage: 18000,
  acquiredDate: "2026-01-20",
  accumulatedDepr: 0,
  status: "active",
  bookValue: 180000,
  ...p,
});

describe("toFaAsset", () => {
  it("narrows a full opaque /fa/assets row (snake_case) and keeps the server book_value", () => {
    expect(
      toFaAsset({
        id: "fa1",
        name: "Building",
        cost: 8400000,
        currency_code: "THB",
        life_years: 20,
        cc_id: "cc-oh",
        depr_method: "straight",
        salvage: 840000,
        acquired_date: "2026-03-15",
        accumulated_depr: 1120000,
        status: "active",
        book_value: 7280000,
      }),
    ).toEqual({
      id: "fa1",
      name: "Building",
      cost: 8400000,
      currencyCode: "THB",
      lifeYears: 20,
      ccId: "cc-oh",
      deprMethod: "straight",
      salvage: 840000,
      acquiredDate: "2026-03-15",
      accumulatedDepr: 1120000,
      status: "active",
      bookValue: 7280000,
    });
  });

  it("derives book_value = cost - accumulated when the wire omits it", () => {
    const a = toFaAsset({ id: "x", name: "n", cost: 100000, accumulated_depr: 30000, life_years: 5 });
    expect(a.bookValue).toBe(70000);
  });

  it("coerces numeric strings and defaults status to active", () => {
    const a = toFaAsset({ id: "x", name: "n", cost: "180000.00", salvage: "18000.00", life_years: "5" });
    expect(a.cost).toBe(180000);
    expect(a.salvage).toBe(18000);
    expect(a.lifeYears).toBe(5);
    expect(a.status).toBe("active");
  });
});

describe("straight-line depreciation (SERVER formula, salvage subtracted)", () => {
  it("monthly = (cost - salvage) / life / 12 — NOT the prototype cost/(life*12) mock", () => {
    // (180000 - 18000) / 5 / 12 = 2700  (the mock cost/(life*12) = 3000 is wrong).
    expect(monthlyStraightLine(180000, 18000, 5)).toBe(2700);
  });

  it("depreciableBase never goes negative", () => {
    expect(depreciableBase(100, 250)).toBe(0);
    expect(depreciableBase(250, 100)).toBe(150);
  });

  it("returns 0 for a non-depreciable asset (life<=0, base<=0, or fully depreciated)", () => {
    expect(monthlyStraightLine(180000, 18000, 0)).toBe(0);
    expect(monthlyStraightLine(60000000, 60000000, 20)).toBe(0);
    // base 162000, already accumulated 162000 -> nothing remains.
    expect(monthlyStraightLine(180000, 18000, 5, 162000)).toBe(0);
  });

  it("caps the final month to the remaining depreciable amount (book-value floor)", () => {
    // base 162000, accumulated 161000 -> remaining 1000 < normal monthly 2700 -> capped to 1000.
    expect(monthlyStraightLine(180000, 18000, 5, 161000)).toBe(1000);
  });
});

describe("depreciable eligibility (mirrors fa.ts runDepreciation)", () => {
  it("active + life>0 + cost>salvage + not fully depreciated", () => {
    expect(isDepreciable(asset())).toBe(true);
    expect(isDepreciable(asset({ status: "written_off" }))).toBe(false);
    expect(isDepreciable(asset({ lifeYears: 0 }))).toBe(false); // land / no-depreciation
    expect(isDepreciable(asset({ cost: 60000000, salvage: 60000000 }))).toBe(false);
    expect(isDepreciable(asset({ accumulatedDepr: 162000 }))).toBe(false); // fully depreciated
  });

  it("depreciableAssets keeps only the eligible rows, in order", () => {
    const list = [asset({ id: "a" }), asset({ id: "b", status: "written_off" }), asset({ id: "c", lifeYears: 0 })];
    expect(depreciableAssets(list).map((a) => a.id)).toEqual(["a"]);
  });
});

describe("depr-table row + totals", () => {
  it("toDeprRow projects real book, monthly, and the remainder", () => {
    const r = toDeprRow(asset({ bookValue: 130000 }));
    expect(r.monthly).toBe(2700);
    expect(r.book).toBe(130000);
    expect(r.remain).toBe(127300);
  });

  it("sumMonthly + eligibleCount aggregate only the depreciable assets", () => {
    const list = [
      asset({ id: "a" }), // 2700
      asset({ id: "b", cost: 84000, salvage: 8400, lifeYears: 3 }), // (75600)/3/12 = 2100
      asset({ id: "c", lifeYears: 0 }), // excluded (land)
    ];
    expect(sumMonthly(list)).toBe(4800);
    expect(eligibleCount(list)).toBe(2);
  });

  it("sumMonthly is 0 for an all-land / empty portfolio (honest empty)", () => {
    expect(sumMonthly([])).toBe(0);
    expect(sumMonthly([asset({ lifeYears: 0 })])).toBe(0);
  });
});

describe("currentCePeriod", () => {
  it("formats a CE 'YYYY-MM' key (UTC), zero-padded", () => {
    expect(currentCePeriod(new Date("2026-07-09T00:00:00Z"))).toBe("2026-07");
    expect(currentCePeriod(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });
});

describe("summarizeRunResult", () => {
  it("narrows the opaque run response to posted count/total + skipped count", () => {
    const res = {
      period: "2026-07",
      posted: [
        { asset_id: "a", amount: 2700, jv_no: "JV-1" },
        { asset_id: "b", amount: 2100, jv_no: "JV-2" },
      ],
      skipped: [{ asset_id: "c", reason: "land" }],
      currency_code: "THB",
    };
    expect(summarizeRunResult(res)).toEqual({ postedCount: 2, postedTotal: 4800, skippedCount: 1 });
  });

  it("is defensive against a missing / non-object response (honest zero)", () => {
    expect(summarizeRunResult(null)).toEqual({ postedCount: 0, postedTotal: 0, skippedCount: 0 });
    expect(summarizeRunResult({})).toEqual({ postedCount: 0, postedTotal: 0, skippedCount: 0 });
  });
});

describe("formatMoney + round2", () => {
  it("groups thousands with no decimals or baht symbol", () => {
    expect(formatMoney(184760)).toBe("184,760");
    expect(formatMoney(-128000)).toBe("-128,000");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(Number.NaN)).toBe("0");
  });

  it("round2 avoids fp drift", () => {
    expect(round2(2700.005)).toBe(2700.01);
    expect(round2(162000 / 5 / 12)).toBe(2700);
  });
});
