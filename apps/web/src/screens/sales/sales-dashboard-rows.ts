/*
 * View-model helpers for SalesDashboard (route `sales.dashboard`) — pure, i18n-free,
 * ASCII-only logic ported from pototype/sales-crm.jsx SalesDashboard (L7-179).
 *
 * WHY THIS SCREEN EXISTS NOW. B-222 deferred it on 2026-08-03 because "most of the
 * screen is unbacked". Re-measured against the live stack, most of that is no longer
 * true — the unit-status donut, the funnel and the transfer schedule all have real
 * sources today. What remains genuinely unbacked is narrower and is named below and
 * in B-442, not approximated. This follows the thin-honest rule Wei set for
 * subcon.progress (B-229) and alloc (B-232): port every element an existing read
 * backs, em-dash or drop the rest.
 *
 * WHAT BACKS WHAT:
 *   donut     GET /projects + GET /projects/{id}/hierarchy — every unit node carries
 *             a real `status`, and its five values are exactly the prototype's five
 *             legend rows (empty · built · booked · sold · soldBuilt). Aggregated
 *             across ALL projects, which is what the card's own title claims.
 *   funnel    GET /sales/leads — `stage` is lead|visit|quote|booking|contract, the
 *             prototype's first FIVE stages. The sixth ("transferred") is a sale-side
 *             state and `lead` has no foreign key to `sales_unit`, so how many of
 *             THESE leads transferred is unknowable. The box keeps its place and
 *             shows the honest marker rather than borrowing a number from a different
 *             population.
 *   transfers GET /sales/contracts — `transfer_at` + `contract`, both real columns.
 *   KPIs      cumulative sales, downs collected and awaiting-transfer are real sums
 *             over those contracts. Sales-this-month and walk-in/booking are NOT:
 *             `sales_unit` records no sale date (only created_at, which is the seed's
 *             own stamp) and nothing tracks a walk-in at all.
 *
 * WHAT IS DROPPED, and why it is dropped rather than em-dashed: an element whose
 * ENTIRE content is unbacked is not a field with a missing value, it is a claim the
 * data cannot make.
 *   - the sales-vs-target bar chart: measured across all 89 tables, the only column
 *     named `target` in the database is work_period.target, a subcon acceptance
 *     quantity. There is no sales target anywhere, and the prototype's own series is
 *     a literal array.
 *   - the Top-5 rep card: `sales_unit` has no user column at all, so a sale cannot be
 *     attributed to anybody, and `lead.owner_user_id` cannot bridge it because the
 *     two tables share no key. Both halves of that card are unbacked.
 *   - the activity feed: /audit-log exists but stores the request PATH, so it can say
 *     "read /api/v1/admin/subscribers" and never "closed unit B-12". Different
 *     subject, not a thinner version of the same one.
 * ASCII-only, tokens-free, no Thai/baht (B-073).
 */

/** The five real unit sale statuses (sales-process-rows.ts UnitStatus). */
export type UnitStatus = "empty" | "built" | "booked" | "sold" | "soldBuilt";

/** The prototype's legend order (sales-crm.jsx L74-78), most-advanced first. */
export const UNIT_STATUS_ORDER: readonly UnitStatus[] = [
  "soldBuilt",
  "sold",
  "booked",
  "built",
  "empty",
];

/** The lead pipeline stages the CRM actually tracks, in funnel order. */
export type LeadStage = "lead" | "visit" | "quote" | "booking" | "contract";

/** The prototype's six funnel stages. The last has no lead-side source. */
export const FUNNEL_STAGES: readonly (LeadStage | "transferred")[] = [
  "lead",
  "visit",
  "quote",
  "booking",
  "contract",
  "transferred",
];

/** Read a string field off an opaque value; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque value; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** One contract row as this screen consumes it (GET /sales/contracts, narrowed). */
export interface ContractRow {
  id: string;
  unitId: string;
  customerId: string;
  /** empty|built|booked|sold|soldBuilt as stored. */
  stage: string;
  /** Contract value (stored). */
  contract: number;
  /** Down payment collected against the unit (stored). */
  down: number;
  /** Scheduled transfer date 'YYYY-MM-DD'; "" when not scheduled. */
  transferAt: string;
  currencyCode: string;
}

