/*
 * ar-cn-rows unit tests (ar.cn, gate G3) — the pure AR-credit-note logic ported from
 * accounting-extra2.jsx ARCreditNote + ARCNForm (toCnRow / vatPreview / preVatBase / statusKind /
 * statusTone / reasonTone / formatMoney / formatDate / cnCount / countStatus / sumAmount /
 * sumVatApproved / parseAmount / cnFormValid / buildCreateCnBody). Guards the opaque-row narrowing
 * (incl. honest empties on null customer/ref/reason/status/date), the CLIENT VAT-preview math (the
 * SERVER remains authoritative), the derived KPI sums, and the POST-body shaping. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toCnRow,
  vatPreview,
  preVatBase,
  statusKind,
  statusTone,
  reasonTone,
  formatMoney,
  formatDate,
  cnCount,
  countStatus,
  sumAmount,
  sumVatApproved,
  parseAmount,
  cnFormValid,
  buildCreateCnBody,
  type CnRow,
} from "./ar-cn-rows";

/** A minimal wire row factory (snake_case Entity, ar.ts cnWire shape). */
function wire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cn-1",
    no: "CN-2569-008",
    customer_id: "cust-1",
    ref_invoice_id: "inv-1",
    reason: "cancel-booking",
    amount: 200000,
    vat: 13084.11,
    currency_code: "THB",
    status: "approved",
    note_date: null,
    created_at: "2026-06-18T03:00:00.000Z",
    ...over,
  };
}

/** A narrowed CnRow factory. */
function row(over: Partial<CnRow> = {}): CnRow {
  return {
    id: "cn-1",
    no: "CN-2569-008",
    customerId: "cust-1",
    refInvoiceId: "inv-1",
    reason: "r",
    amount: 200000,
    vat: 13084,
    currencyCode: "THB",
    status: "approved",
    noteDate: "",
    createdAt: "2026-06-18T03:00:00.000Z",
    ...over,
  };
}

describe("toCnRow", () => {
  it("narrows the snake_case wire to a CnRow", () => {
    const r = toCnRow(wire());
    expect(r.no).toBe("CN-2569-008");
    expect(r.customerId).toBe("cust-1");
    expect(r.refInvoiceId).toBe("inv-1");
    expect(r.amount).toBe(200000);
    expect(r.vat).toBe(13084.11);
    expect(r.status).toBe("approved");
  });

  it("honestly empties null customer / ref / reason / status / note_date (never fabricated)", () => {
    const r = toCnRow(
      wire({ customer_id: null, ref_invoice_id: null, reason: null, status: null, note_date: null }),
    );
    expect(r.customerId).toBe("");
    expect(r.refInvoiceId).toBe("");
    expect(r.reason).toBe("");
    expect(r.status).toBe("");
    expect(r.noteDate).toBe("");
  });

  it("coerces a numeric-string amount/vat to a number", () => {
    const r = toCnRow(wire({ amount: "150000", vat: "9813.08" }));
    expect(r.amount).toBe(150000);
    expect(r.vat).toBeCloseTo(9813.08, 2);
  });
});

describe("vatPreview / preVatBase (CLIENT preview only — server owns the authoritative VAT)", () => {
  it("extracts round(amount x 7/107) — matches the B-121 live proof (10700 -> 700)", () => {
    expect(vatPreview(10700)).toBe(700);
  });

  it("extracts round(amount x 7/107) for the seed gross (200000 -> 13084)", () => {
    expect(vatPreview(200000)).toBe(13084);
    expect(vatPreview(340000)).toBe(22243);
  });

  it("computes the pre-VAT base = round(amount x 100/107)", () => {
    expect(preVatBase(10700)).toBe(10000);
    expect(preVatBase(200000)).toBe(186916);
  });

  it("guards non-finite / non-positive input -> 0", () => {
    expect(vatPreview(0)).toBe(0);
    expect(vatPreview(-100)).toBe(0);
    expect(vatPreview(Number.NaN)).toBe(0);
    expect(preVatBase(0)).toBe(0);
  });

  it("preview VAT + pre-VAT base reconstruct the gross (10700)", () => {
    expect(preVatBase(10700) + vatPreview(10700)).toBe(10700);
  });
});

describe("statusKind (prototype else-branch: draft/''/unknown -> draft)", () => {
  it("maps the three real statuses", () => {
    expect(statusKind("approved")).toBe("approved");
    expect(statusKind("pending")).toBe("pending");
    expect(statusKind("draft")).toBe("draft");
  });

  it("maps '' (a freshly-created / un-flipped CN) + unknown to draft", () => {
    expect(statusKind("")).toBe("draft");
    expect(statusKind("whatever")).toBe("draft");
  });
});

