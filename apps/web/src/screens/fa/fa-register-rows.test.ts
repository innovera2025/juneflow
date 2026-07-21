/*
 * fa-register-rows unit tests (fa.register, gate G3) — the pure register logic ported from
 * fa.jsx FARegister + AssetDetail (toAssetRow / deriveStatus / tab filter+count / status count /
 * cost/accum/book sums / money+millions format / status tone / search / straight-line schedule).
 * Guards the opaque-row narrowing, the honest-empty category tabs (no wire category), the
 * server-derived book_value fallback, and the derived schedule against regression. ASCII-only.
 */
import { describe, it, expect } from "vitest";
import {
  toAssetRow,
  deriveStatus,
  filterByTab,
  tabCount,
  countByStatus,
  sumCost,
  sumAccum,
  sumBook,
  formatMoney,
  formatMillions,
  statusTone,
  applySearch,
  isNoDepr,
  buildSchedule,
  type AssetRow,
} from "./fa-register-rows";

/** A minimal opaque wire row (migration-0035 superset shape). */
const wireActive: Record<string, unknown> = {
  id: "a1",
  name: "Concrete Mixer 350L",
  cost: 180000,
  currency_code: "THB",
  life_years: 5,
  cc_id: "cc-1",
  depr_method: "straight",
  salvage: 18000,
  acquired_date: "2024-01-20",
  accumulated_depr: 50000,
  status: "active",
  book_value: 130000,
};

const wireWriteoff: Record<string, unknown> = {
  id: "a2",
  name: "Old Hino Truck",
  cost: 1840000,
  currency_code: "THB",
  life_years: 5,
  cc_id: null,
  depr_method: "straight",
  salvage: 184000,
  acquired_date: "2021-02-05",
  accumulated_depr: 1652000,
  status: "written_off",
  book_value: 188000,
};

describe("toAssetRow", () => {
  it("narrows a full opaque wire row to the AssetRow shape", () => {
    const r = toAssetRow(wireActive);
    expect(r).toMatchObject({
      id: "a1",
      name: "Concrete Mixer 350L",
      cost: 180000,
      currencyCode: "THB",
      lifeYears: 5,
      ccId: "cc-1",
      deprMethod: "straight",
      salvage: 18000,
      acquiredDate: "2024-01-20",
      accumulatedDepr: 50000,
      bookValue: 130000,
      rawStatus: "active",
      status: "active",
    });
  });

  it("maps a non-active raw status to the writeoff derived status", () => {
    expect(toAssetRow(wireWriteoff).status).toBe("writeoff");
    expect(toAssetRow(wireWriteoff).rawStatus).toBe("written_off");
  });

  it("defaults missing/null fields honestly (no wire code/category/location)", () => {
    const r = toAssetRow({ id: "x", name: "Bare" });
    expect(r.cost).toBe(0);
    expect(r.currencyCode).toBe("THB");
    expect(r.lifeYears).toBeNull();
    expect(r.ccId).toBe("");
    expect(r.deprMethod).toBe("");
    expect(r.acquiredDate).toBe("");
    expect(r.status).toBe("active");
  });

  it("derives book_value from cost - accumulated_depr when the wire omits it", () => {
    const r = toAssetRow({ id: "y", name: "N", cost: 100, accumulated_depr: 30 });
    expect(r.bookValue).toBe(70);
  });

  it("reads numeric strings (drizzle numeric columns arrive as strings)", () => {
    const r = toAssetRow({ id: "z", name: "S", cost: "180000.00", accumulated_depr: "50000.00" });
    expect(r.cost).toBe(180000);
    expect(r.accumulatedDepr).toBe(50000);
  });
});

describe("deriveStatus", () => {
  it("is active only for the exact 'active' status", () => {
    expect(deriveStatus("active")).toBe("active");
    expect(deriveStatus("written_off")).toBe("writeoff");
    expect(deriveStatus("disposed")).toBe("writeoff");
    expect(deriveStatus("")).toBe("writeoff");
  });
});

