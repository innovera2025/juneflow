/*
 * solar-ppa-rows unit tests (gate G3) — the pure SolarPPA display logic narrowed from
 * solar.jsx SolarPPA. Guards the opaque-row narrowing, the YTD aggregate + its millions
 * KPI, the rate formatting, and the status-tone mapping.
 */
import { describe, it, expect } from "vitest";
import { toPpaRow, ytdAmount, kpiYtdValue, rateText, ppaStatusKind, type PpaRow } from "./solar-ppa-rows";

function ppa(over: Partial<PpaRow> = {}): PpaRow {
  return { id: "ppa-1", month: "2569-01", mwh: 500, rate: 3.5, amount: 1_750_000, currencyCode: "THB", status: "issued", ...over };
}

describe("toPpaRow", () => {
  it("narrows a snake_case wire row (currency_code) to PpaRow", () => {
    expect(
      toPpaRow({ id: "p", project_id: "x", month: "2569-02", mwh: "520", rate: "3.5000", amount: "1820000", currency_code: "THB", status: "paid", created_at: "z" }),
    ).toEqual({ id: "p", month: "2569-02", mwh: 520, rate: 3.5, amount: 1820000, currencyCode: "THB", status: "paid" });
  });

  it("defaults absent / null fields (never fabricates)", () => {
    expect(toPpaRow({ id: "y" })).toEqual({ id: "y", month: "", mwh: 0, rate: 0, amount: 0, currencyCode: "", status: "" });
    expect(toPpaRow({ id: "z", amount: null }).amount).toBe(0);
  });
});

describe("ytdAmount / kpiYtdValue", () => {
  const rows = [ppa({ amount: 1_750_000 }), ppa({ amount: 1_820_000 }), ppa({ amount: 1_890_000 })];

  it("sums the billed amounts", () => {
    expect(ytdAmount(rows)).toBe(5_460_000);
  });

  it("renders the YTD KPI in millions to 2dp", () => {
    expect(kpiYtdValue(rows)).toBe("5.46");
    expect(kpiYtdValue([])).toBe("0.00");
  });
});

describe("rateText", () => {
  it("renders the tariff rate to 2dp", () => {
    expect(rateText(3.5)).toBe("3.50");
    expect(rateText(4.12)).toBe("4.12");
    expect(rateText(Number.NaN)).toBe("0.00");
  });
});

describe("ppaStatusKind", () => {
  it("maps the status code to a badge tone (label stays raw in the screen)", () => {
    expect(ppaStatusKind("paid")).toBe("approved");
    expect(ppaStatusKind("issued")).toBe("pending");
    expect(ppaStatusKind("billed")).toBe("pending");
    expect(ppaStatusKind("draft")).toBe("draft");
    expect(ppaStatusKind("anything")).toBe("draft");
  });
});
