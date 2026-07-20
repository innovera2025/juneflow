/*
 * Unit tests for pm-dashboard-rows.ts (pm.dashboard, gate G3) — the pure derivation
 * helpers that back PMDashboard. Covers the opaque-row narrowing (asset / work
 * order), the tri-state next_due tone, the REAL overdue count, the checklist
 * compliance (DEFAULT 1 pass = 'normal', empty -> null), the due/overdue panel
 * (overdue-first, cap 6), the upcoming sort, the FIXED June-2026 calendar marks (Wei
 * 2026-07-20), the date parsers, AND the empty-seed reality (DEFAULT 6: all next_due in
 * a non-anchor month -> zero overdue + empty panel + empty calendar, honestly).
 */
import { describe, it, expect } from "vitest";
import {
  toDashAsset,
  toDashWo,
  dueTone,
  overdueCount,
  compliancePct,
  duePanelRows,
  upcomingRows,
  calendarMarks,
  PM_CALENDAR_YM,
  PM_CALENDAR_DAYS,
  dayOfMonth,
  todayISO,
  formatUpcomingDate,
  type DashAsset,
  type DashWo,
} from "./pm-dashboard-rows";

/** Fixed "today" for deterministic tone/overdue math (matches the current loop date). */
const TODAY = "2026-07-20";

const asset = (over: Partial<DashAsset> = {}): DashAsset => ({
  id: "a1",
  code: "LIFT-A01",
  name: "Passenger lift MX-1000",
  kind: "lift",
  cycle: "monthly",
  nextDue: "2026-07-25",
  ...over,
});

const wo = (results: string[]): DashWo => ({
  id: "w" + results.join(""),
  items: results.map((r, i) => ({ label: "item-" + i, result: r })),
});

describe("toDashAsset", () => {
  it("narrows snake_case wire (code/name real, migration 0034)", () => {
    expect(
      toDashAsset({
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
      kind: "pump",
      cycle: "quarterly",
      nextDue: "2026-08-01",
    });
  });

  it("accepts camelCase next_due and defaults missing fields to ''", () => {
    expect(toDashAsset({ id: "u2", nextDue: "2026-09-01" })).toEqual({
      id: "u2",
      code: "",
      name: "",
      kind: "",
      cycle: "",
      nextDue: "2026-09-01",
    });
  });
});

describe("toDashWo", () => {
  it("narrows checklist items (label + result), unfilled result -> ''", () => {
    expect(
      toDashWo({ id: "w1", items: [{ label: "a", result: "normal" }, { label: "b" }] }),
    ).toEqual({
      id: "w1",
      items: [
        { label: "a", result: "normal" },
        { label: "b", result: "" },
      ],
    });
  });

  it("non-array items -> []", () => {
    expect(toDashWo({ id: "w2" }).items).toEqual([]);
    expect(toDashWo({ id: "w3", items: "nope" }).items).toEqual([]);
  });
});

describe("dueTone", () => {
  it("overdue when next_due strictly before today", () => {
    expect(dueTone("2026-07-10", TODAY)).toBe("overdue");
  });
  it("due when this month and today-or-later", () => {
    expect(dueTone("2026-07-20", TODAY)).toBe("due");
    expect(dueTone("2026-07-25", TODAY)).toBe("due");
  });
  it("plan when a future month", () => {
    expect(dueTone("2026-08-01", TODAY)).toBe("plan");
  });
  it("null when blank", () => {
    expect(dueTone("", TODAY)).toBeNull();
  });
});

describe("overdueCount (REAL, B-108d)", () => {
  it("counts only strictly-past-due assets", () => {
    const rows = [
      asset({ nextDue: "2026-07-10" }), // overdue
      asset({ nextDue: "2026-06-30" }), // overdue
      asset({ nextDue: "2026-07-25" }), // due
      asset({ nextDue: "2026-08-01" }), // plan
      asset({ nextDue: "" }), // undated
    ];
    expect(overdueCount(rows, TODAY)).toBe(2);
  });

  it("DEFAULT 6 empty-seed: all next_due future-month -> 0 (honest, not a bug)", () => {
    const rows = [asset({ nextDue: "2026-08-01" }), asset({ nextDue: "2026-08-01" })];
    expect(overdueCount(rows, TODAY)).toBe(0);
  });
});

describe("compliancePct (DEFAULT 1: pass = 'normal')", () => {
  it("100 * normal / (any result set), 1 decimal", () => {
    // 2 normal, 1 adjust, 1 repair, 1 unfilled -> filled 4, passed 2 -> 50.0
    const wos = [wo(["normal", "adjust", "normal", "repair", ""])];
    expect(compliancePct(wos)).toBe("50.0");
  });

  it("adjust/repair are NOT passes (only 'normal')", () => {
    const wos = [wo(["adjust", "repair"])];
    expect(compliancePct(wos)).toBe("0.0");
  });

  it("all normal -> 100.0", () => {
    expect(compliancePct([wo(["normal", "normal"])])).toBe("100.0");
  });

  it("rounds to 1 decimal (2 of 3 -> 66.7)", () => {
    expect(compliancePct([wo(["normal", "normal", "adjust"])])).toBe("66.7");
  });

  it("no filled item -> null (honest em-dash, never a fabricated 0/100)", () => {
    expect(compliancePct([])).toBeNull();
    expect(compliancePct([wo(["", ""])])).toBeNull();
  });

  it("aggregates across multiple work orders", () => {
    // wo1: 1 normal / 1 filled ; wo2: 1 normal + 1 repair / 2 filled -> 2/3 -> 66.7
    expect(compliancePct([wo(["normal"]), wo(["normal", "repair"])])).toBe("66.7");
  });
});

describe("duePanelRows", () => {
  it("overdue first, then due, capped at 6", () => {
    const rows = [
      asset({ id: "d1", nextDue: "2026-07-25" }), // due
      asset({ id: "o1", nextDue: "2026-07-10" }), // overdue
      asset({ id: "d2", nextDue: "2026-07-28" }), // due
      asset({ id: "p1", nextDue: "2026-08-01" }), // plan (excluded)
    ];
    const out = duePanelRows(rows, TODAY);
    expect(out.map((r) => r.id)).toEqual(["o1", "d1", "d2"]);
    expect(out.map((r) => r.tone)).toEqual(["overdue", "due", "due"]);
  });

  it("caps the combined list at 6", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      asset({ id: "x" + i, nextDue: "2026-07-05" }),
    );
    expect(duePanelRows(rows, TODAY)).toHaveLength(6);
  });

  it("DEFAULT 6 empty-seed: all future-month -> empty panel", () => {
    const rows = [asset({ nextDue: "2026-08-01" }), asset({ nextDue: "2026-08-01" })];
    expect(duePanelRows(rows, TODAY)).toEqual([]);
  });

  it("does not mutate the input array order", () => {
    const rows = [asset({ id: "d", nextDue: "2026-07-25" }), asset({ id: "o", nextDue: "2026-07-01" })];
    duePanelRows(rows, TODAY);
    expect(rows.map((r) => r.id)).toEqual(["d", "o"]);
  });
});

