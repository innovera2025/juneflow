/*
 * labor-attendance-rows unit tests (P5-WEB, gate G3) — the pure LaborAttendance display
 * logic narrowed from labor.jsx LaborAttendance. Guards the record narrowing, the roster +
 * latest-day selection, the per-day record index, the client-side day-cost projection
 * (using the SERVER day_fraction), and the KPI aggregates (present/absent/OT/cost) incl the
 * honest-empty behaviour when a worker has no record.
 */
import { describe, it, expect } from "vitest";
import {
  toAttRecord,
  activeWorkers,
  latestDay,
  recordsForDay,
  dayCost,
  presentCount,
  absentCount,
  totalOt,
  totalCost,
  type AttRecord,
} from "./labor-attendance-rows";
import type { WorkerRow } from "./labor-workers-rows";

/** A WorkerRow for the roster/join tests. */
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

/** An AttRecord for the aggregate tests. */
function rec(over: Partial<AttRecord> = {}): AttRecord {
  return {
    id: "a1",
    workerId: "w1",
    day: "2026-07-03",
    ot: 0,
    status: "full",
    dayFraction: 1,
    ...over,
  };
}

describe("toAttRecord", () => {
  it("narrows a snake_case wire row (uses the server day_fraction)", () => {
    expect(
      toAttRecord({
        id: "att-9",
        worker_id: "w-uuid",
        day: "2026-07-03",
        ot: "2",
        status: "half",
        day_fraction: "0.5",
        cc_id: "ignored",
        created_at: "2026-07-03T00:00:00Z",
      }),
    ).toEqual({
      id: "att-9",
      workerId: "w-uuid",
      day: "2026-07-03",
      ot: 2,
      status: "half",
      dayFraction: 0.5,
    });
  });

  it("accepts camelCase fallbacks and defaults absent fields", () => {
    expect(toAttRecord({ id: "x", workerId: "w", day: "d" })).toEqual({
      id: "x",
      workerId: "w",
      day: "d",
      ot: 0,
      status: "",
      dayFraction: 0,
    });
  });
});

describe("activeWorkers", () => {
  it("keeps only active workers", () => {
    const list = activeWorkers([worker({ id: "a", active: true }), worker({ id: "b", active: false })]);
    expect(list.map((w) => w.id)).toEqual(["a"]);
  });
});

describe("latestDay / recordsForDay", () => {
  const records = [
    rec({ id: "r1", workerId: "w1", day: "2026-07-01" }), // earlier day, excluded from 07-03
    rec({ id: "r2", workerId: "w1", day: "2026-07-03" }), // w1 on the shown day (first wins)
    rec({ id: "r3", workerId: "w1", day: "2026-07-03" }), // w1 duplicate, skipped
    rec({ id: "r4", workerId: "w2", day: "2026-07-03" }),
  ];

  it("latestDay returns the max ISO day, '' when empty", () => {
    expect(latestDay(records)).toBe("2026-07-03");
    expect(latestDay([])).toBe("");
  });

  it("recordsForDay indexes that day's records by worker (first wins)", () => {
    const map = recordsForDay(records, "2026-07-03");
    expect(map.size).toBe(2);
    expect(map.get("w1")?.id).toBe("r2"); // r2 first, r3 duplicate skipped
    expect(map.get("w2")?.id).toBe("r4");
  });

  it("recordsForDay is empty for a blank day", () => {
    expect(recordsForDay(records, "").size).toBe(0);
  });
});

describe("dayCost", () => {
  it("= day_rate*day_fraction + ot*(day_rate/8)*1.5, rounded", () => {
    // 480*1 + 2*(480/8)*1.5 = 480 + 180 = 660
    expect(dayCost(480, rec({ ot: 2, dayFraction: 1 }))).toBe(660);
    // half day, no OT: 480*0.5 = 240
    expect(dayCost(480, rec({ ot: 0, dayFraction: 0.5 }))).toBe(240);
    // absent: fraction 0, no OT -> 0
    expect(dayCost(480, rec({ ot: 0, status: "absent", dayFraction: 0 }))).toBe(0);
  });

  it("is null when there is no record or no day_rate (never fabricates)", () => {
    expect(dayCost(480, undefined)).toBeNull();
    expect(dayCost(null, rec())).toBeNull();
  });
});

describe("KPI aggregates (honest-empty for workers without a record)", () => {
  const workers = [worker({ id: "w1", dayRate: 480 }), worker({ id: "w2", dayRate: 400 }), worker({ id: "w3", dayRate: 450 })];
  // w1 full+2ot, w2 absent, w3 has NO record for the day
  const recMap = new Map<string, AttRecord>([
    ["w1", rec({ workerId: "w1", ot: 2, status: "full", dayFraction: 1 })],
    ["w2", rec({ workerId: "w2", ot: 0, status: "absent", dayFraction: 0 })],
  ]);

  it("present counts records with status !== absent (no-record worker is not present)", () => {
    expect(presentCount(workers, recMap)).toBe(1); // only w1
  });

  it("absent counts status === absent", () => {
    expect(absentCount(workers, recMap)).toBe(1); // w2
  });

  it("totalOt sums OT over workers with a record", () => {
    expect(totalOt(workers, recMap)).toBe(2); // w1 only
  });

  it("totalCost sums the day costs, treating null (no record) as 0", () => {
    // w1: 480 + 2*(60)*1.5 = 660 ; w2 absent: 0 ; w3 no record: null -> 0
    expect(totalCost(workers, recMap)).toBe(660);
  });

  it("all aggregates are zero for an empty day (no records)", () => {
    const empty = new Map<string, AttRecord>();
    expect(presentCount(workers, empty)).toBe(0);
    expect(absentCount(workers, empty)).toBe(0);
    expect(totalOt(workers, empty)).toBe(0);
    expect(totalCost(workers, empty)).toBe(0);
  });
});
