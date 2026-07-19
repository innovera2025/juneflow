/*
 * Unit tests for subcon-rows.ts (subcon.contracts port, gate G3) — the pure
 * SubconContracts-list helpers. Covers the opaque-row narrowing (contract /
 * vendor), the KPI count/sum aggregates, the id -> display joins (vendor name /
 * project name), money + millions formatting, and the wire-forced next-no
 * generator.
 */
import { describe, it, expect } from "vitest";
import {
  toContractRow,
  toVendorRef,
  contractCount,
  totalValue,
  vendorNameById,
  projectNameById,
  formatMoney,
  millionsValue,
  nextContractNo,
  type ContractRow,
} from "./subcon-rows";

const contract = (over: Partial<ContractRow> = {}): ContractRow => ({
  id: "c1",
  no: "WO-2026-0042",
  vendorId: "",
  projectId: "",
  value: 0,
  currencyCode: "THB",
  retentionPct: 0,
  start: "",
  end: "",
  ...over,
});

describe("toContractRow", () => {
  it("narrows the contractWire shape (snake_case + numeric coercion)", () => {
    expect(
      toContractRow({
        id: "c9",
        no: "WO-2026-0051",
        vendor_id: "v-1",
        project_id: "p-1",
        value: 1750000,
        currency_code: "THB",
        retention_pct: 5,
        start: "2026-02-15",
        end: "2026-08-01",
      }),
    ).toEqual({
      id: "c9",
      no: "WO-2026-0051",
      vendorId: "v-1",
      projectId: "p-1",
      value: 1750000,
      currencyCode: "THB",
      retentionPct: 5,
      start: "2026-02-15",
      end: "2026-08-01",
    });
  });

  it("accepts camelCase aliases and defaults missing fields", () => {
    const r = toContractRow({ id: "c2", no: "WO-2026-0048", vendorId: "v2", projectId: "p2", value: "1240000", retentionPct: "10" });
    expect(r.vendorId).toBe("v2");
    expect(r.projectId).toBe("p2");
    expect(r.value).toBe(1240000);
    expect(r.retentionPct).toBe(10);
    expect(r.currencyCode).toBe("");
    expect(r.start).toBe("");
    expect(r.end).toBe("");
  });

  it("coerces a non-finite / absent value to 0 (never NaN)", () => {
    expect(toContractRow({ id: "c3", value: "oops" }).value).toBe(0);
    expect(toContractRow({ id: "c4" }).value).toBe(0);
  });
});

describe("toVendorRef", () => {
  it("narrows a /vendors row (id + name)", () => {
    expect(toVendorRef({ id: "v1", name: "Rung Rueang Construction Co." })).toEqual({
      id: "v1",
      name: "Rung Rueang Construction Co.",
    });
  });
});

describe("contractCount + totalValue", () => {
  const rows = [
    contract({ id: "a", value: 2_150_000 }),
    contract({ id: "b", value: 1_750_000 }),
    contract({ id: "c", value: 1_240_000 }),
  ];
  it("contractCount is the real row length (KPI-1)", () => {
    expect(contractCount(rows)).toBe(3);
    expect(contractCount([])).toBe(0);
  });
  it("totalValue sums every contract value (KPI-2)", () => {
    expect(totalValue(rows)).toBe(5_140_000);
    expect(totalValue([])).toBe(0);
  });
});

describe("id -> display resolvers", () => {
  const vendors = [
    toVendorRef({ id: "v1", name: "Acme" }),
    toVendorRef({ id: "v2", name: "Beta" }),
    toVendorRef({ id: "", name: "Ghost" }),
  ];
  const projects = [
    { id: "p1", name: "Phase 2 - Block B" },
    { id: "p2", name: "Section C" },
  ];

  it("vendorNameById maps id -> name and skips id-less rows", () => {
    const map = vendorNameById(vendors);
    expect(map.get("v1")).toBe("Acme");
    expect(map.get("v2")).toBe("Beta");
    expect(map.get("missing")).toBeUndefined();
    expect(map.size).toBe(2);
  });

  it("vendorNameById tolerates undefined", () => {
    expect(vendorNameById(undefined).size).toBe(0);
  });

  it("projectNameById maps id -> name", () => {
    const map = projectNameById(projects);
    expect(map.get("p1")).toBe("Phase 2 - Block B");
    expect(map.get("nope")).toBeUndefined();
    expect(projectNameById(undefined).size).toBe(0);
  });
});

describe("formatMoney + millionsValue", () => {
  it("groups thousands, rounds, and guards non-finite", () => {
    expect(formatMoney(2150000)).toBe("2,150,000");
    expect(formatMoney(1750000)).toBe("1,750,000");
    expect(formatMoney(96800.4)).toBe("96,800");
    expect(formatMoney(-430000)).toBe("-430,000");
    expect(formatMoney(Number.NaN)).toBe("0");
    expect(formatMoney(0)).toBe("0");
  });
  it("millionsValue divides by 1e6 to 2 dp (matches (v/1e6).toFixed(2))", () => {
    expect(millionsValue(5140000)).toBe("5.14");
    expect(millionsValue(2150000)).toBe("2.15");
    expect(millionsValue(0)).toBe("0.00");
  });
});

describe("nextContractNo", () => {
  it("suggests the next running 4-digit number for the year", () => {
    expect(nextContractNo(["WO-2026-0001", "WO-2026-0002"], 2026)).toBe("WO-2026-0003");
    expect(nextContractNo([], 2026)).toBe("WO-2026-0001");
  });
  it("ignores non-running codes when counting", () => {
    expect(nextContractNo(["PO-2026-0188", "WO-2025-0042"], 2026)).toBe("WO-2026-0001");
  });
  it("skips collisions (count-then-increment, like nextBoqNo)", () => {
    expect(nextContractNo(["WO-2026-0001", "WO-2026-0003"], 2026)).toBe("WO-2026-0004");
    expect(nextContractNo(["WO-2026-0001", "WO-2026-0002", "WO-2026-0003"], 2026)).toBe("WO-2026-0004");
  });
});
