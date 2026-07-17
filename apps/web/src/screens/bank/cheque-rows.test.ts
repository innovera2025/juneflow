/*
 * cheque-rows unit tests (P2-WEB-15, gate G3) — the pure cheque-register logic ported
 * from bank.jsx BankCheque (toChequeRow / formatMoney / formatMillions /
 * chequeStatusKind / chequeStatusTone / chequeKpis / chequeTabCounts). Guards the
 * opaque-row narrowing (incl. honest-null pv_no), the by-status KPI derivations
 * (and the honest-null this-month / received KPIs), and the presentational tab counts.
 * ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toChequeRow,
  formatMoney,
  formatMillions,
  chequeStatusKind,
  chequeStatusTone,
  chequeKpis,
  chequeTabCounts,
  type ChequeRow,
} from "./cheque-rows";

const row = (p: Partial<ChequeRow> = {}): ChequeRow => ({
  id: "c1",
  no: "CH-040128",
  amount: 561150,
  dueDate: "2026-05-25",
  status: "wait",
  pvId: "",
  pvNo: "",
  currencyCode: "THB",
  createdAt: "",
  ...p,
});

describe("toChequeRow", () => {
  it("narrows a full opaque /bank/cheque row, honest-null pv_no preserved", () => {
    expect(
      toChequeRow({
        id: "c1",
        no: "CH-040128",
        amount: 561150,
        due_date: "2026-05-25",
        status: "wait",
        pv_id: "pv-1",
        pv_no: null,
        currency_code: "THB",
        created_at: "2026-05-25T00:00:00.000Z",
      }),
    ).toEqual({
      id: "c1",
      no: "CH-040128",
      amount: 561150,
      dueDate: "2026-05-25",
      status: "wait",
      pvId: "pv-1",
      pvNo: "",
      currencyCode: "THB",
      createdAt: "2026-05-25T00:00:00.000Z",
    });
  });

  it("coerces a numeric-string amount and defaults missing fields", () => {
    const r = toChequeRow({ id: "c2", amount: "184500" });
    expect(r.amount).toBe(184500);
    expect(r.no).toBe("");
    expect(r.pvNo).toBe("");
  });
});

describe("formatters", () => {
  it("formatMoney groups thousands, no decimals or baht", () => {
    expect(formatMoney(561150)).toBe("561,150");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
  it("formatMillions is 2dp", () => {
    expect(formatMillions(8420000)).toBe("8.42");
  });
});

describe("chequeStatusKind + chequeStatusTone", () => {
  it("maps cleared/returned and falls back to wait", () => {
    expect(chequeStatusKind("cleared")).toBe("cleared");
    expect(chequeStatusKind("returned")).toBe("returned");
    expect(chequeStatusKind("wait")).toBe("wait");
    expect(chequeStatusKind("weird")).toBe("wait");
  });
  it("tones cleared->ok, wait->warn, returned->danger", () => {
    expect(chequeStatusTone("cleared").fg).toBe("var(--ok)");
    expect(chequeStatusTone("wait").fg).toBe("var(--warn)");
    expect(chequeStatusTone("returned").fg).toBe("var(--danger)");
  });
});

describe("chequeKpis", () => {
  it("derives by-status counts + amounts; this-month/received stay honest null", () => {
    const rows = [
      row({ status: "wait", amount: 561150 }),
      row({ status: "wait", amount: 402938 }),
      row({ status: "cleared", amount: 184500 }),
      row({ status: "cleared", amount: 380400 }),
      row({ status: "returned", amount: 84500 }),
    ];
    const k = chequeKpis(rows);
    expect(k.thisMonthCount).toBeNull();
    expect(k.receivedCount).toBeNull();
    expect(k.waitCount).toBe(2);
    expect(k.waitAmount).toBe(964088);
    expect(k.clearedCount).toBe(2);
    expect(k.clearedAmount).toBe(564900);
    expect(k.returnedCount).toBe(1);
    expect(k.returnedAmount).toBe(84500);
  });
});

describe("chequeTabCounts", () => {
  it("out = all rows, received = 0 (no direction), wait/returned by-status", () => {
    const rows = [
      row({ status: "wait" }),
      row({ status: "cleared" }),
      row({ status: "returned" }),
    ];
    expect(chequeTabCounts(rows)).toEqual({ out: 3, received: 0, wait: 1, returned: 1 });
  });
});
