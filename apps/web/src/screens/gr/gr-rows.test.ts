/*
 * Unit tests for gr-rows.ts (P2-WEB-11, gate G3) — the pure GR-list helpers that
 * back GRList. Covers the opaque-row narrowing (gr + po/wo), the tab partition +
 * C10 counts, the status tone/label mapping (received/returned/cancelled), the
 * ref-number resolution, the free-text filter, the open-anchor gate, money
 * formatting, and the POST /gr line composition.
 */
import { describe, it, expect } from "vitest";
import {
  toGrRow,
  toAnchorDoc,
  filterByTab,
  tabCount,
  countByStatus,
  refKind,
  refNoMap,
  resolveRefNo,
  statusTone,
  statusLabelKind,
  filterByQuery,
  openAnchors,
  formatMoney,
  buildLines,
  type GrRow,
} from "./gr-rows";

const row = (over: Partial<GrRow> = {}): GrRow => ({
  id: "g1",
  no: "GR-2026-0001",
  poId: "",
  woId: "",
  status: "received",
  received: 0,
  rejected: 0,
  photos: [],
  ...over,
});

describe("toGrRow", () => {
  it("narrows the grWire shape (snake_case po_id/wo_id, numeric received/rejected)", () => {
    expect(
      toGrRow({
        id: "g9",
        no: "GR-2026-0148",
        po_id: "po-1",
        wo_id: null,
        status: "received",
        received: 320,
        rejected: 4,
        photos: ["a.jpg", 5, "b.jpg"],
      }),
    ).toEqual({
      id: "g9",
      no: "GR-2026-0148",
      poId: "po-1",
      woId: "",
      status: "received",
      received: 320,
      rejected: 4,
      photos: ["a.jpg", "b.jpg"],
    });
  });

  it("coerces string numbers and defaults missing fields", () => {
    const r = toGrRow({ id: "g2", received: "120" });
    expect(r.received).toBe(120);
    expect(r.rejected).toBe(0);
    expect(r.status).toBe("");
    expect(r.photos).toEqual([]);
  });
});

describe("toAnchorDoc", () => {
  it("narrows a /po row (amount falls back to total)", () => {
    expect(toAnchorDoc({ id: "po-1", no: "PO-2026-0290", status: "approved", total: 902475 })).toEqual({
      id: "po-1",
      no: "PO-2026-0290",
      status: "approved",
      amount: 902475,
    });
  });

  it("narrows a /wo row (amount falls back to value)", () => {
    expect(toAnchorDoc({ id: "wo-1", no: "WO-2026-0117", status: "approved", value: 537500 }).amount).toBe(537500);
  });
});

describe("filterByTab + tabCount", () => {
  const rows: GrRow[] = [
    row({ id: "a", poId: "po1", status: "received" }),
    row({ id: "b", woId: "wo1", status: "received" }),
    row({ id: "c", poId: "po2", status: "returned" }),
    row({ id: "d", woId: "wo2", status: "cancelled" }),
    row({ id: "e", poId: "po3", status: "received" }),
  ];

  it("po tab = open PO receipts only", () => {
    expect(filterByTab(rows, "po").map((r) => r.id)).toEqual(["a", "e"]);
  });
  it("wo tab = open WO receipts only", () => {
    expect(filterByTab(rows, "wo").map((r) => r.id)).toEqual(["b"]);
  });
  it("other tab = no-anchor rows (empty on this wire)", () => {
    expect(filterByTab(rows, "other")).toEqual([]);
  });
  it("return tab = returned status", () => {
    expect(filterByTab(rows, "return").map((r) => r.id)).toEqual(["c"]);
  });
  it("cancel tab = cancelled status", () => {
    expect(filterByTab(rows, "cancel").map((r) => r.id)).toEqual(["d"]);
  });
  it("tabCount returns the filtered length (C10)", () => {
    expect(tabCount(rows, "po")).toBe(2);
    expect(tabCount(rows, "cancel")).toBe(1);
  });
});

describe("countByStatus", () => {
  it("counts rows of a given status", () => {
    const rows = [row({ status: "received" }), row({ status: "received" }), row({ status: "returned" })];
    expect(countByStatus(rows, "received")).toBe(2);
    expect(countByStatus(rows, "returned")).toBe(1);
    expect(countByStatus(rows, "cancelled")).toBe(0);
  });
});

