/*
 * Unit tests for boq-editor-agg.ts (P2-WEB-04, gate G3) — the pure BOQ-editor logic that
 * backs BOQEditor. Covers item/group narrowing, category (M/S/L) totals, per-group value +
 * grouping, the cat-chip + search filter, CBS budget-row derivation, fmt/fmtDec/bahtK
 * formatting, doc resolution + the read-only gate, cost-center name resolution, and the
 * add/duplicate/generate-pr write-body builders.
 */
import { describe, it, expect } from "vitest";
import type { BoqRow } from "./boq-rows";
import {
  toEditorItem,
  lineTotal,
  toEditorGroups,
  groupItemsByGroup,
  sumLineTotals,
  categoryTotals,
  filterEditorRows,
  cbsRows,
  cbsTotals,
  formatDec,
  bahtK,
  resolveDoc,
  isReadOnly,
  ccNameById,
  canSubmitItem,
  buildAddItemBody,
  buildDuplicateBody,
  buildGeneratePrBody,
  generatedPrNos,
  firstPrNo,
  type EditorItem,
} from "./boq-editor-agg";

const item = (over: Partial<EditorItem> = {}): EditorItem => ({
  id: "i1",
  groupId: "g1",
  code: "MAT-001",
  cat: "M",
  name: "Cement",
  unit: "bag",
  qty: 10,
  price: 100,
  remainQty: 10,
  ccId: "",
  currencyCode: "THB",
  ...over,
});

describe("toEditorItem", () => {
  it("narrows the snake_case wire shape (boq.ts itemWire)", () => {
    const e = toEditorItem({
      id: "u1",
      group_id: "grp",
      code: "MAT-CEM-001",
      name: "Portland cement",
      cat: "m",
      qty: 4800,
      unit: "bag",
      price: 168.5,
      currency_code: "THB",
      cc_id: "cc9",
      remain_qty: 4000,
      element_id: null,
    });
    expect(e).toEqual({
      id: "u1",
      groupId: "grp",
      code: "MAT-CEM-001",
      cat: "M",
      name: "Portland cement",
      unit: "bag",
      qty: 4800,
      price: 168.5,
      remainQty: 4000,
      ccId: "cc9",
      currencyCode: "THB",
    });
  });

  it("defaults an unknown cat to M and currency to THB", () => {
    const e = toEditorItem({ id: "x", cat: "Z" });
    expect(e.cat).toBe("M");
    expect(e.currencyCode).toBe("THB");
  });

  it("coerces S and L cats", () => {
    expect(toEditorItem({ cat: "s" }).cat).toBe("S");
    expect(toEditorItem({ cat: "L" }).cat).toBe("L");
  });

  it("lineTotal = qty x price", () => {
    expect(lineTotal(item({ qty: 12, price: 50 }))).toBe(600);
  });
});

describe("toEditorGroups", () => {
  it("narrows + sorts by seq and pulls nested cbs", () => {
    const groups = toEditorGroups([
      { id: "b", name: "02 Structure", seq: 2, cbs: { budget: 1000, used: 400, committed: 100 } },
      { id: "a", name: "01 Site", seq: 1, cbs: null },
    ]);
    expect(groups.map((g) => g.id)).toEqual(["a", "b"]);
    expect(groups[0].cbs).toBeNull();
    expect(groups[1].cbs).toEqual({ budget: 1000, used: 400, committed: 100, available: 500 });
  });

  it("returns [] for undefined groups", () => {
    expect(toEditorGroups(undefined)).toEqual([]);
  });

  it("honours a server-provided available over the derived one", () => {
    const [g] = toEditorGroups([
      { id: "a", name: "x", seq: 1, cbs: { budget: 100, used: 10, committed: 5, available: 80 } },
    ]);
    expect(g.cbs?.available).toBe(80);
  });
});

