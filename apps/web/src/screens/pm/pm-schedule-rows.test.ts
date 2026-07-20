/*
 * Unit tests for pm-schedule-rows.ts (pm.schedule, gate G3) — the pure derivation
 * helpers that back PMSchedule (Wei B-108a, web-side DERIVE). Covers the opaque-row
 * narrowing, the 14-day tri-state status (overdue / due-within-14d / plan) with its
 * boundaries, the honest-exclude of undated/unparseable rows, the ascending plan sort,
 * the FIXED June-2026 calendar marks (Wei 2026-07-20, worst-status per day), the fixed
 * grid constants, the date helpers, AND the empty-seed reality (the current all-August
 * seed leaves the June grid clean of marks, honestly).
 */
import { describe, it, expect } from "vitest";
import {
  toScheduleAsset,
  scheduleStatus,
  toScheduleItem,
  scheduleItems,
  scheduleDayMarks,
  dayOfMonth,
  todayISO,
  formatScheduleDate,
  PM_SCHEDULE_YM,
  PM_SCHEDULE_DAYS,
  PM_DUE_WINDOW_DAYS,
  type ScheduleAsset,
} from "./pm-schedule-rows";

/** Fixed "today" for deterministic status/mark math (matches the current loop date). */
const TODAY = "2026-07-20";

const asset = (over: Partial<ScheduleAsset> = {}): ScheduleAsset => ({
  id: "a1",
  code: "LIFT-A01",
  name: "Passenger lift MX-1000",
  cycle: "monthly",
  nextDue: "2026-07-25",
  ...over,
});

describe("toScheduleAsset", () => {
  it("narrows snake_case wire (code/name/cycle real, migration 0034)", () => {
    expect(
      toScheduleAsset({
        id: "u1",
        contract_id: "c1",
        code: "PUMP-01",
        name: "Fire pump",
        kind: "pump",
        cycle: "quarterly",
        next_due: "2026-08-01",
      }),
    ).toEqual({
      id: "u1",
      code: "PUMP-01",
      name: "Fire pump",
      cycle: "quarterly",
      nextDue: "2026-08-01",
    });
  });

  it("accepts camelCase next_due and defaults missing fields to ''", () => {
    expect(toScheduleAsset({ id: "u2", nextDue: "2026-09-01" })).toEqual({
      id: "u2",
      code: "",
      name: "",
      cycle: "",
      nextDue: "2026-09-01",
    });
  });
});

describe("scheduleStatus (14-day window, prototype 'next 14 days' copy)", () => {
  it("overdue when strictly before today", () => {
    expect(scheduleStatus("2026-07-19", TODAY)).toBe("overdue");
    expect(scheduleStatus("2026-06-30", TODAY)).toBe("overdue");
  });

  it("due when today or within the next 14 days (inclusive boundary)", () => {
    expect(scheduleStatus("2026-07-20", TODAY)).toBe("due"); // today
    expect(scheduleStatus("2026-08-01", TODAY)).toBe("due"); // +12d
    expect(scheduleStatus("2026-08-03", TODAY)).toBe("due"); // +14d exactly (inclusive)
  });

  it("plan once past the 14-day window", () => {
    expect(scheduleStatus("2026-08-04", TODAY)).toBe("plan"); // +15d
    expect(scheduleStatus("2026-09-01", TODAY)).toBe("plan");
  });

  it("null for a blank or malformed date", () => {
    expect(scheduleStatus("", TODAY)).toBeNull();
    expect(scheduleStatus("2026/07/20", TODAY)).toBeNull();
    expect(scheduleStatus("2026-07-20", "bad")).toBeNull();
  });

  it("the window constant is the prototype's 14 days", () => {
    expect(PM_DUE_WINDOW_DAYS).toBe(14);
  });
});

