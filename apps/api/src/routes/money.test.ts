// G3 unit tests — round2 money helper (B-085 fix 3). The FLOW-A handlers route
// every COMPUTED money wire value through round2 so IEEE-754 accumulation drift
// never surfaces to the FE / visual gate.
import { describe, expect, it } from "vitest";
import { round2 } from "./money.js";

describe("round2 — computed-money 2-dp rounding", () => {
  it("collapses IEEE-754 accumulation drift to the 2-dp minor unit", () => {
    // The canonical float-sum artifact — the exact shape a Σ(qty × price) hits.
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(3 * 0.1)).toBe(0.3);
  });

  it("rounds a genuine sub-cent (3rd-decimal) product to 2 dp", () => {
    // 12345 × 7.125 / 100 = 879.58125 → 879.58 (a WO retention_amount case).
    expect(round2((12345 * 7.125) / 100)).toBe(879.58);
  });

  it("leaves an already-2-dp value unchanged (behaviour-preserving)", () => {
    expect(round2(27000)).toBe(27000);
    expect(round2(1268000)).toBe(1268000);
    expect(round2(0)).toBe(0);
  });

  it("rounds negatives too (a CBS available may go over budget)", () => {
    expect(round2(-1234.5 - 0.001)).toBe(-1234.5);
    expect(round2(-0.005)).toBe(-0.01);
  });

  it("collapses a non-finite input to 0 rather than emitting NaN onto the wire", () => {
    expect(round2(Number.NaN)).toBe(0);
    expect(round2(Number.POSITIVE_INFINITY)).toBe(0);
    expect(round2(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
