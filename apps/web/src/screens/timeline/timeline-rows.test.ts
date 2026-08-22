/*
 * G3 unit tests — the timeline screen's derivations (B-424).
 *
 * These probe the cases a rendered chart hides: a project with no start date, a
 * task that begins before day zero, work in progress with no end, a window of
 * zero length. Each one has a defined answer here, and each answer is the
 * difference between an honest chart and a plausible-looking wrong one.
 */
import { describe, expect, it } from "vitest";
import {
  barGeometry,
  dayOffset,
  pctOfAxis,
  scurveFromEvm,
  timelineAxis,
  timelineKpis,
  toGanttGroups,
  toMilestonePoints,
  type TimelineTaskWire,
  type MilestoneWire,
  type EvmPoint,
} from "./timeline-rows";

const START = "2026-01-01";
const END = "2026-08-29"; // 240 days
const TODAY = "2026-05-26"; // day 145

const task = (over: Partial<TimelineTaskWire> = {}): TimelineTaskWire => ({
  id: "tl-0",
  group_label: "02",
  label: "foundation",
  plan_start: "2026-01-09",
  plan_end: "2026-02-08",
  actual_start: "2026-01-09",
  actual_end: "2026-02-10",
  status: "done",
  pct: 100,
  late: true,
  late_days: 2,
  ...over,
});

const milestone = (over: Partial<MilestoneWire> = {}): MilestoneWire => ({
  id: "ms-0",
  label: "foundations complete",
  day: 40,
  milestone_date: "2026-02-10",
  status: "done",
  ...over,
});

describe("dayOffset", () => {
  it("counts whole calendar days", () => {
    expect(dayOffset("2026-01-01", START)).toBe(0);
    expect(dayOffset(END, START)).toBe(240);
    expect(dayOffset(TODAY, START)).toBe(145);
  });

  it("goes negative for a date before day zero rather than clamping", () => {
    // Clamping here would silently move a task's start; the clamp belongs at the
    // drawing step, where the reason for it is visual.
    expect(dayOffset("2025-12-25", START)).toBe(-7);
  });

  it("is null when either side is missing or unparseable", () => {
    expect(dayOffset(null, START)).toBeNull();
    expect(dayOffset("2026-01-01", null)).toBeNull();
    expect(dayOffset("not-a-date", START)).toBeNull();
  });

  it("reads both dates at UTC midnight, so the answer is timezone-independent", () => {
    // Parsing "2026-01-01" as a LOCAL instant makes this pair differ by a day in
    // half the world, which would move the today-line for those users.
    expect(dayOffset("2026-03-01", "2026-02-28")).toBe(1);
    expect(dayOffset("2026-01-01", "2025-12-31")).toBe(1);
  });
});

describe("timelineAxis", () => {
  it("derives the length and today's position", () => {
    expect(timelineAxis(START, END, TODAY)).toEqual({
      totalDays: 240,
      todayDay: 145,
      startDate: START,
    });
  });

  it("has no axis at all for a project with no start date", () => {
    // Not an error, and not "starts today": an unscheduled project renders empty.
    expect(timelineAxis(null, END, TODAY)).toEqual({
      totalDays: null,
      todayDay: null,
      startDate: null,
    });
  });

  it("refuses a window that ends before it starts, instead of dividing by it", () => {
    expect(timelineAxis("2026-08-29", "2026-01-01", TODAY).totalDays).toBeNull();
    expect(timelineAxis(START, START, TODAY).totalDays).toBeNull();
  });
});

