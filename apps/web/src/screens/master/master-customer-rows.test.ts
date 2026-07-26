/*
 * master-customer-rows unit tests (P2-WEB-40, gate G3) — the pure MasterCustomer display
 * logic narrowed from master-party.jsx. Guards the opaque-row narrowing (snake/camel tax_id,
 * absent/null/non-string defaults) and the REAL kpiTotal count. The unbacked columns/KPIs
 * carry no logic here (they are literal em-dash in the screen, B-135), so nothing to test.
 */
import { describe, it, expect } from "vitest";
import { toCustomerRow, customerCount, type CustomerRow } from "./master-customer-rows";

describe("toCustomerRow", () => {
  it("narrows a snake_case wire row to { id, name, taxId }", () => {
    expect(
      toCustomerRow({
        id: "c1",
        name: "Weerachai Sapmankhong",
        tax_id: "1100400112233",
        created_at: "2026-07-01T00:00:00Z",
      }),
    ).toEqual({ id: "c1", name: "Weerachai Sapmankhong", taxId: "1100400112233" });
  });

  it("accepts camelCase taxId as a fallback", () => {
    expect(toCustomerRow({ id: "c2", name: "N", taxId: "0993000123456" })).toEqual({
      id: "c2",
      name: "N",
      taxId: "0993000123456",
    });
  });

  it("defaults absent / null fields to empty strings (never fabricates)", () => {
    expect(toCustomerRow({ id: "c3", name: "N" })).toEqual({ id: "c3", name: "N", taxId: "" });
    expect(toCustomerRow({ id: "c4", name: "N", tax_id: null })).toEqual({
      id: "c4",
      name: "N",
      taxId: "",
    });
  });

  it("coerces a non-string tax_id to its string form", () => {
    expect(toCustomerRow({ id: "c5", name: "N", tax_id: 12345 }).taxId).toBe("12345");
  });

  it("ignores wire fields the table does not consume (created_at)", () => {
    const row = toCustomerRow({ id: "c6", name: "N", tax_id: "T", created_at: "x" });
    expect(Object.keys(row).sort()).toEqual(["id", "name", "taxId"]);
  });
});

describe("customerCount", () => {
  it("is the real row length (kpiTotal)", () => {
    const rows: CustomerRow[] = [
      { id: "a", name: "A", taxId: "" },
      { id: "b", name: "B", taxId: "" },
      { id: "c", name: "C", taxId: "" },
    ];
    expect(customerCount(rows)).toBe(3);
  });

  it("is zero for an empty catalogue", () => {
    expect(customerCount([])).toBe(0);
  });
});