export function toContract(e: Record<string, unknown>): ContractRow {
  return {
    id: str(e.id),
    unitId: str(e.unit_id ?? e.unitId),
    customerId: str(e.customer_id ?? e.customerId),
    stage: str(e.stage),
    contract: num(e.contract),
    down: num(e.down),
    transferAt: str(e.transfer_at ?? e.transferAt),
    currencyCode: str(e.currency_code ?? e.currencyCode),
  };
}

/** Count units by sale status across every project's hierarchy. */
export function unitStatusCounts(
  nodes: readonly Record<string, unknown>[],
): Record<UnitStatus, number> {
  const out: Record<UnitStatus, number> = {
    empty: 0,
    built: 0,
    booked: 0,
    sold: 0,
    soldBuilt: 0,
  };
  for (const n of nodes) {
    if (str(n.kind) !== "unit") continue;
    const s = str(n.status) as UnitStatus;
    if (s in out) out[s] += 1;
  }
  return out;
}

/** Total units counted (the donut's denominator). */
export function unitTotal(counts: Record<UnitStatus, number>): number {
  return UNIT_STATUS_ORDER.reduce((s, k) => s + counts[k], 0);
}

/**
 * Units sold, for the donut's centre figure.
 *
 * `sold` and `soldBuilt` only — a BOOKED unit is not a sold one. The prototype's
 * caption says "N / M ยูนิตขายแล้ว", and counting bookings into it would inflate the
 * headline number the screen exists to report. This matches unitCounts() in
 * sales-process-rows.ts, which the units grid already uses.
 */
export function unitsSold(counts: Record<UnitStatus, number>): number {
  return counts.sold + counts.soldBuilt;
}

/** Percent of units sold, or null when there are no units to divide by. */
export function soldPct(counts: Record<UnitStatus, number>): number | null {
  const total = unitTotal(counts);
  return total === 0 ? null : (unitsSold(counts) / total) * 100;
}

/** Lead counts per funnel stage. Stages with no leads are a real 0, not absent. */
export function funnelCounts(
  leads: readonly Record<string, unknown>[],
): Record<LeadStage, number> {
  const out: Record<LeadStage, number> = {
    lead: 0,
    visit: 0,
    quote: 0,
    booking: 0,
    contract: 0,
  };
  for (const l of leads) {
    const s = str(l.stage) as LeadStage;
    if (s in out) out[s] += 1;
  }
  return out;
}

/**
 * Conversion of a stage against the top of the funnel, or null when there are no
 * leads at all (a ratio with an empty denominator is not 0%, it is unanswerable).
 */
export function funnelPct(counts: Record<LeadStage, number>, stage: LeadStage): number | null {
  const top = counts.lead;
  return top === 0 ? null : (counts[stage] / top) * 100;
}

/** Sum of contract values — the cumulative-sales KPI. */
export function sumContracts(rows: readonly ContractRow[]): number {
  return rows.reduce((s, r) => s + r.contract, 0);
}

/** Sum of down payments collected. */
export function sumDowns(rows: readonly ContractRow[]): number {
  return rows.reduce((s, r) => s + r.down, 0);
}

/**
 * Units sold but not yet transferred — the "awaiting transfer" KPI.
 *
 * Read off the STAGE, not off transfer_at being in the future: a scheduled date that
 * has passed does not mean the transfer happened, and the stage is what the server
 * moves when it does.
 */
export function awaitingTransfer(rows: readonly ContractRow[]): number {
  return rows.filter((r) => r.stage === "sold").length;
}

/** One row of the transfer schedule. */
export interface TransferRow {
  id: string;
  /** 'YYYY-MM-DD' as stored. */
  date: string;
  unitId: string;
  customerId: string;
  amount: number;
}

/**
 * The next transfers, earliest first.
 *
 * Only rows that HAVE a date: a contract with no scheduled transfer is not a transfer
 * scheduled for an unknown day, it is not on this list at all. Ties break on id so
 * two transfers on one day cannot swap between reads.
 */
export function transferSchedule(rows: readonly ContractRow[], limit = 5): TransferRow[] {
  return rows
    .filter((r) => r.transferAt !== "")
    .sort((a, b) => (a.transferAt === b.transferAt ? (a.id < b.id ? -1 : 1) : a.transferAt < b.transferAt ? -1 : 1))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      date: r.transferAt,
      unitId: r.unitId,
      customerId: r.customerId,
      amount: r.contract,
    }));
}
