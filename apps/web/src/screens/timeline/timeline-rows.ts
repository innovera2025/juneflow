/*
 * Pure derivations for the `timeline` screen (route id `timeline`, B-424).
 *
 * Everything the Gantt draws is an OFFSET IN DAYS from the project's start date,
 * exactly as the prototype does it (pototype/timeline.jsx: milestones at day
 * 0/40/95/195/240 against TODAY_DAY = 145 of totalDays = 240). The wire carries
 * calendar dates; this module turns them into that axis and nothing else.
 *
 * WHY THE ARITHMETIC IS HERE AND NOT IN THE SCREEN. The repo's vitest env is
 * `node` with no DOM, so a bar rendered inside a component can only be asserted
 * through its markup, while a function can be probed directly with the cases that
 * actually break: an unscheduled project, a task starting before the project
 * does, work that has begun and not finished. The screen renders what these
 * return.
 *
 * NOTHING HERE INVENTS A DATE. Every function that cannot answer returns null and
 * the screen shows an em-dash or an empty chart. A project with no start_date has
 * no day zero, so it has no chart — a bar placed on today would be a schedule
 * nobody planned.
 */

/** One task exactly as GET /projects/{id}/timeline sends it. */
export interface TimelineTaskWire {
  id: string;
  group_label: string | null;
  label: string | null;
  plan_start: string | null;
  plan_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  status: string | null;
  pct: number | null;
  late: boolean | null;
  late_days: number | null;
}

/** One milestone exactly as the same read sends it. */
export interface MilestoneWire {
  id: string;
  label: string | null;
  day: number | null;
  milestone_date: string | null;
  status: string | null;
}

/** The screen's view of one Gantt row: day offsets, not dates. */
export interface GanttTask {
  id: string;
  group: string;
  label: string;
  /** [start, end] in days from day zero, or null when the task has no plan. */
  plan: readonly [number, number] | null;
  /** [start, end|null] — a null END means started and not finished. */
  actual: readonly [number, number | null] | null;
  status: string;
  pct: number | null;
  /** Days late as the server stated it; null when no lateness is recorded. */
  lateDays: number | null;
}

