/*
 * ar-invoice-rows unit tests (ar.invoice, gate G3) — the pure AR-invoice logic
 * ported from ar.jsx ARInvoice + ARInvoiceForm (toInvoiceRow / statusView / daysUntil /
 * tab filter+count / KPI derivations / money format / line-preview math). Guards the
 * opaque-row narrowing, the honest open/paid status + due-date arithmetic, and the
 * create-form preview math (incl. empty) against regression. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toInvoiceRow,
  toCustomerRef,
  customerById,
  statusView,
  daysUntil,
  isOpen,
  isPaid,
  isOverdue,
  isDueSoon,
  filterByTab,
  tabCount,
  openInvoices,
  overdueInvoices,
  dueSoonInvoices,
  distinctCustomerCount,
  sumAmount,
  sumOutstanding,
  formatMoney,
  millionsValue,
  round2,
  parseAmount,
  lineTotal,
  sumLineAmounts,
  previewSubtotal,
  previewVat,
  previewTotal,
  isLineComplete,
  toWireLines,
  type InvoiceRow,
  type LineDraft,
} from "./ar-invoice-rows";

// A fixed "now" so the due-date arithmetic is deterministic: 2026-06-01T00:00:00Z.
const NOW = Date.parse("2026-06-01T00:00:00Z");

function inv(over: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "i1",
    no: "INV-2026-0001",
    customerId: "c1",
    projectId: "",
    amount: 100_000,
    vat: 7_000,
    currencyCode: "THB",
    creditTerm: 30,
    dueDate: "2026-06-15",
    status: "open",
    etaxStatus: "queued",
    outstanding: 107_000,
    createdAt: "2026-05-01T00:00:00Z",
    ...over,
  };
}

describe("toInvoiceRow", () => {
  it("narrows a snake_case wire row incl. outstanding", () => {
    const r = toInvoiceRow({
      id: "x",
      no: "INV-2026-0418",
      customer_id: "cust-1",
      project_id: "proj-9",
      amount: 728000,
      vat: 0,
      currency_code: "THB",
      credit_term: 14,
      due_date: "2026-06-08",
      status: "open",
      etax_status: "queued",
      outstanding: 728000,
      created_at: "2026-05-25T00:00:00Z",
    });
    expect(r).toMatchObject({
      id: "x",
      no: "INV-2026-0418",
      customerId: "cust-1",
      projectId: "proj-9",
      amount: 728000,
      vat: 0,
      creditTerm: 14,
      dueDate: "2026-06-08",
      status: "open",
      etaxStatus: "queued",
      outstanding: 728000,
    });
  });

  it("falls back outstanding to amount+vat when the wire omits it (bare create response)", () => {
    const r = toInvoiceRow({ id: "y", no: "INV-1", amount: 184000, vat: 12880, status: "open" });
    expect(r.outstanding).toBe(196880);
  });

  it("keeps null credit_term and empty due_date honestly (draft with no term)", () => {
    const r = toInvoiceRow({ id: "z", no: "INV-2", amount: 10, vat: 0, status: "open" });
    expect(r.creditTerm).toBeNull();
    expect(r.dueDate).toBe("");
  });
});

describe("toCustomerRef / customerById", () => {
  it("narrows a customer wire row and indexes by id", () => {
    const c = toCustomerRef({ id: "c1", name: "Acme Co", tax_id: "0105500000001" });
    expect(c).toEqual({ id: "c1", name: "Acme Co", taxId: "0105500000001" });
    const map = customerById([c]);
    expect(map.get("c1")?.name).toBe("Acme Co");
    expect(map.get("missing")).toBeUndefined();
  });
});

describe("statusView + open/paid predicates", () => {
  it("maps paid to paid and everything else to open", () => {
    expect(statusView("paid")).toBe("paid");
    expect(statusView("open")).toBe("open");
    expect(statusView("anything")).toBe("open");
  });

  it("isOpen / isPaid reflect the wire status", () => {
    expect(isOpen(inv({ status: "open" }))).toBe(true);
    expect(isPaid(inv({ status: "paid" }))).toBe(true);
    expect(isOpen(inv({ status: "paid" }))).toBe(false);
  });
});

describe("daysUntil", () => {
  it("counts whole days to the due date (future +, past -, today 0)", () => {
    expect(daysUntil("2026-06-15", NOW)).toBe(14);
    expect(daysUntil("2026-06-01", NOW)).toBe(0);
    expect(daysUntil("2026-05-25", NOW)).toBe(-7);
  });

  it("returns null for a missing/invalid due date", () => {
    expect(daysUntil("", NOW)).toBeNull();
    expect(daysUntil("not-a-date", NOW)).toBeNull();
  });
});

describe("overdue / due-soon predicates", () => {
  it("overdue only for OPEN invoices past due", () => {
    expect(isOverdue(inv({ status: "open", dueDate: "2026-05-25" }), NOW)).toBe(true);
    // A PAID invoice past its due date is settled -> never overdue.
    expect(isOverdue(inv({ status: "paid", dueDate: "2026-05-25" }), NOW)).toBe(false);
    expect(isOverdue(inv({ status: "open", dueDate: "2026-06-15" }), NOW)).toBe(false);
  });

  it("due-soon only for OPEN invoices within 1..7 days", () => {
    expect(isDueSoon(inv({ dueDate: "2026-06-05" }), NOW)).toBe(true); // +4 days
    expect(isDueSoon(inv({ dueDate: "2026-06-08" }), NOW)).toBe(true); // +7 days (inclusive)
    expect(isDueSoon(inv({ dueDate: "2026-06-09" }), NOW)).toBe(false); // +8 days
    expect(isDueSoon(inv({ dueDate: "2026-06-01" }), NOW)).toBe(false); // today
    expect(isDueSoon(inv({ status: "paid", dueDate: "2026-06-05" }), NOW)).toBe(false);
  });
});

describe("filterByTab + tabCount", () => {
  const rows: InvoiceRow[] = [
    inv({ id: "open-future", status: "open", dueDate: "2026-06-20" }), // open, not due soon
    inv({ id: "due-soon", status: "open", dueDate: "2026-06-04" }), // open + due soon
    inv({ id: "overdue", status: "open", dueDate: "2026-05-20" }), // open + overdue
    inv({ id: "paid", status: "paid", dueDate: "2026-05-20" }), // paid
  ];

  it("partitions the tabs honestly by real status + due date", () => {
    expect(filterByTab(rows, "all", NOW).map((r) => r.id)).toEqual([
      "open-future",
      "due-soon",
      "overdue",
      "paid",
    ]);
    expect(filterByTab(rows, "open", NOW).map((r) => r.id)).toEqual([
      "open-future",
      "due-soon",
      "overdue",
    ]);
    expect(filterByTab(rows, "due", NOW).map((r) => r.id)).toEqual(["due-soon"]);
    expect(filterByTab(rows, "over", NOW).map((r) => r.id)).toEqual(["overdue"]);
    expect(filterByTab(rows, "paid", NOW).map((r) => r.id)).toEqual(["paid"]);
  });

  it("tabCount matches the filtered length", () => {
    expect(tabCount(rows, "all", NOW)).toBe(4);
    expect(tabCount(rows, "open", NOW)).toBe(3);
    expect(tabCount(rows, "due", NOW)).toBe(1);
    expect(tabCount(rows, "over", NOW)).toBe(1);
    expect(tabCount(rows, "paid", NOW)).toBe(1);
  });

  it("handles an empty catalogue", () => {
    expect(filterByTab([], "all", NOW)).toEqual([]);
    expect(tabCount([], "open", NOW)).toBe(0);
  });
});

describe("KPI aggregates", () => {
  const rows: InvoiceRow[] = [
    inv({ id: "a", customerId: "c1", status: "open", dueDate: "2026-06-04", amount: 200_000, vat: 14_000, outstanding: 214_000 }),
    inv({ id: "b", customerId: "c1", status: "open", dueDate: "2026-05-20", amount: 100_000, vat: 0, outstanding: 100_000 }),
    inv({ id: "c", customerId: "c2", status: "paid", dueDate: "2026-05-20", amount: 500_000, vat: 35_000, outstanding: 0 }),
  ];

  it("counts open / overdue / due-soon honestly", () => {
    expect(openInvoices(rows).map((r) => r.id)).toEqual(["a", "b"]);
    expect(overdueInvoices(rows, NOW).map((r) => r.id)).toEqual(["b"]);
    expect(dueSoonInvoices(rows, NOW).map((r) => r.id)).toEqual(["a"]);
  });

  it("distinct customers across ALL invoices", () => {
    expect(distinctCustomerCount(rows)).toBe(2);
    expect(distinctCustomerCount([])).toBe(0);
  });

  it("sumAmount is net (pre-VAT); sumOutstanding is the receivable", () => {
    expect(sumAmount(dueSoonInvoices(rows, NOW))).toBe(200_000);
    expect(sumAmount(overdueInvoices(rows, NOW))).toBe(100_000);
    // Total AR = Σ outstanding over open rows (214,000 + 100,000).
    expect(sumOutstanding(openInvoices(rows))).toBe(314_000);
    expect(sumOutstanding([])).toBe(0);
  });
});

describe("money formatting", () => {
  it("groups thousands, ASCII only, no decimals", () => {
    expect(formatMoney(728000)).toBe("728,000");
    expect(formatMoney(2148000)).toBe("2,148,000");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(Number.NaN)).toBe("0");
  });

  it("millionsValue is a 2-dp millions string", () => {
    expect(millionsValue(2_148_000)).toBe("2.15");
    expect(millionsValue(0)).toBe("0.00");
  });

  it("round2 rounds to the currency minor unit", () => {
    expect(round2(1.005 * 100) / 100).toBeCloseTo(1.005, 2);
    expect(round2(12879.999)).toBe(12880);
  });
});

describe("create-form line preview math (UX only — server is money authority)", () => {
  it("parseAmount strips commas and floors negatives to 0", () => {
    expect(parseAmount("2,150,000")).toBe(2150000);
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("-5")).toBe(0);
    expect(parseAmount("abc")).toBe(0);
  });

  it("lineTotal = qty x price (rounded), 0 for a non-positive line", () => {
    expect(lineTotal(3, 728000)).toBe(2184000);
    expect(lineTotal(0, 728000)).toBe(0);
    expect(lineTotal(2, 0)).toBe(0);
  });

  it("sumLineAmounts sums qty x price over lines", () => {
    expect(sumLineAmounts([{ qty: 2, price: 100 }, { qty: 1, price: 50 }])).toBe(250);
    expect(sumLineAmounts([])).toBe(0);
  });

  it("previewSubtotal / previewVat / previewTotal on drafts", () => {
    const drafts: LineDraft[] = [
      { description: "milestone-5", qty: "1", price: "100000" },
      { description: "", qty: "2", price: "12000" },
    ];
    const subtotal = previewSubtotal(drafts); // 100000 + 24000
    expect(subtotal).toBe(124_000);
    expect(previewVat(subtotal)).toBe(8_680); // 7%
    expect(previewTotal(subtotal)).toBe(132_680);
  });

  it("empty / incomplete drafts preview to zero", () => {
    const drafts: LineDraft[] = [
      { description: "", qty: "", price: "" },
      { description: "x", qty: "3", price: "" }, // no price -> incomplete
    ];
    expect(previewSubtotal(drafts)).toBe(0);
    expect(previewVat(0)).toBe(0);
    expect(previewTotal(0)).toBe(0);
  });

  it("isLineComplete + toWireLines keep only complete lines, description optional", () => {
    const drafts: LineDraft[] = [
      { description: "  milestone-5  ", qty: "1", price: "100000" },
      { description: "", qty: "2", price: "12000" },
      { description: "skip", qty: "0", price: "5" }, // qty 0 -> dropped
      { description: "skip2", qty: "1", price: "" }, // no price -> dropped
    ];
    expect(drafts.map(isLineComplete)).toEqual([true, true, false, false]);
    expect(toWireLines(drafts)).toEqual([
      { qty: 1, price: 100000, description: "milestone-5" },
      { qty: 2, price: 12000 },
    ]);
  });
});
