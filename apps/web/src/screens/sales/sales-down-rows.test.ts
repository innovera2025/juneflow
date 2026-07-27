/*
 * sales-down-rows unit tests (gate G3) — the pure down-payment register + receive-form
 * logic ported from pototype/sales-process.jsx SalesDown (L362-457) +
 * DownPaymentReceiveForm (L459-487). Guards the opaque-row narrowing (snake_case +
 * camelCase), the per-unit aggregation (instalment count + Σ amounts, first-seen order,
 * blank-key skip), the cumulative-down sum, ASCII money formatting, the contract-unit +
 * customer-name resolution, and — critically — the money=SERVER receive body (ONLY
 * sales_unit_id + amount + optional paid_at; NEVER a seq / Dr-Cr / jv). ASCII-only test
 * data (B-073) — no Thai in source.
 */
import { describe, it, expect } from "vitest";
import {
  toDownRow,
  aggregateByUnit,
  cumulativeDown,
  formatMoney,
  toContractUnit,
  toCustomerRef,
  customerNameById,
  downSubmittable,
  buildDownBody,
  type DownRow,
  type DownDraft,
} from "./sales-down-rows";

const down = (p: Partial<DownRow> = {}): DownRow => ({
  salesUnitId: "u-1",
  unitId: "node-1",
  seq: 1,
  amount: 47350,
  paidAt: "2026-05-25",
  currencyCode: "THB",
  ...p,
});

describe("toDownRow", () => {
  it("maps the snake_case /sales/downs wire fields", () => {
    expect(
      toDownRow({
        sales_unit_id: "u-9",
        unit_id: "node-9",
        seq: 3,
        amount: 47350,
        paid_at: "2026-05-24",
        currency_code: "THB",
      }),
    ).toEqual({
      salesUnitId: "u-9",
      unitId: "node-9",
      seq: 3,
      amount: 47350,
      paidAt: "2026-05-24",
      currencyCode: "THB",
    });
  });

  it("accepts camelCase aliases for the multi-word fields", () => {
    const r = toDownRow({ salesUnitId: "u-2", unitId: "node-2", paidAt: "2026-06-01", currencyCode: "THB" });
    expect(r.salesUnitId).toBe("u-2");
    expect(r.unitId).toBe("node-2");
    expect(r.paidAt).toBe("2026-06-01");
  });

  it("narrows seq to an int or null (never NaN), and amount to a finite number", () => {
    expect(toDownRow({ seq: 5 }).seq).toBe(5);
    expect(toDownRow({ seq: "7" }).seq).toBe(7);
    expect(toDownRow({ seq: null }).seq).toBeNull();
    expect(toDownRow({ seq: "" }).seq).toBeNull();
    expect(toDownRow({ seq: "x" }).seq).toBeNull();
    expect(toDownRow({ amount: "47350.5" }).amount).toBe(47350.5);
    expect(toDownRow({ amount: null }).amount).toBe(0);
  });

  it("defaults missing string fields to empty strings (never undefined)", () => {
    expect(toDownRow({})).toEqual({
      salesUnitId: "",
      unitId: "",
      seq: null,
      amount: 0,
      paidAt: "",
      currencyCode: "",
    });
  });
});

describe("aggregateByUnit", () => {
  it("folds instalments into one row per unit: done = count, paid = Σ amounts", () => {
    const rows = [
      down({ salesUnitId: "u-1", seq: 1, amount: 47350 }),
      down({ salesUnitId: "u-1", seq: 2, amount: 47350 }),
      down({ salesUnitId: "u-2", seq: 1, amount: 68667 }),
    ];
    const agg = aggregateByUnit(rows);
    expect(agg).toHaveLength(2);
    expect(agg[0]).toEqual({ salesUnitId: "u-1", unitId: "node-1", currencyCode: "THB", done: 2, paid: 94700 });
    expect(agg[1]).toMatchObject({ salesUnitId: "u-2", done: 1, paid: 68667 });
  });

  it("preserves each unit's first-seen order", () => {
    const rows = [
      down({ salesUnitId: "u-b" }),
      down({ salesUnitId: "u-a" }),
      down({ salesUnitId: "u-b" }),
    ];
    expect(aggregateByUnit(rows).map((r) => r.salesUnitId)).toEqual(["u-b", "u-a"]);
  });

  it("rounds the summed paid to 2dp (no float dust)", () => {
    const rows = [down({ amount: 0.1 }), down({ amount: 0.2 })];
    expect(aggregateByUnit(rows)[0].paid).toBe(0.3);
  });

  it("skips a row with a blank sales_unit_id (never aggregated under an empty key)", () => {
    const agg = aggregateByUnit([down({ salesUnitId: "" }), down({ salesUnitId: "u-1" })]);
    expect(agg.map((r) => r.salesUnitId)).toEqual(["u-1"]);
  });

  it("returns an empty register for an empty list", () => {
    expect(aggregateByUnit([])).toEqual([]);
  });
});

