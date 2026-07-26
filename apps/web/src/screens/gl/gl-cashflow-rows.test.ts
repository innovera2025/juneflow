/*
 * gl-cashflow-rows unit tests (gate G3) — the pure DIRECT-method cash-flow logic ported from
 * accounting-extra2.jsx GLCashFlow (toCfLine / toCfSection / toCashFlow + formatMoney / formatParen
 * / formatMillions / formatDelta). Guards the opaque EntityOk narrowing, the server-authoritative
 * net passthrough, honest-empty investing/financing sections, opening-0 + closing == opening +
 * net_change, the net_change self-reconciliation (Sigma sections == net_change), and the sign /
 * parentheses / millions formatting against regression. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toCfLine,
  toCfSection,
  toCashFlow,
  formatMoney,
  formatParen,
  formatMillions,
  formatDelta,
} from "./gl-cashflow-rows";

/** A representative self-reconciling payload: operating has real lines (in + out), investing +
 *  financing are honest-empty, opening is 0 so closing == net_change. operating.net (+4,000,000)
 *  is the only non-zero section, so Sigma sections == net_change == 4,000,000. */
function samplePayload() {
  return {
    method: "direct",
    operating: {
      lines: [
        { account_code: "4010", account_name: "Revenue", amount: 10000000 },
        { account_code: "1030", account_name: "Trade AR", amount: -2400000 },
        { account_code: "2010", account_name: "Trade AP", amount: -3600000 },
      ],
      net: 4000000,
    },
    investing: { lines: [], net: 0 },
    financing: { lines: [], net: 0 },
    opening_cash: 0,
    net_change: 4000000,
    closing_cash: 4000000,
    prior: null,
    currency_code: "THB",
  };
}

describe("toCfLine", () => {
  it("narrows a snake_case wire line", () => {
    expect(toCfLine({ account_code: "1030", account_name: "AR", amount: -2400000 })).toEqual({
      code: "1030",
      label: "AR",
      amount: -2400000,
    });
  });

  it("accepts camelCase and defaults a missing amount to 0 / null names to ''", () => {
    expect(toCfLine({ accountCode: "4010", accountName: null })).toEqual({
      code: "4010",
      label: "",
      amount: 0,
    });
  });
});

describe("toCfSection", () => {
  it("narrows lines and reads the net straight off the wire (server-authoritative)", () => {
    const s = toCfSection({ lines: [{ account_code: "4010", account_name: "Rev", amount: 10000000 }], net: 4000000 });
    expect(s.lines).toHaveLength(1);
    expect(s.net).toBe(4000000); // read off the wire, NOT summed from lines
  });

  it("yields an honest-empty section for a missing/empty value", () => {
    for (const bad of [undefined, null, {}, { lines: "nope" }]) {
      expect(toCfSection(bad)).toEqual({ lines: [], net: 0 });
    }
  });
});

describe("toCashFlow", () => {
  const vm = toCashFlow(samplePayload());

  it("narrows the operating section rows + server net", () => {
    expect(vm.operating.lines.map((l) => l.code)).toEqual(["4010", "1030", "2010"]);
    expect(vm.operating.net).toBe(4000000);
  });

  it("keeps honest-empty investing/financing (real 0, structurally present)", () => {
    expect(vm.investing).toEqual({ lines: [], net: 0 });
    expect(vm.financing).toEqual({ lines: [], net: 0 });
  });

  it("reads opening / net_change / closing straight off the wire (opening honest-0)", () => {
    expect(vm.openingCash).toBe(0);
    expect(vm.netChange).toBe(4000000);
    expect(vm.closingCash).toBe(4000000);
  });

  it("self-reconciles: operating.net + investing.net + financing.net == net_change (DIRECT)", () => {
    expect(vm.operating.net + vm.investing.net + vm.financing.net).toBe(vm.netChange);
  });

  it("reconciles closing == opening + net_change", () => {
    expect(vm.closingCash).toBe(vm.openingCash + vm.netChange);
  });

  it("defaults the currency to THB and reads the wire currency when present", () => {
    expect(vm.currencyCode).toBe("THB");
    expect(toCashFlow({ currency_code: "USD" }).currencyCode).toBe("USD");
  });

  it("yields structurally-present empty sections + zeros + THB for a missing payload", () => {
    for (const bad of [undefined, null, {}, { operating: "nope" }]) {
      const empty = toCashFlow(bad as Record<string, unknown> | null | undefined);
      expect(empty.operating).toEqual({ lines: [], net: 0 });
      expect(empty.investing).toEqual({ lines: [], net: 0 });
      expect(empty.financing).toEqual({ lines: [], net: 0 });
      expect(empty.openingCash).toBe(0);
      expect(empty.netChange).toBe(0);
      expect(empty.closingCash).toBe(0);
      expect(empty.currencyCode).toBe("THB");
    }
  });

  it("handles a negative net_change (cash outflow) without fabricating", () => {
    const vmNeg = toCashFlow({
      operating: { lines: [{ account_code: "1030", account_name: "AR", amount: -5000000 }], net: -5000000 },
      investing: { lines: [], net: 0 },
      financing: { lines: [], net: 0 },
      opening_cash: 0,
      net_change: -5000000,
      closing_cash: -5000000,
      currency_code: "THB",
    });
    expect(vmNeg.operating.net).toBe(-5000000);
    expect(vmNeg.netChange).toBe(-5000000);
    expect(vmNeg.operating.net + vmNeg.investing.net + vmNeg.financing.net).toBe(vmNeg.netChange);
    expect(vmNeg.closingCash).toBe(vmNeg.openingCash + vmNeg.netChange);
  });
});

describe("formatMoney", () => {
  it("groups thousands with no decimals or baht symbol", () => {
    expect(formatMoney(4000000)).toBe("4,000,000");
    expect(formatMoney(-2400000)).toBe("-2,400,000");
    expect(formatMoney(0)).toBe("0");
  });

  it("returns '0' for non-finite input", () => {
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("formatParen", () => {
  it("wraps a negative (cash out) in parentheses and leaves a positive plain", () => {
    expect(formatParen(-1500000)).toBe("(1,500,000)");
    expect(formatParen(3100000)).toBe("3,100,000");
    expect(formatParen(0)).toBe("0");
  });
});

describe("formatMillions", () => {
  it("scales a full-baht figure to millions with 2dp", () => {
    expect(formatMillions(4000000)).toBe("4.00");
    expect(formatMillions(12200000)).toBe("12.20");
    expect(formatMillions(-1500000)).toBe("-1.50");
    expect(formatMillions(0)).toBe("0.00");
  });
});

describe("formatDelta", () => {
  it("prefixes a '+' for a non-negative net change", () => {
    expect(formatDelta(4000000)).toBe("+4,000,000");
    expect(formatDelta(0)).toBe("+0");
  });

  it("prefixes a Unicode minus for a negative net change", () => {
    expect(formatDelta(-5000000)).toBe("−5,000,000");
  });
});
