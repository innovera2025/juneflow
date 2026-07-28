/*
 * solar-warranty-rows unit tests (gate G3) — the pure SolarWarranty display logic narrowed
 * from solar.jsx SolarWarranty. Guards the opaque-row narrowing (incl. the prod_date /
 * expiry_date date fields) and the status-tone + label mapping (seed + prototype codes).
 */
import { describe, it, expect } from "vitest";
import { toWarrantyRow, warrantyStatus } from "./solar-warranty-rows";

describe("toWarrantyRow", () => {
  it("narrows a snake_case wire row (prod_date / expiry_date) to WarrantyRow", () => {
    expect(
      toWarrantyRow({
        id: "w-1",
        project_id: "p",
        item: "PV Module",
        brand: "JA Solar",
        qty: "100",
        perf: "25y",
        prod_date: "2026-01-01",
        expiry_date: "2051-01-01",
        status: "active",
        created_at: "z",
      }),
    ).toEqual({
      id: "w-1",
      item: "PV Module",
      brand: "JA Solar",
      qty: 100,
      perf: "25y",
      prodDate: "2026-01-01",
      expiryDate: "2051-01-01",
      status: "active",
    });
  });

  it("defaults absent / null dates to empty (the screen renders an em-dash)", () => {
    expect(toWarrantyRow({ id: "y" })).toEqual({
      id: "y",
      item: "",
      brand: "",
      qty: 0,
      perf: "",
      prodDate: "",
      expiryDate: "",
      status: "",
    });
    expect(toWarrantyRow({ id: "z", prod_date: null, expiry_date: null }).prodDate).toBe("");
    expect(toWarrantyRow({ id: "z", expiry_date: null }).expiryDate).toBe("");
  });
});

describe("warrantyStatus", () => {
  it("maps both seed + prototype codes to a tone kind + label kind", () => {
    expect(warrantyStatus("active")).toEqual({ kind: "approved", label: "active" });
    expect(warrantyStatus("expiring")).toEqual({ kind: "pending", label: "expiring" });
    expect(warrantyStatus("expired")).toEqual({ kind: "pending", label: "expiring" });
  });

  it("defaults an unknown status to approved/active (prototype fallback)", () => {
    expect(warrantyStatus("anything")).toEqual({ kind: "approved", label: "active" });
    expect(warrantyStatus("")).toEqual({ kind: "approved", label: "active" });
  });
});
