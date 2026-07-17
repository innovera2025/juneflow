/*
 * formatThaiShort guard tests (B-087). Intl.DateTimeFormat.format() throws a
 * RangeError ("Invalid time value") on an Invalid Date — reachable when the dashboard
 * builds `new Date(summary.asOf)` from a malformed wire `as_of` and passes it to the
 * header + DatePicker anchor. The guard returns an empty placeholder instead of
 * crashing; a valid date still formats exactly as before (behaviour-preserving).
 */
import { describe, it, expect } from "vitest";
import { formatThaiShort } from "./date-picker";

describe("formatThaiShort", () => {
  it("formats a valid date to a non-empty short label (unchanged)", () => {
    const out = formatThaiShort(new Date(2026, 6, 17));
    expect(out).not.toBe("");
    expect(out.length).toBeGreaterThan(0);
  });

  it("returns an empty string for an Invalid Date (no RangeError)", () => {
    expect(() => formatThaiShort(new Date("not-a-real-date"))).not.toThrow();
    expect(formatThaiShort(new Date("not-a-real-date"))).toBe("");
  });

  it("returns an empty string for a NaN-time date", () => {
    expect(formatThaiShort(new Date(Number.NaN))).toBe("");
  });
});
