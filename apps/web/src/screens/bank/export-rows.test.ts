/*
 * export-rows unit tests (P2-WEB-15, gate G3) — the pure bank-file export logic ported
 * from bank.jsx BankExport (splitBank / toExportPv / isExportEligible /
 * eligibleExportPvs / formatMoney / formatMillions / exportSelection / buildExportBody /
 * toExportResult). Guards the eligibility filter (approved + transfer), the vendor
 * bank-string split (incl. honest-empty account), the selection totals, the POST body
 * shaping, and the result narrowing. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  splitBank,
  toExportPv,
  isExportEligible,
  eligibleExportPvs,
  formatMoney,
  formatMillions,
  exportSelection,
  buildExportBody,
  toExportResult,
  type ExportPv,
} from "./export-rows";

const bankOf = (map: Record<string, string>) => (id: string) => map[id] ?? "";

describe("splitBank", () => {
  it("splits a bank code + account on the first whitespace", () => {
    expect(splitBank("KBANK 012-3-45678-9")).toEqual({ bank: "KBANK", account: "012-3-45678-9" });
    expect(splitBank("SCB  111-2-33445-6")).toEqual({ bank: "SCB", account: "111-2-33445-6" });
  });
  it("treats a whitespace-less string as the bank code, empty account", () => {
    expect(splitBank("KBANK")).toEqual({ bank: "KBANK", account: "" });
  });
  it("returns both empty for a blank string", () => {
    expect(splitBank("")).toEqual({ bank: "", account: "" });
    expect(splitBank("   ")).toEqual({ bank: "", account: "" });
  });
});

describe("toExportPv", () => {
  it("narrows a pv row + resolves the beneficiary bank/account from the vendor", () => {
    const pv = toExportPv(
      { id: "pv1", no: null, payee: "CPC", net: 892400, amount: 920000, method: "transfer", status: "approved", vendor_id: "v1" },
      bankOf({ v1: "KBANK 012-3-45678-9" }),
    );
    expect(pv).toEqual({
      id: "pv1",
      no: "",
      payee: "CPC",
      net: 892400,
      amount: 920000,
      method: "transfer",
      status: "approved",
      // absent on the wire row above -> "" (still waiting to be sent)
      batchId: "",
      vendorId: "v1",
      bank: "KBANK",
      account: "012-3-45678-9",
    });
  });
  it("em-dashes (empty) the bank/account when the vendor has no bank string", () => {
    const pv = toExportPv({ id: "pv2", vendor_id: "v9", method: "transfer", status: "approved" }, bankOf({}));
    expect(pv.bank).toBe("");
    expect(pv.account).toBe("");
  });
});

describe("isExportEligible + eligibleExportPvs", () => {
  const pv = (p: Partial<ExportPv>): ExportPv => ({
    id: "p",
    no: "",
    payee: "",
    net: 0,
    amount: 0,
    method: "transfer",
    status: "approved",
    batchId: "",
    vendorId: "",
    bank: "",
    account: "",
    ...p,
  });

  it("only approved + transfer PVs are eligible", () => {
    expect(isExportEligible(pv({}))).toBe(true);
    expect(isExportEligible(pv({ status: "pending" }))).toBe(false);
    expect(isExportEligible(pv({ method: "cheque" }))).toBe(false);
    expect(isExportEligible(pv({ method: "cash", status: "approved" }))).toBe(false);
  });

  it("drops a PV the server already sent to the bank (B-397)", () => {
    // Every export from this screen names pv_ids explicitly, and B-397 answers
    // 409 for the WHOLE batch when any named voucher carries a batch id. So an
    // already-sent PV must never reach the selectable list.
    expect(isExportEligible(pv({ batchId: "b1000000-0000-0000-0000-000000000001" }))).toBe(
      false,
    );
    expect(isExportEligible(pv({ batchId: "" }))).toBe(true);
  });

  it("narrows + filters opaque rows to the eligible set", () => {
    const rows = [
      { id: "a", status: "approved", method: "transfer", vendor_id: "v1", net: 100 },
      { id: "b", status: "pending", method: "transfer", vendor_id: "v1", net: 200 },
      { id: "c", status: "approved", method: "cheque", vendor_id: "v1", net: 300 },
      // sent already — the wire carries batch_id, so it must not be offered
      { id: "d", status: "approved", method: "transfer", vendor_id: "v1", net: 400,
        batch_id: "b1000000-0000-0000-0000-000000000001" },
    ];
    const out = eligibleExportPvs(rows, bankOf({ v1: "KBANK 1" }));
    expect(out.map((p) => p.id)).toEqual(["a"]);
    expect(out[0]!.bank).toBe("KBANK");
  });

  it("reads batch_id off the opaque wire row", () => {
    const [row] = eligibleExportPvs(
      [{ id: "a", status: "approved", method: "transfer", vendor_id: "v1", net: 100 }],
      bankOf({ v1: "KBANK 1" }),
    );
    expect(row!.batchId).toBe("");
    expect(
      toExportPv(
        { id: "x", status: "approved", method: "transfer", vendor_id: "v1", net: 1,
          batch_id: "b1000000-0000-0000-0000-000000000001" },
        bankOf({ v1: "KBANK 1" }),
      ).batchId,
    ).toBe("b1000000-0000-0000-0000-000000000001");
  });
});

describe("formatters", () => {
  it("formatMoney groups thousands", () => {
    expect(formatMoney(894206)).toBe("894,206");
  });
  it("formatMillions is 2dp", () => {
    expect(formatMillions(2840000)).toBe("2.84");
  });
});

describe("exportSelection", () => {
  const pv = (id: string, net: number): ExportPv => ({
    id,
    no: "",
    payee: "",
    net,
    amount: net,
    method: "transfer",
    status: "approved",
    batchId: "",
    vendorId: "",
    bank: "",
    account: "",
  });

  it("counts selected + sums their net over the eligible total", () => {
    const rows = [pv("a", 894206), pv("b", 93896), pv("c", 268000), pv("d", 184500)];
    const sel = exportSelection(rows, new Set(["a", "b"]));
    expect(sel).toEqual({ count: 2, total: 4, amount: 988102 });
  });
});

describe("buildExportBody", () => {
  it("sends the selected pv_ids only when no options are given", () => {
    expect(buildExportBody(["a", "b"])).toEqual({ pv_ids: ["a", "b"] });
  });
  it("includes only present options", () => {
    expect(buildExportBody(["a"], { valueDate: "2026-05-26", debitAccountNo: " 012-3 " })).toEqual({
      pv_ids: ["a"],
      value_date: "2026-05-26",
      debit_account_no: "012-3",
    });
  });
  it("omits blank options", () => {
    expect(buildExportBody(["a"], { valueDate: "  ", debitAccountNo: "" })).toEqual({ pv_ids: ["a"] });
  });
});

describe("toExportResult", () => {
  it("reads the export-batch result off the opaque response", () => {
    expect(
      toExportResult({
        batch_id: "b1",
        file_name: "PAY-20260526.txt",
        content: "H|...\nD|...",
        format: "fake",
        pv_count: 4,
        total_amount: 1440000,
      }),
    ).toEqual({
      batchId: "b1",
      fileName: "PAY-20260526.txt",
      content: "H|...\nD|...",
      format: "fake",
      pvCount: 4,
      totalAmount: 1440000,
    });
  });
});
