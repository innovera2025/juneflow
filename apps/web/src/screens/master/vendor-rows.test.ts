/*
 * vendor-rows unit tests (P2-WEB-01, gate G3) — the pure MasterVendor display logic ported
 * from master-party.jsx. Guards the opaque-row narrowing defaults, the B-070 type<->kind
 * display map (2-way schema <-> 4-way badge), the search/type filter, the KPI counts, the
 * B-071 credit-term day-count mapping, and the status-badge tone.
 */
import { describe, it, expect } from "vitest";
import {
  toVendorRow,
  displayType,
  typeToKind,
  matchesSearch,
  filterVendors,
  typeCount,
  vendorStats,
  creditTermKey,
  statusTone,
  addrBankLine,
  type VendorRow,
} from "./vendor-rows";

/** A supplier + a subcon fixture mirroring the seeded superset (6 supplier + subcon firms). */
const SUPPLIER: VendorRow = {
  id: "v1",
  name: "บจก. รุ่งเรืองวัสดุก่อสร้าง",
  code: "V-0012",
  taxId: "0105545012345",
  kind: "supplier",
  creditTerm: 30,
  addr: "ถ.พหลโยธิน กทม.",
  bank: "KBANK 012-3-45678-9",
  status: "active",
};
const SUBCON: VendorRow = {
  id: "v2",
  name: "บจก. รุ่งเรืองก่อสร้าง",
  code: "SC-01",
  taxId: "",
  kind: "subcon",
  creditTerm: null,
  addr: "",
  bank: "",
  status: "active",
};
const INACTIVE_SUPPLIER: VendorRow = {
  ...SUPPLIER,
  id: "v3",
  code: "V-0061",
  kind: "supplier",
  creditTerm: 0,
  status: "inactive",
};

describe("toVendorRow", () => {
  it("narrows a full opaque /vendors row (snake_case) to the row shape", () => {
    expect(
      toVendorRow({
        id: "v1",
        name: "บจก. A",
        code: "V-0001",
        tax_id: "0105545012345",
        kind: "supplier",
        credit_term: 45,
        addr: "ที่อยู่",
        bank: "KBANK 1-2-3",
        status: "active",
        extra: "ignored",
      }),
    ).toEqual({
      id: "v1",
      name: "บจก. A",
      code: "V-0001",
      taxId: "0105545012345",
      kind: "supplier",
      creditTerm: 45,
      addr: "ที่อยู่",
      bank: "KBANK 1-2-3",
      status: "active",
    });
  });

  it("accepts camelCase aliases for tax_id / credit_term", () => {
    const r = toVendorRow({ taxId: "123", creditTerm: 60 });
    expect(r.taxId).toBe("123");
    expect(r.creditTerm).toBe(60);
  });

  it("defaults every field (creditTerm null) when absent", () => {
    expect(toVendorRow({})).toEqual({
      id: "",
      name: "",
      code: "",
      taxId: "",
      kind: "",
      creditTerm: null,
      addr: "",
      bank: "",
      status: "",
    });
  });

  it("treats a non-numeric / blank credit_term as null (never invents a day count)", () => {
    expect(toVendorRow({ credit_term: "ตามงวดงาน" }).creditTerm).toBeNull();
    expect(toVendorRow({ credit_term: "" }).creditTerm).toBeNull();
    expect(toVendorRow({ credit_term: "30" }).creditTerm).toBe(30);
  });
});

describe("displayType / typeToKind (B-070)", () => {
  it("derives the 4-way badge from the 2-way kind", () => {
    expect(displayType("subcon")).toBe("contractor");
    expect(displayType("supplier")).toBe("material");
  });

  it("collapses any non-subcon kind to material (honest 2-way schema)", () => {
    expect(displayType("")).toBe("material");
    expect(displayType("bogus")).toBe("material");
  });

  it("maps the 4-way form selection back to the 2-way kind", () => {
    expect(typeToKind("contractor")).toBe("subcon");
    expect(typeToKind("material")).toBe("supplier");
    expect(typeToKind("service")).toBe("supplier");
    expect(typeToKind("land")).toBe("supplier");
  });
});

