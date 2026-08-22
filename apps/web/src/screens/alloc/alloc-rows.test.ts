/*
 * G3 unit tests for the alloc view-model (B-433).
 *
 * Expected values come from pototype/petty-alloc.jsx AllocateCost (L123-303) — the spec — and
 * from the SERVED payload shape of GET /dashboard/budget-actual, not from the implementation
 * (tests/CLAUDE.md).
 *
 * The properties worth protecting: the code column is SPLIT from the served label rather than
 * invented, a zero standard yields a null percentage rather than a misleading 0%, and the
 * prototype's own banding thresholds survive.
 */
import { describe, expect, it } from "vitest";
import {
  allocTotals,
  barHalfWidth,
  splitCode,
  statusOf,
  toAllocRow,
  VARIANCE_WARN_PCT,
  type AllocRow,
} from "./alloc-rows";

/** The first served category, as GET /dashboard/budget-actual returns it. */
const SERVED = { label: "01 Site Preparation", plan: 1000000, actual: 1200000 };

const row = (o: Partial<AllocRow> = {}): AllocRow => ({ ...toAllocRow(SERVED), ...o });

describe("splitting the served label", () => {
  it("splits a leading numeric code off the label", () => {
    expect(splitCode("01 Site Preparation")).toEqual({ code: "01", name: "Site Preparation" });
  });

  it("keeps a label with no leading code whole, and yields an empty code", () => {
    // An empty code em-dashes in the .tsx; it never invents a sequence number.
    expect(splitCode("Structural Works")).toEqual({ code: "", name: "Structural Works" });
  });

  it("does not treat digits inside the name as a code", () => {
    expect(splitCode("Block B-12 finishing")).toEqual({ code: "", name: "Block B-12 finishing" });
  });

  it("survives an empty label", () => {
    expect(splitCode("")).toEqual({ code: "", name: "" });
  });
});

describe("narrowing a served category", () => {
  it("reads plan and actual and derives the variance", () => {
    expect(toAllocRow(SERVED)).toEqual({
      code: "01",
      name: "Site Preparation",
      standard: 1000000,
      actual: 1200000,
      variance: 200000,
      variancePct: 20,
    });
  });

  it("accepts a null label without crashing", () => {
    const r = toAllocRow({ label: null, plan: 5, actual: 5 });
    expect(r.code).toBe("");
    expect(r.name).toBe("");
  });

  it("reports NO percentage when the standard is zero, rather than 0%", () => {
    // A category with no budget has no meaningful percentage; printing 0% there would read as
    // "on plan" for a row that is entirely unplanned spend.
    const r = toAllocRow({ label: "07 Extra", plan: 0, actual: 90000 });
    expect(r.variance).toBe(90000);
    expect(r.variancePct).toBeNull();
  });

  it("signs an underspend negative", () => {
    const r = toAllocRow({ label: "02 Structure", plan: 1000, actual: 800 });
    expect(r.variance).toBe(-200);
    expect(r.variancePct).toBe(-20);
  });
});

describe("the status banding is the prototype's own", () => {
  it("bands anything under 10 percent as normal, either direction", () => {
    expect(VARIANCE_WARN_PCT).toBe(10);
    expect(statusOf(row({ variance: 90, variancePct: 9 }))).toBe("normal");
    expect(statusOf(row({ variance: -90, variancePct: -9 }))).toBe("normal");
  });

  it("bands 10 percent itself as significant — the boundary is inclusive", () => {
    expect(statusOf(row({ variance: 100, variancePct: 10 }))).toBe("over");
    expect(statusOf(row({ variance: -100, variancePct: -10 }))).toBe("under");
  });

  it("has an honest state for a row with no percentage", () => {
    expect(statusOf(row({ variance: 50, variancePct: null }))).toBe("other");
  });
});

describe("the diverging bar", () => {
  it("is half the clamped magnitude, so it fills at 25 percent variance", () => {
    // prototype: min(100, |pct| * 4), drawn from the centre line -> half either side.
    expect(barHalfWidth(row({ variancePct: 25 }))).toBe(50);
    expect(barHalfWidth(row({ variancePct: 5 }))).toBe(10);
  });

  it("clamps rather than overflowing the track", () => {
    expect(barHalfWidth(row({ variancePct: 400 }))).toBe(50);
  });

  it("draws nothing when there is no percentage", () => {
    expect(barHalfWidth(row({ variancePct: null }))).toBe(0);
  });
});

describe("the table foot", () => {
  it("totals every money column and derives the overall percentage", () => {
    expect(
      allocTotals([
        row({ standard: 1000, actual: 1200, variance: 200 }),
        row({ standard: 3000, actual: 2800, variance: -200 }),
      ]),
    ).toEqual({ standard: 4000, actual: 4000, variance: 0, variancePct: 0 });
  });

  it("returns zeros and a null percentage for an empty table, never NaN", () => {
    expect(allocTotals([])).toEqual({
      standard: 0,
      actual: 0,
      variance: 0,
      variancePct: null,
    });
  });
});
