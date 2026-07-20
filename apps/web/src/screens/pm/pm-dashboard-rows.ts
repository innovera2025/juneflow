/*
 * PM Dashboard derivation helpers for PMDashboard (pm.dashboard — the read-only KPI
 * overview) — pure, i18n-free, ASCII-only logic derived from pototype/pm.jsx PMKpi
 * (L74-90) + PMDashboard (L95-150) and pototype/pm2.jsx PMCalendar (L552-590) +
 * PMUpcoming (L592-623).
 *
 * The prototype drove the whole dashboard from local mocks (PM_ASSETS_BY_TYPE,
 * PM_MONTHLY, PM_PLAN_ITEMS, PM_DAY_MARKS + a hardcoded "June 2569" calendar title).
 * PLAN.md section 0 rules 3/4: those mocks are dropped — every value here is derived
 * from the REAL server catalogue:
 *   GET /pm/assets       -> assetWire { id, contract_id, code, name, kind, site,
 *                           cycle, next_due }  (name/code gained columns in migration
 *                           0034, B-110, so they now ride the wire).
 *   GET /pm/workorders   -> workOrderWire { ..., items[{ label, result }] } where
 *                           result in normal|adjust|repair or unset.
 * Nothing is fabricated: an unbacked metric surfaces as an em-dash in the VIEW, so
 * this module returns null / "" / [] for the honest gap (never a guessed number).
 *
 * Wei B-108d (web-side derivation, NO endpoint):
 *   - overdueCount  = assets with next_due < today (REAL).
 *   - compliancePct = 100 * (checklist items result==='normal') / (items with any
 *     result set), 1 decimal (REAL; null when no item has a result yet).
 *   - due/overdue panel = [...overdue, ...dueSoon] by next_due tone, capped at 6.
 *   - upcoming list = every dated asset sorted by next_due ascending.
 *   - calendar marks = current-month assets keyed by day-of-month, tri-state tone.
 * The unbacked KPIs (this-month WO count, pending quotes, cost YTD) need no
 * derivation here — the view renders them as an em-dash (DEFAULTS 2/3/4).
 *
 * ASCII-only (mirrors pm-rows.ts, B-073) — no Thai lives here; the em-dash + every
 * label are the view's (pm-dashboard.tsx).
 */

/** The three filled checklist states that count toward the compliance denominator
 *  (schema pm.ts PmChecklistRow.result). An unfilled item omits `result`. */
const RESULT_SET: ReadonlySet<string> = new Set(["normal", "adjust", "repair"]);

/** A PM asset as the dashboard consumes it (GET /pm/assets row, narrowed from wire). */
export interface DashAsset {
  /** Row uuid — the stable React key (never shown). */
  id: string;
  /** Human code (e.g. LIFT-A01) — the ".num" id line (migration 0034, B-110). */
  code: string;
  /** Real asset name (migration 0034, B-110). */
  name: string;
  /** Equipment kind (lift / pump / ...). */
  kind: string;
  /** PM cycle label (monthly / quarterly / ...). */
  cycle: string;
  /** Next-due date, ISO "YYYY-MM-DD" (or "" when blank). */
  nextDue: string;
}

/** One checklist line as the compliance derivation reads it. */
export interface DashChecklistItem {
  label: string;
  /** "normal" | "adjust" | "repair", or "" when unfilled. */
  result: string;
}

/** A PM work order as the dashboard consumes it (only its checklist items matter). */
export interface DashWo {
  id: string;
  items: DashChecklistItem[];
}

/** Read a string field off an opaque row; "" when absent (mirrors toAssetRow). */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * Narrow an opaque /pm/assets Entity row to a DashAsset. Accepts snake_case (server
 * convention) or camelCase for robustness (mirrors toAssetRow). Missing fields "".
 */
export function toDashAsset(e: Record<string, unknown>): DashAsset {
  return {
    id: str(e.id),
    code: str(e.code),
    name: str(e.name),
    kind: str(e.kind),
    cycle: str(e.cycle),
    nextDue: str(e.next_due ?? e.nextDue),
  };
}