describe("grouping + per-group value", () => {
  const items = [
    item({ id: "1", groupId: "g1", qty: 2, price: 100 }),
    item({ id: "2", groupId: "g1", qty: 1, price: 50 }),
    item({ id: "3", groupId: "g2", qty: 4, price: 25 }),
  ];
  it("buckets items by group", () => {
    const map = groupItemsByGroup(items);
    expect(map.get("g1")?.length).toBe(2);
    expect(map.get("g2")?.length).toBe(1);
  });
  it("sums line totals per group and across all", () => {
    const map = groupItemsByGroup(items);
    expect(sumLineTotals(map.get("g1") ?? [])).toBe(250);
    expect(sumLineTotals(items)).toBe(350);
  });
  it("empty rows sum to 0", () => {
    expect(sumLineTotals([])).toBe(0);
  });
});

describe("categoryTotals", () => {
  it("sums value + count per M/S/L and the grand total", () => {
    const t = categoryTotals([
      item({ cat: "M", qty: 10, price: 100 }), // 1000
      item({ cat: "M", qty: 1, price: 500 }), // 500
      item({ cat: "S", qty: 1, price: 2000 }), // 2000
      item({ cat: "L", qty: 5, price: 100 }), // 500
    ]);
    expect(t.M).toBe(1500);
    expect(t.S).toBe(2000);
    expect(t.L).toBe(500);
    expect(t.countM).toBe(2);
    expect(t.countS).toBe(1);
    expect(t.countL).toBe(1);
    expect(t.grand).toBe(4000);
  });
  it("empty -> all zero", () => {
    expect(categoryTotals([])).toEqual({
      M: 0,
      S: 0,
      L: 0,
      countM: 0,
      countS: 0,
      countL: 0,
      grand: 0,
    });
  });
});

describe("filterEditorRows", () => {
  const rows = [
    item({ id: "1", cat: "M", code: "MAT-CEM", name: "Cement" }),
    item({ id: "2", cat: "S", code: "SUB-STR", name: "Concrete pour" }),
    item({ id: "3", cat: "L", code: "LAB-STR", name: "Rebar labor" }),
  ];
  it("empty cat set shows all", () => {
    expect(filterEditorRows(rows, new Set(), "").length).toBe(3);
  });
  it("filters by the active category set", () => {
    const out = filterEditorRows(rows, new Set<"M" | "S" | "L">(["S", "L"]), "");
    expect(out.map((r) => r.id)).toEqual(["2", "3"]);
  });
  it("searches name+code case-insensitively", () => {
    expect(filterEditorRows(rows, new Set(), "cem").map((r) => r.id)).toEqual(["1"]);
    expect(filterEditorRows(rows, new Set(), "LAB").map((r) => r.id)).toEqual(["3"]);
  });
  it("combines cat + search", () => {
    expect(
      filterEditorRows(rows, new Set<"M" | "S" | "L">(["M"]), "concrete").length,
    ).toBe(0);
  });
});

describe("cbsRows + cbsTotals", () => {
  const groups = toEditorGroups([
    { id: "g1", name: "01", seq: 1, cbs: { budget: 1000, used: 400, committed: 200 } },
    { id: "g2", name: "02", seq: 2, cbs: { budget: 1000, used: 800, committed: 400 } }, // over
    { id: "g3", name: "03", seq: 3, cbs: null }, // no budget
  ]);
  it("derives available + over + percentages", () => {
    const rows = cbsRows(groups);
    expect(rows[0]).toMatchObject({ available: 400, over: false, usedPct: 40, commPct: 20 });
    expect(rows[1]).toMatchObject({ available: -200, over: true });
    expect(rows[2]).toMatchObject({ budget: 0, usedPct: 0, commPct: 0, over: false });
  });
  it("totals sum the rows", () => {
    const t = cbsTotals(cbsRows(groups));
    expect(t.budget).toBe(2000);
    expect(t.used).toBe(1200);
    expect(t.committed).toBe(600);
    expect(t.available).toBe(200);
  });
});

describe("formatDec + bahtK", () => {
  it("fmtDec keeps 2 decimals + thousands", () => {
    expect(formatDec(168.5)).toBe("168.50");
    expect(formatDec(1234567.899)).toBe("1,234,567.90");
    expect(formatDec(0)).toBe("0.00");
    expect(formatDec(Number.NaN)).toBe("0.00");
  });
  it("bahtK compacts to M / K", () => {
    expect(bahtK(1_240_000)).toBe("1.24M");
    expect(bahtK(280_000)).toBe("280K");
    expect(bahtK(0)).toBe("0K");
  });
});

