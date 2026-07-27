/*
 * sales-loan-rows unit tests (gate G3) — the pure SalesLoan register logic ported from
 * pototype/sales-process.jsx SalesLoan (toLoanRow / isLoanStatus / filterLoanByTab /
 * loanTabCount / countByStatus / countRejectedOrReduced / statusTone / statusLabelKind /
 * formatMoney). Guards the opaque-row narrowing (snake_case + camelCase, the money
 * number|null, the nullable term), the 5-status tab partition (partial appears only under
 * "all"), the real KPI counts (C10), and the per-status badge tone/label mapping.
 * ASCII-only test data (B-073) — no Thai in source.
 */
import { describe, it, expect } from "vitest";
import {
  toLoanRow,
  isLoanStatus,
  filterLoanByTab,
  loanTabCount,
  countByStatus,
  countRejectedOrReduced,
  statusTone,
  statusLabelKind,
  formatMoney,
  LOAN_STATUSES,
  LOAN_TABS,
  type LoanRow,
} from "./sales-loan-rows";

const loan = (p: Partial<LoanRow> = {}): LoanRow => ({
  id: "loan-1",
  salesUnitId: "unit-1",
  bank: "KBANK",
  askAmt: 4_185_000,
  approvedAmt: 4_185_000,
  currencyCode: "THB",
  term: 30,
  submitDate: "2026-05-10",
  resultDate: "2026-05-22",
  status: "approved",
  ...p,
});

describe("toLoanRow", () => {
  it("maps the snake_case wire fields", () => {
    expect(
      toLoanRow({
        id: "loan-9",
        sales_unit_id: "unit-9",
        bank: "SCB",
        ask_amt: 6_156_000,
        approved_amt: 6_156_000,
        currency_code: "THB",
        term: 30,
        submit_date: "2026-05-05",
        result_date: "2026-05-20",
        status: "transfer",
        created_at: "2026-05-01T00:00:00Z",
      }),
    ).toEqual({
      id: "loan-9",
      salesUnitId: "unit-9",
      bank: "SCB",
      askAmt: 6_156_000,
      approvedAmt: 6_156_000,
      currencyCode: "THB",
      term: 30,
      submitDate: "2026-05-05",
      resultDate: "2026-05-20",
      status: "transfer",
    });
  });

  it("accepts camelCase aliases for the multi-word fields", () => {
    const r = toLoanRow({ id: "loan-2", salesUnitId: "u-2", askAmt: 1000, approvedAmt: 900, submitDate: "2026-06-01" });
    expect(r.salesUnitId).toBe("u-2");
    expect(r.askAmt).toBe(1000);
    expect(r.approvedAmt).toBe(900);
    expect(r.submitDate).toBe("2026-06-01");
  });

  it("parses money to a number or null (null = unset, never NaN)", () => {
    expect(toLoanRow({ approved_amt: null }).approvedAmt).toBeNull();
    expect(toLoanRow({ approved_amt: "" }).approvedAmt).toBeNull();
    expect(toLoanRow({ approved_amt: 0 }).approvedAmt).toBe(0);
    expect(toLoanRow({ approved_amt: "3800000" }).approvedAmt).toBe(3_800_000);
    expect(toLoanRow({}).askAmt).toBeNull();
  });

  it("parses term to an int or null (never NaN)", () => {
    expect(toLoanRow({ term: 30 }).term).toBe(30);
    expect(toLoanRow({ term: "25" }).term).toBe(25);
    expect(toLoanRow({ term: null }).term).toBeNull();
    expect(toLoanRow({}).term).toBeNull();
  });

  it("defaults missing string fields to empty strings (never undefined)", () => {
    expect(toLoanRow({})).toEqual({
      id: "",
      salesUnitId: "",
      bank: "",
      askAmt: null,
      approvedAmt: null,
      currencyCode: "",
      term: null,
      submitDate: "",
      resultDate: "",
      status: "",
    });
  });
});

describe("isLoanStatus", () => {
  it("accepts every one of the 5 known statuses", () => {
    for (const s of LOAN_STATUSES) expect(isLoanStatus(s)).toBe(true);
  });

  it("rejects an unknown status value", () => {
    expect(isLoanStatus("closed")).toBe(false);
    expect(isLoanStatus("")).toBe(false);
  });
});

