/*
 * PM Schedule derivation helpers for PMSchedule (pm.schedule — the read-only PM plan
 * calendar) — pure, i18n-free, ASCII-only logic derived from pototype/pm2.jsx
 * PMSchedule (L497-551) + PMCalendar (L552-591) + PMUpcoming (L592-624).
 *
 * Wei B-108a (web-side DERIVE, NO /pm/schedule endpoint): the schedule is computed
 * from the live GET /pm/assets catalogue (assetWire { id, contract_id, name, code,
 * kind, site, cycle, next_due }). The prototype drove PMCalendar / PMUpcoming from the
 * PM_PLAN_ITEMS + PM_DAY_MARKS mocks; those are dropped — every row here is real.
 * Nothing is fabricated: an asset with a null/unparseable next_due is honestly
 * EXCLUDED (never given a guessed date).
 *
 * FIXED GRID (Wei 2026-07-20): the calendar month is the prototype's verbatim
 * June-2569 (June-2026 CE), NOT the live month, and always draws 30 day cells (1..30)
 * straight into the 7-column grid (no weekday offset). Day marks derive ONLY from
 * assets whose next_due lands in that anchor month (PM_SCHEDULE_YM); with the current
 * all-August seed the grid renders clean of marks (honest, not a bug) — same fixed
 * grid as pm.dashboard (pm-dashboard-rows.ts calendarMarks).
 *
 * STATUS THRESHOLD (FLAG): the prototype's genWO modal copy names a 14-day window
 * ("...in the next 14 days" — pm.genWoInfoLine), so that literal drives the tri-state
 * status here: overdue = past-due (next_due < today); due = within the next 14 days;
 * plan = further out. This is a schedule-specific window, distinct from the
 * dashboard's same-calendar-month "due" tone (pm-dashboard-rows.ts dueTone).
 *
 * ASCII-only (mirrors pm-rows.ts / pm-dashboard-rows.ts): no Thai literal lives here.
 * The `cycle` string rides through verbatim from the wire (a raw stored value, never
 * an i18n key); the th-TH short-date label is produced by Intl at runtime (a dynamic
 * locale format, not a re-translated source string).
 */

/**
 * The FIXED calendar-grid anchor (Wei 2026-07-20): the schedule PMCalendar renders the
 * prototype's verbatim June-2569 (June-2026 CE) month, 30 day cells (1..30).
 */
export const PM_SCHEDULE_YM = "2026-06";
export const PM_SCHEDULE_DAYS = 30;
/** The genWO / due-status window, from the prototype's "next 14 days" copy (FLAG). */
export const PM_DUE_WINDOW_DAYS = 14;

/** Tri-state schedule status (overdue / due-soon / planned-ahead). */
export type ScheduleStatus = "overdue" | "due" | "plan";

/** A PM asset as the schedule consumes it (GET /pm/assets row, narrowed from wire). */
export interface ScheduleAsset {
  /** Row uuid — the stable React key (never shown). */
  id: string;
  /** Human code (e.g. LIFT-A01) — the ".num" id line (migration 0034, B-110). */
  code: string;
  /** Real asset name (migration 0034, B-110). */
  name: string;
  /** PM cycle label — rendered verbatim from the wire (a raw stored value, not a key). */
  cycle: string;
  /** Next-due date, ISO "YYYY-MM-DD" (or "" when blank). */
  nextDue: string;
}

/** One derived schedule item (a dated asset that sits on the plan calendar). */
export interface ScheduleItem {
  id: string;
  code: string;
  name: string;
  cycle: string;
  /** Next-due date, ISO "YYYY-MM-DD" (always parseable — undated rows are excluded). */
  nextDue: string;
  /** next_due day-of-month (1-31) — the calendar-day filter + mark key. */
  day: number;
  status: ScheduleStatus;
}

/** Read a string field off an opaque row; "" when absent (mirrors toDashAsset). */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * Narrow an opaque /pm/assets Entity row to a ScheduleAsset. Accepts snake_case
 * (server convention) or camelCase for robustness (mirrors toDashAsset). Missing
 * fields default to "".
 */
export function toScheduleAsset(e: Record<string, unknown>): ScheduleAsset {
  return {
    id: str(e.id),
    code: str(e.code),
    name: str(e.name),
    cycle: str(e.cycle),
    nextDue: str(e.next_due ?? e.nextDue),
  };
}

/** Parse a strict "YYYY-MM-DD" -> [year, month(1-12), day(1-31)] or null. */
function parseISO(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return [y, mo, d];
}

