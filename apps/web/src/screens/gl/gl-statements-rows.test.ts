/*
 * gl-statements-rows unit tests (gate G3) — the pure financial-statement logic ported from
 * gl.jsx GLStatements (toStmtRow / isCurrentAsset / sumAmount / toStatements / formatMoney).
 * Guards the opaque EntityOk narrowing, the 3-bucket -> 4-section asset split (CURRENT vs
 * NON-CURRENT by account_code prefix "11"), the server-authoritative subtotals passthrough,
 * the equity net-income fold, honest-empty sections, the balanced flag, and the always-null
 * prior column against regression. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toStmtRow,
  isCurrentAsset,
  sumAmount,
  toStatements,
  formatMoney,
  type StmtRowVM,
} from "./gl-statements-rows";

const row = (p: Partial<StmtRowVM> = {}): StmtRowVM => ({
  code: "",
  label: "",
  amount: 0,
  ...p,
});

/** A representative balanced payload: current + non-current assets, a liability, empty equity
 *  members + a folded net income, revenue + expense rows, THB. */
function samplePayload() {
  return {
    balance_sheet: {
      assets: {
        rows: [
          { account_code: "1101", account_name: "Cash", amount: 24470000, prior_amount: null },
          { account_code: "1103", account_name: "Trade AR", amount: 88580000, prior_amount: null },
          { account_code: "1210", account_name: "PPE", amount: 42175240, prior_amount: null },
        ],
        subtotal: 155225240,
      },
      liabilities: {
        rows: [{ account_code: "2101", account_name: "Trade AP", amount: 12400000, prior_amount: null }],
        subtotal: 12400000,
      },
      equity: {
        rows: [],
        net_income_line: { amount: 37716000, prior_amount: null },
        subtotal: 142825240,
      },
      total_assets: 155225240,
      total_liabilities_equity: 155225240,
      prior_total_assets: null,
      balanced: true,
    },
    income_statement: {
      revenue: {
        rows: [{ account_code: "4101", account_name: "House sales", amount: 202520000, prior_total: null }],
        total: 202520000,
        prior_total: null,
      },
      expense: {
        rows: [{ account_code: "5101", account_name: "Construction cost", amount: 164804000, prior_total: null }],
        total: 164804000,
        prior_total: null,
      },
      net_income: 37716000,
      prior_net_income: null,
    },
    currency_code: "THB",
  };
}

describe("toStmtRow", () => {
  it("narrows a snake_case wire row and drops the always-null prior column", () => {
    expect(
      toStmtRow({ account_code: "1101", account_name: "Cash", amount: 24470000, prior_amount: null }),
    ).toEqual({ code: "1101", label: "Cash", amount: 24470000 });
  });

  it("accepts camelCase and defaults a missing amount to 0 / null names to ''", () => {
    expect(toStmtRow({ accountCode: "2101", accountName: null })).toEqual({
      code: "2101",
      label: "",
      amount: 0,
    });
  });
});

describe("isCurrentAsset", () => {
  it("is true only for the account_code prefix '11'", () => {
    expect(isCurrentAsset("1101")).toBe(true);
    expect(isCurrentAsset("1199")).toBe(true);
    expect(isCurrentAsset("1210")).toBe(false); // non-current asset (12xx)
    expect(isCurrentAsset("2101")).toBe(false); // liability
    expect(isCurrentAsset("")).toBe(false);
  });

  it("ignores surrounding whitespace", () => {
    expect(isCurrentAsset("  1101 ")).toBe(true);
  });
});

describe("sumAmount", () => {
  it("sums row amounts and rounds to 2dp", () => {
    expect(sumAmount([row({ amount: 100 }), row({ amount: 250.5 })])).toBe(350.5);
    expect(sumAmount([row({ amount: 0.1 }), row({ amount: 0.2 })])).toBe(0.3);
    expect(sumAmount([])).toBe(0);
  });
});

