/*
 * ar-rv-rows unit tests (ar.rv, gate G3) — the pure receive-voucher logic ported
 * from ar.jsx ARReceiveVoucher + RVCreateForm (toRvRow / formatMoney / formatDate /
 * methodKey / methodTone / isRetentionRefund / rvKpis / statusKind / statusTone /
 * toInvoiceOption / unpaidInvoices / computeOutstanding / isOverAllocated /
 * rvSubmittable / buildRvBody). Guards the opaque-row narrowing (incl. honest-null
 * no/method + retention-refund detection), the derived KPI counts, the outstanding
 * calc + over-allocation detection path (B-121, server-authoritative — no clamp),
 * and the SINGLE-invoice POST-body shaping. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toRvRow,
  formatMoney,
  formatDate,
  methodKey,
  methodTone,
  isRetentionRefund,
  rvKpis,
  statusKind,
  statusTone,
  toInvoiceOption,
  unpaidInvoices,
  computeOutstanding,
  isOverAllocated,
  rvSubmittable,
  buildRvBody,
  type RvRow,
  type InvoiceOption,
  type RvDraft,
} from "./ar-rv-rows";

const row = (p: Partial<RvRow> = {}): RvRow => ({
  id: "r1",
  no: "",
  invoiceId: "inv-1",
  amount: 0,
  currencyCode: "THB",
  method: "",
  receiptDate: "",
  bank: "",
  status: "open",
  source: "invoice",
  createdAt: "",
  ...p,
});

describe("toRvRow", () => {
  it("narrows a full opaque /ar/rv row (snake_case), honest nulls preserved", () => {
    expect(
      toRvRow({
        id: "r1",
        invoice_id: "inv-9",
        no: null,
        amount: 728000,
        currency_code: "THB",
        method: "transfer",
        receipt_date: "2026-05-24",
        bank: "KBANK",
        status: "posted",
        source: "invoice",
        created_at: "2026-05-24T00:00:00.000Z",
      }),
    ).toEqual({
      id: "r1",
      no: "",
      invoiceId: "inv-9",
      amount: 728000,
      currencyCode: "THB",
      method: "transfer",
      receiptDate: "2026-05-24",
      bank: "KBANK",
      status: "posted",
      source: "invoice",
      createdAt: "2026-05-24T00:00:00.000Z",
    });
  });

  it("keeps method '' + invoice_id '' when absent (retention-refund shape)", () => {
    const r = toRvRow({ id: "r2", amount: "84500", source: "retention-refund" });
    expect(r.method).toBe("");
    expect(r.invoiceId).toBe("");
    expect(r.amount).toBe(84500);
  });
});

describe("formatters", () => {
  it("formatMoney groups thousands", () => {
    expect(formatMoney(2148000)).toBe("2,148,000");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
  it("formatDate prefers receipt_date, falls back to created_at, '' otherwise", () => {
    expect(formatDate("2026-05-24", "2026-05-25T13:45:00.000Z")).toBe("2026-05-24");
    expect(formatDate("", "2026-05-25T13:45:00.000Z")).toBe("2026-05-25");
    expect(formatDate("", "")).toBe("");
    expect(formatDate("nope", "")).toBe("");
  });
});

describe("methodKey + methodTone", () => {
  it("narrows known methods and '' otherwise", () => {
    expect(methodKey("transfer")).toBe("transfer");
    expect(methodKey("cheque")).toBe("cheque");
    expect(methodKey("cash")).toBe("cash");
    expect(methodKey("wire")).toBe("");
  });
  it("tones transfer info, cheque warn, cash ok", () => {
    expect(methodTone("transfer").fg).toBe("var(--info)");
    expect(methodTone("cheque").fg).toBe("var(--warn)");
    expect(methodTone("cash").fg).toBe("var(--ok)");
  });
});

describe("isRetentionRefund + rvKpis", () => {
  it("detects a retention-refund by null invoice_id", () => {
    expect(isRetentionRefund(row({ invoiceId: "" }))).toBe(true);
    expect(isRetentionRefund(row({ invoiceId: "inv-1" }))).toBe(false);
  });
  it("derives transfer / cheque / retention-refund counts", () => {
    const rows = [
      row({ method: "transfer", invoiceId: "inv-1" }),
      row({ method: "transfer", invoiceId: "inv-2" }),
      row({ method: "cheque", invoiceId: "inv-3" }),
      row({ method: "cash", invoiceId: "inv-4" }),
      row({ method: "transfer", invoiceId: "", source: "retention-refund" }),
    ];
    expect(rvKpis(rows)).toEqual({
      transferCount: 3,
      chequeCount: 1,
      retentionCount: 1,
    });
  });
  it("counts a legitimate 0 on an empty list (AR Phase-5-deferred honest-empty)", () => {
    expect(rvKpis([])).toEqual({ transferCount: 0, chequeCount: 0, retentionCount: 0 });
  });
});

describe("statusKind + statusTone", () => {
  it("maps open / posted with a draft fallback", () => {
    expect(statusKind("open")).toBe("open");
    expect(statusKind("posted")).toBe("posted");
    expect(statusKind("weird")).toBe("other");
    expect(statusTone("posted").fg).toBe("var(--ok)");
    expect(statusTone("open").fg).toBe("var(--warn)");
    expect(statusTone("weird").fg).toBe("var(--draft)");
  });
});

describe("invoice picker (unpaid + outstanding)", () => {
  const inv = (p: Partial<InvoiceOption> = {}): InvoiceOption => ({
    id: "inv-1",
    no: "INV-2026-0418",
    amount: 728000,
    vat: 0,
    outstanding: 728000,
    status: "open",
    currencyCode: "THB",
    ...p,
  });

  it("narrows an opaque /ar/invoices row with its server outstanding", () => {
    expect(
      toInvoiceOption({
        id: "inv-1",
        no: "INV-2026-0413",
        amount: 184000,
        vat: 12880,
        outstanding: 196880,
        status: "open",
        currency_code: "THB",
      }),
    ).toEqual({
      id: "inv-1",
      no: "INV-2026-0413",
      amount: 184000,
      vat: 12880,
      outstanding: 196880,
      status: "open",
      currencyCode: "THB",
    });
  });

  it("unpaidInvoices keeps positive-outstanding, non-paid rows only", () => {
    const rows = [
      inv({ id: "a", status: "open", outstanding: 728000 }),
      inv({ id: "b", status: "paid", outstanding: 0 }),
      inv({ id: "c", status: "open", outstanding: 0 }),
    ];
    expect(unpaidInvoices(rows).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("outstanding + over-allocation (server-authoritative, no clamp)", () => {
  it("computeOutstanding mirrors amount + vat - received", () => {
    expect(computeOutstanding(184000, 12880, 0)).toBe(196880);
    expect(computeOutstanding(728000, 0, 500000)).toBe(228000);
    expect(computeOutstanding(728000, 0, -5)).toBe(728000); // negative received clamps
  });
  it("isOverAllocated flags a receipt greater than the outstanding", () => {
    expect(isOverAllocated(728001, 728000)).toBe(true);
    expect(isOverAllocated(728000, 728000)).toBe(false); // exact = allowed
    expect(isOverAllocated(200000, 728000)).toBe(false);
  });
});

describe("create-form helpers", () => {
  const draft = (p: Partial<RvDraft> = {}): RvDraft => ({
    invoiceId: "",
    amount: 0,
    method: "",
    ...p,
  });

  it("rvSubmittable requires an invoice and a positive amount", () => {
    expect(rvSubmittable(draft())).toBe(false);
    expect(rvSubmittable(draft({ invoiceId: "inv-1" }))).toBe(false);
    expect(rvSubmittable(draft({ invoiceId: "inv-1", amount: 100 }))).toBe(true);
  });

  it("buildRvBody sends a single invoice_id + amount, method only when picked", () => {
    expect(
      buildRvBody(draft({ invoiceId: "  inv-9  ", amount: 728000, method: "transfer" })),
    ).toEqual({
      invoice_id: "inv-9",
      amount: 728000,
      method: "transfer",
    });
  });

  it("buildRvBody omits method when unset (real cash amount, never clamped)", () => {
    expect(buildRvBody(draft({ invoiceId: "inv-1", amount: 145000 }))).toEqual({
      invoice_id: "inv-1",
      amount: 145000,
    });
  });
});
