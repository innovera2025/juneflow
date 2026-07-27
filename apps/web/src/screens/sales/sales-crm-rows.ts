/*
 * Sales CRM lead-register row helpers for SalesCRM (sales.crm, the read-only kanban
 * port) — pure, i18n-free, ASCII-only logic derived from pototype/sales-crm.jsx
 * SalesCRM (L216-301) + LEADS_BY_STAGE (L191-212).
 *
 * The prototype held its pipeline in the local LEADS_BY_STAGE mock (keyed by stage,
 * each lead carrying denormalised display strings: an owner NAME, a 3-state
 * "hot"/"warm"/"cold" warmth, a human lastContact label, a per-lead `days`). PLAN.md
 * §0 rule 3: that mock is dropped as data — the board is the real server register
 * (GET /sales/leads, use-sales-crm.ts) whose opaque Entity wire is
 * (apps/api/src/routes/land-sales.ts leadWire):
 *   { id, name, phone, source, interest, stage, hot, last_contact_at, note,
 *     owner_user_id, days, created_at }   (ordered newest-first server-side).
 *
 * WIRE / HONEST NOTES (never fabricated — see sales-crm.tsx header for the full list):
 *  - hot is a BOOLEAN column. The 3-state warmth (hot/warm/cold, sales-crm.jsx
 *    HOT_TONE) is a NOT-YET-MERGED migration (SA-1), so this module narrows `hot` to a
 *    boolean; the view shows the hot badge only when true and never invents a
 *    warm/cold distinction the wire lacks.
 *  - stage is the 5-stage funnel enum (lead|visit|quote|booking|contract) — the kanban
 *    axis; groupByStage buckets rows under the 5 known stages (an unknown stage value
 *    is dropped, never forced into a column).
 *  - owner_user_id is a raw user uuid — resolved to a name in the view via GET /users
 *    (userNameById, mirroring po-wo-rows.ts vendorNameById), em-dashed when
 *    absent/unresolved (the raw uuid is never leaked).
 *  - last_contact_at is a real date; days is days-in-stage (nullable int). All ASCII
 *    (B-073) — no Thai lives here.
 */

/** The 5 CRM funnel stages, in board order (sales-crm.jsx `stages`). The kanban axis. */
export const LEAD_STAGES = ["lead", "visit", "quote", "booking", "contract"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** A CRM lead as the board consumes it (GET /sales/leads row, narrowed from the wire). */
export interface LeadRow {
  id: string;
  name: string;
  phone: string;
  source: string;
  interest: string;
  /** Raw stage value (normally one of LEAD_STAGES; kept as string for robustness). */
  stage: string;
  /** Priority flag (boolean wire column; 3-state warmth is a not-yet-merged migration). */
  hot: boolean;
  /** Last-contact date (ISO), or "" when the column is null. */
  lastContactAt: string;
  note: string;
  /** Owning sales user uuid; resolved to a name via userNameById (em-dash when unresolved). */
  ownerUserId: string;
  /** Days-in-stage (nullable) — drives the "overdue" (days > 3) contact-date accent. */
  days: number | null;
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Narrow a truthy wire value to a boolean (accepts true / "true" / 1 / "1"). */
function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/** Parse an integer field; null when absent/non-finite (days is a nullable column). */
function intOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Narrow an opaque /sales/leads Entity row to the LeadRow the board needs. Accepts
 * snake_case (server convention) or camelCase for robustness (mirrors toAssetRow).
 * Missing string fields default to "" (never undefined); days defaults to null.
 */
export function toLeadRow(e: Record<string, unknown>): LeadRow {
  return {
    id: str(e.id),
    name: str(e.name),
    phone: str(e.phone),
    source: str(e.source),
    interest: str(e.interest),
    stage: str(e.stage),
    hot: bool(e.hot),
    lastContactAt: str(e.last_contact_at ?? e.lastContactAt),
    note: str(e.note),
    ownerUserId: str(e.owner_user_id ?? e.ownerUserId),
    days: intOrNull(e.days),
  };
}

/** True when `s` is one of the 5 known funnel stages. */
export function isLeadStage(s: string): s is LeadStage {
  return (LEAD_STAGES as readonly string[]).includes(s);
}

/**
 * Bucket leads under the 5 known stages, preserving input order (the server already
 * ordered newest-first). A row whose stage is not one of LEAD_STAGES is dropped — it
 * is never forced into a column (honest; no fabricated placement).
 */
export function groupByStage(rows: readonly LeadRow[]): Record<LeadStage, LeadRow[]> {
  const out: Record<LeadStage, LeadRow[]> = {
    lead: [],
    visit: [],
    quote: [],
    booking: [],
    contract: [],
  };
  for (const r of rows) {
    if (isLeadStage(r.stage)) out[r.stage].push(r);
  }
  return out;
}

/**
 * Count of hot leads — the real hot-follow KPI value (sales.crm.kpiHotFollow),
 * replacing the mock literal 12 (C10: derive from the real query, never hardcode).
 */
export function countHot(rows: readonly LeadRow[]): number {
  return rows.reduce((n, r) => n + (r.hot ? 1 : 0), 0);
}

/** A tenant user reduced to the id -> name resolution it feeds (GET /users row). */
export interface UserRef {
  id: string;
  name: string;
}

/** Narrow an opaque /users Entity row to a UserRef (mirrors po-wo-rows toVendorRef). */
export function toUserRef(e: Record<string, unknown>): UserRef {
  return { id: str(e.id), name: str(e.name) };
}

/**
 * Build a user id -> name map for owner resolution (mirrors po-wo-rows.ts
 * vendorNameById). Blank ids are skipped; the view em-dashes any id absent from the
 * map (never leaking the raw uuid).
 */
export function userNameById(users: readonly UserRef[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of users ?? []) if (u.id) map.set(u.id, u.name);
  return map;
}
