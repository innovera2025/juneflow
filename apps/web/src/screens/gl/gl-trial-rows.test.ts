/*
 * gl-trial-rows unit tests (gate G3) — the pure trial-balance logic ported from gl.jsx
 * GLTrialBalance (toTrialRow / toTrialBalance / rowBalance / accountType / balanceSuffix /
 * kpiSum / formatMoney / millionsAbs). Guards the opaque EntityOk narrowing, the period-net
 * balance + Dr/Cr sign, the code-prefix KPI classification (all four types + equity-excluded),
 * and the Dr=Cr totals passthrough against regression. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toTrialRow,
  toTrialBalance,
  rowBalance,
  accountType,
  balanceSuffix,
  kpiSum,
  formatMoney,
  millionsAbs,
  type TrialRow,
} from "./gl-trial-rows";

const row = (p: Partial<TrialRow> = {}): TrialRow => ({
  accountCode: "",
  accountName: "",
  debit: 0,
  credit: 0,
  ...p,
});

describe("toTrialRow", () => {
  it("narrows a snake_case wire row", () => {
    expect(
      toTrialRow({ account_code: "1101", account_name: "Cash", debit: 28640000, credit: 22180000 }),
    ).toEqual({ accountCode: "1101", accountName: "Cash", debit: 28640000, credit: 22180000 });
  });

  it("accepts camelCase and defaults missing numerics to 0 / null strings to ''", () => {
    const r = toTrialRow({ accountCode: "4101", accountName: null, credit: "32140000" });
    expect(r).toEqual({ accountCode: "4101", accountName: "", debit: 0, credit: 32140000 });
  });
});

describe("toTrialBalance", () => {
  it("narrows the full EntityOk object (rows + totals + currency)", () => {
    const tb = toTrialBalance({
      rows: [
        { account_code: "1101", account_name: "Cash", debit: 100, credit: 40 },
        { account_code: "4101", account_name: "Sales", debit: 0, credit: 60 },
      ],
      totals: { total_debit: 100, total_credit: 100 },
      currency_code: "THB",
    });
    expect(tb.rows).toHaveLength(2);
    expect(tb.rows[0]).toEqual({ accountCode: "1101", accountName: "Cash", debit: 100, credit: 40 });
    expect(tb.totals).toEqual({ totalDebit: 100, totalCredit: 100 });
    expect(tb.currencyCode).toBe("THB");
  });

  it("returns empty rows / zero totals / THB default for a missing or malformed payload", () => {
    for (const bad of [undefined, null, {}, { rows: "nope" }]) {
      const tb = toTrialBalance(bad as Record<string, unknown> | null | undefined);
      expect(tb.rows).toEqual([]);
      expect(tb.totals).toEqual({ totalDebit: 0, totalCredit: 0 });
      expect(tb.currencyCode).toBe("THB");
    }
  });

  it("passes the real Dr=Cr totals through unchanged (balanced JVs)", () => {
    const tb = toTrialBalance({ rows: [], totals: { total_debit: 128970000, total_credit: 128970000 } });
    expect(tb.totals.totalDebit).toBe(tb.totals.totalCredit);
  });
});

describe("rowBalance", () => {
  it("is the period NET debit - credit (not carry + dr - cr)", () => {
    expect(rowBalance(row({ debit: 28640000, credit: 22180000 }))).toBe(6460000);
    expect(rowBalance(row({ debit: 0, credit: 32140000 }))).toBe(-32140000);
    expect(rowBalance(row({ debit: 500, credit: 500 }))).toBe(0);
  });

  it("rounds to 2dp so float dust does not leak", () => {
    expect(rowBalance(row({ debit: 0.3, credit: 0.1 }))).toBe(0.2);
  });
});

describe("accountType", () => {
  it("classifies each Thai-COA prefix, with equity distinct and unknown -> other", () => {
    expect(accountType("1101")).toBe("asset");
    expect(accountType("2101")).toBe("liability");
    expect(accountType("3101")).toBe("equity");
    expect(accountType("4101")).toBe("revenue");
    expect(accountType("5101")).toBe("expense");
    expect(accountType("9999")).toBe("other");
    expect(accountType("")).toBe("other");
  });
});

describe("balanceSuffix", () => {
  it("uses (Cr) for any negative balance regardless of type", () => {
    expect(balanceSuffix("1101", -5)).toBe("(Cr)");
    expect(balanceSuffix("5101", -5)).toBe("(Cr)");
  });

  it("uses the account type for a non-negative balance (asset Dr, liability/equity Cr, else '')", () => {
    expect(balanceSuffix("1101", 100)).toBe("(Dr)");
    expect(balanceSuffix("1101", 0)).toBe("(Dr)");
    expect(balanceSuffix("2101", 100)).toBe("(Cr)");
    expect(balanceSuffix("3101", 100)).toBe("(Cr)");
    expect(balanceSuffix("4101", 100)).toBe("");
    expect(balanceSuffix("5101", 100)).toBe("");
  });
});

describe("kpiSum", () => {
  const rows: TrialRow[] = [
    row({ accountCode: "1101", debit: 28640000, credit: 22180000 }), // asset +6.46M
    row({ accountCode: "1201", debit: 96400000, credit: 92100000 }), // asset +4.30M
    row({ accountCode: "2101", debit: 12640000, credit: 16660000 }), // liability -4.02M
    row({ accountCode: "3101", debit: 0, credit: 100000000 }), // equity (excluded)
    row({ accountCode: "4101", debit: 0, credit: 32140000 }), // revenue -32.14M
    row({ accountCode: "5101", debit: 24840000, credit: 0 }), // expense +24.84M
  ];

  it("sums debit - credit per code-prefix group", () => {
    expect(kpiSum(rows, "asset")).toBe(10760000);
    expect(kpiSum(rows, "liability")).toBe(-4020000);
    expect(kpiSum(rows, "revenue")).toBe(-32140000);
    expect(kpiSum(rows, "expense")).toBe(24840000);
  });

  it("excludes equity ('3') from every KPI group", () => {
    // Equity is never summed into asset/liability/revenue/expense.
    const totalKpi =
      kpiSum(rows, "asset") + kpiSum(rows, "liability") + kpiSum(rows, "revenue") + kpiSum(rows, "expense");
    const totalAll = rows.reduce((s, r) => s + (r.debit - r.credit), 0);
    const equityNet = rowBalance(row({ debit: 0, credit: 100000000 }));
    expect(totalKpi).toBe(totalAll - equityNet);
    expect(kpiSum([row({ accountCode: "3101", debit: 0, credit: 100000000 })], "liability")).toBe(0);
  });

  it("returns 0 for an empty row set", () => {
    expect(kpiSum([], "asset")).toBe(0);
  });
});

describe("formatMoney", () => {
  it("groups thousands with no decimals or baht symbol", () => {
    expect(formatMoney(6460000)).toBe("6,460,000");
    expect(formatMoney(-4020000)).toBe("-4,020,000");
    expect(formatMoney(0)).toBe("0");
  });

  it("returns '0' for non-finite input", () => {
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("millionsAbs", () => {
  it("shows the abs value in millions with one decimal", () => {
    expect(millionsAbs(152100000)).toBe("152.1");
    expect(millionsAbs(-13600000)).toBe("13.6");
    expect(millionsAbs(0)).toBe("0.0");
  });

  it("coerces non-finite input to 0.0", () => {
    expect(millionsAbs(Number.NaN)).toBe("0.0");
  });
});