describe("toGanttGroups", () => {
  it("converts dates to day offsets and keeps the server's order", () => {
    const groups = toGanttGroups([task(), task({ id: "tl-1", group_label: "03", label: "walls" })], START);
    expect(groups.map((g) => g.group)).toEqual(["02", "03"]);
    expect(groups[0]!.tasks[0]!.plan).toEqual([8, 38]);
    expect(groups[0]!.tasks[0]!.actual).toEqual([8, 40]);
  });

  it("returns NOTHING when the project has no start date", () => {
    // There is no axis to place a bar on. Drawing from a guessed origin would put
    // a schedule on screen that nobody planned.
    expect(toGanttGroups([task()], null)).toEqual([]);
  });

  it("keeps an open-ended actual open — that bar runs to the today-line", () => {
    const [g] = toGanttGroups([task({ status: "ongoing", actual_end: null })], START);
    expect(g!.tasks[0]!.actual).toEqual([8, null]);
  });

  it("gives NO plan bar to a task missing either end of its window", () => {
    // Half a window is not half a bar; it is an unfinished data entry.
    expect(toGanttGroups([task({ plan_end: null })], START)[0]!.tasks[0]!.plan).toBeNull();
    expect(toGanttGroups([task({ plan_start: null })], START)[0]!.tasks[0]!.plan).toBeNull();
  });

  it("gives NO actual bar to work that has not started", () => {
    const [g] = toGanttGroups([task({ status: "future", actual_start: null, actual_end: null })], START);
    expect(g!.tasks[0]!.actual).toBeNull();
  });

  it("collects rows of the same group into one band", () => {
    const groups = toGanttGroups(
      [task({ id: "a" }), task({ id: "b" }), task({ id: "c", group_label: "03" })],
      START,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]!.tasks.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("toMilestonePoints", () => {
  it("keeps the day offset the strip positions with", () => {
    expect(toMilestonePoints([milestone()])[0]).toEqual({
      id: "ms-0",
      label: "foundations complete",
      day: 40,
      date: "2026-02-10",
      status: "done",
    });
  });

  it("DROPS a milestone with no day rather than pinning it to day zero", () => {
    // Day zero is the project's start. A milestone shown there because its day is
    // unknown reads as "this already happened".
    expect(toMilestonePoints([milestone({ day: null })])).toEqual([]);
  });
});

describe("barGeometry", () => {
  const axis = timelineAxis(START, END, TODAY);

  it("places a closed window as a percentage of the axis", () => {
    expect(barGeometry([0, 120], axis)).toEqual({ left: 0, width: 50 });
    expect(barGeometry([120, 240], axis)).toEqual({ left: 50, width: 50 });
  });

  it("runs an OPEN window to the today-line", () => {
    // This is what "started and not finished" looks like on a chart.
    expect(barGeometry([120, null], axis)).toEqual({
      left: 50,
      width: pctOfAxis(145, 240) - 50,
    });
  });

  it("clamps a bar that starts before day zero to the left edge", () => {
    // Real data: someone moved the project start later. Off-canvas would hide it.
    expect(barGeometry([-30, 60], axis)!.left).toBe(0);
  });

  it("keeps a one-day task visible as a zero-width bar rather than dropping it", () => {
    expect(barGeometry([100, 100], axis)).toEqual({ left: pctOfAxis(100, 240), width: 0 });
  });

  it("is null without an axis, and null for an open window with no today", () => {
    expect(barGeometry([0, 10], timelineAxis(null, END, TODAY))).toBeNull();
    const noToday = { totalDays: 240, todayDay: null, startDate: START };
    expect(barGeometry([0, null], noToday)).toBeNull();
    expect(barGeometry(null, axis)).toBeNull();
  });
});

describe("timelineKpis", () => {
  const axis = timelineAxis(START, END, TODAY);

  it("counts ongoing work and stated lateness from the rows", () => {
    const kpis = timelineKpis(
      [
        task({ id: "a", status: "ongoing", late: false, late_days: null }),
        task({ id: "b", status: "ongoing", late: true, late_days: 3 }),
        task({ id: "c", status: "done", late: false, late_days: null }),
      ],
      [],
      axis,
    );
    expect(kpis.ongoingCount).toBe(2);
    expect(kpis.lateCount).toBe(1);
  });

  it("uses the STATED late flag, never a comparison of the dates", () => {
    // The source leaves one overrunning task unmarked (B-424). Re-deriving here
    // would contradict the badge the same row renders.
    const overrunButUnmarked = task({ plan_end: "2026-02-08", actual_end: "2026-02-20", late: false, late_days: null });
    expect(timelineKpis([overrunButUnmarked], [], axis).lateCount).toBe(0);
  });

  it("averages the percents that exist and answers null when none do", () => {
    expect(timelineKpis([task({ pct: 100 }), task({ pct: 50 })], [], axis).progressPct).toBe(75);
    expect(timelineKpis([task({ pct: null })], [], axis).progressPct).toBeNull();
  });

  it("counts work due within seven days on the SAME axis the bars use", () => {
    const kpis = timelineKpis(
      [
        task({ id: "in", plan_end: "2026-05-30" }), // day 149
        task({ id: "edge", plan_end: "2026-06-02" }), // day 152 — exactly +7
        task({ id: "out", plan_end: "2026-06-03" }), // day 153
        task({ id: "past", plan_end: "2026-05-01" }),
      ],
      [],
      axis,
    );
    expect(kpis.dueThisWeek).toBe(2);
  });

  it("cannot answer due-this-week without an axis, and says so with null", () => {
    expect(timelineKpis([task()], [], timelineAxis(null, END, TODAY)).dueThisWeek).toBeNull();
  });

  it("counts upcoming milestones by their stated status", () => {
    const kpis = timelineKpis([], [milestone({ status: "soon" }), milestone({ id: "m2", status: "done" })], axis);
    expect(kpis.upcomingMilestones).toBe(1);
  });
});

describe("scurveFromEvm", () => {
  const series: EvmPoint[] = [
    { periodLabel: "2026-01", pv: 25, ev: 20, ac: 22 },
    { periodLabel: "2026-02", pv: 50, ev: 40, ac: 44 },
    { periodLabel: "2026-03", pv: 100, ev: 80, ac: 88 },
  ];

  it("normalises by the FINAL pv, so plan reaches 100% at completion", () => {
    const curve = scurveFromEvm(series)!;
    expect(curve.labels).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(curve.plan).toEqual([25, 50, 100]);
    expect(curve.actual).toEqual([20, 40, 80]);
  });

  it("leaves a GAP for a period with no measured value instead of drawing zero", () => {
    // A drop to zero would read as work being undone.
    // The BOQ narrowing types ev/ac as numbers, but the endpoint can and does send
    // a period that has not been measured; the cast is the only way to model that
    // here, and the behaviour it pins is the reason the guard exists at all.
    const unmeasured = { periodLabel: "2026-03", pv: 100, ev: null, ac: null } as unknown as EvmPoint;
    const curve = scurveFromEvm([...series.slice(0, 2), unmeasured])!;
    expect(curve.actual).toEqual([20, 40, null]);
  });

  it("is null with no series, and null when the denominator is unusable", () => {
    expect(scurveFromEvm([])).toBeNull();
    expect(scurveFromEvm([{ periodLabel: "2026-01", pv: 0, ev: 0, ac: 0 }])).toBeNull();
    expect(
      scurveFromEvm([{ periodLabel: "2026-01", pv: null, ev: 5, ac: 5 } as unknown as EvmPoint]),
    ).toBeNull();
  });
});
