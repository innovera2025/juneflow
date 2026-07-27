/*
 * After-Sales Service ticket-register row helpers for AfterSalesService (route
 * sales.service, the WRITE port) — pure, i18n-free, ASCII-only logic derived from
 * pototype/sales-service.jsx AfterSalesService + TicketDetail + NewTicketForm.
 *
 * The prototype held its register in the local SERVICE_TICKETS mock (each ticket
 * carrying denormalised display strings: a unit CODE, a customer NAME, an assignee
 * NAME, a mock human date, a mock warranty-months integer, a mock rating). PLAN.md §0
 * rule 3: that mock is dropped as data — the register is the real server register
 * (GET /sales/service, use-sales-service.ts) whose opaque Entity wire is
 * (apps/api/src/routes/sales-service.ts ticketWire):
 *   { id, no, unit_id, customer_id, channel, category, title, priority, status,
 *     assignee_user_id, opened_date, scheduled_date, warranty,
 *     warranty_months_remaining, created_at }   (ordered newest-first server-side).
 *
 * WIRE / HONEST NOTES (never fabricated — see sales-service.tsx header for the full
 * list):
 *  - status is the SV-3 linear machine (received -> scheduled -> fixing -> fixed ->
 *    closed). nextTransition() returns the ONE valid next action-op per status (or
 *    null for closed/unknown) — the view offers only that button (no illegal jumps).
 *  - warranty_months_remaining is the SERVER-DERIVED number (SV-2, read-time from the
 *    sold unit's transfer_at + 12mo); null when the wire cannot supply it -> em-dash.
 *    warranty is the covered/expired boolean flag (serialized as-is).
 *  - unit_id / customer_id / assignee_user_id are raw uuids. customer_id + assignee
 *    resolve to a NAME via GET /customers + GET /users (nameById); unit_id has NO clean
 *    label source (project_node uuid; bookings carry no unit label, the hierarchy needs
 *    a per-project fetch) -> ALWAYS em-dashed (the raw uuid is never leaked).
 *  - rating has NO column (close ignores the client rating) -> the view em-dashes it,
 *    never a fabricated star score.
 *  All ASCII (B-073) — no Thai lives here.
 */

/** The 5 service-ticket statuses, in machine order (sales-service.jsx SVC_STATUS). */
export const SERVICE_STATUSES = [
  "received",
  "scheduled",
  "fixing",
  "fixed",
  "closed",
] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/** 1-based timeline step per status (SVC_STATUS `step`) — the detail-modal progress. */
export const STATUS_STEP: Record<ServiceStatus, number> = {
  received: 1,
  scheduled: 2,
  fixing: 3,
  fixed: 4,
  closed: 5,
};