describe("matchesSearch (master-party.jsx:62)", () => {
  it("matches case-insensitively over code + name + taxId", () => {
    expect(matchesSearch(SUPPLIER, "v-0012")).toBe(true);
    expect(matchesSearch(SUPPLIER, "0105545012345")).toBe(true);
    expect(matchesSearch(SUPPLIER, "รุ่งเรือง")).toBe(true);
    expect(matchesSearch(SUPPLIER, "zzz")).toBe(false);
  });

  it("keeps every row for an empty query", () => {
    expect(matchesSearch(SUBCON, "")).toBe(true);
  });
});

describe("filterVendors / typeCount", () => {
  const rows = [SUPPLIER, SUBCON, INACTIVE_SUPPLIER];

  it("keeps all rows for the empty type filter (ทั้งหมด tab)", () => {
    expect(filterVendors(rows, "", "")).toHaveLength(3);
  });

  it("filters by the display-derived type", () => {
    expect(filterVendors(rows, "", "material").map((v) => v.id)).toEqual(["v1", "v3"]);
    expect(filterVendors(rows, "", "contractor").map((v) => v.id)).toEqual(["v2"]);
    // No wire row derives to service/land under the 2-way schema.
    expect(filterVendors(rows, "", "service")).toHaveLength(0);
    expect(filterVendors(rows, "", "land")).toHaveLength(0);
  });

  it("combines search + type filter", () => {
    expect(filterVendors(rows, "V-0012", "material").map((v) => v.id)).toEqual(["v1"]);
    expect(filterVendors(rows, "V-0012", "contractor")).toHaveLength(0);
  });

  it("counts each derived type for the tab badges", () => {
    expect(typeCount(rows, "material")).toBe(2);
    expect(typeCount(rows, "contractor")).toBe(1);
    expect(typeCount(rows, "service")).toBe(0);
    expect(typeCount(rows, "land")).toBe(0);
  });
});

describe("vendorStats (master-party.jsx:83-86)", () => {
  it("computes total / active / material-or-contractor / inactive", () => {
    const s = vendorStats([SUPPLIER, SUBCON, INACTIVE_SUPPLIER]);
    expect(s).toEqual({
      total: 3,
      active: 2,
      materialOrContractor: 3,
      inactive: 1,
    });
  });

  it("is all-zero for an empty catalogue", () => {
    expect(vendorStats([])).toEqual({
      total: 0,
      active: 0,
      materialOrContractor: 0,
      inactive: 0,
    });
  });
});

describe("creditTermKey (B-071)", () => {
  it("maps the closed VendorForm day set to its discriminant", () => {
    expect(creditTermKey(0)).toBe("cash");
    expect(creditTermKey(15)).toBe("d15");
    expect(creditTermKey(30)).toBe("d30");
    expect(creditTermKey(45)).toBe("d45");
    expect(creditTermKey(60)).toBe("d60");
  });

  it("returns 'none' for null or any out-of-set integer (screen renders '—')", () => {
    expect(creditTermKey(null)).toBe("none");
    expect(creditTermKey(90)).toBe("none");
    expect(creditTermKey(7)).toBe("none");
  });
});

describe("statusTone", () => {
  it("uses the approved (ok) tone for active, draft tone otherwise", () => {
    expect(statusTone("active")).toEqual({
      bg: "var(--ok-soft)",
      fg: "var(--ok)",
      dot: "#16A34A",
    });
    expect(statusTone("inactive").dot).toBe("#94A3B8");
    expect(statusTone("").dot).toBe("#94A3B8");
  });
});

describe("addrBankLine (master-party.jsx:111)", () => {
  it("joins addr and bank with ' · ', omitting blanks", () => {
    expect(addrBankLine("ถ.พหลโยธิน กทม.", "KBANK 012-3-45678-9")).toBe(
      "ถ.พหลโยธิน กทม. · KBANK 012-3-45678-9",
    );
    expect(addrBankLine("", "KBANK 1")).toBe("KBANK 1");
    expect(addrBankLine("ที่อยู่", "")).toBe("ที่อยู่");
    expect(addrBankLine("", "")).toBe("");
  });
});