/**
 * Narrow an opaque /pm/workorders Entity row to a DashWo — only its checklist
 * `items` are needed (compliance). A non-array items field yields []; each row keeps
 * its label + result (result "" when unfilled).
 */
export function toDashWo(e: Record<string, unknown>): DashWo {
  const raw = Array.isArray(e.items) ? e.items : [];
  const items: DashChecklistItem[] = raw.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    return { label: str(o.label), result: str(o.result) };
  });
  return { id: str(e.id), items };
}

/** Tri-state schedule tone for a next_due date. */
export type DueTone = "overdue" | "due" | "plan";

/** Same calendar year+month ("2026-07" === "2026-07"). */
function sameYearMonth(a: string, b: string): boolean {
  return a.length >= 7 && b.length >= 7 && a.slice(0, 7) === b.slice(0, 7);
}

/**
 * Tri-state tone for a next_due date relative to today (both ISO "YYYY-MM-DD"):
 *   overdue = past-due   (next_due < today)
 *   due     = this month, today or later (approaching)
 *   plan    = a future month (scheduled ahead)
 * A blank/malformed next_due has no tone (null). Lexicographic compare is valid for
 * the fixed ISO shape (string order == chronological order).
 */
export function dueTone(nextDue: string, today: string): DueTone | null {
  if (!nextDue) return null;
  if (nextDue < today) return "overdue";
  if (sameYearMonth(nextDue, today)) return "due";
  return "plan";
}

/** REAL overdue KPI — assets whose next_due is strictly before today (B-108d). */
export function overdueCount(assets: readonly DashAsset[], today: string): number {
  return assets.filter((a) => a.nextDue !== "" && a.nextDue < today).length;
}

/**
 * Checklist compliance across all work orders (B-108d). DEFAULT 1: "passed" = result
 * 'normal' (vs adjust/repair). Denominator = items with ANY result set — unfilled
 * items are excluded (never counted pass or fail). Returns a 1-decimal string
 * ("91.5"), or null when no item has a result yet (the view then shows an em-dash —
 * an honest empty, not a fabricated 0%/100%).
 */
export function compliancePct(wos: readonly DashWo[]): string | null {
  let filled = 0;
  let passed = 0;
  for (const w of wos) {
    for (const it of w.items) {
      if (RESULT_SET.has(it.result)) {
        filled += 1;
        if (it.result === "normal") passed += 1;
      }
    }
  }
  if (filled === 0) return null;
  return ((100 * passed) / filled).toFixed(1);
}

/** One due/overdue panel row (pm.jsx PMDashboard panel). */
export interface PanelRow {
  id: string;
  code: string;
  name: string;
  nextDue: string;
  tone: "overdue" | "due";
}

/**
 * The "near/overdue PM" panel list: overdue assets first, then due-soon (this-month)
 * assets, capped at 6 (pm.jsx `[...overdue, ...due].slice(0, 6)`). Future-month
 * ("plan") assets are excluded — they surface only in the upcoming list / calendar.
 * Order within each group follows load order (stable). Never mutates the input.
 */
export function duePanelRows(assets: readonly DashAsset[], today: string): PanelRow[] {
  const overdue: PanelRow[] = [];
  const due: PanelRow[] = [];
  for (const a of assets) {
    const tone = dueTone(a.nextDue, today);
    const row = { id: a.id, code: a.code, name: a.name, nextDue: a.nextDue };
    if (tone === "overdue") overdue.push({ ...row, tone });
    else if (tone === "due") due.push({ ...row, tone });
  }
  return [...overdue, ...due].slice(0, 6);
}

/** One upcoming-plan row (pm2.jsx PMUpcoming). */
export interface UpcomingRow {
  id: string;
  code: string;
  name: string;
  cycle: string;
  nextDue: string;
  /** next_due day-of-month (1-31), null when malformed — the calendar-day filter key. */
  day: number | null;
  tone: DueTone;
}