describe("resolveDoc + isReadOnly", () => {
  const doc = (over: Partial<BoqRow>): BoqRow => ({
    id: "d",
    no: "BOQ-1",
    name: "n",
    scope: "s",
    projectId: "p",
    version: 1,
    status: "draft",
    currency_code: "THB",
    total: 0,
    ...over,
  });
  const docs = [doc({ id: "a", no: "BOQ-A" }), doc({ id: "b", no: "BOQ-B" })];
  it("resolves by no", () => {
    expect(resolveDoc(docs, "BOQ-B")?.id).toBe("b");
  });
  it("falls back to the first doc when no is empty or unmatched", () => {
    expect(resolveDoc(docs, "")?.id).toBe("a");
    expect(resolveDoc(docs, "BOQ-Z")?.id).toBe("a");
  });
  it("undefined when there are no docs", () => {
    expect(resolveDoc([], "BOQ-A")).toBeUndefined();
  });
  it("read-only only when approved (locked)", () => {
    expect(isReadOnly("approved")).toBe(true);
    expect(isReadOnly("draft")).toBe(false);
    expect(isReadOnly("pending")).toBe(false);
    expect(isReadOnly("revise")).toBe(false);
  });
});

describe("ccNameById", () => {
  it("maps id -> {code,name} and skips idless rows", () => {
    const map = ccNameById([
      { id: "cc1", code: "UT0001", name: "Site prep" },
      { code: "UT0002", name: "no id" },
    ]);
    expect(map.get("cc1")).toEqual({ code: "UT0001", name: "Site prep" });
    expect(map.size).toBe(1);
  });
  it("undefined rows -> empty map", () => {
    expect(ccNameById(undefined).size).toBe(0);
  });
});

describe("write-body builders", () => {
  it("canSubmitItem gates on code + name + positive qty", () => {
    expect(canSubmitItem("C", "N", 1)).toBe(true);
    expect(canSubmitItem("", "N", 1)).toBe(false);
    expect(canSubmitItem("C", " ", 1)).toBe(false);
    expect(canSubmitItem("C", "N", 0)).toBe(false);
  });
  it("buildAddItemBody sends only persisted columns (trimmed)", () => {
    const body = buildAddItemBody("g5", {
      cat: "S",
      code: " SUB-1 ",
      name: " Pour ",
      unit: " lot ",
      qty: 1,
      price: 1840000,
      currencyCode: "",
    });
    expect(body).toEqual({
      group_id: "g5",
      code: "SUB-1",
      name: "Pour",
      cat: "S",
      qty: 1,
      unit: "lot",
      price: 1840000,
      currency_code: "THB",
    });
    expect("cc_id" in body).toBe(false);
    expect("detail" in body).toBe(false);
  });
  it("buildDuplicateBody copies with a -COPY code suffix", () => {
    const body = buildDuplicateBody(item({ code: "MAT-001", qty: 3, price: 20 }));
    expect(body.code).toBe("MAT-001-COPY");
    expect(body).toMatchObject({ group_id: "g1", name: "Cement", cat: "M", qty: 3, price: 20 });
  });
  it("buildGeneratePrBody carries the selected item ids (no per-item qty)", () => {
    expect(buildGeneratePrBody(new Set(["a", "b"]))).toEqual({ item_ids: ["a", "b"] });
    expect(buildGeneratePrBody([])).toEqual({ item_ids: [] });
  });
});

describe("generate-pr response parsing", () => {
  it("reads every created PR number in order", () => {
    const resp = { prs: [{ no: "PR-2026-0001" }, { no: "PR-S-2026-0001" }] };
    expect(generatedPrNos(resp)).toEqual(["PR-2026-0001", "PR-S-2026-0001"]);
    expect(firstPrNo(resp)).toBe("PR-2026-0001");
  });
  it("tolerates a missing/empty prs array", () => {
    expect(generatedPrNos({})).toEqual([]);
    expect(generatedPrNos(null)).toEqual([]);
    expect(firstPrNo({ prs: [] })).toBe("");
  });
});
