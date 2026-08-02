/*
 * Unit tests for inv-shared.ts (gate G3) — the pure, i18n-free helpers shared by
 * the inventory read screens: opaque-field reads, money formatting (0/2 dec),
 * warehouse id->name resolution, the derived stock-status enum, and the
 * transfer/issue document-status tone mapping.
 */
import { describe, it, expect } from "vitest";
import {
  str,
  num,
  numOrNull,
  formatMoney,
  formatDec,
  warehouseNameById,
  stockStatusKind,
  stockStatusTone,
  docStatusKind,
  docStatusTone,
} from "./inv-shared";

describe("str / num / numOrNull", () => {
  it("reads strings, coercing non-strings and defaulting null to ''", () => {
    expect(str("MAT-001")).toBe("MAT-001");
    expect(str(42)).toBe("42");
    expect(str(null)).toBe("");
    expect(str(undefined)).toBe("");
  });

  it("reads finite numbers (incl numeric strings), defaulting to 0", () => {
    expect(num(168.5)).toBe(168.5);
    expect(num("425.00")).toBe(425);
    expect(num("")).toBe(0);
    expect(num(null)).toBe(0);
    expect(num(Number.NaN)).toBe(0);
  });

  it("keeps null distinct from 0 for nullable fields (low_point)", () => {
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
    expect(numOrNull(0)).toBe(0);
    expect(numOrNull("300")).toBe(300);
    expect(numOrNull("nope")).toBeNull();
  });
});

describe("formatMoney (0 decimals, thousands grouping)", () => {
  it("groups with commas, ASCII only, rounding to whole units", () => {
    expect(formatMoney(902475)).toBe("902,475");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(1240)).toBe("1,240");
    expect(formatMoney(-25500)).toBe("-25,500");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("formatDec (2 decimals, thousands grouping)", () => {
  it("keeps exactly two decimals + comma grouping", () => {
    expect(formatDec(7000)).toBe("7,000.00");
    expect(formatDec(425)).toBe("425.00");
    expect(formatDec(168.5)).toBe("168.50");
    expect(formatDec(0)).toBe("0.00");
    expect(formatDec(Number.NaN)).toBe("0.00");
  });
});

describe("warehouseNameById", () => {
  it("maps warehouse id -> name, skipping id-less rows", () => {
    const m = warehouseNameById([
      { id: "w1", name: "WH Central" },
      { id: "w2", name: "WH Block B" },
      { id: "", name: "orphan" },
    ]);
    expect(m.get("w1")).toBe("WH Central");
    expect(m.get("w2")).toBe("WH Block B");
    expect(m.has("")).toBe(false);
  });

  it("returns an empty map for undefined", () => {
    expect(warehouseNameById(undefined).size).toBe(0);
  });
});

describe("stockStatusKind (derived from on_hand vs low_point)", () => {
  it("derives out when on_hand <= 0 (the unseeded-ledger case)", () => {
    expect(stockStatusKind(0, 300)).toBe("out");
    expect(stockStatusKind(-5, 300)).toBe("out");
  });

  it("derives low when on_hand <= low_point (and > 0)", () => {
    expect(stockStatusKind(220, 300)).toBe("low");
    expect(stockStatusKind(300, 300)).toBe("low");
  });

  it("derives ok when on_hand > low_point (or low_point is null)", () => {
    expect(stockStatusKind(1240, 200)).toBe("ok");
    expect(stockStatusKind(5, null)).toBe("ok");
  });

  it("maps each kind to a tokened tone", () => {
    expect(stockStatusTone("ok")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)" });
    expect(stockStatusTone("low")).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)" });
    expect(stockStatusTone("out")).toEqual({ bg: "var(--danger-soft)", fg: "var(--danger)" });
  });
});

describe("docStatusKind / docStatusTone (transfer + issue)", () => {
  it("narrows the wire status to the known kind", () => {
    expect(docStatusKind("pending")).toBe("pending");
    expect(docStatusKind("approved")).toBe("approved");
    expect(docStatusKind("weird")).toBe("draft");
  });

  it("maps pending/approved to tokened tone + verbatim dot", () => {
    expect(docStatusTone("pending")).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" });
    expect(docStatusTone("approved")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" });
    expect(docStatusTone("other")).toEqual({ bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" });
  });
});
