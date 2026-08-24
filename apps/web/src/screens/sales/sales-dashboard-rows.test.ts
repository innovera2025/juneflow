/*
 * G3 unit tests for the sales-dashboard view-model (B-442).
 *
 * Expected values come from pototype/sales-crm.jsx SalesDashboard (L7-179) and from
 * the SERVED shapes of GET /sales/contracts, /sales/leads and /projects/{id}/hierarchy
 * — not from the implementation (tests/CLAUDE.md).
 *
 * The properties worth protecting are the ones where a plausible simplification would
 * quietly overstate the business: counting bookings as sales, turning an unanswerable
 * ratio into 0%, or listing a transfer that has no date.
 */
import { describe, expect, it } from "vitest";
import {
  awaitingTransfer,
  funnelCounts,
  funnelPct,
  soldPct,
  sumContracts,
  sumDowns,
  toContract,
  transferSchedule,
  unitStatusCounts,
  unitTotal,
  unitsSold,
  UNIT_STATUS_ORDER,
  FUNNEL_STAGES,
  type ContractRow,
} from "./sales-dashboard-rows";

/** A served contract row (land-sales.ts unitWire). */
const WIRE = {
  id: "c-1",
  unit_id: "u-1",
  customer_id: "cus-1",
  stage: "soldBuilt",
  booking: 50000,
  contract: 4850000,
  loan: 4000000,
  currency_code: "THB",
  down: 485000,
  transfer_at: "2026-09-15",
  created_at: "2026-01-02T00:00:00.000Z",
};

const row = (o: Partial<ContractRow> = {}): ContractRow => ({ ...toContract(WIRE), ...o });
const unit = (status: string) => ({ kind: "unit", status });

describe("narrowing a served contract", () => {
  it("reads every field the screen uses, snake_case as the server sends it", () => {
    expect(toContract(WIRE)).toEqual({
      id: "c-1",
      unitId: "u-1",
      customerId: "cus-1",
      stage: "soldBuilt",
      contract: 4850000,
      down: 485000,
      transferAt: "2026-09-15",
      currencyCode: "THB",
    });
  });

  it("accepts numeric columns as the strings pg returns them", () => {
    const r = toContract({ ...WIRE, contract: "4850000.00", down: "485000.00" });
    expect(r.contract).toBe(4850000);
    expect(r.down).toBe(485000);
  });

  it("turns an absent row into zeros and empty strings, never NaN", () => {
    const r = toContract({});
    expect(r.contract).toBe(0);
    expect(r.transferAt).toBe("");
    expect(Number.isNaN(r.down)).toBe(false);
  });
});

describe("the unit-status donut", () => {
  it("counts the five real statuses the hierarchy carries", () => {
    // Measured on the live stack: 84 units, soldBuilt 48 / sold 9 / booked 5 /
    // built 6 / empty 16. These five values ARE the prototype's five legend rows.
    const nodes = [
      ...Array.from({ length: 48 }, () => unit("soldBuilt")),
      ...Array.from({ length: 9 }, () => unit("sold")),
      ...Array.from({ length: 5 }, () => unit("booked")),
      ...Array.from({ length: 6 }, () => unit("built")),
      ...Array.from({ length: 16 }, () => unit("empty")),
    ];
    const c = unitStatusCounts(nodes);
    expect(c).toEqual({ soldBuilt: 48, sold: 9, booked: 5, built: 6, empty: 16 });
    expect(unitTotal(c)).toBe(84);
  });

  it("ignores non-unit nodes, so blocks and phases are not counted as inventory", () => {
    const nodes = [{ kind: "block", status: "" }, { kind: "phase" }, unit("empty")];
    expect(unitTotal(unitStatusCounts(nodes))).toBe(1);
  });

  it("ignores an unknown status rather than bucketing it somewhere", () => {
    // A status this screen does not know about must not silently become "empty" and
    // report a unit as available for sale.
    expect(unitTotal(unitStatusCounts([unit("reserved-by-legal")]))).toBe(0);
  });

  it("counts only sold and soldBuilt as SOLD — a booking is not a sale", () => {
    const c = unitStatusCounts([unit("sold"), unit("soldBuilt"), unit("booked")]);
    expect(unitsSold(c)).toBe(2);
  });

  it("reports NO percentage when there are no units, rather than 0%", () => {
    // 0% would read as "nothing sold" when the truth is "nothing to sell".
    expect(soldPct(unitStatusCounts([]))).toBeNull();
    expect(soldPct(unitStatusCounts([unit("sold"), unit("empty")]))).toBe(50);
  });

  it("keeps the prototype's legend order, most-advanced first", () => {
    expect(UNIT_STATUS_ORDER).toEqual(["soldBuilt", "sold", "booked", "built", "empty"]);
  });
});

