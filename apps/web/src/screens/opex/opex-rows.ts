/*
 * Pure narrowing + derivation helpers for OpexBudget (opex web port, THIN-HONEST —
 * Wei B-246 thin-honest). No React/DOM here so the logic is unit-tested in isolation (G3):
 * opex-rows.test.ts covers the 12-month roll-up + the money=SERVER create-body build.
 *
 * The live wire (apps/api/src/routes/opex.ts budgetWire) is the opaque snake_case
 * shape of a real opex_budget row: { id, dept, year, months, currency_code }. `months`
 * is the 12-month BUDGET figure array (a planning INPUT). toOpexRow() narrows it to a
 * typed OpexRow; the derivations (annualTotal / totalBudget / maxMonth) are display
 * roll-ups of the SERVER-owned month figures — never a JV/compute (money = NONE for the
 * read; money = SERVER for the create, which sends only {dept, year, months} and lets the
 * server force currency THB + reject a duplicate dept+year with 409).
 */

/** The opex_budget planning grid is always a 12-month array (Jan..Dec). */
export const MONTHS_IN_YEAR = 12;

/** Typed OpexRow narrowed from the opaque /opex/budgets wire row. */
export interface OpexRow {
  id: string;
  dept: string;
  year: number;
  months: number[];
  currencyCode: string;
}

/** Coerce an unknown to a finite number (a non-number / NaN → 0, never fabricated). */
export function asNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce an unknown to a trimmed string ("" when absent). */
function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Narrow one opaque /opex/budgets row to a typed OpexRow (months always numeric). */
export function toOpexRow(raw: Record<string, unknown>): OpexRow {
  const rawMonths = (raw as { months?: unknown }).months;
  const months = Array.isArray(rawMonths) ? rawMonths.map(asNum) : [];
  return {
    id: asStr(raw.id),
    dept: asStr(raw.dept),
    year: asNum(raw.year),
    months,
    currencyCode: asStr(raw.currency_code) || "THB",
  };
}

/**
 * annualTotal — the row's whole-year budget = Σ of its (up to 12) monthly figures. A
 * display roll-up of the server-owned month numbers (the ONLY money the read shows).
 */
export function annualTotal(months: number[]): number {
  return months.reduce((sum, m) => sum + (Number.isFinite(m) ? m : 0), 0);
}

/** totalBudget — Σ annualTotal across every dept row (the KPI-1 + table-footer total). */
export function totalBudget(rows: OpexRow[]): number {
  return rows.reduce((sum, r) => sum + annualTotal(r.months), 0);
}

/** deptCount — the number of dept budget rows (KPI-1 sub + footer count). */
export function deptCount(rows: OpexRow[]): number {
  return rows.length;
}

/** maxMonth — the largest monthly figure (bar scaling in the per-dept detail modal). */
export function maxMonth(months: number[]): number {
  return months.reduce((max, m) => (m > max ? m : max), 0);
}

/** latestYear — the most recent budget year present (null when empty) for the subtitle. */
export function latestYear(rows: OpexRow[]): number | null {
  if (rows.length === 0) return null;
  return rows.reduce((y, r) => (r.year > y ? r.year : y), rows[0]!.year);
}

/** Stable order mirroring the server (year asc, then dept asc) so the grid is deterministic. */
export function sortRows(rows: OpexRow[]): OpexRow[] {
  return [...rows].sort(
    (a, b) => a.year - b.year || (a.dept < b.dept ? -1 : a.dept > b.dept ? 1 : 0),
  );
}

/** Group-separated thousands, no decimals (ds.jsx fmt) — display formatting only. */
export function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
}

// --- create form (POST /opex/budgets) — money = SERVER ---------------------------

/** The create-form draft: strings while typing; coerced on submit. */
export interface OpexDraft {
  dept: string;
  year: string;
  months: string[];
}

/** A blank draft with 12 empty month cells. */
export function emptyOpexDraft(): OpexDraft {
  return { dept: "", year: "", months: Array.from({ length: MONTHS_IN_YEAR }, () => "") };
}

/** A draft is submittable once it carries a dept and a positive integer year. */
export function draftSubmittable(d: OpexDraft): boolean {
  const yr = Number(d.year);
  return d.dept.trim() !== "" && Number.isFinite(yr) && yr > 0;
}

/**
 * buildOpexBody — the opaque POST /opex/budgets body from a draft. money = SERVER: only
 * {dept, year, months[12]} is sent; currency_code is NEVER included (the server forces
 * THB) and no total/JV is computed client-side. Empty month cells coerce to 0.
 */
export function buildOpexBody(d: OpexDraft): { dept: string; year: number; months: number[] } {
  return {
    dept: d.dept.trim(),
    year: Math.trunc(Number(d.year)),
    months: d.months.slice(0, MONTHS_IN_YEAR).map(asNum),
  };
}
