/*
 * Unit tests for pm-contracts-rows.ts (pm.contracts port, gate G3) — the pure
 * PMContracts-list helpers. Covers the opaque-row narrowing (contract / customer),
 * the honest status-from-end derivation (B-136) incl. the active/expiring/expired
 * boundaries + the no-basis (em-dash) case, the KPI count/sum/active/expiring
 * aggregates (incl. empty), the id -> display joins, and money + millions formatting.
 */
import { describe, it, expect } from "vitest";
import {
  toPmContractRow,
  toCustomerRef,
  statusFromEnd,
  EXPIRING_WINDOW_DAYS,
  contractCount,
  totalValue,
  activeCount,
  expiringCount,
  customerNameById,
  projectNameById,
  formatMoney,
  millionsValue,
  type PmContractRow,
} from "./pm-contracts-rows";

const row = (over: Partial<PmContractRow> = {}): PmContractRow => ({
  id: "c1",
  projectId: "",
  customerId: "",
  mode: "MA",
  visitsPerYear: null,
  sla: "",
  value: 0,
  currencyCode: "THB",
  end: "",
  ...over,
});

/** Fixed clock so the boundary tests are deterministic. */
const TODAY = new Date("2026-07-19T09:00:00Z");

describe("toPmContractRow", () => {
  it("narrows the contractWire shape (snake_case + numeric coercion)", () => {
    expect(
      toPmContractRow({
        id: "c9",
        project_id: "p-1",
        customer_id: "cu-1",
        mode: "per_visit",
        visits_per_year: 4,
        sla: "4 h",
        value: 144000,
        currency_code: "THB",
        end: "2026-12-31",
      }),
    ).toEqual({
      id: "c9",
      projectId: "p-1",
      customerId: "cu-1",
      mode: "per_visit",
      visitsPerYear: 4,
      sla: "4 h",
      value: 144000,
      currencyCode: "THB",
      end: "2026-12-31",
    });
  });

  it("accepts camelCase aliases and defaults missing fields", () => {
    const r = toPmContractRow({ id: "c2", projectId: "p2", customerId: "cu2", value: "96000" });
    expect(r.projectId).toBe("p2");
    expect(r.customerId).toBe("cu2");
    expect(r.value).toBe(96000);
    expect(r.mode).toBe("");
    expect(r.visitsPerYear).toBeNull();
    expect(r.sla).toBe("");
    expect(r.end).toBe("");
  });

  it("coerces a non-finite / absent value to 0 (never NaN) and blank visits to null", () => {
    expect(toPmContractRow({ id: "c3", value: "oops" }).value).toBe(0);
    expect(toPmContractRow({ id: "c4" }).value).toBe(0);
    expect(toPmContractRow({ id: "c5", visits_per_year: "" }).visitsPerYear).toBeNull();
    expect(toPmContractRow({ id: "c6", visits_per_year: 12 }).visitsPerYear).toBe(12);
  });
});

describe("toCustomerRef", () => {
  it("narrows a /customers row (id + name)", () => {
    expect(toCustomerRef({ id: "cu1", name: "Juniper Estate Co." })).toEqual({
      id: "cu1",
      name: "Juniper Estate Co.",
    });
  });
});

