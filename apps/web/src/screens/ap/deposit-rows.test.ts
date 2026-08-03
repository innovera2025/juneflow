/*
 * deposit-rows unit tests (gate G3) — the pure vendor-deposit logic ported from
 * ap.jsx APDeposit + APDepositForm (toDepositRow / formatMoney / formatMillions /
 * depositKpis / depositStatusKind / depositStatusTone / depositSubmittable /
 * decodeRef / buildDepositBody). Guards the opaque-row narrowing (incl. honest-null
 * no/vendorName/ref/reason/pct + server-computed balance read off the wire), the
 * REAL KPI derivations (never the mock literals), the client-side badge derivation,
 * and the POST-body shaping (money=SERVER: only ids + typed amount + label pct).
 * ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toDepositRow,
  formatMoney,
  formatMillions,
  depositKpis,
  depositStatusKind,
  depositStatusTone,
  depositSubmittable,
  decodeRef,
  buildDepositBody,
  emptyDepositDraft,
  type DepositRow,
  type DepositDraft,
} from "./deposit-rows";

const row = (p: Partial<DepositRow> = {}): DepositRow => ({
  id: "d1",
  no: "DP-2026-0024",
  vendorId: "v1",
  vendorName: "Vendor",
  poId: "",
  woId: "",
  reason: "",
  ref: "",
  pct: null,
  amount: 0,
  used: 0,
  balance: 0,
  currencyCode: "THB",
  status: "approved",
  createdAt: "2026-05-25T00:00:00.000Z",
  ...p,
});

describe("toDepositRow", () => {
  it("narrows a full opaque /ap/deposit row (snake_case) incl server balance", () => {
    expect(
      toDepositRow({
        id: "d1",
        no: "DP-2026-0021",
        vendor_id: "v9",
        po_id: "po9",
        wo_id: null,
        reason: "deposit PO cement 25%",
        pct: 25,
        amount: 460000,
        used: 230000,
        currency_code: "THB",
        status: "approved",
        created_at: "2026-05-25T00:00:00.000Z",
        vendor_name: "SCG",
        ref: "PO-2026-0286",
        balance: 230000,
      }),
    ).toEqual({
      id: "d1",
      no: "DP-2026-0021",
      vendorId: "v9",
      vendorName: "SCG",
      poId: "po9",
      woId: "",
      reason: "deposit PO cement 25%",
      ref: "PO-2026-0286",
      pct: 25,
      amount: 460000,
      used: 230000,
      balance: 230000,
      currencyCode: "THB",
      status: "approved",
      createdAt: "2026-05-25T00:00:00.000Z",
    });
  });

  it("keeps honest nulls: no/vendorName/ref/reason -> '' and pct -> null", () => {
    const r = toDepositRow({ id: "d2", amount: "80400", used: "0", balance: "80400" });
    expect(r.no).toBe("");
    expect(r.vendorName).toBe("");
    expect(r.ref).toBe("");
    expect(r.reason).toBe("");
    expect(r.pct).toBeNull();
    // numeric strings coerce (drizzle numeric columns arrive as strings).
    expect(r.amount).toBe(80400);
    expect(r.balance).toBe(80400);
  });
});

describe("formatters", () => {
  it("formatMoney groups thousands, guards non-finite", () => {
    expect(formatMoney(380400)).toBe("380,400");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
  it("formatMillions is 2dp", () => {
    expect(formatMillions(1860000)).toBe("1.86");
    expect(formatMillions(14200000)).toBe("14.20");
  });
});

describe("depositKpis (real derivations, never the mock literals)", () => {
  it("derives outstanding / offset / ytd off the loaded rows", () => {
    const rows = [
      // outstanding, offset partial, this year
      row({ amount: 460000, used: 230000, balance: 230000, createdAt: "2026-03-01T00:00:00.000Z" }),
      // fully cleared (balance 0), fully offset, this year
      row({ amount: 122480, used: 122480, balance: 0, createdAt: "2026-04-01T00:00:00.000Z" }),
      // outstanding, no offset, PRIOR year (excluded from ytd)
      row({ amount: 215000, used: 0, balance: 215000, createdAt: "2025-12-01T00:00:00.000Z" }),
    ];
    expect(depositKpis(rows, 2026)).toEqual({
      outstandingCount: 2, // rows 1 + 3 have balance > 0
      outstandingSum: 445000, // 230000 + 215000
      offsetCount: 2, // rows 1 + 2 have used > 0
      offsetSum: 352480, // 230000 + 122480
      ytdCount: 2, // rows 1 + 2 created in 2026
      ytdSum: 582480, // 460000 + 122480
    });
  });

  it("is all-zero on an empty register (honest empty state)", () => {
    expect(depositKpis([], 2026)).toEqual({
      outstandingCount: 0,
      outstandingSum: 0,
      offsetCount: 0,
      offsetSum: 0,
      ytdCount: 0,
      ytdSum: 0,
    });
  });
});

describe("depositStatusKind + depositStatusTone (client-derived badge)", () => {
  it("cleared when balance is 0, outstanding otherwise", () => {
    expect(depositStatusKind(0)).toBe("cleared");
    expect(depositStatusKind(230000)).toBe("outstanding");
  });
  it("tones cleared ok / outstanding warn", () => {
    expect(depositStatusTone(0)).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)" });
    expect(depositStatusTone(1)).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)" });
  });
});

describe("create-form helpers", () => {
  const draft = (p: Partial<DepositDraft> = {}): DepositDraft => ({
    ...emptyDepositDraft(),
    ...p,
  });

  it("depositSubmittable requires a vendor and a positive amount", () => {
    expect(depositSubmittable(draft())).toBe(false);
    expect(depositSubmittable(draft({ vendorId: "v1" }))).toBe(false);
    expect(depositSubmittable(draft({ vendorId: "v1", amount: "0" }))).toBe(false);
    expect(depositSubmittable(draft({ vendorId: "v1", amount: "380400" }))).toBe(true);
  });

  it("decodeRef maps the single selection to po_id | wo_id (or nothing)", () => {
    expect(decodeRef("po:po1")).toEqual({ po_id: "po1" });
    expect(decodeRef("wo:wo9")).toEqual({ wo_id: "wo9" });
    expect(decodeRef("")).toEqual({});
    expect(decodeRef("po:")).toEqual({});
  });

  it("buildDepositBody sends vendor_id + amount + present optionals (po ref + pct)", () => {
    expect(
      buildDepositBody(draft({ vendorId: "  v1  ", refSel: "po:po1", pct: "30", amount: "380400" })),
    ).toEqual({
      vendor_id: "v1",
      amount: 380400,
      pct: 30,
      po_id: "po1",
    });
  });

  it("buildDepositBody omits ref + pct when unset, sends a wo ref when chosen", () => {
    expect(buildDepositBody(draft({ vendorId: "v1", amount: "215000" }))).toEqual({
      vendor_id: "v1",
      amount: 215000,
    });
    expect(
      buildDepositBody(draft({ vendorId: "v1", refSel: "wo:wo7", amount: "215000" })),
    ).toEqual({
      vendor_id: "v1",
      amount: 215000,
      wo_id: "wo7",
    });
  });
});