describe("filterLoanByTab", () => {
  const rows = [
    loan({ id: "a", status: "submitted" }),
    loan({ id: "b", status: "approved" }),
    loan({ id: "c", status: "transfer" }),
    loan({ id: "d", status: "rejected" }),
    loan({ id: "e", status: "partial" }),
    loan({ id: "f", status: "approved" }),
  ];

  it("returns every loan under the 'all' tab", () => {
    expect(filterLoanByTab(rows, "all").map((r) => r.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("partitions each status tab to that single status", () => {
    expect(filterLoanByTab(rows, "submitted").map((r) => r.id)).toEqual(["a"]);
    expect(filterLoanByTab(rows, "approved").map((r) => r.id)).toEqual(["b", "f"]);
    expect(filterLoanByTab(rows, "transfer").map((r) => r.id)).toEqual(["c"]);
    expect(filterLoanByTab(rows, "rejected").map((r) => r.id)).toEqual(["d"]);
  });

  it("shows a 'partial' loan only under 'all' (no partial tab exists)", () => {
    const inTabs = LOAN_TABS.filter((tab) => tab !== "all").some((tab) =>
      filterLoanByTab(rows, tab).some((r) => r.status === "partial"),
    );
    expect(inTabs).toBe(false);
    expect(filterLoanByTab(rows, "all").some((r) => r.status === "partial")).toBe(true);
  });

  it("loanTabCount is the real length of the filtered set (C10)", () => {
    expect(loanTabCount(rows, "all")).toBe(6);
    expect(loanTabCount(rows, "approved")).toBe(2);
    expect(loanTabCount(rows, "transfer")).toBe(1);
    expect(loanTabCount([], "all")).toBe(0);
  });
});

describe("countByStatus + countRejectedOrReduced (KPI aggregates)", () => {
  const rows = [
    loan({ status: "submitted" }),
    loan({ status: "submitted" }),
    loan({ status: "approved" }),
    loan({ status: "rejected" }),
    loan({ status: "partial" }),
  ];

  it("counts an exact status", () => {
    expect(countByStatus(rows, "submitted")).toBe(2);
    expect(countByStatus(rows, "approved")).toBe(1);
    expect(countByStatus(rows, "transfer")).toBe(0);
  });

  it("counts rejected OR reduced-limit (partial) together for the rejected KPI", () => {
    expect(countRejectedOrReduced(rows)).toBe(2);
    expect(countRejectedOrReduced([])).toBe(0);
  });
});

describe("statusTone + statusLabelKind", () => {
  it("maps each status to its prototype badge tone", () => {
    expect(statusTone("transfer")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)" });
    expect(statusTone("submitted")).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)" });
    expect(statusTone("rejected")).toEqual({ bg: "var(--danger-soft)", fg: "var(--danger)" });
    expect(statusTone("partial")).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)" });
    expect(statusTone("approved")).toEqual({ bg: "var(--accent-soft)", fg: "var(--accent)" });
  });

  it("falls back to the approved (accent) tone for an unknown status", () => {
    expect(statusTone("weird")).toEqual({ bg: "var(--accent-soft)", fg: "var(--accent)" });
  });

  it("maps each status to its badge label kind (approved/unknown -> ready)", () => {
    expect(statusLabelKind("transfer")).toBe("transfer");
    expect(statusLabelKind("submitted")).toBe("waiting");
    expect(statusLabelKind("rejected")).toBe("rejected");
    expect(statusLabelKind("partial")).toBe("partial");
    expect(statusLabelKind("approved")).toBe("ready");
    expect(statusLabelKind("weird")).toBe("ready");
  });
});

describe("formatMoney", () => {
  it("groups a full-unit amount with thousands separators", () => {
    expect(formatMoney(4_185_000)).toBe("4,185,000");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(3_800_000)).toBe("3,800,000");
  });

  it("rounds and never returns NaN", () => {
    expect(formatMoney(1234.6)).toBe("1,235");
    expect(formatMoney(Number.NaN)).toBe("0");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("0");
  });
});
