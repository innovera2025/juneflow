/*
 * model-cards unit tests (P1-WEB-13, gate G3) — the pure model-card logic ported from
 * master.jsx MasterModel (toModelCard / formatModelPrice / hasBom / statusActive).
 * Guards the price-in-millions display, the opaque-row narrowing defaults, and the
 * real bom_item_count gate (the mock 248+i*30 is forbidden) against regression.
 */
import { describe, it, expect } from "vitest";
import {
  toModelCard,
  formatModelPrice,
  hasBom,
  statusActive,
  type ModelCard,
} from "./model-cards";

describe("toModelCard", () => {
  it("narrows a full opaque /models row to the card shape", () => {
    expect(
      toModelCard({
        id: "m1",
        code: "A-1",
        type: "บ้านเดี่ยว 2 ชั้น",
        area: 168,
        bed: 4,
        bath: 4,
        parking: 2,
        price: 8_240_000,
        currency_code: "THB",
        status: "active",
        color: "#0B2A4A",
        unit_count: 48,
        bom_item_count: 248,
        extra: "ignored",
      }),
    ).toEqual({
      id: "m1",
      code: "A-1",
      type: "บ้านเดี่ยว 2 ชั้น",
      area: 168,
      bed: 4,
      bath: 4,
      parking: 2,
      price: 8_240_000,
      currency_code: "THB",
      status: "active",
      color: "#0B2A4A",
      unit_count: 48,
      bom_item_count: 248,
    });
  });

  it("defaults missing fields (numbers -> 0, strings -> \"\")", () => {
    expect(toModelCard({})).toEqual({
      id: "",
      code: "",
      type: "",
      area: 0,
      bed: 0,
      bath: 0,
      parking: 0,
      price: 0,
      currency_code: "",
      status: "",
      color: "",
      unit_count: 0,
      bom_item_count: 0,
    });
  });

  it("accepts camelCase multi-word fields as a fallback", () => {
    const c = toModelCard({ unitCount: 12, bomItemCount: 30, currencyCode: "THB" });
    expect(c.unit_count).toBe(12);
    expect(c.bom_item_count).toBe(30);
    expect(c.currency_code).toBe("THB");
  });

  it("coerces numeric strings and drops invalid ones to 0", () => {
    const c = toModelCard({ area: "145", price: "5950000", bed: "x" });
    expect(c.area).toBe(145);
    expect(c.price).toBe(5_950_000);
    expect(c.bed).toBe(0);
  });
});

describe("formatModelPrice", () => {
  it("renders FULL baht as a bare 2-dp millions string", () => {
    expect(formatModelPrice(8_240_000)).toBe("8.24");
    expect(formatModelPrice(5_950_000)).toBe("5.95");
    expect(formatModelPrice(500_000)).toBe("0.50");
  });

  it("returns \"0.00\" for zero", () => {
    expect(formatModelPrice(0)).toBe("0.00");
  });

  it("returns \"0.00\" for NaN and negative input (guarded boundary)", () => {
    expect(formatModelPrice(Number.NaN)).toBe("0.00");
    expect(formatModelPrice(-1_000_000)).toBe("0.00");
    expect(formatModelPrice(Number.POSITIVE_INFINITY)).toBe("0.00");
  });
});

describe("hasBom", () => {
  it("is true only when the real bom_item_count is positive", () => {
    expect(hasBom({ bom_item_count: 248 })).toBe(true);
    expect(hasBom({ bom_item_count: 0 })).toBe(false);
  });
});

describe("statusActive", () => {
  it("is true for active, false for draft/other", () => {
    expect(statusActive({ status: "active" })).toBe(true);
    expect(statusActive({ status: "draft" })).toBe(false);
    expect(statusActive({ status: "" })).toBe(false);
  });
});

// Compile-time: ModelCard is the exported shape the view consumes.
const _sample: ModelCard = {
  id: "m",
  code: "A-1",
  type: "",
  area: 0,
  bed: 0,
  bath: 0,
  parking: 0,
  price: 0,
  currency_code: "THB",
  status: "draft",
  color: "#000",
  unit_count: 0,
  bom_item_count: 0,
};
void _sample;
