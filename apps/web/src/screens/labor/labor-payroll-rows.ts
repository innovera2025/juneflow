/*
 * LaborPayroll display helpers (P5-WEB) — pure, i18n-free, ASCII-only logic narrowed from
 * pototype/labor.jsx LaborPayroll (L191-256) + its PAYROLL_SEED (L188-190). No Thai/baht
 * literal lives here (section 0 rule 2/6); the screen supplies every label from i18n keys.
 *
 * The prototype held payroll in a local PAYROLL_SEED array whose rows carried a mock id
 * ("W-001"), name, team, wage, days, ot and computed the net client-side
 * (wageOf = days*wage + ot*(wage/8)*1.5). Section 0 rule 3: that mock + its client money
 * math are dropped — the list is the real server run catalogue (GET /labor/payroll,
 * use-labor.ts) whose payroll wire is
 *   { id, worker_id, period, amount, currency_code, cc_id, created_at }
 *   (apps/api/src/routes/labor.ts payrollWire)
 * The row has NO name/team/day_rate: worker_id is FK-resolved to a WorkerRow via
 * GET /labor/workers (workerById map, identical to how labor-attendance joins its roster);
 * an unresolved worker_id renders an em-dash in the screen (never the raw uuid).
 *
 * money = SERVER (rule): `amount` is the server-authoritative net (posted as a balanced
 * JV Dr 1140 WIP-labor / Cr 1020 bank via POST /labor/payroll/{id}/post). netTotal here is
 * only the Sigma of those authoritative nets for the KPI / footer / confirm total — it NEVER
 * splits or re-derives the money (the days/ot/base-wage/ot-pay breakdown is not on the wire
 * and is em-dashed by the screen, not reconstructed).
 */
import type { WorkerRow } from "./labor-workers-rows";

/** A payroll run as the table + KPIs consume it (GET /labor/payroll row, narrowed). */
export interface PayrollRow {
  /** Server uuid — the POST /labor/payroll/{id}/post target key + React key. */
  id: string;
  /** The worker this run belongs to (join key -> WorkerRow.id). */
  workerId: string;
  /** The accounting period ('YYYY-MM' key) — subtitle grouping. "" when absent. */
  period: string;
  /** SERVER-authoritative net pay in FULL currency units (money -> currencyCode). */
  amount: number;
  /** Currency of `amount`. "" when absent. */
  currencyCode: string;
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid (drizzle numeric = string). */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Narrow an opaque /labor/payroll Entity row to the PayrollRow the screen needs. Fields
 * accept snake_case (server convention, payrollWire) or camelCase for robustness. cc_id and
 * created_at are intentionally not consumed (cc_id has no UI in the prototype; created_at is
 * the server sort key only).
 */
export function toPayrollRow(e: Record<string, unknown>): PayrollRow {
  return {
    id: str(e.id),
    workerId: str(e.worker_id ?? e.workerId),
    period: str(e.period),
    amount: num(e.amount),
    currencyCode: str(e.currency_code ?? e.currencyCode),
  };
}

/* --------------------------------------------------------------------------- */
/* Worker join + aggregates (labor.jsx L191-247)                                 */
/* --------------------------------------------------------------------------- */

/**
 * Index the worker register by id for the worker_id -> name/team/day_rate join (the payroll
 * wire carries no name/team/day_rate). First worker per id wins; blank ids are skipped.
 */
export function workerById(workers: readonly WorkerRow[]): Map<string, WorkerRow> {
  const map = new Map<string, WorkerRow>();
  for (const w of workers) {
    if (w.id && !map.has(w.id)) map.set(w.id, w);
  }
  return map;
}

/**
 * Sigma of the SERVER net amounts across the runs (labor.jsx L194 `total`, but read off the
 * server-authoritative `amount` instead of the mock wageOf). Feeds the kpiTotal KPI, the
 * footer grand total, and the confirm-modal amount. Never re-derives the money split.
 */
export function netTotal(rows: readonly PayrollRow[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

/**
 * The latest period present across the runs — the honest interim "shown period" for the
 * subtitle {period} (the handler sorts created_at desc; periods are 'YYYY-MM' string-
 * sortable). "" when there are no runs -> the subtitle then em-dashes {period}. Mirrors
 * labor-attendance's latestDay: there is no single authoritative period on the wire.
 */
export function latestPeriod(rows: readonly PayrollRow[]): string {
  let max = "";
  for (const r of rows) if (r.period && r.period > max) max = r.period;
  return max;
}