/** Day-of-month (1-31) of an ISO date, or null when malformed. */
export function dayOfMonth(iso: string): number | null {
  const p = parseISO(iso);
  return p ? p[2] : null;
}

/** ISO date `days` after the given ISO date (UTC, tz-safe), or null when malformed. */
function addDaysISO(iso: string, days: number): string | null {
  const p = parseISO(iso);
  if (!p) return null;
  const [y, mo, d] = p;
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  const yy = String(dt.getUTCFullYear()).padStart(4, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Tri-state schedule status for a next_due date relative to today (both ISO
 * "YYYY-MM-DD"): overdue = strictly past-due; due = today..today+14 (the prototype's
 * "next 14 days" window, PM_DUE_WINDOW_DAYS); plan = further out. Lexicographic compare
 * is valid for the fixed ISO shape (string order == chronological order). A blank or
 * malformed next_due (or today) has no status (null).
 */
export function scheduleStatus(nextDue: string, today: string): ScheduleStatus | null {
  if (!parseISO(nextDue) || !parseISO(today)) return null;
  if (nextDue < today) return "overdue";
  const bound = addDaysISO(today, PM_DUE_WINDOW_DAYS);
  if (bound && nextDue <= bound) return "due";
  return "plan";
}

/**
 * Narrow a dated asset into a ScheduleItem, or null when it has no parseable next_due
 * (honest-exclude — the mock never lacked a date, so this only drops bad/blank data,
 * never fabricates one).
 */
export function toScheduleItem(a: ScheduleAsset, today: string): ScheduleItem | null {
  const day = dayOfMonth(a.nextDue);
  const status = scheduleStatus(a.nextDue, today);
  if (day == null || status == null) return null;
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    cycle: a.cycle,
    nextDue: a.nextDue,
    day,
    status,
  };
}

/**
 * The schedule plan list (pm2.jsx PMUpcoming source): every DATED asset sorted by
 * next_due ascending. Undated / unparseable assets are dropped (they cannot sit on a
 * date). `map`+`filter` returns a fresh array, so the sort never mutates the input.
 */
export function scheduleItems(
  assets: readonly ScheduleAsset[],
  today: string,
): ScheduleItem[] {
  return assets
    .map((a) => toScheduleItem(a, today))
    .filter((it): it is ScheduleItem => it !== null)
    .sort((a, b) => (a.nextDue < b.nextDue ? -1 : a.nextDue > b.nextDue ? 1 : 0));
}

/** Status precedence for a shared calendar day (overdue > due > plan). */
function rank(s: ScheduleStatus): number {
  return s === "overdue" ? 3 : s === "due" ? 2 : 1;
}

/**
 * Calendar day marks for the FIXED anchor month (PM_SCHEDULE_YM = June 2026): items
 * whose next_due lands in that month, keyed by day-of-month (1..30) -> worst status.
 * Items in any other month are not shown (the grid is the one fixed month). When two
 * items share a day, the stronger status wins. With a seed whose next_due sits outside
 * June 2026 the map is empty and the grid renders clean (honest, not a bug).
 */
export function scheduleDayMarks(
  items: readonly ScheduleItem[],
): Map<number, ScheduleStatus> {
  const marks = new Map<number, ScheduleStatus>();
  for (const it of items) {
    if (it.nextDue.slice(0, 7) !== PM_SCHEDULE_YM) continue;
    if (it.day < 1 || it.day > PM_SCHEDULE_DAYS) continue;
    const prev = marks.get(it.day);
    if (!prev || rank(it.status) > rank(prev)) marks.set(it.day, it.status);
  }
  return marks;
}

/** Today as an ISO date "YYYY-MM-DD" (mirrors pm-dashboard-rows todayISO). */
export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Format an ISO date to the stacked { day, month-short } + combined `label` the plan
 * list + genWO modal render (pm2.jsx `p.date` / `p.date.split(" ")`). Uses a single
 * th-TH Intl formatter ({ day: "numeric", month: "short" }); `formatToParts` extracts
 * the day + short-month cleanly (no fragile string split). A malformed date yields
 * { day: "", month: "", label: "" } so the view can show an em-dash. The Thai output
 * is produced by Intl at runtime — no Thai literal lives in this source.
 */
export function formatScheduleDate(iso: string): {
  day: string;
  month: string;
  label: string;
} {
  const p = parseISO(iso);
  if (!p) return { day: "", month: "", label: "" };
  const [y, mo, d] = p;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const fmt = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const parts = fmt.formatToParts(dt);
  const day = parts.find((x) => x.type === "day")?.value ?? "";
  const month = parts.find((x) => x.type === "month")?.value ?? "";
  return { day, month, label: fmt.format(dt) };
}
