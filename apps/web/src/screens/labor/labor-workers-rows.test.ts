/*
 * labor-workers-rows unit tests (P5-WEB, gate G3) — the pure LaborWorkers display logic
 * narrowed from labor.jsx LaborWorkers. Guards the opaque-row narrowing (incl the
 * code-vs-uuid split + nullable day_rate), the derived team list + team filter, the KPI
 * aggregates (active/inactive counts, avg wage, estimated day wage), the status mapping,
 * and the ASCII money format.
 */
import { describe, it, expect } from "vitest";
import {
  toWorkerRow,
  distinctTeams,
  filterByTeam,
  activeCount,
  inactiveCount,
  avgWage,
  estimatedDayWage,
  statusKind,
  fmt,
  type WorkerRow,
} from "./labor-workers-rows";

/** A fully-specified worker row for the aggregate/mapping tests. */
function worker(over: Partial<WorkerRow> = {}): WorkerRow {
  return {
    id: "uuid-1",
    code: "W-001",
    name: "Worker One",
    team: "Team A",
    skill: "Steelworker",
    payType: "daily",
    dayRate: 450,
    currencyCode: "THB",
    active: true,
    ...over,
  };
}

describe("toWorkerRow", () => {
  it("narrows a snake_case wire row (code is the business code, not the uuid)", () => {
    expect(
      toWorkerRow({
        id: "uuid-abc",
        code: "W-006",
        name: "Worker Six",
        team: "Team Electric",
        skill: "Electrician",
        pay_type: "daily",
        day_rate: "520",
        currency_code: "THB",
        active: true,
        supervisor: "ignored",
        created_at: "2026-07-01T00:00:00Z",
      }),
    ).toEqual({
      id: "uuid-abc",
      code: "W-006",
      name: "Worker Six",
      team: "Team Electric",
      skill: "Electrician",
      payType: "daily",
      dayRate: 520,
      currencyCode: "THB",
      active: true,
    });
  });

  it("accepts camelCase fallbacks", () => {
    const r = toWorkerRow({ id: "x", code: "W-1", payType: "monthly", dayRate: 800, currencyCode: "USD" });
    expect(r.payType).toBe("monthly");
    expect(r.dayRate).toBe(800);
    expect(r.currencyCode).toBe("USD");
  });

  it("keeps day_rate null when absent/null (never fabricates a rate)", () => {
    expect(toWorkerRow({ id: "y", code: "W-2" }).dayRate).toBeNull();
    expect(toWorkerRow({ id: "z", code: "W-3", day_rate: null }).dayRate).toBeNull();
  });

  it("defaults active to true (schema default) and only false marks inactive", () => {
    expect(toWorkerRow({ id: "a" }).active).toBe(true);
    expect(toWorkerRow({ id: "b", active: false }).active).toBe(false);
  });

  it("defaults absent text fields to empty strings", () => {
    expect(toWorkerRow({ id: "c" })).toEqual({
      id: "c",
      code: "",
      name: "",
      team: "",
      skill: "",
      payType: "",
      dayRate: null,
      currencyCode: "",
      active: true,
    });
  });
});

describe("distinctTeams", () => {
  it("collects unique non-empty teams in first-seen order", () => {
    const rows = [
      worker({ team: "A" }),
      worker({ team: "B" }),
      worker({ team: "A" }),
      worker({ team: "" }),
      worker({ team: "C" }),
    ];
    expect(distinctTeams(rows)).toEqual(["A", "B", "C"]);
  });

  it("is empty when no worker has a team", () => {
    expect(distinctTeams([worker({ team: "" })])).toEqual([]);
  });
});

describe("filterByTeam", () => {
  const rows = [worker({ id: "1", team: "A" }), worker({ id: "2", team: "B" }), worker({ id: "3", team: "A" })];

  it("returns every row for an empty team filter", () => {
    expect(filterByTeam(rows, "")).toHaveLength(3);
  });

  it("filters by team equality", () => {
    expect(filterByTeam(rows, "A").map((r) => r.id)).toEqual(["1", "3"]);
  });
});

describe("KPI aggregates", () => {
  const rows = [
    worker({ dayRate: 450, active: true }),
    worker({ dayRate: 420, active: true }),
    worker({ dayRate: 400, active: false }),
  ];

  it("counts active / inactive", () => {
    expect(activeCount(rows)).toBe(2);
    expect(inactiveCount(rows)).toBe(1);
  });

  it("avgWage rounds Sum(rate)/rowCount, counting a null rate as 0 (prototype formula)", () => {
    expect(avgWage(rows)).toBe(Math.round((450 + 420 + 400) / 3)); // 423
    expect(avgWage([worker({ dayRate: 500 }), worker({ dayRate: null })])).toBe(250); // (500+0)/2
  });

  it("avgWage is 0 for an empty set (no division-by-zero)", () => {
    expect(avgWage([])).toBe(0);
  });

  it("estimatedDayWage sums only ACTIVE rates (null -> 0)", () => {
    expect(estimatedDayWage(rows)).toBe(450 + 420); // active only
    expect(estimatedDayWage([worker({ dayRate: null, active: true }), worker({ dayRate: 300, active: true })])).toBe(300);
  });
});

describe("statusKind", () => {
  it("maps active -> approved, inactive -> draft", () => {
    expect(statusKind(true)).toBe("approved");
    expect(statusKind(false)).toBe("draft");
  });
});

describe("fmt", () => {
  it("groups thousands (ASCII) and guards non-finite", () => {
    expect(fmt(450)).toBe("450");
    expect(fmt(3320)).toBe("3,320");
    expect(fmt(0)).toBe("0");
    expect(fmt(Number.NaN)).toBe("0");
  });
});
