/*
 * Unit tests for po-list-rows.ts (B-355, gate G3) — the POList-only wire narrowing
 * (`paid`, `doc_date`), the house ISO/UTC date format, and the paid-bar proportion.
 * The shared po-wo-rows helpers (toPoRow / filterPoByTab / formatMoney / ...) are covered
 * by po-wo-rows.test.ts; the component<->payload seam is covered by po-list.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { toPoListWire, poListWireById, formatDate, paidPct } from "./po-list-rows";

describe("toPoListWire", () => {
  it("narrows the server's snake_case fields off the /po list row", () => {
    expect(
      toPoListWire({
        id: "po-1",
        no: "PO-2026-0291",
        paid: 500000,
        deposit: 300000,
        doc_date: "2026-05-24T03:15:00.000Z",
      }),
    ).toEqual({ id: "po-1", paid: 500000, docDate: "2026-05-24T03:15:00.000Z" });
  });

  it("accepts camelCase for robustness (mirrors toPoRow)", () => {
    expect(toPoListWire({ id: "po-1", docDate: "2026-05-24T00:00:00Z" }).docDate).toBe(
      "2026-05-24T00:00:00Z",
    );
  });

  it("parses a numeric-string paid (the wire's money-as-string tolerance)", () => {
    expect(toPoListWire({ id: "po-1", paid: "317000" }).paid).toBe(317000);
  });

  it("reports 0 for a PO the server sent no billings for", () => {
    expect(toPoListWire({ id: "po-2", paid: 0 }).paid).toBe(0);
  });

  it("defaults a missing paid to 0 and a missing doc_date to empty", () => {
    expect(toPoListWire({ id: "po-3" })).toEqual({ id: "po-3", paid: 0, docDate: "" });
  });
});

describe("poListWireById", () => {
  it("keys each served row by its doc id", () => {
    const map = poListWireById([
      { id: "po-1", paid: 317000, doc_date: "2026-05-24T00:00:00Z" },
      { id: "po-2", paid: 0, doc_date: "2026-05-25T00:00:00Z" },
    ]);
    expect(map.get("po-1")?.paid).toBe(317000);
    expect(map.get("po-2")?.docDate).toBe("2026-05-25T00:00:00Z");
  });

  it("skips a row with no id rather than keying it under an empty string", () => {
    expect(poListWireById([{ paid: 999 }]).size).toBe(0);
  });

  it("tolerates an undefined payload (query not settled)", () => {
    expect(poListWireById(undefined).size).toBe(0);
  });
});

describe("formatDate", () => {
  it("renders a wire instant as an ISO/UTC calendar date", () => {
    expect(formatDate("2026-05-24T03:15:00.000Z")).toBe("2026-05-24");
  });

  it("uses UTC, not the runner's local zone", () => {
    expect(formatDate("2026-05-24T23:30:00.000Z")).toBe("2026-05-24");
  });

  it("returns empty for a missing or unparseable value (the view em-dashes it)", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });
});

describe("paidPct", () => {
  it("is the display proportion of paid to the stored total", () => {
    expect(paidPct(317000, 1268000)).toBe(25);
    expect(paidPct(1268000, 1268000)).toBe(100);
  });

  it("is 0 for an unpaid PO", () => {
    expect(paidPct(0, 1268000)).toBe(0);
  });

  it("clamps an over-billed PO to a full bar instead of overflowing the track", () => {
    expect(paidPct(2000000, 1268000)).toBe(100);
  });

  it("floors a credit-note-negative paid at 0", () => {
    expect(paidPct(-5000, 1268000)).toBe(0);
  });

  it("returns 0 rather than dividing by a zero / negative / non-finite total", () => {
    expect(paidPct(100, 0)).toBe(0);
    expect(paidPct(100, -1)).toBe(0);
    expect(paidPct(100, Number.NaN)).toBe(0);
    expect(paidPct(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });
});