/** The 3 priority levels (sales-service.jsx PRIO_COLOR). */
export const PRIORITIES = ["high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** The 4 list tabs (sales-service.jsx TabBar): active / all / high / closed. */
export const SERVICE_TABS = ["active", "all", "high", "closed"] as const;
export type ServiceTab = (typeof SERVICE_TABS)[number];

/** The status action-op that advances a ticket to its next state (SV-3). */
export type TransitionOp = "schedule" | "start" | "fix" | "close";

/** A service ticket as the screen consumes it (GET /sales/service row, narrowed). */
export interface TicketRow {
  id: string;
  no: string;
  /** Sold-unit project_node uuid — NO clean label source, so always em-dashed. */
  unitId: string;
  /** Buyer customer uuid; resolved to a name via nameById (em-dash when unresolved). */
  customerId: string;
  channel: string;
  category: string;
  title: string;
  /** Raw priority value (normally one of PRIORITIES; kept as string for robustness). */
  priority: string;
  /** Raw status value (normally one of SERVICE_STATUSES; kept as string). */
  status: string;
  /** Assigned technician user uuid; resolved to a name via nameById (em-dash else). */
  assigneeUserId: string;
  /** Intake date (ISO YYYY-MM-DD), or "" when null. */
  openedDate: string;
  /** Scheduled visit date (ISO YYYY-MM-DD), or "" when not yet scheduled. */
  scheduledDate: string;
  /** Covered/expired boolean flag (the wire column, serialized as-is). */
  warranty: boolean;
  /** Server-derived remaining warranty months (SV-2); null when the wire lacks it. */
  warrantyMonthsRemaining: number | null;
  createdAt: string;
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Narrow a truthy wire value to a boolean (accepts true / "true" / 1 / "1"). */
function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/** Parse an integer field; null when absent/non-finite (warranty months is nullable). */
function intOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Narrow an opaque /sales/service Entity row to the TicketRow the screen needs.
 * Accepts snake_case (server convention) or camelCase for robustness (mirrors
 * toLeadRow). Missing string fields default to "" (never undefined); warranty months
 * default to null; the warranty flag defaults to false.
 */
export function toTicketRow(e: Record<string, unknown>): TicketRow {
  return {
    id: str(e.id),
    no: str(e.no),
    unitId: str(e.unit_id ?? e.unitId),
    customerId: str(e.customer_id ?? e.customerId),
    channel: str(e.channel),
    category: str(e.category),
    title: str(e.title),
    priority: str(e.priority),
    status: str(e.status),
    assigneeUserId: str(e.assignee_user_id ?? e.assigneeUserId),
    openedDate: str(e.opened_date ?? e.openedDate),
    scheduledDate: str(e.scheduled_date ?? e.scheduledDate),
    warranty: bool(e.warranty),
    warrantyMonthsRemaining: intOrNull(
      e.warranty_months_remaining ?? e.warrantyMonthsRemaining,
    ),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/** True when `s` is one of the 5 known service statuses. */
export function isServiceStatus(s: string): s is ServiceStatus {
  return (SERVICE_STATUSES as readonly string[]).includes(s);
}

/** True when `p` is one of the 3 known priorities. */
export function isPriority(p: string): p is Priority {
  return (PRIORITIES as readonly string[]).includes(p);
}

/**
 * The single valid next transition for a ticket status (SV-3 linear machine):
 *   received -> schedule -> scheduled -> start -> fixing -> fix -> fixed -> close ->
 *   closed. Returns null for `closed` (terminal) or any unknown status — the view then
 *   offers NO advance button (never an illegal jump). The backend folds the predecessor
 *   into the UPDATE WHERE, so a stale click 409s; this is only the FE affordance gate.
 */
export function nextTransition(
  status: string,
): { op: TransitionOp; next: ServiceStatus } | null {
  switch (status) {
    case "received":
      return { op: "schedule", next: "scheduled" };
    case "scheduled":
      return { op: "start", next: "fixing" };
    case "fixing":
      return { op: "fix", next: "fixed" };
    case "fixed":
      return { op: "close", next: "closed" };
    default:
      return null; // closed (terminal) or unknown -> no advance
  }
}

/**
 * Filter the register for a list tab (sales-service.jsx AfterSalesService.filtered):
 *   active -> every non-closed ticket; all -> everything; high -> priority==="high";
 *   closed -> status==="closed".
 */
export function filterByTab(
  rows: readonly TicketRow[],
  tab: ServiceTab,
): TicketRow[] {
  switch (tab) {
    case "active":
      return rows.filter((r) => r.status !== "closed");
    case "high":
      return rows.filter((r) => r.priority === "high");
    case "closed":
      return rows.filter((r) => r.status === "closed");
    case "all":
    default:
      return [...rows];
  }
}

/** Real per-tab count (the tab badge value, C10 — replaces the prototype literals). */
export function tabCount(rows: readonly TicketRow[], tab: ServiceTab): number {
  return filterByTab(rows, tab).length;
}

/** Real count of tickets in a given status (drives the received/fixing KPIs, C10). */
export function countByStatus(rows: readonly TicketRow[], status: ServiceStatus): number {
  return rows.reduce((n, r) => n + (r.status === status ? 1 : 0), 0);
}

/** A tenant customer/user reduced to the id -> name resolution it feeds. */
export interface NameRef {
  id: string;
  name: string;
}

/** Narrow an opaque /customers or /users Entity row to a NameRef (both carry name). */
export function toRef(e: Record<string, unknown>): NameRef {
  return { id: str(e.id), name: str(e.name) };
}

/**
 * Build an id -> name map for customer/assignee resolution (mirrors sales-crm-rows
 * userNameById). Blank ids are skipped; the view em-dashes any id absent from the map
 * (never leaking the raw uuid).
 */
export function nameById(refs: readonly NameRef[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of refs ?? []) if (r.id) map.set(r.id, r.name);
  return map;
}