describe("statusTone", () => {
  it("returns the ds.jsx STATUS tokens per kind", () => {
    expect(statusTone("approved")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" });
    expect(statusTone("pending")).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" });
    expect(statusTone("draft")).toEqual({ bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" });
  });
});

describe("reasonTone (cancel-booking -> danger, else info; Thai stays in the dict)", () => {
  // ASCII stand-ins for the dict reason values (the fn is content-agnostic equality, B-073).
  const cancel = "cancel-booking-reason";
  it("is danger for the cancel-booking reason", () => {
    expect(reasonTone(cancel, cancel)).toBe("var(--danger)");
  });
  it("is info for any other reason", () => {
    expect(reasonTone("variation-order-reason", cancel)).toBe("var(--info)");
  });
  it("is info for an empty reason (never danger)", () => {
    expect(reasonTone("", cancel)).toBe("var(--info)");
  });
});

describe("formatMoney", () => {
  it("groups with thousands separators, no decimals", () => {
    expect(formatMoney(200000)).toBe("200,000");
    expect(formatMoney(13084.11)).toBe("13,084");
    expect(formatMoney(0)).toBe("0");
  });
  it("guards a non-finite value -> '0'", () => {
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("formatDate (note_date, else created_at, UTC YYYY-MM-DD)", () => {
  it("prefers note_date when present", () => {
    expect(formatDate("2026-07-01", "2026-06-18T03:00:00.000Z")).toBe("2026-07-01");
  });
  it("falls back to created_at when note_date is empty", () => {
    expect(formatDate("", "2026-06-18T03:00:00.000Z")).toBe("2026-06-18");
  });
  it("returns '' for a missing/invalid timestamp (the cell then em-dashes)", () => {
    expect(formatDate("", "")).toBe("");
    expect(formatDate("", "not-a-date")).toBe("");
  });
});

describe("KPI sums (real, honest on empty)", () => {
  const rows: CnRow[] = [
    row({ id: "a", amount: 200000, vat: 13084, status: "approved" }),
    row({ id: "b", amount: 340000, vat: 22243, status: "pending" }),
    row({ id: "c", amount: 150000, vat: 9813, status: "draft" }),
    row({ id: "d", amount: 100000, vat: 6542, status: "" }), // un-flipped new CN -> draft, not counted approved
  ];

  it("cnCount is the row length", () => {
    expect(cnCount(rows)).toBe(4);
    expect(cnCount([])).toBe(0);
  });

  it("countStatus counts by the derived kind", () => {
    expect(countStatus(rows, "approved")).toBe(1);
    expect(countStatus(rows, "pending")).toBe(1);
    expect(countStatus(rows, "draft")).toBe(2); // draft + the status="" row
  });

  it("sumAmount totals every gross amount (incl VAT)", () => {
    expect(sumAmount(rows)).toBe(790000);
    expect(sumAmount([])).toBe(0);
  });

  it("sumVatApproved totals the REAL wire vat of APPROVED rows only", () => {
    expect(sumVatApproved(rows)).toBe(13084);
    expect(sumVatApproved([])).toBe(0);
  });
});

describe("parseAmount", () => {
  it("parses a positive amount", () => {
    expect(parseAmount("150000")).toBe(150000);
  });
  it("returns 0 for empty / non-positive / non-numeric", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("-5")).toBe(0);
    expect(parseAmount("abc")).toBe(0);
  });
});

describe("cnFormValid (customer + invoice ref + positive amount all required)", () => {
  it("is valid when all three are present", () => {
    expect(cnFormValid({ customerId: "c", refInvoiceId: "i", reason: "r", amount: "150000" })).toBe(true);
  });
  it("is invalid without a customer", () => {
    expect(cnFormValid({ customerId: "", refInvoiceId: "i", reason: "r", amount: "150000" })).toBe(false);
  });
  it("is invalid without an invoice ref (server rejects a missing ref)", () => {
    expect(cnFormValid({ customerId: "c", refInvoiceId: "", reason: "r", amount: "150000" })).toBe(false);
  });
  it("is invalid without a positive amount", () => {
    expect(cnFormValid({ customerId: "c", refInvoiceId: "i", reason: "r", amount: "0" })).toBe(false);
  });
});

describe("buildCreateCnBody (opaque POST /ar/cn body — client sends gross amount, server owns VAT)", () => {
  it("shapes the snake_case body with the client-supplied no", () => {
    const body = buildCreateCnBody("CN-2026-123456", {
      customerId: "cust-1",
      refInvoiceId: "inv-1",
      reason: "discount-reason",
      amount: "150000",
    });
    expect(body).toEqual({
      no: "CN-2026-123456",
      customer_id: "cust-1",
      ref_invoice_id: "inv-1",
      reason: "discount-reason",
      amount: 150000,
    });
  });

  it("never sends a client vat/total (server authority)", () => {
    const body = buildCreateCnBody("CN-2026-000001", {
      customerId: "c",
      refInvoiceId: "i",
      reason: "r",
      amount: "10700",
    });
    expect(body).not.toHaveProperty("vat");
    expect(body).not.toHaveProperty("total");
    expect(body.amount).toBe(10700);
  });
});
