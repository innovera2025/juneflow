/*
 * sub-rows unit tests (Subscription tenant screens, gate G3) — the pure display logic
 * narrowed from subscription.jsx SubPlans + SubBilling. Guards the opaque-row narrowing
 * (incl. the storage_gb / ai_per_month limit keys and the null-price -> contact-sales
 * coercion), the size->colour reconstruction, the cycle price selection, the CTA-kind
 * derivation, the invoice narrowing, the status-badge mapping, and the number/date
 * formatting.
 */
import { describe, it, expect } from "vitest";
import {
  str,
  num,
  formatMoney,
  formatDate,
  toPlanRow,
  sizeColor,
  priceForCycle,
  isUnlimited,
  planCtaKind,
  toInvoiceRow,
  invoiceBadge,
  type PlanRow,
} from "./sub-rows";

describe("str / num", () => {
  it("str coerces safely", () => {
    expect(str("x")).toBe("x");
    expect(str(null)).toBe("");
    expect(str(undefined)).toBe("");
    expect(str(42)).toBe("42");
  });
  it("num parses finite numbers, 0 otherwise", () => {
    expect(num(2900)).toBe(2900);
    expect(num("7900.00")).toBe(7900);
    expect(num(null)).toBe(0);
    expect(num("")).toBe(0);
    expect(num("nope")).toBe(0);
  });
});

describe("formatMoney", () => {
  it("groups thousands (ASCII)", () => {
    expect(formatMoney(79000)).toBe("79,000");
    expect(formatMoney(456000)).toBe("456,000");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("formatDate", () => {
  it("emits a UTC YYYY-MM-DD, else empty", () => {
    expect(formatDate("2026-06-01T03:00:00.000Z")).toBe("2026-06-01");
    expect(formatDate("")).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });
});

describe("toPlanRow", () => {
  it("narrows a rich planWire row (storage_gb / ai_per_month keys)", () => {
    expect(
      toPlanRow({
        id: "M",
        size: "M",
        name: "Professional",
        price_m: "7900.00",
        price_y: "79000.00",
        currency_code: "THB",
        limits: { projects: 10, users: 25, storage_gb: 100, ai_per_month: 50 },
        menus: ["dashboard", "boq", "proc"],
        sub_rules: { "boq.aiqto": "M" },
        created_at: "2026-07-01T00:00:00Z",
      }),
    ).toEqual({
      id: "M",
      size: "M",
      name: "Professional",
      priceM: 7900,
      priceY: 79000,
      currencyCode: "THB",
      projects: 10,
      users: 25,
      storageGb: 100,
      aiPerMonth: 50,
      menus: ["dashboard", "boq", "proc"],
    });
  });

  it("coerces an absent/null/0 price to null (contact-sales branch)", () => {
    // The API num() coerces a SQL-null price to 0, so Enterprise arrives as 0 -> null.
    const full = toPlanRow({ id: "Full", size: "Full", price_m: 0, price_y: null });
    expect(full.priceM).toBeNull();
    expect(full.priceY).toBeNull();
  });

  it("defaults absent limits / menus (never fabricates)", () => {
    const r = toPlanRow({ id: "x" });
    expect(r.projects).toBe(0);
    expect(r.storageGb).toBe(0);
    expect(r.aiPerMonth).toBe(0);
    expect(r.menus).toEqual([]);
  });

  it("reads unlimited quotas as -1", () => {
    const r = toPlanRow({ id: "Full", limits: { projects: -1, users: -1, storage_gb: 1000, ai_per_month: -1 } });
    expect(r.projects).toBe(-1);
    expect(r.storageGb).toBe(1000);
    expect(isUnlimited(r.aiPerMonth)).toBe(true);
    expect(isUnlimited(r.storageGb)).toBe(false);
  });
});

describe("sizeColor", () => {
  it("reconstructs the prototype's verbatim size->hex map", () => {
    expect(sizeColor("S")).toBe("#5A7CA8");
    expect(sizeColor("M")).toBe("#0B2A4A");
    expect(sizeColor("L")).toBe("#0F766E");
    expect(sizeColor("Full")).toBe("#B45309");
    expect(sizeColor("unknown")).toBe("#5A7CA8");
  });
});

describe("priceForCycle / planCtaKind", () => {
  const pro = (over: Partial<PlanRow> = {}): PlanRow => ({
    id: "M",
    size: "M",
    name: "Professional",
    priceM: 7900,
    priceY: 79000,
    currencyCode: "THB",
    projects: 10,
    users: 25,
    storageGb: 100,
    aiPerMonth: 50,
    menus: [],
    ...over,
  });

  it("selects the price for the active cycle", () => {
    expect(priceForCycle(pro(), "yearly")).toBe(79000);
    expect(priceForCycle(pro(), "monthly")).toBe(7900);
  });

  it("returns null for a no-price plan (both cycles)", () => {
    const full = pro({ size: "Full", priceM: null, priceY: null });
    expect(priceForCycle(full, "yearly")).toBeNull();
    expect(priceForCycle(full, "monthly")).toBeNull();
  });

  it("derives the CTA kind (contact / downgrade / upgrade), never marking a current plan", () => {
    expect(planCtaKind(pro({ size: "Full", priceM: null, priceY: null }), "yearly")).toBe("contact");
    expect(planCtaKind(pro({ size: "S" }), "yearly")).toBe("downgrade");
    expect(planCtaKind(pro({ size: "M" }), "yearly")).toBe("upgrade");
    expect(planCtaKind(pro({ size: "L" }), "monthly")).toBe("upgrade");
  });
});

describe("toInvoiceRow / invoiceBadge", () => {
  it("narrows a minimal invoiceWire row", () => {
    expect(
      toInvoiceRow({
        id: "iv1",
        subscription_id: "s1",
        amount: "79000.00",
        currency_code: "THB",
        status: "paid",
        created_at: "2026-01-01T00:00:00Z",
      }),
    ).toEqual({
      id: "iv1",
      amount: 79000,
      currencyCode: "THB",
      status: "paid",
      createdAt: "2026-01-01T00:00:00Z",
    });
  });

  it("maps status to badge tone + label discriminant (paid keyed, others raw)", () => {
    expect(invoiceBadge("paid")).toEqual({ tone: "approved", labelKind: "paid" });
    expect(invoiceBadge("pending")).toEqual({ tone: "pending", labelKind: "raw" });
    expect(invoiceBadge("overdue")).toEqual({ tone: "rejected", labelKind: "raw" });
    expect(invoiceBadge("weird")).toEqual({ tone: "draft", labelKind: "raw" });
  });
});
