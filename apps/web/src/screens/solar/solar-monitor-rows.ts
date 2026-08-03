/*
 * solar.monitor list-row helpers (read-only) — pure, i18n-free, ASCII-only logic narrowed
 * from pototype/solar.jsx SolarMonitoring (L25-107). The prototype held inverters + O&M
 * tickets in local arrays (L26-38); §0 rule 3 drops that mock — the real server rows are
 *   /solar/inverters : { id, project_id, zone, kw, output_kw, perf, temp, status, created_at }
 *   /solar/om-tickets : { id, inverter_id, no, title, priority, assignee_user_id, status, created_at }
 * (apps/api/src/routes/solar.ts). The live KPIs (current output + installed capacity) are
 * DERIVED from the inverter rows; the other three monitor KPIs are fixed illustrative
 * EPC-model figures with no backend column (rendered verbatim in the screen, not here).
 *
 * STATUS/TONE is code-based (never a Thai literal comparison in .tsx, B-073): the backend
 * stores a status code (seed = "normal"); inverterStatus maps both the seed codes and the
 * prototype codes to a ds.jsx StatusBadge tone + which solar.monitor.status* label key to
 * render. The O&M ticket priority is a raw backend value (seed = a Thai word) rendered as
 * the Tag label with a NEUTRAL tone for all — the wire has no priority CODE to switch on,
 * so a Thai-literal compare is impossible (honest divergence, reported). The ticket status
 * is the raw backend value rendered with a pending tone (the prototype hardcodes pending).
 *
 * assignee_user_id is a raw uuid, resolved to a name via GET /users (userNameById, the
 * sales-crm precedent); an unresolved/absent assignee em-dashes in the screen (never a
 * leaked uuid). No write logic lives here (solar.ts is GET-only; the open-ticket form is a
 * dropped mock, §0 rule 3).
 */
import { str, num, type StatusKind } from "./solar-shared";

/* --------------------------------------------------------------------------- */
/* Inverter row (solar.jsx inverters, L26-33)                                   */
/* --------------------------------------------------------------------------- */

/** An inverter as the monitoring table consumes it (GET /solar/inverters row). */
export interface InverterRow {
  id: string;
  /** Zone / Array label (free text; "" when absent). */
  zone: string;
  /** Rated capacity in kW (server stored; 0 when absent). */
  kw: number;
  /** Instantaneous output in kW (server stored; 0 when absent). */
  outputKw: number;
  /** Performance percentage 0..100 (drives the perf bar + colour). */
  perf: number;
  /** Status code (normal|ok|warn|derating|down|offline, not enumerated). */
  status: string;
}

/** Narrow an opaque /solar/inverters row to InverterRow (snake_case wire / camelCase fallback). */
export function toInverterRow(e: Record<string, unknown>): InverterRow {
  return {
    id: str(e.id),
    zone: str(e.zone),
    kw: num(e.kw),
    outputKw: num(e.output_kw ?? e.outputKw),
    perf: num(e.perf),
    status: str(e.status),
  };
}

/* --------------------------------------------------------------------------- */
/* O&M ticket row (solar.jsx tickets, L34-38)                                   */
/* --------------------------------------------------------------------------- */

/** An O&M ticket as the side card consumes it (GET /solar/om-tickets row). */
export interface TicketRow {
  id: string;
  /** Human ticket number (e.g. "OM-2569-001"). */
  no: string;
  /** Inverter uuid FK — resolved to an asset label via the loaded inverters (omAssetLabel). */
  inverterId: string;
  /** Ticket title / description (raw). */
  title: string;
  /** Priority — a raw backend value (rendered as the Tag label, neutral tone). */
  priority: string;
  /** Assignee user uuid — resolved to a name via GET /users (em-dash when unresolved). */
  assigneeUserId: string;
  /** Status — a raw backend value (rendered with a pending tone). */
  status: string;
}

/** Narrow an opaque /solar/om-tickets row to TicketRow (snake_case wire / camelCase fallback). */
export function toTicketRow(e: Record<string, unknown>): TicketRow {
  return {
    id: str(e.id),
    no: str(e.no),
    inverterId: str(e.inverter_id ?? e.inverterId),
    title: str(e.title),
    priority: str(e.priority),
    assigneeUserId: str(e.assignee_user_id ?? e.assigneeUserId),
    status: str(e.status),
  };
}

