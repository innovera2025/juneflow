/*
 * fa-adjust-rows unit tests (fa.adjust, gate G3) — the pure adjustment logic ported from fa.jsx
 * FAAdjust + AdjustDetail (toFaAdjustment narrowing / kind badge tone / write-off + revalue paths
 * / tab counts / honest sale-empty / date + money format). ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toFaAdjustment,
  adjustColumns,
  adjustKindMeta,
  countByKind,
  filterByKind,
  formatMoney,
  formatDate,
  type FaAdjustment,
} from "./fa-adjust-rows";

const adj = (p: Partial<FaAdjustment> = {}): FaAdjustment => ({
  id: "adj1",
  assetId: "fa1",
  kind: "revalue",
  amount: 72000000,
  currencyCode: "THB",
  jvId: "",
  status: "approved",
  memo: "revalue -> 72000000",
  createdAt: "2026-05-01T02:42:00.000Z",
  ...p,
});

describe("toFaAdjustment", () => {
  it("narrows a full opaque /fa/adjustments row (snake_case)", () => {
    expect(
      toFaAdjustment({
        id: "wo1",
        asset_id: "fa98",
        kind: "write_off",
        amount: 188000,
        currency_code: "THB",
        jv_id: "jv-7",
        status: "approved",
        memo: "write-off Hino",
        created_at: "2026-05-20T00:00:00.000Z",
      }),
    ).toEqual({
      id: "wo1",
      assetId: "fa98",
      kind: "write_off",
      amount: 188000,
      currencyCode: "THB",
      jvId: "jv-7",
      status: "approved",
      memo: "write-off Hino",
      createdAt: "2026-05-20T00:00:00.000Z",
    });
  });

  it("keeps a null jv_id / memo as '' (em-dash path) and coerces numeric-string amount", () => {
    const r = toFaAdjustment({ id: "rv1", asset_id: "fa1", kind: "revalue", amount: "72000000.00", jv_id: null, memo: null });
    expect(r.jvId).toBe("");
    expect(r.memo).toBe("");
    expect(r.amount).toBe(72000000);
  });
});

describe("adjustKindMeta", () => {
  it("tones revalue green (ok), write_off red (danger), sale info, unknown neutral", () => {
    expect(adjustKindMeta("revalue")).toEqual({ badge: "revalue", bg: "var(--ok-soft)", fg: "var(--ok)" });
    expect(adjustKindMeta("write_off")).toEqual({ badge: "writeoff", bg: "var(--danger-soft)", fg: "var(--danger)" });
    expect(adjustKindMeta("sale")).toEqual({ badge: "sale", bg: "var(--info-soft)", fg: "var(--info)" });
    expect(adjustKindMeta("mystery")).toEqual({ badge: "other", bg: "var(--surface-3)", fg: "var(--text-2)" });
  });
});

describe("adjustColumns (kind-aware before/after placement of the single wire amount)", () => {
  it("revalue -> amount is the NEW value: after column, before em-dashes (null)", () => {
    expect(adjustColumns(adj({ kind: "revalue", amount: 72000000 }))).toEqual({
      before: null,
      after: 72000000,
    });
  });

  it("write_off -> amount is the REMOVED book value: before column, after em-dashes (null)", () => {
    expect(adjustColumns(adj({ kind: "write_off", amount: 188000 }))).toEqual({
      before: 188000,
      after: null,
    });
  });

  it("unknown kind -> both null (honest, no assumption about the amount's meaning)", () => {
    expect(adjustColumns(adj({ kind: "sale", amount: 380000 }))).toEqual({ before: null, after: null });
    expect(adjustColumns(adj({ kind: "mystery", amount: 5 }))).toEqual({ before: null, after: null });
  });
});

describe("tab counts + filter (revalue / write-off paths, honest sale-empty)", () => {
  const rows = [
    adj({ id: "a", kind: "revalue" }),
    adj({ id: "b", kind: "write_off" }),
    adj({ id: "c", kind: "write_off" }),
  ];

  it("counts by kind; all -> total; sale -> 0 (the server writes no sale)", () => {
    expect(countByKind(rows, "all")).toBe(3);
    expect(countByKind(rows, "revalue")).toBe(1);
    expect(countByKind(rows, "write_off")).toBe(2);
    expect(countByKind(rows, "sale")).toBe(0);
  });

  it("filters rows by kind; sale is always empty", () => {
    expect(filterByKind(rows, "revalue").map((r) => r.id)).toEqual(["a"]);
    expect(filterByKind(rows, "write_off").map((r) => r.id)).toEqual(["b", "c"]);
    expect(filterByKind(rows, "sale")).toEqual([]);
    expect(filterByKind(rows, "all")).toHaveLength(3);
  });

  it("an empty history counts 0 across every tab", () => {
    expect(countByKind([], "all")).toBe(0);
    expect(countByKind([], "revalue")).toBe(0);
  });
});

describe("formatMoney + formatDate", () => {
  it("groups thousands, signs negatives, no baht symbol", () => {
    expect(formatMoney(12000000)).toBe("12,000,000");
    expect(formatMoney(-240000)).toBe("-240,000");
    expect(formatMoney(0)).toBe("0");
  });

  it("formats created_at to an ISO date (UTC), '' on missing/invalid (cell em-dashes)", () => {
    expect(formatDate("2026-05-20T00:00:00.000Z")).toBe("2026-05-20");
    expect(formatDate("")).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });
});