/**
 * The upcoming-plan list: every DATED asset sorted by next_due ascending (pm2.jsx
 * PM_PLAN_ITEMS order). Undated assets are dropped (they cannot sit on a date). Each
 * row carries the next_due day-of-month (calendar-day filter) + its schedule tone.
 * `filter` returns a fresh array, so the sort never mutates the input.
 */
export function upcomingRows(assets: readonly DashAsset[], today: string): UpcomingRow[] {
  return assets
    .filter((a) => a.nextDue !== "")
    .sort((a, b) => (a.nextDue < b.nextDue ? -1 : a.nextDue > b.nextDue ? 1 : 0))
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      cycle: a.cycle,
      nextDue: a.nextDue,
      day: dayOfMonth(a.nextDue),
      tone: dueTone(a.nextDue, today) ?? "plan",
    }));
}

/** Tone precedence for a shared calendar day (overdue > due > plan). */
function rank(t: DueTone): number {
  return t === "overdue" ? 3 : t === "due" ? 2 : 1;
}

/**
 * Calendar day marks for the CURRENT month: assets whose next_due lands in today's
 * month, keyed by day-of-month -> tone (overdue for a past day, due for today or
 * later). Future-month assets are not shown (the grid is a single month). When two
 * assets share a day, the stronger tone wins.
 */
export function calendarMarks(
  assets: readonly DashAsset[],
  today: string,
): Map<number, DueTone> {
  const marks = new Map<number, DueTone>();
  const ym = today.slice(0, 7);
  for (const a of assets) {
    if (a.nextDue === "" || a.nextDue.slice(0, 7) !== ym) continue;
    const day = dayOfMonth(a.nextDue);
    if (day == null) continue;
    const tone = dueTone(a.nextDue, today);
    if (!tone) continue;
    const prev = marks.get(day);
    if (!prev || rank(tone) > rank(prev)) marks.set(day, tone);
  }
  return marks;
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

/** Number of days in today's calendar month (28-31); 31 as a safe fallback. */
export function daysInMonth(today: string): number {
  const p = parseISO(today);
  if (!p) return 31;
  const [y, mo] = p;
  // Day 0 of month (mo) is the last day of month (mo-1) — UTC to avoid tz drift.
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Today as an ISO date "YYYY-MM-DD" (Wei B-108d: new Date().toISOString().slice). */
export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Current-month calendar title, th-TH long-month + Buddhist year (DEFAULT 5). The
 * prototype hardcoded "June 2569" (a mock artifact); we render TODAY's month
 * dynamically via Intl instead of re-translating a fixed Thai string. FLAGGED
 * divergence: the calendar always shows the current month, so a fixed-June visual
 * reference will differ (orch-B may need to re-capture the pm.dashboard reference).
 * Returns "" for a malformed today. th-TH numeric year yields the Buddhist era
 * (e.g. "2569" for 2026), matching the prototype's convention.
 */
export function monthTitle(today: string): string {
  const p = parseISO(today);
  if (!p) return "";
  const [y, mo, d] = p;
  return new Intl.DateTimeFormat("th-TH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, mo - 1, d)));
}

/**
 * Split an ISO date into the stacked { day, month-short } the upcoming list renders
 * (pm2.jsx `p.date.split(" ")`). Month uses th-TH short ("Aug." -> Thai abbrev) via
 * Intl (dynamic locale format, not a re-translated source string — same posture as
 * monthTitle); the day is the raw day-of-month. A malformed date yields
 * { day: "", month: "" } so the view can show an em-dash.
 */
export function formatUpcomingDate(iso: string): { day: string; month: string } {
  const p = parseISO(iso);
  if (!p) return { day: "", month: "" };
  const [y, mo, d] = p;
  const month = new Intl.DateTimeFormat("th-TH", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, mo - 1, d)));
  return { day: String(d), month };
}
