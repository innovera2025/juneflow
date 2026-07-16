/*
 * Unit tests for boq-overview-agg.ts (P2-WEB-03, gate G3) — the pure BOQ-overview
 * aggregation helpers that back BOQOverview. Covers the doc-total slices, the
 * PR/PO/WO amount sums, millions/percentage formatting, and the balance-item
 * derivation + grouping + search.
 */
import { describe, it, expect } from "vitest";
import type { BoqRow } from "./boq-rows";
import {
  docsInProject,
  sumDocTotal,
  sumTotalByStatuses,
  toAmtRow,
  sumAmount,
  millions1,
  pct,
  pct1,
  toBalanceItem,
  itemsBoqValue,
  itemsUsedValue,
  usedPctFromItems,
  groupBalanceItems,
  filterBalanceItems,
  toGroupList,
  type BalanceItem,
} from "./boq-overview-agg";

const doc = (over: Partial<BoqRow> = {}): BoqRow => ({
  id: "b1",
  no: "BOQ-2026-001",
  name: "Block B",
  scope: "B-Type1",
  projectId: "p1",
  version: 1,
  status: "approved",
  currency_code: "THB",
  total: 0,
  ...over,
});

describe("doc-level aggregates", () => {
  const docs = [
    doc({ id: "a", projectId: "p1", status: "approved", total: 1_000_000 }),
    doc({ id: "b", projectId: "p1", status: "pending", total: 400_000 }),
    doc({ id: "c", projectId: "p1", status: "revise", total: 200_000 }),
    doc({ id: "d", projectId: "p2", status: "approved", total: 9_000_000 }),
  ];

  it("docsInProject filters by project id; empty = all", () => {
    expect(docsInProject(docs, "p1").map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(docsInProject(docs, "")).toHaveLength(4);
  });

  it("sumDocTotal sums totals", () => {
    expect(sumDocTotal(docsInProject(docs, "p1"))).toBe(1_600_000);
  });

  it("sumTotalByStatuses slices by status set", () => {
    const p1 = docsInProject(docs, "p1");
    expect(sumTotalByStatuses(p1, ["approved"])).toBe(1_000_000);
    expect(sumTotalByStatuses(p1, ["pending", "revise"])).toBe(600_000);
    expect(sumTotalByStatuses(p1, ["draft"])).toBe(0);
  });
});

describe("PR/PO/WO amount sums", () => {
  const rows = [
    toAmtRow({ project_id: "p1", status: "approved", amount: 500_000 }),
    toAmtRow({ project_id: "p1", status: "draft", amount: 300_000 }),
    toAmtRow({ projectId: "p2", status: "approved", amount: 700_000 }),
  ];

  it("toAmtRow narrows snake_case + camelCase", () => {
    expect(toAmtRow({ project_id: "x", status: "s", amount: 5 })).toEqual({
      projectId: "x",
      status: "s",
      amount: 5,
    });
    expect(toAmtRow({ projectId: "y", amount: "12.5" }).amount).toBe(12.5);
  });

  it("sumAmount respects project + optional status filter", () => {
    expect(sumAmount(rows, "p1")).toBe(800_000); // all p1 statuses
    expect(sumAmount(rows, "p1", ["approved"])).toBe(500_000);
    expect(sumAmount(rows, "")).toBe(1_500_000); // no project filter
  });
});

describe("formatting", () => {
  it("millions1 renders 1-decimal millions", () => {
    expect(millions1(12_400_000)).toBe("12.4");
    expect(millions1(600_000)).toBe("0.6");
    expect(millions1(Number.NaN)).toBe("0.0");
  });

  it("pct / pct1 guard divide-by-zero", () => {
    expect(pct(6, 12)).toBe(50);
    expect(pct(1, 0)).toBe(0);
    expect(pct1(6_280_000, 12_400_000)).toBe("50.6");
  });
});

describe("balance-item derivation", () => {
  const raw = {
    group_id: "g1",
    code: "02-016",
    cat: "M",
    name: "steel",
    unit: "bar",
    qty: 1280,
    price: 685,
    remain_qty: 960,
  };

  it("derives used/balance/pct from qty + remain + price", () => {
    const it = toBalanceItem(raw);
    expect(it).toMatchObject({
      groupId: "g1",
      code: "02-016",
      cat: "M",
      boqQty: 1280,
      used: 320,
      balQty: 960,
      pct: 25,
    });
    expect(it.boqV).toBe(1280 * 685);
    expect(it.balV).toBe(960 * 685);
    expect(it.usedV).toBe(320 * 685);
  });

  it("fresh item (remain == qty) => used 0 / pct 0 (real seed state)", () => {
    const it = toBalanceItem({ ...raw, remain_qty: 1280 });
    expect(it.used).toBe(0);
    expect(it.pct).toBe(0);
    expect(it.balV).toBe(1280 * 685);
  });

  it("coerces unknown cat to M and guards qty 0", () => {
    const it = toBalanceItem({ qty: 0, price: 100, remain_qty: 0, cat: "?" });
    expect(it.cat).toBe("M");
    expect(it.pct).toBe(0);
  });
});

describe("balance aggregates + grouping", () => {
  const items: BalanceItem[] = [
    toBalanceItem({ group_id: "g2", code: "a", cat: "M", qty: 100, price: 10, remain_qty: 50 }),
    toBalanceItem({ group_id: "g2", code: "b", cat: "S", qty: 1, price: 1000, remain_qty: 1 }),
    toBalanceItem({ group_id: "g3", code: "c", cat: "L", qty: 10, price: 100, remain_qty: 0 }),
  ];

  it("itemsBoqValue / itemsUsedValue / usedPctFromItems", () => {
    expect(itemsBoqValue(items)).toBe(1000 + 1000 + 1000);
    expect(itemsUsedValue(items)).toBe(500 + 0 + 1000);
    expect(usedPctFromItems(items)).toBeCloseTo((1500 / 3000) * 100, 5);
  });

  it("groupBalanceItems buckets by group order, drops empty groups", () => {
    const groups = groupBalanceItems(items, [
      { id: "g1", name: "01" },
      { id: "g2", name: "02" },
      { id: "g3", name: "03" },
    ]);
    expect(groups.map((g) => g.name)).toEqual(["02", "03"]);
    expect(groups[0].rows.map((r) => r.code)).toEqual(["a", "b"]);
  });

  it("filterBalanceItems matches code + name; empty query = all", () => {
    expect(filterBalanceItems(items, "").length).toBe(3);
    expect(filterBalanceItems(items, "a").map((i) => i.code)).toEqual(["a"]);
  });

  it("toGroupList maps ordered {id,name}", () => {
    expect(
      toGroupList([
        { id: "g1", name: "01", seq: 1, cbs: null },
        { id: "g2", name: "02", seq: 2 },
      ]),
    ).toEqual([
      { id: "g1", name: "01" },
      { id: "g2", name: "02" },
    ]);
  });
});