/** One group band with its rows, in the order the screen renders them. */
export interface GanttGroup {
  group: string;
  tasks: GanttTask[];
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole calendar days from `from` to `to`, or null when either side is missing or
 * unparseable.
 *
 * Both are `YYYY-MM-DD`, so they are compared at UTC midnight. Parsing them as
 * local instants would make the same pair differ by a day either side of a
 * timezone, and the today-line would sit differently for a user in Bangkok and
 * one in London looking at the same schedule.
 */
export function dayOffset(to: string | null | undefined, from: string | null | undefined): number | null {
  if (!to || !from) return null;
  const a = Date.parse(`${to}T00:00:00Z`);
  const b = Date.parse(`${from}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / MS_PER_DAY);
}

/**
 * Group the wire's tasks into the bands the Gantt renders, converting every date
 * to a day offset from `startDate`.
 *
 * Returns [] when the project has no start date: there is no axis to place
 * anything on, and a chart drawn from a guessed origin is worse than no chart.
 * The server already ordered the rows (group, plan start, id) and this preserves
 * that order rather than re-sorting on a different key.
 */
export function toGanttGroups(
  tasks: readonly TimelineTaskWire[],
  startDate: string | null,
): GanttGroup[] {
  if (!startDate) return [];
  const groups: GanttGroup[] = [];
  for (const t of tasks) {
    const planFrom = dayOffset(t.plan_start, startDate);
    const planTo = dayOffset(t.plan_end, startDate);
    const actFrom = dayOffset(t.actual_start, startDate);
    const actTo = dayOffset(t.actual_end, startDate);
    const row: GanttTask = {
      id: t.id,
      group: t.group_label ?? "",
      label: t.label ?? "",
      // Both ends are required for a bar. A task with only one is not half a bar
      // — it is a task whose window nobody finished entering.
      plan: planFrom != null && planTo != null ? [planFrom, planTo] : null,
      // An actual with no start has not begun; an actual with a start and no end
      // is in progress, which the chart draws up to the today-line.
      actual: actFrom != null ? [actFrom, actTo] : null,
      status: t.status ?? "",
      pct: t.pct,
      lateDays: t.late_days,
    };
    const band = groups.find((g) => g.group === row.group);
    if (band) band.tasks.push(row);
    else groups.push({ group: row.group, tasks: [row] });
  }
  return groups;
}

/** A milestone placed on the same axis. */
export interface MilestonePoint {
  id: string;
  label: string;
  /** Offset in days from day zero — the strip's own position. */
  day: number;
  date: string | null;
  status: string;
}

/**
 * Milestones the strip can place. A milestone carries `day` on the wire, so it
 * needs no project start to be positioned — but one without a day cannot be
 * placed at all and is dropped rather than pinned to day zero, which would show a
 * future milestone as the project's beginning.
 */
export function toMilestonePoints(rows: readonly MilestoneWire[]): MilestonePoint[] {
  const out: MilestonePoint[] = [];
  for (const m of rows) {
    if (m.day == null) continue;
    out.push({
      id: m.id,
      label: m.label ?? "",
      day: m.day,
      date: m.milestone_date,
      status: m.status ?? "",
    });
  }
  return out;
}

/** The chart's horizontal axis: how long the plan is, and where today sits. */
export interface TimelineAxis {
  /** Total days from start to end. Null when the project has no usable window. */
  totalDays: number | null;
  /** Today's offset from day zero, per the SERVER's date. Null without a window. */
  todayDay: number | null;
  /** Day zero itself, kept so day-based helpers need no second argument. */
  startDate: string | null;
}

/**
 * The axis, from the project window and the server's as-of date.
 *
 * `asOfDate` is the SERVER's, never the browser's: the footer prints this same
 * day number beside the line, so two clocks would let the line and its caption
 * disagree on one screen — and would move the line between two runs of the visual
 * gate against an unchanged app.
 *
 * A zero- or negative-length window yields null rather than being divided by: a
 * project that ends before it starts is bad data, and a chart is not the place to
 * discover that.
 */
export function timelineAxis(
  startDate: string | null,
  endDate: string | null,
  asOfDate: string | null,
): TimelineAxis {
  const total = dayOffset(endDate, startDate);
  const usable = total != null && total > 0;
  return {
    totalDays: usable ? total : null,
    todayDay: usable ? dayOffset(asOfDate, startDate) : null,
    startDate: usable ? (startDate ?? null) : null,
  };
}

/**
 * A day offset as a percentage of the axis, clamped to [0, 100].
 *
 * CLAMPED, not dropped: a task that starts before the project's own start date is
 * real data — someone moved the project start later — and its bar belongs at the
 * left edge rather than off-canvas where it silently disappears.
 */
export function pctOfAxis(day: number, totalDays: number): number {
  if (!(totalDays > 0)) return 0;
  return Math.min(100, Math.max(0, (day / totalDays) * 100));
}

/** Left offset and width for one bar, both as percentages of the axis. */
export interface BarGeometry {
  left: number;
  width: number;
}

/**
 * Bar geometry for a [from, to] window. `to` null means "up to today", which is
 * how the chart draws work in progress.
 *
 * Returns null when the window cannot be placed — no axis, or an open-ended bar
 * with no today to run to. A zero-width bar is still returned: a task planned for
 * a single day is a real one-day task, and hiding it would lose a row.
 */
export function barGeometry(
  window: readonly [number, number | null] | null,
  axis: TimelineAxis,
): BarGeometry | null {
  const total = axis.totalDays;
  if (!window || total == null) return null;
  const [from, rawTo] = window;
  const to = rawTo ?? axis.todayDay;
  if (to == null) return null;
  const left = pctOfAxis(from, total);
  const right = pctOfAxis(Math.max(from, to), total);
  return { left, width: Math.max(0, right - left) };
}

/** The KPI values, each null when nothing on the wire supports it. */
export interface TimelineKpis {
  /** Mean completion across tasks that report one. Null when none do. */
  progressPct: number | null;
  ongoingCount: number;
  lateCount: number;
  /** Milestones the plan has not reached yet, by status. */
  upcomingMilestones: number;
  /** Tasks whose plan ends within the next 7 days. Null without an axis. */
  dueThisWeek: number | null;
}

/**
 * The KPI strip, derived from what the wire actually carries.
 *
 * THE PROTOTYPE'S OWN NUMBERS ARE NOT REPRODUCED, and that is the point. It
 * hardcodes 62 / 6 / 3 / 1 / 4 next to sub-captions with no source at all; the
 * counts here come from the rows, and the captions that cannot be derived are
 * rendered em-dash by the screen (B-425). A KPI that matches the mock by being
 * hardcoded is not a KPI.
 */
export function timelineKpis(
  tasks: readonly TimelineTaskWire[],
  milestones: readonly MilestoneWire[],
  axis: TimelineAxis,
): TimelineKpis {
  const withPct = tasks.filter((t) => t.pct != null);
  const progressPct = withPct.length
    ? withPct.reduce((sum, t) => sum + (t.pct ?? 0), 0) / withPct.length
    : null;

  let dueThisWeek: number | null = null;
  if (axis.todayDay != null && axis.startDate) {
    dueThisWeek = 0;
    for (const t of tasks) {
      // Measured on the same axis the bars use, so "this week" means the same
      // seven days the chart shows.
      const day = dayOffset(t.plan_end, axis.startDate);
      if (day == null) continue;
      if (day >= axis.todayDay && day - axis.todayDay <= 7) dueThisWeek += 1;
    }
  }

  return {
    progressPct,
    ongoingCount: tasks.filter((t) => t.status === "ongoing").length,
    // `late` is the server's stated flag, never a comparison made here: the
    // source leaves one overrunning task unmarked, and re-deriving would
    // disagree with the badge the same row shows (B-424).
    lateCount: tasks.filter((t) => t.late === true).length,
    upcomingMilestones: milestones.filter((m) => m.status === "soon").length,
    dueThisWeek,
  };
}

/** One EVM period as GET /boq/reports/evm sends it. */
export interface EvmPoint {
  period_label: string;
  pv: number | null;
  ev: number | null;
  ac: number | null;
}

/** The S-curve: one label per period, plan and actual as cumulative percents. */
export interface Scurve {
  labels: string[];
  plan: (number | null)[];
  actual: (number | null)[];
}

/**
 * The cumulative progress curve, from the EVM series.
 *
 * NORMALISED BY THE FINAL PV, because the series carries no budget-at-completion
 * and the response has no other denominator. PV at the last period is planned
 * value at completion, which is what BAC means — so plan reaches 100% at the end
 * by construction, and actual reaches EV/BAC.
 *
 * THIS IS NOT THE PROTOTYPE'S CURVE, and the difference is recorded rather than
 * hidden (B-426): the mock hardcodes eight monthly points weighted by BOQ value,
 * while this is the twelve EVM periods the project actually has. The shape is the
 * real one; the caption that claims BOQ weighting is itself unmintable copy.
 *
 * Returns null when there is no series or no usable denominator — an empty chart
 * rather than a curve divided by zero.
 */
export function scurveFromEvm(series: readonly EvmPoint[]): Scurve | null {
  if (!series.length) return null;
  const last = series[series.length - 1];
  const bac = last?.pv ?? null;
  if (bac == null || !(bac > 0)) return null;
  return {
    labels: series.map((p) => p.period_label),
    plan: series.map((p) => (p.pv == null ? null : (p.pv / bac) * 100)),
    // A period with no EV has not been measured yet; null leaves a gap in the
    // line instead of drawing a drop to zero.
    actual: series.map((p) => (p.ev == null ? null : (p.ev / bac) * 100)),
  };
}
