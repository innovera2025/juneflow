/*
 * Pure narrowing + mapping for AuditLog (gate G3, node-testable) — turns the thin
 * GET /audit-log server row into the render shape, with the Wei-ruled honest
 * divergences (2026-07-19) baked in.
 *
 * The prototype (pototype/exec-audit.jsx AUDIT_ENTRIES) carried a rich mock row
 * { t, d, user, role, mod, act, obj, detail, tone }. The backend row is
 * deliberately thinner: { id, user_id, user_name, action, entity, at }
 * (apps/api/src/routes/audit-log.ts). So this module renders ONLY real fields and
 * OMITS role / detail / module-tag / per-row tone — never fabricating them:
 *   - action  -> a label + icon via AUDIT_ACT (3 dedicated audit.* keys + 3
 *               borrows: edit/approve/delete). An unknown action renders the raw
 *               code (labelKey null) with a neutral "doc" icon — no crash, no
 *               invented label.
 *   - entity  -> rendered OPAQUE as-is (an opaque template / "table:uuid" string;
 *               the server has no display-mapping layer — Wei 2026-07-19).
 *   - at      -> HH:mm (UTC, deterministic across host TZ) + an ABSOLUTE day key
 *               "YYYY-MM-DD". No relative "N days ago" label is synthesized
 *               (would reintroduce B-160 relative-time G5 nondeterminism).
 *   - user_name -> passed through; a null (unresolved id) is signalled so the view
 *               falls back to a system-writer i18n label — never hardcoded here.
 */
import type { DictKey } from "@juneflow/i18n";
import type { IconName } from "../../ui/icon";

/** Em-dash placeholder for an un-parseable timestamp (no fabrication). */
export const DASH = "—";

/** The thin GET /audit-log row (contract types it as an opaque Entity). */
export interface AuditServerRow {
  id?: unknown;
  user_id?: unknown;
  user_name?: unknown;
  action?: unknown;
  entity?: unknown;
  at?: unknown;
}

/** Action -> label key + icon. A null labelKey means "render the raw action code". */
export interface ActionMeta {
  readonly labelKey: DictKey | null;
  readonly icon: IconName;
}

/**
 * AUDIT_ACT (pototype/exec-audit.jsx L177-180) — 3 dedicated audit.* keys +
 * 3 borrows (edit/approve/delete map to common.*). Order is the prototype's
 * (drives the filter dropdown option order).
 */
export const AUDIT_ACT: Record<string, ActionMeta> = {
  create: { labelKey: "audit.actCreate", icon: "plus" },
  edit: { labelKey: "common.edit", icon: "edit" },
  approve: { labelKey: "common.approve", icon: "check" },
  delete: { labelKey: "common.delete", icon: "x" },
  post: { labelKey: "audit.actPost", icon: "ledger" },
  sync: { labelKey: "audit.actSync", icon: "sync" },
};

/** The known action codes, in the prototype's order (filter options + tests). */
export const AUDIT_ACTIONS: readonly string[] = Object.keys(AUDIT_ACT);

/** Meta for any action code — unknown codes fall back to a neutral doc icon. */
export function actionMeta(action: string): ActionMeta {
  return AUDIT_ACT[action] ?? { labelKey: null, icon: "doc" };
}

/** The render-ready audit row (all real fields; omitted fields simply absent). */
export interface AuditRow {
  id: string;
  /** Server user_name; null when the acting user no longer resolves (view falls back). */
  userName: string | null;
  /** Raw action code (also the raw fallback label for an unknown action). */
  action: string;
  /** i18n key for the action label, or null when the raw code should be shown. */
  actionLabelKey: DictKey | null;
  actionIcon: IconName;
  /** Opaque entity string, rendered as-is. */
  entity: string;
  /** "HH:mm" (UTC) or DASH when `at` is un-parseable. */
  time: string;
  /** Absolute day key "YYYY-MM-DD" or DASH; groups rows under a stable header. */
  dayKey: string;
}

/** Parse the server `at` into a Date, or null when it is missing/invalid. */
function parseAt(at: unknown): Date | null {
  if (typeof at !== "string" && !(at instanceof Date)) return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Absolute day key "YYYY-MM-DD" (UTC) — deterministic, no relative-time label. */
export function dayKeyOf(at: unknown): string {
  const d = parseAt(at);
  return d ? d.toISOString().slice(0, 10) : DASH;
}

/** "HH:mm" in UTC — deterministic across host timezone (avoids G5 flake). */
export function hhmmOf(at: unknown): string {
  const d = parseAt(at);
  if (!d) return DASH;
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Narrow one thin server row into the render shape (honest fields only). */
export function toAuditRow(raw: AuditServerRow, index: number): AuditRow {
  const action = typeof raw.action === "string" ? raw.action : "";
  const meta = actionMeta(action);
  const userName = typeof raw.user_name === "string" && raw.user_name.length > 0 ? raw.user_name : null;
  const entity = typeof raw.entity === "string" ? raw.entity : "";
  return {
    id: typeof raw.id === "string" ? raw.id : String(index),
    userName,
    action,
    actionLabelKey: meta.labelKey,
    actionIcon: meta.icon,
    entity,
    time: hhmmOf(raw.at),
    dayKey: dayKeyOf(raw.at),
  };
}

/** A day bucket: its absolute-date key + the rows under it (server order preserved). */
export interface AuditDayGroup {
  day: string;
  rows: AuditRow[];
}

/**
 * Group rows by absolute day, preserving the server's newest-first order (both of
 * groups and of rows within a group). Mirrors the prototype's day-grouping, but by
 * an absolute date instead of a relative label.
 */
export function groupByDay(rows: readonly AuditRow[]): AuditDayGroup[] {
  const groups: AuditDayGroup[] = [];
  const byKey = new Map<string, AuditDayGroup>();
  for (const row of rows) {
    let g = byKey.get(row.dayKey);
    if (!g) {
      g = { day: row.dayKey, rows: [] };
      byKey.set(row.dayKey, g);
      groups.push(g);
    }
    g.rows.push(row);
  }
  return groups;
}
