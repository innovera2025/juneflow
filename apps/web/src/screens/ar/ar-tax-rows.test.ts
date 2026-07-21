/*
 * ar-tax-rows unit tests (ar.tax, gate G3) — the pure AR tax-register logic ported from
 * ar.jsx ARTaxInvoice (toTaxRow / deriveKind / deriveDisplayStatus / kindTag / statusTone /
 * filterByTab / tabCount / issuedCount / issuedTotal / vatTotal / cancelledCount /
 * formatMoney / formatDec / formatMillions / formatDate). Guards the opaque-row narrowing,
 * the DERIVED kind/status (void -> cancel/cancelled, else tax/approved), the honest-empty
 * receipt tab, the KPI sums (voided excluded), and the money/date formatting. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toTaxRow,
  deriveKind,
  deriveDisplayStatus,
  kindTag,
  statusTone,
  filterByTab,
  tabCount,
  issuedCount,
  issuedTotal,
  vatTotal,
  cancelledCount,
  formatMoney,
  formatDec,
  formatMillions,
  formatDate,
  type TaxRow,
} from "./ar-tax-rows";

const row = (p: Partial<TaxRow> = {}): TaxRow => ({
  id: "t1",
  no: "TX-1",
  amount: 0,
  vat: 0,
  total: 0,
  etaxStatus: "queued",
  status: "open",
  docDate: "",
  kind: "tax",
  displayStatus: "approved",
  ...p,
});

describe("toTaxRow", () => {
  it("narrows a full opaque /ar/tax-register row (snake_case) + derives kind/status", () => {
    expect(
      toTaxRow({
        id: "t1",
        no: "TX-2026-0184",
        customer_id: "c1",
        amount: 2007476.64,
        vat: 140523.36,
        total: 2148000,
        etax_status: "queued",
        status: "paid",
        doc_date: "2026-05-25T00:00:00.000Z",
      }),
    ).toEqual({
      id: "t1",
      no: "TX-2026-0184",
      amount: 2007476.64,
      vat: 140523.36,
      total: 2148000,
      etaxStatus: "queued",
      status: "paid",
      docDate: "2026-05-25T00:00:00.000Z",
      kind: "tax",
      displayStatus: "approved",
    });
  });

  it("derives a voided e-Tax as cancel/cancelled (real figures preserved)", () => {
    const r = toTaxRow({ id: "t2", no: "TX-9", amount: "1000", vat: "70", total: "1070", etax_status: "void" });
    expect(r.kind).toBe("cancel");
    expect(r.displayStatus).toBe("cancelled");
    expect(r.amount).toBe(1000); // string coerced; NOT zeroed by the cancel
    expect(r.vat).toBe(70);
  });

  it("coerces missing numerics to 0 and keeps a blank doc_date empty", () => {
    const r = toTaxRow({ id: "t3", no: "TX-3" });
    expect(r.amount).toBe(0);
    expect(r.vat).toBe(0);
    expect(r.total).toBe(0);
    expect(r.docDate).toBe("");
  });
});

describe("deriveKind + deriveDisplayStatus", () => {
  it("maps void -> cancel/cancelled, everything else -> tax/approved (receipt never derived)", () => {
    expect(deriveKind("void")).toBe("cancel");
    expect(deriveKind("queued")).toBe("tax");
    expect(deriveKind("")).toBe("tax");
    expect(deriveDisplayStatus("void")).toBe("cancelled");
    expect(deriveDisplayStatus("queued")).toBe("approved");
  });
});

describe("kindTag + statusTone", () => {
  it("tones each kind (tax=info, receipt=ok, cancel=neutral)", () => {
    expect(kindTag("tax")).toEqual({ bg: "var(--info-soft)", fg: "var(--info)" });
    expect(kindTag("receipt")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)" });
    expect(kindTag("cancel")).toEqual({ bg: "var(--surface-3)", fg: "var(--text-3)" });
  });
  it("tones the status badge (approved tokened, cancelled verbatim slate)", () => {
    expect(statusTone("approved")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" });
    expect(statusTone("cancelled")).toEqual({ bg: "#F1F5F9", fg: "#64748B", dot: "#94A3B8" });
  });
});

describe("filterByTab + tabCount", () => {
  const rows = [
    row({ id: "a", kind: "tax" }),
    row({ id: "b", kind: "tax" }),
    row({ id: "c", kind: "cancel", etaxStatus: "void", displayStatus: "cancelled" }),
  ];
  it("all -> every row; tax -> tax rows; cancel -> voided; receipt -> honest-empty", () => {
    expect(filterByTab(rows, "all").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(filterByTab(rows, "tax").map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterByTab(rows, "cancel").map((r) => r.id)).toEqual(["c"]);
    expect(filterByTab(rows, "receipt")).toEqual([]);
  });
  it("tabCount matches (receipt is always 0 — no wire signal)", () => {
    expect(tabCount(rows, "all")).toBe(3);
    expect(tabCount(rows, "tax")).toBe(2);
    expect(tabCount(rows, "receipt")).toBe(0);
    expect(tabCount(rows, "cancel")).toBe(1);
  });
});

describe("KPI derivations (voided excluded)", () => {
  const rows = [
    row({ kind: "tax", total: 2148000, vat: 140523.36 }),
    row({ kind: "tax", total: 184000, vat: 12037.38 }),
    row({ kind: "cancel", etaxStatus: "void", total: 500000, vat: 32710, displayStatus: "cancelled" }),
  ];
  it("issuedCount + issuedTotal + vatTotal sum only non-void rows", () => {
    expect(issuedCount(rows)).toBe(2);
    expect(issuedTotal(rows)).toBe(2332000); // 2,148,000 + 184,000 (voided 500k excluded)
    expect(vatTotal(rows)).toBeCloseTo(152560.74, 2); // voided VAT excluded
  });
  it("cancelledCount counts voided rows", () => {
    expect(cancelledCount(rows)).toBe(1);
  });
});

describe("formatters", () => {
  it("formatMoney groups thousands, no decimals or baht", () => {
    expect(formatMoney(2148000)).toBe("2,148,000");
    expect(formatMoney(-64500)).toBe("-64,500");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
  it("formatDec groups thousands with 2 decimals (ds.jsx fmtDec)", () => {
    expect(formatDec(2007476.64)).toBe("2,007,476.64");
    expect(formatDec(12037.38)).toBe("12,037.38");
    expect(formatDec(0)).toBe("0.00");
    expect(formatDec(Number.NaN)).toBe("0.00");
  });
  it("formatMillions is 2dp (ds.jsx fmtM)", () => {
    expect(formatMillions(32140000)).toBe("32.14");
    expect(formatMillions(2240000)).toBe("2.24");
  });
  it("formatDate is YYYY-MM-DD (UTC), empty on missing/invalid", () => {
    expect(formatDate("2026-05-25T09:30:00.000Z")).toBe("2026-05-25");
    expect(formatDate("")).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });
});
