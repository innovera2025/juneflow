/*
 * LaborAttendance display helpers (P5-WEB, read-only) — pure, i18n-free, ASCII-only logic
 * narrowed from pototype/labor.jsx LaborAttendance (L108-185) + its ATT_OPTS config
 * (L103-107). No Thai/baht literal lives here (section 0 rule 2/6).
 *
 * The prototype seeded every active worker to a form default {status:"full", ot:0} in
 * local state (labor.jsx L109-111) and computed the day cost + KPI totals client-side.
 * Section 0 rule 3: those form mechanics are dropped — this is a faithful READ. The roster
 * + the worker_id -> name/team/skill/day_rate join come from GET /labor/workers; the actual
 * per-worker status/ot for the shown day come from GET /labor/attendance
 *   attendanceWire = { id, worker_id, day, ot, status, day_fraction, cc_id, created_at }
 *   (apps/api/src/routes/labor.ts L238-249)
 * The SERVER-DERIVED `day_fraction` (full:1, half:0.5, absent:0) is used as-is for the pay
 * factor — NOT re-derived from ATT_OPTS.f (section spec). cc_id has no UI in the prototype
 * and is ignored (no fabrication).
 *
 * DIVERGENCES (reported, never fabricated):
 *   - SINGLE-DAY SCOPE: the prototype hardcodes one header date; attendance rows carry a
 *     per-row `day` but there is no authoritative header date and no day-picker. The honest
 *     interim (this module) is the LATEST `day` present (latestDay); the day is undefined
 *     when no attendance row exists -> the roster shows honest-empty status. Flagged for a
 *     Wei ruling.
 *   - A worker with no attendance row for the shown day is honest-empty: no status is
 *     selected, OT is em-dash, the day cost is null (em-dash) — never a fabricated default.
 *   - The day cost is a client-side DISPLAY projection (day_rate*day_fraction +
 *     ot*(day_rate/8)*1.5); the authoritative labor money is server POST /labor/payroll.
 *     A null day_rate yields a null cost (em-dash).
 */
import type { WorkerRow } from "./labor-workers-rows";

/** A daily attendance record as the screen consumes it (GET /labor/attendance row). */
export interface AttRecord {
  /** Server uuid — React key only. */
  id: string;
  /** The worker this record belongs to (join key -> WorkerRow.id). */
  workerId: string;
  /** The calendar day (ISO date string, e.g. "2026-07-03"). */
  day: string;
  /** Overtime hours logged. */
  ot: number;
  /** Status code: full | half | absent (drives the status buttons + present/absent). */
  status: string;
  /** SERVER-DERIVED pay factor (full:1, half:0.5, absent:0) — used as-is for the cost. */
  dayFraction: number;
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Narrow an opaque /labor/attendance Entity row to the AttRecord the screen needs. Fields
 * accept snake_case (server convention, attendanceWire) or camelCase for robustness. cc_id
 * and created_at are intentionally not consumed (no UI in the prototype).
 */
export function toAttRecord(e: Record<string, unknown>): AttRecord {
  return {
    id: str(e.id),
    workerId: str(e.worker_id ?? e.workerId),
    day: str(e.day),
    ot: num(e.ot),
    status: str(e.status),
    dayFraction: num(e.day_fraction ?? e.dayFraction),
  };
}

/* --------------------------------------------------------------------------- */
/* Roster + day selection (labor.jsx L109-113)                                   */
/* --------------------------------------------------------------------------- */

/** The active roster (labor.jsx L109 `WORKERS_SEED.filter(active)`). */
export function activeWorkers(workers: readonly WorkerRow[]): WorkerRow[] {
  return workers.filter((w) => w.active);
}

/**
 * The latest `day` present across the records — the honest interim "shown day" (the handler
 * already sorts day desc). "" when there are no records (roster then renders honest-empty).
 */
export function latestDay(records: readonly AttRecord[]): string {
  let max = "";
  for (const r of records) if (r.day && r.day > max) max = r.day;
  return max;
}

/**
 * Index the records for `day` by worker id (first record per worker wins). Empty map when
 * `day` is "" — so a dayless roster shows no selected status anywhere.
 */
export function recordsForDay(records: readonly AttRecord[], day: string): Map<string, AttRecord> {
  const map = new Map<string, AttRecord>();
  if (!day) return map;
  for (const r of records) {
    if (r.day === day && r.workerId && !map.has(r.workerId)) map.set(r.workerId, r);
  }
  return map;
}

/* --------------------------------------------------------------------------- */
/* Day cost + KPI aggregates (labor.jsx L118-121)                                */
/* --------------------------------------------------------------------------- */

/**
 * The client-side DISPLAY day cost (labor.jsx L118): day_rate*day_fraction +
 * ot*(day_rate/8)*1.5, rounded. Returns null (-> em-dash) when there is no record for the
 * shown day or the worker has no day_rate — never a fabricated zero.
 */
export function dayCost(dayRate: number | null, rec: AttRecord | undefined): number | null {
  if (!rec || dayRate == null) return null;
  return Math.round(dayRate * rec.dayFraction + rec.ot * (dayRate / 8) * 1.5);
}

/** Present count (labor.jsx L119): active workers with a record whose status !== absent. */
export function presentCount(workers: readonly WorkerRow[], recMap: Map<string, AttRecord>): number {
  return workers.filter((w) => {
    const r = recMap.get(w.id);
    return r != null && r.status !== "absent";
  }).length;
}

/** Absent count (KPI-Present sub): active workers whose record status === absent. */
export function absentCount(workers: readonly WorkerRow[], recMap: Map<string, AttRecord>): number {
  return workers.filter((w) => recMap.get(w.id)?.status === "absent").length;
}

/** Total OT hours across the roster for the shown day (labor.jsx L121). */
export function totalOt(workers: readonly WorkerRow[], recMap: Map<string, AttRecord>): number {
  return workers.reduce((s, w) => {
    const r = recMap.get(w.id);
    return s + (r ? r.ot : 0);
  }, 0);
}

/** Total day cost across the roster for the shown day (labor.jsx L120); nulls count as 0. */
export function totalCost(workers: readonly WorkerRow[], recMap: Map<string, AttRecord>): number {
  return workers.reduce((s, w) => {
    const c = dayCost(w.dayRate, recMap.get(w.id));
    return s + (c ?? 0);
  }, 0);
}