describe("refKind", () => {
  it("prefers PO, then WO, then none", () => {
    expect(refKind(row({ poId: "p" }))).toBe("PO");
    expect(refKind(row({ woId: "w" }))).toBe("WO");
    expect(refKind(row())).toBe("");
  });
});

describe("refNoMap + resolveRefNo", () => {
  const poNos = refNoMap([
    { id: "po1", no: "PO-2026-0288", status: "approved", amount: 0 },
    { id: "po2", no: "PO-2026-0287", status: "approved", amount: 0 },
  ]);
  const woNos = refNoMap([{ id: "wo1", no: "WO-2026-0115", status: "approved", amount: 0 }]);

  it("resolves a PO anchor to its doc no", () => {
    expect(resolveRefNo(row({ poId: "po1" }), poNos, woNos)).toBe("PO-2026-0288");
  });
  it("resolves a WO anchor to its doc no", () => {
    expect(resolveRefNo(row({ woId: "wo1" }), poNos, woNos)).toBe("WO-2026-0115");
  });
  it("returns empty (never a UUID) for an anchor not in the fetched page", () => {
    expect(resolveRefNo(row({ poId: "po-missing" }), poNos, woNos)).toBe("");
    expect(resolveRefNo(row(), poNos, woNos)).toBe("");
  });
});

describe("statusTone + statusLabelKind", () => {
  it("received maps to the approved (green) tone", () => {
    expect(statusTone("received")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" });
    expect(statusLabelKind("received")).toBe("received");
  });
  it("cancelled uses the ds.jsx STATUS.cancelled verbatim literals", () => {
    expect(statusTone("cancelled")).toEqual({ bg: "#F1F5F9", fg: "#64748B", dot: "#94A3B8" });
    expect(statusLabelKind("cancelled")).toBe("cancelled");
  });
  it("returned uses the info tone (approximate) and its own label kind", () => {
    expect(statusTone("returned")).toEqual({ bg: "var(--info-soft)", fg: "var(--info)", dot: "#1D4ED8" });
    expect(statusLabelKind("returned")).toBe("returned");
  });
  it("unknown status falls back to received", () => {
    expect(statusLabelKind("weird")).toBe("received");
  });
});

describe("filterByQuery", () => {
  const poNos = refNoMap([{ id: "po1", no: "PO-2026-0288", status: "approved", amount: 0 }]);
  const woNos = refNoMap([]);
  const rows = [row({ id: "a", no: "GR-2026-0148", poId: "po1" }), row({ id: "b", no: "GR-2026-0147" })];

  it("returns all rows for an empty query", () => {
    expect(filterByQuery(rows, "   ", poNos, woNos)).toHaveLength(2);
  });
  it("matches on GR no (case-insensitive)", () => {
    expect(filterByQuery(rows, "0148", poNos, woNos).map((r) => r.id)).toEqual(["a"]);
  });
  it("matches on the resolved ref no", () => {
    expect(filterByQuery(rows, "0288", poNos, woNos).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("openAnchors", () => {
  it("keeps only approved (open) docs", () => {
    const docs = [
      { id: "1", no: "PO-1", status: "approved", amount: 0 },
      { id: "2", no: "PO-2", status: "draft", amount: 0 },
      { id: "3", no: "PO-3", status: "closed", amount: 0 },
    ];
    expect(openAnchors(docs).map((d) => d.id)).toEqual(["1"]);
    expect(openAnchors(undefined)).toEqual([]);
  });
});

describe("formatMoney", () => {
  it("groups thousands, rounds, and guards non-finite", () => {
    expect(formatMoney(902475)).toBe("902,475");
    expect(formatMoney(2612800)).toBe("2,612,800");
    expect(formatMoney(96800.4)).toBe("96,800");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("buildLines", () => {
  it("composes a single aggregate line and clamps negatives to 0", () => {
    expect(buildLines(320, 4)).toEqual([{ qty_ok: 320, qty_rejected: 4 }]);
    expect(buildLines(-5, Number.NaN)).toEqual([{ qty_ok: 0, qty_rejected: 0 }]);
  });
});