describe("cumulativeDown", () => {
  it("sums every instalment amount across all units (the real KPI value)", () => {
    const rows = [down({ amount: 47350 }), down({ amount: 47350 }), down({ amount: 68667 })];
    expect(cumulativeDown(rows)).toBe(163367);
  });

  it("returns 0 for an empty list", () => {
    expect(cumulativeDown([])).toBe(0);
  });
});

describe("formatMoney", () => {
  it("groups full baht with thousands separators, no symbol/decimals", () => {
    expect(formatMoney(473500)).toBe("473,500");
    expect(formatMoney(94700)).toBe("94,700");
    expect(formatMoney(0)).toBe("0");
  });

  it("returns '0' for a non-finite value", () => {
    expect(formatMoney(Number.NaN)).toBe("0");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("toContractUnit + toCustomerRef + customerNameById", () => {
  it("narrows a /sales/contracts row to the picker unit", () => {
    expect(
      toContractUnit({ id: "u-1", unit_id: "node-1", customer_id: "c-1", currency_code: "THB" }),
    ).toEqual({ id: "u-1", unitId: "node-1", customerId: "c-1", currencyCode: "THB" });
  });

  it("narrows a /customers row to { id, name } and maps id -> name, skipping blanks", () => {
    expect(toCustomerRef({ id: "c-1", name: "Wanna", tax_id: "x" })).toEqual({ id: "c-1", name: "Wanna" });
    const map = customerNameById([toCustomerRef({ id: "c-1", name: "Wanna" }), toCustomerRef({ id: "", name: "Ghost" })]);
    expect(map.get("c-1")).toBe("Wanna");
    expect(map.size).toBe(1);
  });

  it("returns an empty map for undefined input", () => {
    expect(customerNameById(undefined).size).toBe(0);
  });
});

describe("downSubmittable", () => {
  it("requires a unit and a positive finite amount", () => {
    const base: DownDraft = { salesUnitId: "u-1", amount: 47350, paidAt: "" };
    expect(downSubmittable(base)).toBe(true);
    expect(downSubmittable({ ...base, salesUnitId: "" })).toBe(false);
    expect(downSubmittable({ ...base, salesUnitId: "   " })).toBe(false);
    expect(downSubmittable({ ...base, amount: 0 })).toBe(false);
    expect(downSubmittable({ ...base, amount: -1 })).toBe(false);
    expect(downSubmittable({ ...base, amount: Number.NaN })).toBe(false);
  });
});

describe("buildDownBody (money=SERVER contract)", () => {
  it("sends ONLY sales_unit_id + amount (+ paid_at when supplied) — never seq/Dr-Cr/jv", () => {
    const body = buildDownBody({ salesUnitId: "u-1", amount: 47350, paidAt: "2026-05-25" });
    expect(body).toEqual({ sales_unit_id: "u-1", amount: 47350, paid_at: "2026-05-25" });
    // The client never composes the server's fields.
    expect(body).not.toHaveProperty("seq");
    expect(body).not.toHaveProperty("dr");
    expect(body).not.toHaveProperty("cr");
    expect(body).not.toHaveProperty("jv_no");
  });

  it("omits paid_at when blank (server defaults to today) and trims the unit id", () => {
    expect(buildDownBody({ salesUnitId: "  u-2  ", amount: 100, paidAt: "" })).toEqual({
      sales_unit_id: "u-2",
      amount: 100,
    });
    expect(buildDownBody({ salesUnitId: "u-3", amount: 100, paidAt: "   " })).not.toHaveProperty("paid_at");
  });
});
