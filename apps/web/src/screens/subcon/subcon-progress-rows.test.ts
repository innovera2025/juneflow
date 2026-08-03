/*
 * Unit tests for subcon-progress-rows.ts (subcon.progress port, gate G3) — the pure
 * SubconProgress helpers. Covers the vendor narrowing + subcon/name filters, the
 * per-vendor contract COUNT/Σ VALUE/active-contract grouping, the REAL "working"
 * vendor count, and the period narrowing (title) / seq sort / tfoot Σ amount.
 */
import { describe, it, expect } from "vitest";
import { type ContractRow } from "./subcon-rows";
import {
  toSubconVendor,
  subconVendors,
  filterVendorsByName,
  contractsForVendor,
  vendorContractCount,
  vendorTotalValue,
  activeContractFor,
  workingVendorCount,
  toProgressPeriod,
  sortPeriodsBySeq,
  periodsTotal,
  type SubconVendor,
} from "./subcon-progress-rows";

const vendor = (over: Partial<SubconVendor> = {}): SubconVendor => ({
  id: "v1",
  name: "Rung Rueang Construction Co.",
  kind: "subcon",
  status: "active",
  ...over,
});

const contract = (over: Partial<ContractRow> = {}): ContractRow => ({
  id: "c1",
  no: "WO-2026-0042",
  vendorId: "v1",
  projectId: "p1",
  value: 0,
  currencyCode: "THB",
  retentionPct: 0,
  start: "",
  end: "",
  ...over,
});

describe("toSubconVendor", () => {
  it("narrows a /vendors row (id/name/kind/status)", () => {
    expect(
      toSubconVendor({ id: "v9", name: "Chang Thai", kind: "subcon", status: "active", extra: 1 }),
    ).toEqual({ id: "v9", name: "Chang Thai", kind: "subcon", status: "active" });
  });
  it("defaults missing fields to empty strings (never undefined)", () => {
    expect(toSubconVendor({ id: "v2" })).toEqual({ id: "v2", name: "", kind: "", status: "" });
  });
});

describe("subconVendors", () => {
  it("keeps only kind === subcon (defensive guard against a full catalogue)", () => {
    const rows = [
      vendor({ id: "a", kind: "subcon" }),
      vendor({ id: "b", kind: "supplier" }),
      vendor({ id: "c", kind: "subcon" }),
    ];
    expect(subconVendors(rows).map((v) => v.id)).toEqual(["a", "c"]);
    expect(subconVendors([])).toEqual([]);
  });
});

describe("filterVendorsByName", () => {
  const rows = [
    vendor({ id: "a", name: "Rung Rueang Construction" }),
    vendor({ id: "b", name: "Chang Thai Development" }),
    vendor({ id: "c", name: "Fai Fa Inter" }),
  ];
  it("case-insensitively matches the name substring", () => {
    expect(filterVendorsByName(rows, "thai").map((v) => v.id)).toEqual(["b"]);
    expect(filterVendorsByName(rows, "RUNG").map((v) => v.id)).toEqual(["a"]);
  });
  it("returns the list unchanged for an empty/blank query", () => {
    expect(filterVendorsByName(rows, "").map((v) => v.id)).toEqual(["a", "b", "c"]);
    expect(filterVendorsByName(rows, "   ").map((v) => v.id)).toEqual(["a", "b", "c"]);
  });
  it("returns [] when nothing matches", () => {
    expect(filterVendorsByName(rows, "zzz")).toEqual([]);
  });
});

describe("per-vendor contract aggregates", () => {
  const contracts = [
    contract({ id: "c1", vendorId: "v1", value: 2_150_000 }),
    contract({ id: "c2", vendorId: "v1", value: 1_750_000 }),
    contract({ id: "c3", vendorId: "v2", value: 1_240_000 }),
  ];

  it("contractsForVendor groups by vendor_id (and [] for an empty id)", () => {
    expect(contractsForVendor(contracts, "v1").map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(contractsForVendor(contracts, "v2").map((c) => c.id)).toEqual(["c3"]);
    expect(contractsForVendor(contracts, "")).toEqual([]);
    expect(contractsForVendor(contracts, "nope")).toEqual([]);
  });

  it("vendorContractCount is the real per-vendor row count", () => {
    expect(vendorContractCount(contracts, "v1")).toBe(2);
    expect(vendorContractCount(contracts, "v2")).toBe(1);
    expect(vendorContractCount(contracts, "nope")).toBe(0);
  });

  it("vendorTotalValue sums the real per-vendor contract values (money-safe)", () => {
    expect(vendorTotalValue(contracts, "v1")).toBe(3_900_000);
    expect(vendorTotalValue(contracts, "v2")).toBe(1_240_000);
    expect(vendorTotalValue(contracts, "nope")).toBe(0);
  });

  it("activeContractFor returns the vendor's first contract, else undefined", () => {
    expect(activeContractFor(contracts, "v1")?.id).toBe("c1");
    expect(activeContractFor(contracts, "v2")?.id).toBe("c3");
    expect(activeContractFor(contracts, "nope")).toBeUndefined();
  });
});

describe("workingVendorCount", () => {
  it("counts distinct subcon vendors that appear on >= 1 contract", () => {
    const vendors = [
      vendor({ id: "v1", kind: "subcon" }),
      vendor({ id: "v2", kind: "subcon" }),
      vendor({ id: "v3", kind: "subcon" }), // no contract -> not "working"
      vendor({ id: "s1", kind: "supplier" }), // supplier -> excluded even with a contract
    ];
    const contracts = [
      contract({ vendorId: "v1" }),
      contract({ vendorId: "v1" }), // same vendor twice -> counted once
      contract({ vendorId: "v2" }),
      contract({ vendorId: "s1" }),
    ];
    expect(workingVendorCount(vendors, contracts)).toBe(2);
    expect(workingVendorCount(vendors, [])).toBe(0);
    expect(workingVendorCount([], contracts)).toBe(0);
  });
});

describe("toProgressPeriod + sort + total", () => {
  it("narrows periodWire and captures the enriched title", () => {
    const p = toProgressPeriod({
      id: "pr1",
      contract_id: "c1",
      seq: 1,
      basis: "percent",
      pct: 20,
      amount: 430_000,
      currency_code: "THB",
      status: "passed",
      title: "Period 1",
    });
    expect(p.seq).toBe(1);
    expect(p.amount).toBe(430_000);
    expect(p.status).toBe("passed");
    expect(p.title).toBe("Period 1");
  });

  it("defaults an absent title to empty string (view em-dashes)", () => {
    expect(toProgressPeriod({ id: "pr2", seq: 2 }).title).toBe("");
  });

  it("sortPeriodsBySeq orders ascending without mutating the input", () => {
    const periods = [
      toProgressPeriod({ id: "b", seq: 2 }),
      toProgressPeriod({ id: "a", seq: 0 }),
      toProgressPeriod({ id: "c", seq: 1 }),
    ];
    expect(sortPeriodsBySeq(periods).map((p) => p.seq)).toEqual([0, 1, 2]);
    expect(periods.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("periodsTotal sums the real period amounts (money-safe display sum)", () => {
    const periods = [
      toProgressPeriod({ id: "a", seq: 1, amount: 430_000 }),
      toProgressPeriod({ id: "b", seq: 2, amount: 645_000 }),
      toProgressPeriod({ id: "c", seq: 3, amount: 537_500 }),
    ];
    expect(periodsTotal(periods)).toBe(1_612_500);
    expect(periodsTotal([])).toBe(0);
  });
});
