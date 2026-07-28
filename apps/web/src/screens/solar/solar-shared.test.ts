/*
 * solar-shared unit tests (gate G3) — the pure cross-screen helpers (opaque-row readers,
 * money formatter, ds.jsx status-tone map) used by every solar screen.
 */
import { describe, it, expect } from "vitest";
import { str, num, formatMoney, statusTone } from "./solar-shared";

describe("str", () => {
  it("returns a string as-is, coerces non-strings, and empties null/undefined", () => {
    expect(str("x")).toBe("x");
    expect(str(42)).toBe("42");
    expect(str(null)).toBe("");
    expect(str(undefined)).toBe("");
  });
});

describe("num", () => {
  it("reads finite numbers, parses numeric strings, and zeroes the rest", () => {
    expect(num(500)).toBe(500);
    expect(num("472.00")).toBe(472);
    expect(num("")).toBe(0);
    expect(num(null)).toBe(0);
    expect(num("abc")).toBe(0);
    expect(num(Number.NaN)).toBe(0);
  });
});

describe("formatMoney", () => {
  it("groups thousands with ASCII commas and is NaN-safe", () => {
    expect(formatMoney(1_750_000)).toBe("1,750,000");
    expect(formatMoney(500)).toBe("500");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(-199)).toBe("-199");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("statusTone", () => {
  it("returns tokened bg/fg + the prototype-verbatim dot per ds.jsx STATUS kind", () => {
    expect(statusTone("approved")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" });
    expect(statusTone("pending")).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" });
    expect(statusTone("rejected")).toEqual({ bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" });
    expect(statusTone("draft")).toEqual({ bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" });
  });
});
