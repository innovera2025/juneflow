/*
 * fin-aging-rows unit tests (ar.aging + ap.aging, gate G3) — the pure aggregate/party logic
 * ported from accounting-extra.jsx FinAging. Guards: the opaque /ar/aging report narrowing
 * (bucket -> KPI/tfoot view), the null wire -> null view path (the AP side, honest-empty), the
 * HONEST-EMPTY per-party resolve (an aggregate report carries no party dimension), and the money
 * formatters. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toAgingView,
  resolveParties,
  partyRowTotal,
  formatMoney,
  formatMillion,
  AGING_BUCKET_KEYS,
  type AgingPartyRow,
} from "./fin-aging-rows";

/** A representative GET /ar/aging report (aggregate-by-bucket, the real handler shape). */
const wire = (): Record<string, unknown> => ({
  buckets: [
    { bucket: "current", count: 3, amount: 4_000_000 },
    { bucket: "1-30", count: 2, amount: 1_000_000 },
    { bucket: "31-60", count: 1, amount: 500_000 },
    { bucket: "61-90", count: 1, amount: 300_000 },
    { bucket: "90+", count: 1, amount: 200_000 },
  ],
  total_outstanding: 6_000_000,
  currency_code: "THB",
});

describe("toAgingView — aggregate bucket narrowing", () => {
  it("maps each bucket to its amount in fixed order", () => {
    const v = toAgingView(wire())!;
    expect(v.current).toBe(4_000_000);
    expect(v.b30).toBe(1_000_000);
    expect(v.b60).toBe(500_000);
    expect(v.b90).toBe(300_000);
    expect(v.over).toBe(200_000);
  });

  it("sums the overdue buckets (b30 + b60 + b90 + over)", () => {
    expect(toAgingView(wire())!.overdue).toBe(2_000_000);
  });

  it("counts the outstanding invoices as the summed bucket counts", () => {
    expect(toAgingView(wire())!.count).toBe(8);
  });

  it("prefers total_outstanding off the wire (server authority)", () => {
    expect(toAgingView(wire())!.total).toBe(6_000_000);
  });

  it("falls back to summed buckets when total_outstanding is absent", () => {
    const w = wire();
    delete w.total_outstanding;
    // current 4,000,000 + overdue 2,000,000
    expect(toAgingView(w)!.total).toBe(6_000_000);
  });

  it("derives current as a whole-percent of total", () => {
    // 4,000,000 / 6,000,000 -> 67%
    expect(toAgingView(wire())!.currentPct).toBe(67);
  });

  it("never divides by zero when total is 0 (empty report)", () => {
    const v = toAgingView({ buckets: [], total_outstanding: 0, currency_code: "THB" })!;
    expect(v.total).toBe(0);
    expect(v.currentPct).toBe(0);
    expect(v.count).toBe(0);
    expect(v.overdue).toBe(0);
  });

  it("reads the report currency (THB fallback)", () => {
    expect(toAgingView(wire())!.currencyCode).toBe("THB");
    const w = wire();
    delete w.currency_code;
    expect(toAgingView(w)!.currencyCode).toBe("THB");
  });

  it("coerces numeric-string bucket amounts", () => {
    const v = toAgingView({
      buckets: [{ bucket: "current", count: "2", amount: "150000.00" }],
      total_outstanding: "150000.00",
    })!;
    expect(v.current).toBe(150_000);
    expect(v.count).toBe(2);
    expect(v.total).toBe(150_000);
  });

  it("treats a missing bucket as 0 (absent key)", () => {
    const v = toAgingView({ buckets: [{ bucket: "90+", count: 1, amount: 99 }], total_outstanding: 99 })!;
    expect(v.current).toBe(0);
    expect(v.b30).toBe(0);
    expect(v.over).toBe(99);
  });

  it("returns null for no wire (the AP side has no endpoint -> honest-empty)", () => {
    expect(toAgingView(undefined)).toBeNull();
    expect(toAgingView(null)).toBeNull();
  });
});

describe("resolveParties — honest-empty per-party rows", () => {
  it("yields NO rows for the aggregate AR report (no party dimension on the wire)", () => {
    expect(resolveParties(wire())).toEqual([]);
  });

  it("yields NO rows for the AP side (no wire)", () => {
    expect(resolveParties(undefined)).toEqual([]);
    expect(resolveParties(null)).toEqual([]);
  });
});

describe("partyRowTotal", () => {
  it("sums the five buckets of a party row", () => {
    const r: AgingPartyRow = {
      name: "x",
      cur: 100,
      b30: 200,
      b60: 300,
      b90: 400,
      over: 500,
      docs: 3,
      total: 0,
    };
    expect(partyRowTotal(r)).toBe(1500);
  });
});

describe("formatMoney", () => {
  it("groups thousands with ASCII commas", () => {
    expect(formatMoney(1_840_000)).toBe("1,840,000");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(999)).toBe("999");
  });
  it("rounds to whole baht and preserves sign", () => {
    expect(formatMoney(1234.6)).toBe("1,235");
    expect(formatMoney(-2_000_000)).toBe("-2,000,000");
  });
  it("returns 0 for a non-finite input", () => {
    expect(formatMoney(Number.NaN)).toBe("0");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("formatMillion", () => {
  it("formats a magnitude in millions with two decimals", () => {
    expect(formatMillion(5_200_000)).toBe("5.20");
    expect(formatMillion(0)).toBe("0.00");
    expect(formatMillion(468_000_000)).toBe("468.00");
  });
  it("returns 0.00 for a non-finite input", () => {
    expect(formatMillion(Number.NaN)).toBe("0.00");
  });
});

describe("AGING_BUCKET_KEYS", () => {
  it("is the fixed 5-bucket display order (ASCII hyphens, mirroring the wire)", () => {
    expect(AGING_BUCKET_KEYS).toEqual(["current", "1-30", "31-60", "61-90", "90+"]);
  });
});
