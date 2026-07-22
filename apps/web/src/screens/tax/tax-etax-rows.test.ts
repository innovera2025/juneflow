/*
 * tax-etax-rows unit tests (tax.etax, gate G3) — the pure e-Tax register logic ported from
 * etax.jsx TaxETax (toStatusCount / statusCountMap / totalCount / toEtaxInvoiceRow /
 * toCustomerMap / statusBadgeKind / queuedInvoiceIds / sumGrossTotal / formatters). Guards the
 * opaque-row narrowing, the queued->sent send set, and the B-124 HONEST-EMPTY theater ruling
 * against regression. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  ETAX_STATUSES,
  HONEST_EMPTY_THEATER,
  asEtaxStatus,
  toStatusCount,
  statusCountMap,
  totalCount,
  toEtaxInvoiceRow,
  toCustomerMap,
  statusBadgeKind,
  queuedInvoiceIds,
  sumGrossTotal,
  formatMoney,
  formatMillions,
  formatDate,
  type EtaxInvoiceRow,
} from "./tax-etax-rows";

const inv = (p: Partial<EtaxInvoiceRow> = {}): EtaxInvoiceRow => ({
  id: "i1",
  no: "JF-INV-2569-0255",
  customerId: "c1",
  amount: 100,
  vat: 7,
  total: 107,
  currencyCode: "THB",
  etaxStatus: "queued",
  createdAt: "2026-07-01T03:00:00.000Z",
  ...p,
});

describe("asEtaxStatus", () => {
  it("keeps a known enum value, falls unknown -> queued", () => {
    expect(asEtaxStatus("sent")).toBe("sent");
    expect(asEtaxStatus("void")).toBe("void");
    expect(asEtaxStatus("bogus")).toBe("queued");
    expect(asEtaxStatus(null)).toBe("queued");
  });
});

describe("toStatusCount / statusCountMap / totalCount", () => {
  it("narrows an opaque /etax/status aggregate row", () => {
    expect(toStatusCount({ etax_status: "sent", count: 3 })).toEqual({ status: "sent", count: 3 });
    // negative / non-finite counts clamp to a non-negative integer
    expect(toStatusCount({ etax_status: "queued", count: -2 })).toEqual({ status: "queued", count: 0 });
  });

  it("folds all four buckets (0-filled) and totals them", () => {
    const counts = statusCountMap([
      { status: "queued", count: 2 },
      { status: "sent", count: 4 },
      { status: "rejected", count: 1 },
    ]);
    expect(counts).toEqual({ queued: 2, sent: 4, rejected: 1, void: 0 });
    expect(totalCount(counts)).toBe(7);
  });
});

describe("toEtaxInvoiceRow", () => {
  it("narrows an opaque /ar/invoices row and derives total = amount + vat", () => {
    expect(
      toEtaxInvoiceRow({
        id: "i9",
        no: "JE-INV-2569-0061",
        customer_id: "cust-9",
        amount: 4894560,
        vat: 342619.2,
        currency_code: "THB",
        etax_status: "queued",
        created_at: "2026-07-01T03:00:00.000Z",
      }),
    ).toEqual({
      id: "i9",
      no: "JE-INV-2569-0061",
      customerId: "cust-9",
      amount: 4894560,
      vat: 342619.2,
      total: 5237179.2,
      currencyCode: "THB",
      etaxStatus: "queued",
      createdAt: "2026-07-01T03:00:00.000Z",
    });
  });
});

describe("toCustomerMap", () => {
  it("maps customer_id -> { name, taxId } (both REAL columns)", () => {
    const m = toCustomerMap([{ id: "c1", name: "Acme", tax_id: "0-1075-36000-11-2" }]);
    expect(m.get("c1")).toEqual({ name: "Acme", taxId: "0-1075-36000-11-2" });
    expect(m.get("missing")).toBeUndefined();
  });
});

describe("statusBadgeKind — the four enum states map to StatusBadge kinds", () => {
  it("queued->pending, sent->approved, rejected->rejected, void->draft", () => {
    expect(ETAX_STATUSES.map(statusBadgeKind)).toEqual([
      "pending",
      "approved",
      "rejected",
      "draft",
    ]);
  });
});

describe("queuedInvoiceIds / sumGrossTotal", () => {
  it("selects only queued ids as the batch-send set", () => {
    const rows = [
      inv({ id: "a", etaxStatus: "queued" }),
      inv({ id: "b", etaxStatus: "sent" }),
      inv({ id: "c", etaxStatus: "queued" }),
      inv({ id: "d", etaxStatus: "rejected" }),
    ];
    expect(queuedInvoiceIds(rows)).toEqual(["a", "c"]);
  });

  it("sums gross totals (amount + vat)", () => {
    expect(sumGrossTotal([inv({ total: 107 }), inv({ total: 5237179.2 })])).toBe(5237286.2);
  });
});

describe("HONEST_EMPTY_THEATER (B-124) — the fabricated e-Tax theater is never rendered as data", () => {
  it("lists exactly the four honest-empty compliance artefacts", () => {
    expect([...HONEST_EMPTY_THEATER]).toEqual([
      "rdAcknowledgement",
      "caCertificate",
      "xmlSigningTimestamp",
      "deliveryReceipt",
    ]);
  });

  it("statusBadgeKind carries ONLY the real status — no RD acknowledgement leaks in", () => {
    // A `sent` invoice resolves to the plain approved badge; there is no ack/receipt field
    // anywhere in the pure surface, so the theater cannot be reconstructed from these helpers.
    expect(statusBadgeKind("sent")).toBe("approved");
    const surface = JSON.stringify({ counts: statusCountMap([]), row: inv() });
    expect(surface).not.toMatch(/ack|receipt|cert|xml/i);
  });
});

describe("formatters (ASCII-only, no baht glyph)", () => {
  it("formatMoney groups thousands with no decimals / baht", () => {
    expect(formatMoney(3850000)).toBe("3,850,000");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(Number.NaN)).toBe("0");
  });

  it("formatMillions renders one decimal", () => {
    expect(formatMillions(3850000)).toBe("3.9");
    expect(formatMillions(0)).toBe("0.0");
  });

  it("formatDate emits a UTC YYYY-MM-DD, else empty", () => {
    expect(formatDate("2026-07-01T03:00:00.000Z")).toBe("2026-07-01");
    expect(formatDate("")).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });
});