describe("statusFromEnd (B-136 — derived from the real end date)", () => {
  it("returns expired when end is strictly before today", () => {
    expect(statusFromEnd("2026-07-18", TODAY)).toBe("expired");
    expect(statusFromEnd("2025-01-01", TODAY)).toBe("expired");
  });

  it("returns expiring on the near boundary (today .. today+window inclusive)", () => {
    expect(statusFromEnd("2026-07-19", TODAY)).toBe("expiring"); // today (0 days)
    expect(statusFromEnd("2026-08-01", TODAY)).toBe("expiring"); // +13 days
    // exactly EXPIRING_WINDOW_DAYS away is still expiring (inclusive)
    const edge = new Date(Date.UTC(2026, 6, 19 + EXPIRING_WINDOW_DAYS));
    const iso = edge.toISOString().slice(0, 10);
    expect(statusFromEnd(iso, TODAY)).toBe("expiring");
  });

  it("returns active beyond the window", () => {
    expect(statusFromEnd("2026-12-31", TODAY)).toBe("active");
    // one day past the window flips to active
    const past = new Date(Date.UTC(2026, 6, 19 + EXPIRING_WINDOW_DAYS + 1));
    expect(statusFromEnd(past.toISOString().slice(0, 10), TODAY)).toBe("active");
  });

  it("returns null (no basis -> em-dash) for an absent / unparseable end", () => {
    expect(statusFromEnd("", TODAY)).toBeNull();
    expect(statusFromEnd("not-a-date", TODAY)).toBeNull();
    expect(statusFromEnd("2026-13-40", TODAY)).toBeNull();
  });
});

describe("KPI aggregates", () => {
  const rows = [
    row({ id: "a", value: 144_000, end: "2026-12-31" }), // active
    row({ id: "b", value: 96_000, end: "2026-08-01" }), // expiring
    row({ id: "c", value: 60_000, end: "2026-05-01" }), // expired
    row({ id: "d", value: 210_000, end: "" }), // no basis -> null
  ];

  it("contractCount is the real row length", () => {
    expect(contractCount(rows)).toBe(4);
    expect(contractCount([])).toBe(0);
  });

  it("totalValue sums every contract value (incl. no-basis rows)", () => {
    expect(totalValue(rows)).toBe(510_000);
    expect(totalValue([])).toBe(0);
  });

  it("activeCount counts only derived-active rows", () => {
    expect(activeCount(rows, TODAY)).toBe(1);
    expect(activeCount([], TODAY)).toBe(0);
  });

  it("expiringCount counts only derived-expiring rows", () => {
    expect(expiringCount(rows, TODAY)).toBe(1);
    expect(expiringCount([], TODAY)).toBe(0);
  });
});

describe("id -> display resolvers", () => {
  const customers = [
    toCustomerRef({ id: "cu1", name: "Acme" }),
    toCustomerRef({ id: "cu2", name: "Beta" }),
    toCustomerRef({ id: "", name: "Ghost" }),
  ];
  const projects = [
    { id: "p1", name: "Juniper Park" },
    { id: "p2", name: "Solar Farm 8MW" },
  ];

  it("customerNameById maps id -> name and skips id-less rows", () => {
    const map = customerNameById(customers);
    expect(map.get("cu1")).toBe("Acme");
    expect(map.get("cu2")).toBe("Beta");
    expect(map.get("missing")).toBeUndefined();
    expect(map.size).toBe(2);
  });

  it("customerNameById tolerates undefined", () => {
    expect(customerNameById(undefined).size).toBe(0);
  });

  it("projectNameById maps id -> name", () => {
    const map = projectNameById(projects);
    expect(map.get("p1")).toBe("Juniper Park");
    expect(map.get("nope")).toBeUndefined();
    expect(projectNameById(undefined).size).toBe(0);
  });
});

describe("formatMoney + millionsValue", () => {
  it("groups thousands, rounds, and guards non-finite", () => {
    expect(formatMoney(144000)).toBe("144,000");
    expect(formatMoney(2400000)).toBe("2,400,000");
    expect(formatMoney(96800.4)).toBe("96,800");
    expect(formatMoney(-60000)).toBe("-60,000");
    expect(formatMoney(Number.NaN)).toBe("0");
    expect(formatMoney(0)).toBe("0");
  });

  it("millionsValue divides by 1e6 to 2 dp (matches (v/1e6).toFixed(2))", () => {
    expect(millionsValue(2910000)).toBe("2.91");
    expect(millionsValue(144000)).toBe("0.14");
    expect(millionsValue(0)).toBe("0.00");
  });
});
