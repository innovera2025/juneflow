/*
 * billing-rows unit tests (P2-WEB-14, gate G3) — the pure AP-billing logic ported
 * from ap.jsx APBilling + BillingForm (toBillingRow / formatMoney / formatMillions /
 * formatThousands0 / billingKpis / billingTabCounts / agingCell / agingColor /
 * statusTone / statusLabelKind / parseMoney / billingSubmittable / buildBillingBody).
 * Guards the opaque-row narrowing (incl. honest-null no/wht/retention/aging), the
 * derived KPI / tab counts, and the POST-body shaping. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toBillingRow,
  formatMoney,
  formatMillions,
  formatThousands0,
  billingKpis,
  billingTabCounts,
  agingCell,
  agingColor,
  statusTone,
  statusLabelKind,
  parseMoney,
  billingSubmittable,
  buildBillingBody,
  emptyBillingDraft,
  type BillingRow,
  type BillingDraft,
} from "./billing-rows";

const row = (p: Partial<BillingRow> = {}): BillingRow => ({
  id: "b1",
  no: "",
  vendorId: "v1",
  vendorName: "Vendor",
  poId: "",
  woId: "",
  grId: "",
  ref: "",
  invoiceNo: "",
  amount: 0,
  vat: 0,
  wht: null,
  retention: null,
  dueDate: "",
  aging: null,
  status: "approved",
  kind: "",
  currencyCode: "THB",
  createdAt: "",
  ...p,
});

describe("toBillingRow", () => {
  it("narrows a full opaque /ap/billing row (snake_case), honest nulls preserved", () => {
    expect(
      toBillingRow({
        id: "b1",
        no: null,
        vendor_id: "v1",
        vendor_name: "CPC",
        gr_id: "g1",
        ref: "GR-2026-0144",
        invoice_no: "INV-CPC-118",
        amount: 920000,
        vat: 60187,
        wht: 27600,
        retention: null,
        due_date: "2026-05-30",
        aging: 5,
        status: "approved",
        kind: "progress",
        currency_code: "THB",
        created_at: "2026-05-25T00:00:00.000Z",
      }),
    ).toEqual({
      id: "b1",
      no: "",
      vendorId: "v1",
      vendorName: "CPC",
      poId: "",
      woId: "",
      grId: "g1",
      ref: "GR-2026-0144",
      invoiceNo: "INV-CPC-118",
      amount: 920000,
      vat: 60187,
      wht: 27600,
      retention: null,
      dueDate: "2026-05-30",
      aging: 5,
      status: "approved",
      kind: "progress",
      currencyCode: "THB",
      createdAt: "2026-05-25T00:00:00.000Z",
    });
  });

  it("keeps wht/retention/aging null when absent (never fabricates)", () => {
    const r = toBillingRow({ id: "b2", amount: "100" });
    expect(r.wht).toBeNull();
    expect(r.retention).toBeNull();
    expect(r.aging).toBeNull();
    expect(r.amount).toBe(100);
  });
});

describe("formatters", () => {
  it("formatMoney groups thousands, no decimals or baht", () => {
    expect(formatMoney(920000)).toBe("920,000");
    expect(formatMoney(-64500)).toBe("-64,500");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
  it("formatMillions is 2dp", () => {
    expect(formatMillions(2345000)).toBe("2.35");
  });
  it("formatThousands0 is 0dp", () => {
    expect(formatThousands0(70000)).toBe("70");
  });
});

describe("billingKpis", () => {
  it("derives total/due7/over/wht from the rows (aging + wht driven)", () => {
    const rows = [
      row({ amount: 920000, wht: 27600, aging: 5 }), // due within 7
      row({ amount: 415400, wht: 12462, aging: -5 }), // overdue
      row({ amount: 268000, wht: 8040, aging: 21 }), // far
      row({ amount: 100000, wht: null, aging: null }), // no due_date
    ];
    const k = billingKpis(rows);
    expect(k.count).toBe(4);
    expect(k.totalAmount).toBe(1703400);
    expect(k.due7Count).toBe(1);
    expect(k.due7Amount).toBe(920000);
    expect(k.overCount).toBe(1);
    expect(k.overAmount).toBe(415400);
    expect(k.whtTotal).toBe(48102); // null wht contributes 0
  });
});

describe("billingTabCounts", () => {
  it("counts all/due/over/paid honestly", () => {
    const rows = [
      row({ aging: 3, status: "approved" }),
      row({ aging: -1, status: "approved" }),
      row({ aging: null, status: "paid" }),
    ];
    expect(billingTabCounts(rows)).toEqual({ all: 3, due: 1, over: 1, paid: 1 });
  });
});

describe("agingCell + agingColor", () => {
  it("classifies over/soon/far and null", () => {
    expect(agingCell(-5)).toEqual({ kind: "over", days: 5 });
    expect(agingCell(3)).toEqual({ kind: "soon", days: 3 });
    expect(agingCell(21)).toEqual({ kind: "far", days: 21 });
    expect(agingCell(null)).toBeNull();
  });
  it("maps each bucket to its token colour", () => {
    expect(agingColor("over")).toBe("var(--danger)");
    expect(agingColor("soon")).toBe("var(--warn)");
    expect(agingColor("far")).toBe("var(--text-3)");
  });
});

describe("statusTone + statusLabelKind", () => {
  it("maps known statuses and falls back to draft", () => {
    expect(statusTone("approved").fg).toBe("var(--ok)");
    expect(statusTone("pending").fg).toBe("var(--warn)");
    expect(statusTone("weird").dot).toBe("#94A3B8");
    expect(statusLabelKind("paid")).toBe("paid");
    expect(statusLabelKind("weird")).toBe("draft");
  });
});

describe("create-form helpers", () => {
  it("parseMoney keeps non-negative, else 0", () => {
    expect(parseMoney("920000")).toBe(920000);
    expect(parseMoney("")).toBe(0);
    expect(parseMoney("-5")).toBe(0);
    expect(parseMoney("abc")).toBe(0);
  });

  it("billingSubmittable requires a vendor and a positive amount", () => {
    expect(billingSubmittable(emptyBillingDraft())).toBe(false);
    expect(billingSubmittable({ ...emptyBillingDraft(), vendorId: "v1" })).toBe(false);
    expect(
      billingSubmittable({ ...emptyBillingDraft(), vendorId: "v1", amount: "100" }),
    ).toBe(true);
  });

  it("buildBillingBody sends required fields + only present optionals", () => {
    const draft: BillingDraft = {
      vendorId: "  v1  ",
      grId: "g1",
      invoiceNo: "INV-1",
      dueDate: "2026-06-24",
      amount: "859813",
      vat: "60187",
      wht: "",
    };
    expect(buildBillingBody(draft)).toEqual({
      vendor_id: "v1",
      amount: 859813,
      gr_id: "g1",
      invoice_no: "INV-1",
      due_date: "2026-06-24",
      vat: 60187,
    });
  });

  it("buildBillingBody omits blank optionals (server derives wht)", () => {
    expect(buildBillingBody({ ...emptyBillingDraft(), vendorId: "v1", amount: "100" })).toEqual({
      vendor_id: "v1",
      amount: 100,
    });
  });
});