describe("toStatements — balance sheet", () => {
  const vm = toStatements(samplePayload());

  it("splits the single assets bucket into CURRENT ('11') vs NON-CURRENT by code prefix", () => {
    expect(vm.balanceSheet.currentAssets.rows.map((r) => r.code)).toEqual(["1101", "1103"]);
    expect(vm.balanceSheet.nonCurrentAssets.rows.map((r) => r.code)).toEqual(["1210"]);
  });

  it("derives each asset-split subtotal client-side, summing back to the server assets subtotal", () => {
    const cur = vm.balanceSheet.currentAssets.subtotal;
    const non = vm.balanceSheet.nonCurrentAssets.subtotal;
    expect(cur).toBe(113050000); // 24,470,000 + 88,580,000
    expect(non).toBe(42175240);
    expect(cur + non).toBe(155225240); // == server assets.subtotal / total_assets
  });

  it("reads the liabilities subtotal straight off the wire (server-authoritative)", () => {
    expect(vm.balanceSheet.currentLiab.rows).toHaveLength(1);
    expect(vm.balanceSheet.currentLiab.subtotal).toBe(12400000);
  });

  it("folds net income into equity: server subtotal + separate net-income line", () => {
    expect(vm.balanceSheet.equity.members).toEqual([]); // honest-empty members in the seed
    expect(vm.balanceSheet.equity.netIncome).toBe(37716000);
    expect(vm.balanceSheet.equity.subtotal).toBe(142825240); // server (members + net income)
  });

  it("passes the server totals + balanced flag through unchanged", () => {
    expect(vm.balanceSheet.totalAssets).toBe(155225240);
    expect(vm.balanceSheet.totalLiabilitiesEquity).toBe(155225240);
    expect(vm.balanceSheet.balanced).toBe(true);
  });
});

describe("toStatements — income statement", () => {
  const vm = toStatements(samplePayload());

  it("reads revenue/expense totals straight off the wire and the server net income", () => {
    expect(vm.profitLoss.revenue.rows).toHaveLength(1);
    expect(vm.profitLoss.revenue.subtotal).toBe(202520000); // revenue.total
    expect(vm.profitLoss.expense.subtotal).toBe(164804000); // expense.total
    expect(vm.profitLoss.netIncome).toBe(37716000);
  });

  it("defaults the currency to THB and reads the wire currency when present", () => {
    expect(vm.currencyCode).toBe("THB");
    expect(toStatements({ currency_code: "USD" }).currencyCode).toBe("USD");
  });
});

describe("toStatements — honest-empty + balanced flag", () => {
  it("yields structurally-present empty sections + zero subtotals + THB for a missing payload", () => {
    for (const bad of [undefined, null, {}, { balance_sheet: "nope" }]) {
      const vm = toStatements(bad as Record<string, unknown> | null | undefined);
      expect(vm.balanceSheet.currentAssets).toEqual({ rows: [], subtotal: 0 });
      expect(vm.balanceSheet.nonCurrentAssets).toEqual({ rows: [], subtotal: 0 });
      expect(vm.balanceSheet.currentLiab).toEqual({ rows: [], subtotal: 0 });
      expect(vm.balanceSheet.equity).toEqual({ members: [], netIncome: 0, subtotal: 0 });
      expect(vm.profitLoss.revenue).toEqual({ rows: [], subtotal: 0 });
      expect(vm.profitLoss.expense).toEqual({ rows: [], subtotal: 0 });
      expect(vm.profitLoss.netIncome).toBe(0);
      expect(vm.currencyCode).toBe("THB");
    }
  });

  it("never fabricates a balanced=true — only a literal server true counts, missing -> false", () => {
    expect(toStatements({}).balanceSheet.balanced).toBe(false);
    expect(
      toStatements({ balance_sheet: { balanced: false } }).balanceSheet.balanced,
    ).toBe(false);
    expect(
      toStatements({ balance_sheet: { balanced: "true" } }).balanceSheet.balanced,
    ).toBe(false); // a non-boolean is NOT trusted as balanced
    expect(
      toStatements({ balance_sheet: { balanced: true } }).balanceSheet.balanced,
    ).toBe(true);
  });
});

describe("formatMoney", () => {
  it("groups thousands with no decimals or baht symbol", () => {
    expect(formatMoney(155225240)).toBe("155,225,240");
    expect(formatMoney(-12400000)).toBe("-12,400,000");
    expect(formatMoney(0)).toBe("0");
  });

  it("returns '0' for non-finite input", () => {
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});