describe("filterByTab / tabCount", () => {
  const rows: AssetRow[] = [toAssetRow(wireActive), toAssetRow(wireWriteoff)];

  it("all -> every row", () => {
    expect(filterByTab(rows, "all")).toHaveLength(2);
  });

  it("active/writeoff -> the matching derived status", () => {
    expect(filterByTab(rows, "active").map((r) => r.id)).toEqual(["a1"]);
    expect(filterByTab(rows, "writeoff").map((r) => r.id)).toEqual(["a2"]);
  });

  it("category tabs are honest-empty (no wire category column)", () => {
    expect(filterByTab(rows, "land")).toEqual([]);
    expect(filterByTab(rows, "veh")).toEqual([]);
    expect(filterByTab(rows, "mach")).toEqual([]);
    expect(tabCount(rows, "land")).toBe(0);
    expect(tabCount(rows, "veh")).toBe(0);
    expect(tabCount(rows, "mach")).toBe(0);
  });

  it("tabCount matches the filtered length", () => {
    expect(tabCount(rows, "all")).toBe(2);
    expect(tabCount(rows, "active")).toBe(1);
    expect(tabCount(rows, "writeoff")).toBe(1);
  });
});

describe("countByStatus + sums", () => {
  const rows: AssetRow[] = [toAssetRow(wireActive), toAssetRow(wireWriteoff)];

  it("counts by derived status", () => {
    expect(countByStatus(rows, "active")).toBe(1);
    expect(countByStatus(rows, "writeoff")).toBe(1);
  });

  it("sums cost / accumulated depreciation / book value", () => {
    expect(sumCost(rows)).toBe(180000 + 1840000);
    expect(sumAccum(rows)).toBe(50000 + 1652000);
    expect(sumBook(rows)).toBe(130000 + 188000);
  });

  it("empty register sums to 0", () => {
    expect(sumCost([])).toBe(0);
    expect(sumAccum([])).toBe(0);
    expect(sumBook([])).toBe(0);
  });
});

describe("formatMoney / formatMillions", () => {
  it("groups thousands with no decimals", () => {
    expect(formatMoney(1000000)).toBe("1,000,000");
    expect(formatMoney(180000)).toBe("180,000");
    expect(formatMoney(0)).toBe("0");
  });

  it("formats a negative amount honestly", () => {
    expect(formatMoney(-128000)).toBe("-128,000");
  });

  it("renders millions with one decimal", () => {
    expect(formatMillions(78400000)).toBe("78.4");
    expect(formatMillions(36200000)).toBe("36.2");
    expect(formatMillions(0)).toBe("0.0");
  });
});

describe("statusTone", () => {
  it("uses the ok tone for active, the danger tone for writeoff", () => {
    expect(statusTone("active")).toMatchObject({ fg: "var(--ok)", labelKey: "fa.statusActive" });
    expect(statusTone("writeoff")).toMatchObject({
      fg: "var(--danger)",
      labelKey: "fa.statusWriteoff",
    });
  });
});

describe("applySearch", () => {
  const rows: AssetRow[] = [toAssetRow(wireActive), toAssetRow(wireWriteoff)];

  it("returns every row for a blank query", () => {
    expect(applySearch(rows, "   ")).toHaveLength(2);
  });

  it("matches the asset name case-insensitively", () => {
    expect(applySearch(rows, "hino").map((r) => r.id)).toEqual(["a2"]);
    expect(applySearch(rows, "MIXER").map((r) => r.id)).toEqual(["a1"]);
  });

  it("returns nothing when no name matches", () => {
    expect(applySearch(rows, "zzz")).toEqual([]);
  });
});

describe("isNoDepr / buildSchedule", () => {
  it("flags a non-depreciable asset (no positive life)", () => {
    expect(isNoDepr({ lifeYears: null })).toBe(true);
    expect(isNoDepr({ lifeYears: 0 })).toBe(true);
    expect(isNoDepr({ lifeYears: 5 })).toBe(false);
  });

  it("returns an empty schedule for a non-depreciable asset", () => {
    expect(buildSchedule(toAssetRow({ id: "l", name: "Land", cost: 100, life_years: 0 }))).toEqual([]);
  });

  it("builds a straight-line schedule flooring cumulative at the depreciable base", () => {
    const sched = buildSchedule(toAssetRow(wireActive));
    expect(sched).toHaveLength(5);
    // yearly = round((180000 - 18000) / 5) = 32400
    expect(sched[0]).toMatchObject({ year: 1, annual: 32400, cumulative: 32400, book: 147600 });
    // final year cumulative floors at base (162000), not 5 * 32400 = 162000 here (exact)
    expect(sched[4].cumulative).toBe(162000);
    expect(sched[4].book).toBe(18000);
  });

  it("approximates posted years from accumulated_depr / yearly", () => {
    // accumulated_depr 50000 / yearly 32400 ~= 1.5 -> round -> 2 posted years
    const sched = buildSchedule(toAssetRow(wireActive));
    expect(sched.filter((s) => s.posted)).toHaveLength(2);
  });
});
