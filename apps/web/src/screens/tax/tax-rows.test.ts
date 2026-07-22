/*
 * tax-rows unit tests (tax.vat + tax.wht, gate G3) — the pure report logic ported from tax.jsx +
 * tax-forms.jsx (toVatReport / vatBoxes incl honest-zero / toWhtReport / classifyWhtForm 3-vs-53
 * split / whtGroupFor / money formatters). Guards the opaque-report narrowing, the PP30 box
 * mapping (real figures + honest-zero boxes), and the PND heuristic against regression.
 * ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toVatReport,
  vatBoxes,
  toWhtReport,
  classifyWhtForm,
  whtGroupFor,
  whtAllCount,
  formatMoney,
  formatMoney2,
  millions,
  thousands,
  round2,
  EMPTY_VAT_REPORT,
  EMPTY_WHT_REPORT,
} from "./tax-rows";

describe("toVatReport", () => {
  it("narrows a full opaque /tax/reports/vat report (snake_case, drizzle string numerics)", () => {
    expect(
      toVatReport({
        output_vat: "2240000",
        output_base: 32000000,
        input_vat: "840000",
        input_base: 12000000,
        net_vat: 1400000,
        period: "2026-05",
        currency_code: "THB",
      }),
    ).toEqual({
      outputVat: 2240000,
      outputBase: 32000000,
      inputVat: 840000,
      inputBase: 12000000,
      netVat: 1400000,
      period: "2026-05",
      currencyCode: "THB",
    });
  });

  it("honest-zeros a report over zero rows and blanks a null period (all periods)", () => {
    const r = toVatReport({ output_vat: 0, input_vat: 0, net_vat: 0, period: null, currency_code: "THB" });
    expect(r).toEqual({ ...EMPTY_VAT_REPORT, currencyCode: "THB" });
    expect(r.period).toBe("");
  });
});

describe("vatBoxes (PP30 v1-v16)", () => {
  it("maps the real figures with a positive net (tax payable) and honest-zero non-wire boxes", () => {
    const b = vatBoxes(
      toVatReport({ output_vat: 2240000, output_base: 32000000, input_vat: 840000, input_base: 12000000, net_vat: 1400000 }),
    );
    // Real, wire-backed boxes.
    expect(b.v1).toBe(32000000); // total sales = output base
    expect(b.v4).toBe(32000000); // taxable sales (no zero/exempt split)
    expect(b.v5).toBe(2240000); // output VAT
    expect(b.v6).toBe(12000000); // input base
    expect(b.v7).toBe(840000); // input VAT
    expect(b.v8).toBe(1400000); // tax payable (net > 0)
    expect(b.v9).toBe(0); // not overpaid
    expect(b.v11).toBe(1400000); // net payable (v8 - v10)
    expect(b.v15).toBe(1400000); // total payable
    // Honest-zero, non-wire boxes (B-124).
    expect(b.v2).toBe(0);
    expect(b.v3).toBe(0);
    expect(b.v10).toBe(0);
    expect(b.v12).toBe(0);
    expect(b.v13).toBe(0);
    expect(b.v14).toBe(0);
    expect(b.v16).toBe(0);
  });

  it("maps a negative net (tax overpaid) to v9 only, exactly as the prototype PND30Form formula does", () => {
    const b = vatBoxes(
      toVatReport({ output_vat: 500000, output_base: 7000000, input_vat: 800000, input_base: 11000000, net_vat: -300000 }),
    );
    expect(b.v8).toBe(0); // nothing payable this month
    expect(b.v9).toBe(300000); // overpaid this month (output < input)
    // The prototype's net section only compares v8 vs v10 (carried credit); v9 is NOT fed into it,
    // and with no carried credit (v10 = 0) the net boxes stay zero. Mirrored exactly (§0), not "fixed".
    expect(b.v11).toBe(0);
    expect(b.v12).toBe(0);
    expect(b.v15).toBe(0);
    expect(b.v16).toBe(0);
  });

  it("is entirely honest-zero over an empty report", () => {
    const b = vatBoxes(EMPTY_VAT_REPORT);
    expect(Object.values(b).every((v) => v === 0)).toBe(true);
  });
});

describe("toWhtReport", () => {
  it("narrows the aggregate groups + total (snake_case, drizzle string numerics)", () => {
    expect(
      toWhtReport({
        pnd3: { count: 2, wht: "7200", base: 42000 },
        pnd53: { count: 36, wht: 232800, base: "7760000" },
        total_wht: 240000,
        period: "2026-05",
        currency_code: "THB",
      }),
    ).toEqual({
      pnd3: { count: 2, wht: 7200, base: 42000 },
      pnd53: { count: 36, wht: 232800, base: 7760000 },
      totalWht: 240000,
      period: "2026-05",
      currencyCode: "THB",
    });
  });

  it("honest-zeros missing groups over an empty report", () => {
    const r = toWhtReport({ total_wht: 0, period: null });
    expect(r).toEqual({ ...EMPTY_WHT_REPORT });
    expect(whtAllCount(r)).toBe(0);
  });

  it("counts all rows across both groups + selects the group per form kind", () => {
    const r = toWhtReport({ pnd3: { count: 2, wht: 7200, base: 42000 }, pnd53: { count: 36, wht: 232800, base: 7760000 }, total_wht: 240000 });
    expect(whtAllCount(r)).toBe(38);
    expect(whtGroupFor(r, "3")).toEqual({ count: 2, wht: 7200, base: 42000 });
    expect(whtGroupFor(r, "53")).toEqual({ count: 36, wht: 232800, base: 7760000 });
  });
});

describe("classifyWhtForm (PND3 vs 53 heuristic)", () => {
  it("routes a 13-digit tax_id to 53 (juristic) and anything else to 3 (individual)", () => {
    expect(classifyWhtForm("0105540084234")).toBe("53"); // 13-digit company
    expect(classifyWhtForm("0105 538 021876")).toBe("53"); // formatting stripped, still 13
    expect(classifyWhtForm("110180031245")).toBe("3"); // 12 digits -> individual
    expect(classifyWhtForm("")).toBe("3"); // missing -> individual
    expect(classifyWhtForm("abc")).toBe("3"); // non-numeric -> individual
  });
});

describe("money formatters", () => {
  it("formatMoney groups thousands with no decimals or baht symbol", () => {
    expect(formatMoney(2240000)).toBe("2,240,000");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(-300000)).toBe("-300,000");
    expect(formatMoney(Number.NaN)).toBe("0");
  });

  it("formatMoney2 groups thousands with exactly 2 decimals (RD form fmtB)", () => {
    expect(formatMoney2(2240000)).toBe("2,240,000.00");
    expect(formatMoney2(2904)).toBe("2,904.00");
    expect(formatMoney2(0)).toBe("0.00");
    expect(formatMoney2(-300000.5)).toBe("-300,000.50");
    expect(formatMoney2(Number.NaN)).toBe("0.00");
  });

  it("round2 tidies a client-derived box to 2 dp", () => {
    expect(round2(1400000.005)).toBe(1400000.01);
    expect(round2(Number.NaN)).toBe(0);
  });
});

describe("scaled KPI helpers (M / K)", () => {
  it("millions scales to millions with exactly 2 decimals (prototype VAT KPI values)", () => {
    expect(millions(2_240_000)).toBe("2.24"); // VAT sales -> "2.24"
    expect(millions(840_000)).toBe("0.84"); // VAT purchases -> "0.84"
    expect(millions(1_400_000)).toBe("1.40"); // VAT net -> "1.40" (trailing zero kept)
    expect(millions(0)).toBe("0.00"); // edge: zero
    expect(millions(-1_400_000)).toBe("-1.40"); // edge: negative (credit)
    expect(millions(2_999_000)).toBe("3.00"); // edge: rounds 2.999 up to 3.00
    expect(millions(Number.NaN)).toBe("0.00"); // edge: non-finite -> "0.00"
  });

  it("thousands scales to thousands, no decimals, with grouping (prototype WHT total KPI value)", () => {
    expect(thousands(240_000)).toBe("240"); // WHT total -> "240"
    expect(thousands(1_240_000)).toBe("1,240"); // grouping over 1M
    expect(thousands(0)).toBe("0"); // edge: zero
    expect(thousands(-240_000)).toBe("-240"); // edge: negative
    expect(thousands(240_500)).toBe("241"); // edge: rounds 240.5 up to 241
    expect(thousands(Number.NaN)).toBe("0"); // edge: non-finite -> "0"
  });
});
