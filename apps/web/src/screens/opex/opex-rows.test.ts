/*
 * opex-rows unit tests (opex web port, gate G3) — the pure OpexBudget display + create
 * logic narrowed from opex-budget.jsx / the live /opex/budgets wire. Guards the opaque-row
 * narrowing, the 12-month annual roll-up + the cross-dept total, the max-month bar scale,
 * the deterministic sort / latest-year, and the money=SERVER create-body build (which must
 * NEVER emit currency_code — the server owns THB). The un-backed prototype columns (used /
 * committed / remaining / %used) carry no logic here (they are literal em-dash in the
 * screen), so there is nothing to test for them.
 */
import { describe, it, expect } from "vitest";
import {
  MONTHS_IN_YEAR,
  toOpexRow,
  annualTotal,
  totalBudget,
  deptCount,
  maxMonth,
  latestYear,
  sortRows,
  formatMoney,
  emptyOpexDraft,
  draftSubmittable,
  buildOpexBody,
  type OpexRow,
} from "./opex-rows";

const row = (over: Partial<OpexRow> = {}): OpexRow => ({
  id: "b1",
  dept: "ADMIN",
  year: 2569,
  months: Array.from({ length: 12 }, () => 1_000_000),
  currencyCode: "THB",
  ...over,
});

describe("toOpexRow", () => {
  it("narrows the opaque wire row and coerces months to numbers", () => {
    const r = toOpexRow({
      id: "x",
      dept: "IT",
      year: 2569,
      months: [100, "200", null, 300],
      currency_code: "THB",
    });
    expect(r).toEqual({
      id: "x",
      dept: "IT",
      year: 2569,
      months: [100, 200, 0, 300],
      currencyCode: "THB",
    });
  });

  it("defaults a missing months array to empty and currency to THB", () => {
    const r = toOpexRow({ id: "y", dept: "HR", year: 2570 });
    expect(r.months).toEqual([]);
    expect(r.currencyCode).toBe("THB");
  });
});

describe("annualTotal (the 12-month roll-up)", () => {
  it("sums the whole year from the monthly figures", () => {
    expect(annualTotal([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe(78);
  });

  it("treats a non-finite month as 0", () => {
    expect(annualTotal([10, Number.NaN, 20, Number.POSITIVE_INFINITY])).toBe(30);
  });

  it("is 0 for an empty budget (never fabricated)", () => {
    expect(annualTotal([])).toBe(0);
  });
});

describe("totalBudget / deptCount", () => {
  it("sums annualTotal across every dept row", () => {
    const rows = [
      row({ months: [1_000_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }),
      row({ dept: "IT", months: [500_000, 500_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }),
    ];
    expect(totalBudget(rows)).toBe(2_000_000);
    expect(deptCount(rows)).toBe(2);
  });

  it("is 0 / 0 for an empty register", () => {
    expect(totalBudget([])).toBe(0);
    expect(deptCount([])).toBe(0);
  });
});

describe("maxMonth (detail-modal bar scale)", () => {
  it("returns the largest monthly figure", () => {
    expect(maxMonth([100, 900, 300])).toBe(900);
  });
  it("is 0 for an empty budget", () => {
    expect(maxMonth([])).toBe(0);
  });
});

describe("latestYear / sortRows", () => {
  it("picks the most recent year, null when empty", () => {
    expect(latestYear([row({ year: 2568 }), row({ year: 2570 }), row({ year: 2569 })])).toBe(2570);
    expect(latestYear([])).toBeNull();
  });

  it("orders by year asc then dept asc (mirrors the server)", () => {
    const sorted = sortRows([
      row({ dept: "B", year: 2570 }),
      row({ dept: "A", year: 2569 }),
      row({ dept: "A", year: 2570 }),
    ]);
    expect(sorted.map((r) => `${r.year}:${r.dept}`)).toEqual(["2569:A", "2570:A", "2570:B"]);
  });
});

describe("formatMoney", () => {
  it("groups thousands with no decimals", () => {
    expect(formatMoney(1_234_567)).toBe("1,234,567");
    expect(formatMoney(0)).toBe("0");
  });
});

describe("create form (money = SERVER)", () => {
  it("an empty draft has 12 blank months and is not submittable", () => {
    const d = emptyOpexDraft();
    expect(d.months).toHaveLength(MONTHS_IN_YEAR);
    expect(draftSubmittable(d)).toBe(false);
  });

  it("requires a dept and a positive integer year", () => {
    expect(draftSubmittable({ dept: "IT", year: "2569", months: [] })).toBe(true);
    expect(draftSubmittable({ dept: "  ", year: "2569", months: [] })).toBe(false);
    expect(draftSubmittable({ dept: "IT", year: "0", months: [] })).toBe(false);
    expect(draftSubmittable({ dept: "IT", year: "", months: [] })).toBe(false);
  });

  it("builds a body of ONLY {dept, year, months} — never currency_code (server owns THB)", () => {
    const body = buildOpexBody({
      dept: "  IT  ",
      year: "2569.9",
      months: ["100", "", "200", "x"],
    });
    expect(body).toEqual({ dept: "IT", year: 2569, months: [100, 0, 200, 0] });
    expect(Object.keys(body)).toEqual(["dept", "year", "months"]);
    expect("currency_code" in body).toBe(false);
  });

  it("caps the months sent to at most 12", () => {
    const many = Array.from({ length: 15 }, (_, i) => String(i + 1));
    const body = buildOpexBody({ dept: "IT", year: "2569", months: many });
    expect(body.months).toHaveLength(MONTHS_IN_YEAR);
  });
});
