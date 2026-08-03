/*
 * labor-payroll-rows unit tests (P5-WEB, gate G3) — the pure LaborPayroll display logic
 * narrowed from labor.jsx LaborPayroll. Guards the run narrowing (snake/camel, numeric-as-
 * string coercion), the worker_id -> WorkerRow join index, the Σ-net total (server amounts,
 * never a re-derived split), and the latest-period selection incl the honest-empty behaviour
 * when there are no runs.
 */
import { describe, it, expect } from "vitest";
import {
  toPayrollRow,
  workerById,
  netTotal,
  latestPeriod,
  type PayrollRow,
} from "./labor-payroll-rows";
import type { WorkerRow } from "./labor-workers-rows";

/** A WorkerRow for the join tests. */
function worker(over: Partial<WorkerRow> = {}): WorkerRow {
  return {
    id: "w1",
    code: "W-001",
    name: "Worker One",
    team: "Team A",
    skill: "Steelworker",
    payType: "daily",
    dayRate: 480,
    currencyCode: "THB",
    active: true,
    ...over,
  };
}

/** A PayrollRow for the aggregate tests. */
function run(over: Partial<PayrollRow> = {}): PayrollRow {
  return {
    id: "p1",
    workerId: "w1",
    period: "2026-07",
    amount: 3000,
    currencyCode: "THB",
    ...over,
  };
}

describe("toPayrollRow", () => {
  it("narrows a snake_case server row", () => {
    expect(
      toPayrollRow({
        id: "p9",
        worker_id: "w9",
        period: "2026-06",
        amount: 4500,
        currency_code: "THB",
        cc_id: "cc1",
        created_at: "2026-06-30T00:00:00Z",
      }),
    ).toEqual({ id: "p9", workerId: "w9", period: "2026-06", amount: 4500, currencyCode: "THB" });
  });

  it("accepts camelCase aliases", () => {
    expect(toPayrollRow({ id: "p2", workerId: "w2", period: "2026-05", currencyCode: "THB" })).toEqual({
      id: "p2",
      workerId: "w2",
      period: "2026-05",
      amount: 0,
      currencyCode: "THB",
    });
  });

  it("coerces a drizzle numeric string amount", () => {
    expect(toPayrollRow({ id: "p3", amount: "12750.50" }).amount).toBe(12750.5);
  });

  it("defaults missing fields ('' / 0), never fabricating", () => {
    expect(toPayrollRow({})).toEqual({ id: "", workerId: "", period: "", amount: 0, currencyCode: "" });
  });
});

describe("workerById", () => {
  it("indexes workers by id (first wins, blanks skipped)", () => {
    const map = workerById([worker(), worker({ id: "w2", name: "Two" }), worker({ id: "", name: "Ghost" })]);
    expect(map.get("w1")?.name).toBe("Worker One");
    expect(map.get("w2")?.name).toBe("Two");
    expect(map.has("")).toBe(false);
  });

  it("resolves a run's worker_id to name/team/day_rate (an unknown id misses)", () => {
    const map = workerById([worker({ id: "w1", team: "Team A", dayRate: 500 })]);
    expect(map.get(run({ workerId: "w1" }).workerId)?.team).toBe("Team A");
    expect(map.get("nope")).toBeUndefined();
  });
});

describe("netTotal", () => {
  it("sums the server net amounts (never re-derives a split)", () => {
    expect(netTotal([run({ amount: 3000 }), run({ id: "p2", amount: 2500 }), run({ id: "p3", amount: 1234 })])).toBe(6734);
  });

  it("is 0 for an empty run set (honest, no fabrication)", () => {
    expect(netTotal([])).toBe(0);
  });
});

describe("latestPeriod", () => {
  it("returns the newest 'YYYY-MM' present", () => {
    expect(latestPeriod([run({ period: "2026-05" }), run({ id: "p2", period: "2026-07" }), run({ id: "p3", period: "2026-06" })])).toBe(
      "2026-07",
    );
  });

  it("returns '' when there are no runs -> subtitle em-dashes the period", () => {
    expect(latestPeriod([])).toBe("");
  });
});
