/*
 * pv-rows unit tests (P2-WEB-14, gate G3) — the pure payment-voucher logic ported
 * from ap.jsx APPaymentVoucher + PVCreateForm (toPvRow / formatMoney /
 * formatThousands0 / formatDate / methodKey / methodTone / pvKpis / statusTone /
 * statusLabelKind / pvNet / impliedWhtPct / pvSubmittable / buildPvBody). Guards the
 * opaque-row narrowing (incl. honest-null no/method/retention), the derived KPIs,
 * the client net preview, and the POST-body shaping. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toPvRow,
  formatMoney,
  formatThousands0,
  formatDate,
  methodKey,
  methodTone,
  pvKpis,
  statusTone,
  statusLabelKind,
  pvNet,
  impliedWhtPct,
  pvSubmittable,
  buildPvBody,
  type PvRow,
  type PvDraft,
} from "./pv-rows";

const row = (p: Partial<PvRow> = {}): PvRow => ({
  id: "p1",
  no: "",
  billingIds: [],
  vendorId: "v1",
  payee: "Vendor",
  amount: 0,
  whtPct: 0,
  wht: 0,
  retention: null,
  net: 0,
  method: "",
  chequeNo: "",
  chequeBank: "",
  chequeDate: "",
  currencyCode: "THB",
  status: "pending",
  createdAt: "",
  ...p,
});

describe("toPvRow", () => {
  it("narrows a full opaque /ap/pv row (snake_case), honest nulls preserved", () => {
    expect(
      toPvRow({
        id: "p1",
        no: null,
        billing_ids: ["b1", "b2"],
        vendor_id: "v1",
        payee: "Rungrueang",
        amount: 645000,
        wht_pct: 3,
        wht: 19350,
        retention: 64500,
        net: 561150,
        method: "cheque",
        cheque_no: "CH-040128",
        cheque_bank: "SCB",
        cheque_date: "2026-05-25",
        currency_code: "THB",
        status: "approved",
        created_at: "2026-05-25T00:00:00.000Z",
      }),
    ).toEqual({
      id: "p1",
      no: "",
      billingIds: ["b1", "b2"],
      vendorId: "v1",
      payee: "Rungrueang",
      amount: 645000,
      whtPct: 3,
      wht: 19350,
      retention: 64500,
      net: 561150,
      method: "cheque",
      chequeNo: "CH-040128",
      chequeBank: "SCB",
      chequeDate: "2026-05-25",
      currencyCode: "THB",
      status: "approved",
      createdAt: "2026-05-25T00:00:00.000Z",
    });
  });

  it("keeps method '' + retention null when absent (never fabricates)", () => {
    const r = toPvRow({ id: "p2", amount: "100", billing_ids: null });
    expect(r.method).toBe("");
    expect(r.retention).toBeNull();
    expect(r.billingIds).toEqual([]);
  });
});

describe("formatters", () => {
  it("formatMoney groups thousands", () => {
    expect(formatMoney(561150)).toBe("561,150");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
  it("formatThousands0 is 0dp", () => {
    expect(formatThousands0(240000)).toBe("240");
  });
  it("formatDate slices a valid timestamp, '' otherwise", () => {
    expect(formatDate("2026-05-25T13:45:00.000Z")).toBe("2026-05-25");
    expect(formatDate("nope")).toBe("");
    expect(formatDate("")).toBe("");
  });
});

describe("methodKey + methodTone", () => {
  it("narrows known methods and '' otherwise", () => {
    expect(methodKey("cheque")).toBe("cheque");
    expect(methodKey("transfer")).toBe("transfer");
    expect(methodKey("wire")).toBe("");
  });
  it("tones cheque warn, transfer info, else ok", () => {
    expect(methodTone("cheque").fg).toBe("var(--warn)");
    expect(methodTone("transfer").fg).toBe("var(--info)");
    expect(methodTone("cash").fg).toBe("var(--ok)");
    expect(methodTone("deposit").fg).toBe("var(--ok)");
  });
});

describe("pvKpis", () => {
  it("derives pending count + wht/retention totals", () => {
    const rows = [
      row({ status: "pending", wht: 12462, retention: 0 }),
      row({ status: "approved", wht: 27600, retention: null }),
      row({ status: "approved", wht: 19350, retention: 64500 }),
    ];
    expect(pvKpis(rows)).toEqual({
      pendingCount: 1,
      whtTotal: 59412,
      retentionTotal: 64500,
    });
  });
});

describe("statusTone + statusLabelKind", () => {
  it("maps statuses with draft fallback", () => {
    expect(statusTone("approved").fg).toBe("var(--ok)");
    expect(statusLabelKind("pending")).toBe("pending");
    expect(statusLabelKind("weird")).toBe("draft");
  });
});

describe("pvNet + impliedWhtPct", () => {
  it("previews net = gross - wht - retention, clamping negatives", () => {
    expect(pvNet(645000, 3, 64500)).toEqual({
      gross: 645000,
      wht: 19350,
      retention: 64500,
      net: 561150,
    });
    expect(pvNet(-10, -3, -5)).toEqual({ gross: 0, wht: 0, retention: 0, net: 0 });
  });
  it("derives the implied wht pct from a billing's wht over gross", () => {
    expect(impliedWhtPct(19350, 645000)).toBe(3);
    expect(impliedWhtPct(null, 645000)).toBe(0);
    expect(impliedWhtPct(100, 0)).toBe(0);
  });
});

describe("create-form helpers", () => {
  const draft = (p: Partial<PvDraft> = {}): PvDraft => ({
    billingId: "",
    gross: 0,
    whtPct: 0,
    retention: 0,
    method: "",
    chequeNo: "",
    chequeBank: "",
    chequeDate: "",
    ...p,
  });

  it("pvSubmittable requires a billing and a positive gross", () => {
    expect(pvSubmittable(draft())).toBe(false);
    expect(pvSubmittable(draft({ billingId: "b1" }))).toBe(false);
    expect(pvSubmittable(draft({ billingId: "b1", gross: 100 }))).toBe(true);
  });

  it("buildPvBody sends billing_ids array + only present optionals", () => {
    expect(
      buildPvBody(
        draft({
          billingId: "  b1  ",
          gross: 645000,
          whtPct: 3,
          retention: 64500,
          method: "cheque",
          chequeNo: "CH-1",
          chequeBank: "SCB",
          chequeDate: "2026-05-25",
        }),
      ),
    ).toEqual({
      billing_ids: ["b1"],
      amount: 645000,
      wht_pct: 3,
      retention: 64500,
      method: "cheque",
      cheque_no: "CH-1",
      cheque_bank: "SCB",
      cheque_date: "2026-05-25",
    });
  });

  it("buildPvBody omits method + cheque fields when unset", () => {
    expect(buildPvBody(draft({ billingId: "b1", gross: 100 }))).toEqual({
      billing_ids: ["b1"],
      amount: 100,
      wht_pct: 0,
      retention: 0,
    });
  });
});