/**
 * Resolve a ticket's inverter_id to a display label ("<id> · <zone>", or just the id when the
 * zone is blank), or "" when the FK is absent/unresolved — a real FK join for the O&M view
 * modal's asset row (never leaks a raw uuid, mirrors the assignee resolver). The middot
 * separator is the prototype's own asset string (solar.jsx), ASCII-punctuation, not copy.
 */
export function omAssetLabel(inverterId: string, inverters: readonly InverterRow[]): string {
  if (!inverterId) return "";
  const inv = inverters.find((iv) => iv.id === inverterId);
  if (!inv) return "";
  return inv.zone ? `${inv.id} · ${inv.zone}` : inv.id;
}

/* --------------------------------------------------------------------------- */
/* Live KPI aggregates (solar.jsx totalOut / capacity, L39-40 + L50)            */
/* --------------------------------------------------------------------------- */

/** Sum instantaneous output across inverters, in kW (KPI "current output" numerator). */
export function totalOutputKw(rows: readonly InverterRow[]): number {
  return rows.reduce((s, iv) => s + iv.outputKw, 0);
}

/** Sum rated capacity across inverters, in kW (KPI "current output" sub numerator). */
export function totalCapacityKw(rows: readonly InverterRow[]): number {
  return rows.reduce((s, iv) => s + iv.kw, 0);
}

/** KPI value "current output" in MW to 2dp (solar.jsx (totalOut/1000).toFixed(2), L50). */
export function kpiOutputMw(rows: readonly InverterRow[]): string {
  return (totalOutputKw(rows) / 1000).toFixed(2);
}

/** KPI sub {mw} = installed capacity in MW to 0dp (solar.jsx (capacity/1000).toFixed(0), L50). */
export function kpiInstalledMw(rows: readonly InverterRow[]): string {
  return (totalCapacityKw(rows) / 1000).toFixed(0);
}

/* --------------------------------------------------------------------------- */
/* Status + performance mapping (solar.jsx L75 + L80)                           */
/* --------------------------------------------------------------------------- */

/**
 * Inverter status -> { badge tone kind, which solar.monitor.status* label to render }
 * (solar.jsx L80). Both the seed code ("normal") and the prototype codes resolve:
 *   normal | ok       -> approved + "ok"       (t solar.monitor.statusOk)
 *   warn   | derating -> pending  + "derating" (t solar.monitor.statusDerating)
 *   down   | offline  -> rejected + "offline"  (t solar.monitor.statusOffline)
 *   (default)         -> approved + "ok"
 * Returns a label kind (never Thai) so the .tsx picks the t() key with no literal compare.
 */
export function inverterStatus(status: string): {
  kind: StatusKind;
  label: "ok" | "derating" | "offline";
} {
  switch (status) {
    case "warn":
    case "derating":
      return { kind: "pending", label: "derating" };
    case "down":
    case "offline":
      return { kind: "rejected", label: "offline" };
    case "normal":
    case "ok":
    default:
      return { kind: "approved", label: "ok" };
  }
}

/**
 * Perf-bar fill colour (solar.jsx L75): >=90 ok, >=70 warn, else danger. Token-backed
 * (§0 rule 6). Used for the inline performance bar in the monitoring table.
 */
export function perfColor(perf: number): string {
  if (perf >= 90) return "var(--ok)";
  if (perf >= 70) return "var(--warn)";
  return "var(--danger)";
}

/* --------------------------------------------------------------------------- */
/* Assignee resolver (real FK join, never a raw uuid leak) — sales-crm precedent */
/* --------------------------------------------------------------------------- */

/** A user as the assignee resolver consumes it (GET /users row, narrowed). */
export interface UserRef {
  id: string;
  name: string;
}

/** Narrow an opaque /users row to a UserRef (mirrors sales-crm-rows toUserRef). */
export function toUserRef(e: Record<string, unknown>): UserRef {
  return { id: str(e.id), name: str(e.name) };
}

/**
 * Build a user id -> name map for assignee resolution (mirrors sales-crm-rows
 * userNameById). Blank ids are skipped; the view em-dashes any id absent from the map
 * (never leaking the raw uuid).
 */
export function userNameById(users: readonly UserRef[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of users ?? []) if (u.id) map.set(u.id, u.name);
  return map;
}