describe("toScheduleItem", () => {
  it("carries name/code/cycle + derives day + status", () => {
    expect(toScheduleItem(asset({ id: "x", nextDue: "2026-08-01" }), TODAY)).toEqual({
      id: "x",
      code: "LIFT-A01",
      name: "Passenger lift MX-1000",
      cycle: "monthly",
      nextDue: "2026-08-01",
      day: 1,
      status: "due",
    });
  });

  it("honest-excludes an undated / unparseable asset (null, never a fabricated date)", () => {
    expect(toScheduleItem(asset({ nextDue: "" }), TODAY)).toBeNull();
    expect(toScheduleItem(asset({ nextDue: "not-a-date" }), TODAY)).toBeNull();
  });
});

describe("scheduleItems", () => {
  it("sorts dated assets by next_due asc and drops undated", () => {
    const rows = [
      asset({ id: "c", nextDue: "2026-09-01" }),
      asset({ id: "a", nextDue: "2026-07-25" }),
      asset({ id: "u", nextDue: "" }),
      asset({ id: "b", nextDue: "2026-08-01" }),
    ];
    const out = scheduleItems(rows, TODAY);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(out.map((r) => r.status)).toEqual(["due", "due", "plan"]);
    expect(out.map((r) => r.day)).toEqual([25, 1, 1]);
  });

  it("does not mutate the input array order", () => {
    const rows = [asset({ id: "b", nextDue: "2026-09-01" }), asset({ id: "a", nextDue: "2026-07-25" })];
    scheduleItems(rows, TODAY);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("scheduleDayMarks (FIXED June-2026 anchor, Wei 2026-07-20)", () => {
  it("marks only anchor-month (June 2026) days; other months excluded", () => {
    const items = scheduleItems(
      [
        asset({ nextDue: "2026-06-10" }), // June -> day 10 (past vs July today -> overdue)
        asset({ nextDue: "2026-06-25" }), // June -> day 25
        asset({ nextDue: "2026-07-25" }), // July (not the anchor) -> excluded
        asset({ nextDue: "2026-08-01" }), // August -> excluded
      ],
      TODAY,
    );
    const marks = scheduleDayMarks(items);
    expect(marks.get(10)).toBe("overdue");
    expect(marks.get(25)).toBe("overdue");
    expect(marks.size).toBe(2);
  });

  it("worst status wins when two items share a day (today INSIDE June proves tri-state)", () => {
    const inJune = "2026-06-15";
    const items = scheduleItems(
      [
        asset({ nextDue: "2026-06-15" }), // due (today)
        asset({ nextDue: "2026-06-15" }), // due (today)
        asset({ nextDue: "2026-06-10" }), // overdue
      ],
      inJune,
    );
    const marks = scheduleDayMarks(items);
    expect(marks.get(15)).toBe("due");
    expect(marks.get(10)).toBe("overdue");
  });

  it("DEFAULT empty-seed: all August -> empty marks on the fixed June calendar (honest)", () => {
    const items = scheduleItems(
      [asset({ nextDue: "2026-08-01" }), asset({ nextDue: "2026-08-01" })],
      TODAY,
    );
    expect(scheduleDayMarks(items).size).toBe(0);
  });

  it("exposes the fixed anchor month + 30-cell grid constants", () => {
    expect(PM_SCHEDULE_YM).toBe("2026-06");
    expect(PM_SCHEDULE_DAYS).toBe(30);
  });
});

describe("date helpers", () => {
  it("dayOfMonth parses / rejects", () => {
    expect(dayOfMonth("2026-07-20")).toBe(20);
    expect(dayOfMonth("")).toBeNull();
    expect(dayOfMonth("2026/07/20")).toBeNull();
    expect(dayOfMonth("2026-13-01")).toBeNull();
  });

  it("todayISO yields a YYYY-MM-DD slice", () => {
    expect(todayISO(new Date("2026-07-20T09:30:00Z"))).toBe("2026-07-20");
  });

  it("formatScheduleDate splits day + short month + combined label, '' for junk", () => {
    const f = formatScheduleDate("2026-08-01");
    expect(f.day).toBe("1");
    expect(f.month.length).toBeGreaterThan(0);
    expect(f.label.length).toBeGreaterThan(0);
    expect(f.label).toContain(f.day);
    expect(f.label).toContain(f.month);
    expect(formatScheduleDate("nope")).toEqual({ day: "", month: "", label: "" });
  });
});