describe("the sales funnel", () => {
  it("counts the five stages the lead table actually tracks", () => {
    const leads = [
      { stage: "lead" }, { stage: "lead" }, { stage: "lead" }, { stage: "lead" },
      { stage: "visit" }, { stage: "visit" },
      { stage: "quote" }, { stage: "quote" },
      { stage: "booking" },
      { stage: "contract" },
    ];
    expect(funnelCounts(leads)).toEqual({ lead: 4, visit: 2, quote: 2, booking: 1, contract: 1 });
  });

  it("keeps a stage with no leads as a real 0, not as an absent stage", () => {
    expect(funnelCounts([{ stage: "lead" }]).quote).toBe(0);
  });

  it("still declares six stages, the sixth having no lead-side source", () => {
    // `lead` has no foreign key to `sales_unit`, so how many of THESE leads
    // transferred is unknowable. The box keeps its place; the screen em-dashes it.
    expect(FUNNEL_STAGES).toHaveLength(6);
    expect(FUNNEL_STAGES[5]).toBe("transferred");
    expect(Object.keys(funnelCounts([]))).not.toContain("transferred");
  });

  it("computes conversion against the top of the funnel", () => {
    const c = funnelCounts([
      { stage: "lead" }, { stage: "lead" }, { stage: "lead" }, { stage: "lead" },
      { stage: "quote" },
    ]);
    expect(funnelPct(c, "lead")).toBe(100);
    expect(funnelPct(c, "quote")).toBe(25);
  });

  it("reports NO conversion when there are no leads at all", () => {
    // A ratio with an empty denominator is unanswerable, not zero.
    expect(funnelPct(funnelCounts([]), "quote")).toBeNull();
  });
});

describe("the KPI sums", () => {
  it("adds contract values and down payments", () => {
    const rows = [row({ contract: 1000, down: 100 }), row({ contract: 2000, down: 250 })];
    expect(sumContracts(rows)).toBe(3000);
    expect(sumDowns(rows)).toBe(350);
  });

  it("counts awaiting-transfer off the STAGE, not off the date being in the future", () => {
    // A scheduled date that has passed does not mean the transfer happened, and a
    // future date on an ALREADY-transferred unit does not mean it is still pending.
    // The stage is what the server moves when the transfer happens.
    //
    // Every row here carries a FUTURE date on purpose, so an implementation that
    // reads the date instead of the stage returns 4 rather than 2. An earlier version
    // of this test left the dates varied and a date-reading mutant survived it by
    // arithmetic coincidence.
    const rows = [
      row({ stage: "sold", transferAt: "2099-01-01" }),
      row({ stage: "sold", transferAt: "2099-02-01" }),
      row({ stage: "soldBuilt", transferAt: "2099-03-01" }),
      row({ stage: "booked", transferAt: "2099-04-01" }),
    ];
    expect(awaitingTransfer(rows)).toBe(2);
  });

  it("counts a sold unit with NO scheduled date — unscheduled is still pending", () => {
    // The opposite mistake: filtering on transfer_at being present would drop the
    // units most in need of attention, the ones nobody has booked a date for.
    expect(awaitingTransfer([row({ stage: "sold", transferAt: "" })])).toBe(1);
  });

  it("returns zero for an empty tenant, never NaN", () => {
    expect(sumContracts([])).toBe(0);
    expect(sumDowns([])).toBe(0);
    expect(awaitingTransfer([])).toBe(0);
  });
});

describe("the transfer schedule", () => {
  it("lists the earliest transfers first", () => {
    const rows = [
      row({ id: "b", transferAt: "2026-09-20" }),
      row({ id: "a", transferAt: "2026-09-01" }),
      row({ id: "c", transferAt: "2026-10-05" }),
    ];
    expect(transferSchedule(rows).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("omits contracts with no scheduled transfer", () => {
    // Not "a transfer on an unknown day" — it is not on this list at all.
    const rows = [row({ id: "dated", transferAt: "2026-09-01" }), row({ id: "undated", transferAt: "" })];
    expect(transferSchedule(rows).map((t) => t.id)).toEqual(["dated"]);
  });

  it("breaks ties on id so two transfers on one day cannot swap between reads", () => {
    const rows = [
      row({ id: "z", transferAt: "2026-09-01" }),
      row({ id: "a", transferAt: "2026-09-01" }),
    ];
    expect(transferSchedule(rows).map((t) => t.id)).toEqual(["a", "z"]);
  });

  it("caps the list at the prototype's five rows", () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      row({ id: `r${i}`, transferAt: `2026-09-0${i + 1}` }),
    );
    expect(transferSchedule(rows)).toHaveLength(5);
  });

  it("carries the contract value, not the booking deposit", () => {
    expect(transferSchedule([row({ transferAt: "2026-09-01", contract: 4850000 })])[0]!.amount).toBe(
      4850000,
    );
  });
});