describe("upcomingRows", () => {
  it("sorts dated assets by next_due asc and drops undated", () => {
    const rows = [
      asset({ id: "c", nextDue: "2026-09-01" }),
      asset({ id: "a", nextDue: "2026-07-25" }),
      asset({ id: "u", nextDue: "" }),
      asset({ id: "b", nextDue: "2026-08-01" }),
    ];
    const out = upcomingRows(rows, TODAY);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(out.map((r) => r.tone)).toEqual(["due", "plan", "plan"]);
    expect(out.map((r) => r.day)).toEqual([25, 1, 1]);
  });

  it("DEFAULT 6 empty-seed: future-month assets still list (as plan), sorted", () => {
    const rows = [asset({ id: "a", nextDue: "2026-08-01" }), asset({ id: "b", nextDue: "2026-08-01" })];
    const out = upcomingRows(rows, TODAY);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.tone === "plan")).toBe(true);
  });
});

describe("calendarMarks (FIXED June-2026 anchor, Wei 2026-07-20)", () => {
  it("marks only anchor-month (June 2026) days; other months excluded", () => {
    const rows = [
      asset({ nextDue: "2026-06-10" }), // June -> day 10 (past vs July today -> overdue)
      asset({ nextDue: "2026-06-25" }), // June -> day 25
      asset({ nextDue: "2026-07-25" }), // July (not the anchor) -> excluded
      asset({ nextDue: "2026-08-01" }), // August -> excluded
    ];
    const marks = calendarMarks(rows, TODAY);
    expect(marks.get(10)).toBe("overdue");
    expect(marks.get(25)).toBe("overdue");
    expect(marks.has(25) && marks.size).toBe(2);
  });

  it("tone stays relative to today (today INSIDE June proves tri-state due/plan)", () => {
    const inJune = "2026-06-15";
    const rows = [
      asset({ nextDue: "2026-06-10" }), // before today-in-June -> overdue
      asset({ nextDue: "2026-06-20" }), // this month, today-or-later -> due
    ];
    const marks = calendarMarks(rows, inJune);
    expect(marks.get(10)).toBe("overdue");
    expect(marks.get(20)).toBe("due");
  });

  it("stronger tone wins when two assets share a day", () => {
    const rows = [asset({ nextDue: "2026-06-25" }), asset({ nextDue: "2026-06-25" })];
    expect(calendarMarks(rows, TODAY).get(25)).toBe("overdue");
  });

  it("DEFAULT 6 empty-seed: all August -> empty marks on the fixed June calendar", () => {
    const rows = [asset({ nextDue: "2026-08-01" }), asset({ nextDue: "2026-08-01" })];
    expect(calendarMarks(rows, TODAY).size).toBe(0);
  });

  it("exposes the fixed anchor month + 30-cell grid constants", () => {
    expect(PM_CALENDAR_YM).toBe("2026-06");
    expect(PM_CALENDAR_DAYS).toBe(30);
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
});

describe("th-TH Intl formatters (dynamic locale format — no re-translated source)", () => {
  it("formatUpcomingDate splits day + short month, '' for junk", () => {
    const f = formatUpcomingDate("2026-08-01");
    expect(f.day).toBe("1");
    expect(f.month.length).toBeGreaterThan(0);
    expect(formatUpcomingDate("nope")).toEqual({ day: "", month: "" });
  });
});
