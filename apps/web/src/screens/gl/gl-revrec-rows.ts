/*
 * View-model helpers for GLRevenueWIP (gl.revrec) — pure, i18n-free, ASCII-only logic ported from
 * pototype/accounting-extra.jsx GLRevenueWIP (L291-443). Route gl.revrec
 * (docs/extract/NAV-ROUTES.md, section "acct", parent gl).
 *
 * The prototype held both tables in local literals (REVREC_SEED L277-282, WIP_SEED L284-288) and
 * mutated them in place on post/transfer. Section-0 rule 3: those mocks are dropped — every figure
 * comes from the server:
 *   GET /gl/revrec -> { id, project_id, project_name, method, contract_amount, pct, recognized,
 *                       billed, unbilled, currency_code, posted }
 *   GET /gl/wip    -> { id, project_id, project_name, material, subcon, overhead, transferred,
 *                       balance, currency_code }
 *
 * MONEY AUTHORITY (apps/web/CLAUDE.md). Two figures the prototype computed on the client are
 * SERVER-DERIVED here and read straight off the wire, never recomputed:
 *   - `unbilled` (prototype: r.recognized - r.billed)
 *   - `balance`  (prototype: wipBal() = mat + sub + oh - transferred)
 * The one derivation that stays client-side is `due` — the prototype's dueRev() — and it is
 * DISPLAY ONLY: it labels the button ("create JV (1.2M)") and nothing more. The POST sends no
 * amount at all; revrec.ts recomputes it under the transaction. If the two ever disagree the
 * server wins and the operator sees the server's outcome, so a stale `due` can mislabel a button
 * but can never move money.
 *
 * `method` IS NOT RENDERED AS A LABEL HERE, on purpose (B-432). rev_rec.method is a bare `text`
 * column with no enum in the schema, the data dictionary or docs/extract, and the seed writes one
 * invented code ("percent-of-completion") into all four rows while the prototype states four
 * DIFFERENT methods. Mapping the one code onto one of the four prototype labels would be a guess,
 * so methodMeta() reports `known: false` for everything the repo does not define, and the screen
 * renders an em-dash — the honest-null convention, not a fabricated label. When Wei answers B-432
 * the mapping goes in here and nothing else moves.
 * ASCII-only, tokens-free, no Thai/baht (B-073).
 */

/** One recognition row as the table consumes it (narrowed from an opaque wire row). */
export interface RevRecVM {
  id: string;
  projectId: string;
  /** JOINED project name ("" when null/unresolved -> em-dash in the .tsx). */
  projectName: string;
  /** Raw stored method code ("" when null). Deliberately NOT a display label — see B-432. */
  method: string;
  contractAmount: number;
  /** Percent complete, 0-100 as stored. */
  pct: number;
  recognized: number;
  billed: number;
  /** SERVER-derived recognized - billed. Positive = contract asset, negative = contract liability. */
  unbilled: number;
  currencyCode: string;
  posted: boolean;
}

/** One WIP row as the table consumes it (narrowed from an opaque wire row). */
export interface WipVM {
  id: string;
  projectId: string;
  /** JOINED project name ("" when null/unresolved -> em-dash in the .tsx). */
  projectName: string;
  material: number;
  subcon: number;
  overhead: number;
  transferred: number;
  /** SERVER-derived material + subcon + overhead - transferred. */
  balance: number;
  currencyCode: string;
}

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

/** Narrow one opaque wire row to a RevRecVM. */
export function toRevRec(e: Record<string, unknown>): RevRecVM {
  return {
    id: str(e.id),
    projectId: str(e.project_id ?? e.projectId),
    projectName: str(e.project_name ?? e.projectName),
    method: str(e.method),
    contractAmount: num(e.contract_amount ?? e.contractAmount),
    pct: num(e.pct),
    recognized: num(e.recognized),
    billed: num(e.billed),
    unbilled: num(e.unbilled),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    posted: e.posted === true,
  };
}

/** Narrow one opaque wire row to a WipVM. */
export function toWip(e: Record<string, unknown>): WipVM {
  return {
    id: str(e.id),
    projectId: str(e.project_id ?? e.projectId),
    projectName: str(e.project_name ?? e.projectName),
    material: num(e.material),
    subcon: num(e.subcon),
    overhead: num(e.overhead),
    transferred: num(e.transferred),
    balance: num(e.balance),
    currencyCode: str(e.currency_code ?? e.currencyCode),
  };
}

/**
 * The prototype's dueRev(): how much of the contract is recognisable right now.
 *
 * DISPLAY ONLY. The server recomputes this inside the posting transaction, so this exists to
 * decide whether the row shows a button or the "fully recognised" marker, and to put a rounded
 * figure on that button. Clamped at 0 so a row recognised beyond its pct target (legal — pct can
 * be revised down) shows the marker rather than a negative button.
 */
export function dueRev(r: Pick<RevRecVM, "contractAmount" | "pct" | "recognized">): number {
  return Math.max(0, Math.round((r.contractAmount * r.pct) / 100) - r.recognized);
}

/** Rows with something left to recognise — the "waiting for a JV this period" KPI. */
export function dueCount(rows: RevRecVM[]): number {
  return rows.filter((r) => dueRev(r) > 0).length;
}

/** Sum of `recognized` across the rows (KPI: recognised revenue YTD). */
export function sumRecognized(rows: RevRecVM[]): number {
  return rows.reduce((s, r) => s + r.recognized, 0);
}

/**
 * Sum of the POSITIVE unbilled amounts (KPI: contract asset).
 *
 * The prototype clamps each row at 0 before summing, and that is an accounting statement rather
 * than a rounding detail: a negative unbilled is a contract LIABILITY (billed ahead of
 * recognition) and belongs on the other side of the balance sheet, so netting it against the
 * asset would understate both. Kept exactly as the prototype has it.
 */
export function sumUnbilledAsset(rows: RevRecVM[]): number {
  return rows.reduce((s, r) => s + Math.max(0, r.unbilled), 0);
}

/** Sum of the server-derived WIP balances (KPI: WIP outstanding). */
export function sumWipBalance(rows: WipVM[]): number {
  return rows.reduce((s, r) => s + r.balance, 0);
}

/** Sum of amounts already moved to cost of sales (KPI: transferred YTD). */
export function sumTransferred(rows: WipVM[]): number {
  return rows.reduce((s, r) => s + r.transferred, 0);
}

/** Column totals of the WIP table's cost columns (the prototype's tfoot). */
export function wipTotals(rows: WipVM[]): {
  material: number;
  subcon: number;
  overhead: number;
  transferred: number;
  balance: number;
} {
  return {
    material: rows.reduce((s, r) => s + r.material, 0),
    subcon: rows.reduce((s, r) => s + r.subcon, 0),
    overhead: rows.reduce((s, r) => s + r.overhead, 0),
    transferred: sumTransferred(rows),
    balance: sumWipBalance(rows),
  };
}

/** What the "method" cell knows about a stored code. See B-432 for why nothing is known yet. */
export interface MethodMeta {
  /** false -> the screen renders an em-dash instead of inventing a label. */
  known: boolean;
  /** The stored code, passed through for a future mapping/diagnostics. */
  code: string;
}

/**
 * Classify a stored rev_rec.method code.
 *
 * There is no enum to classify against: the schema types the column as bare `text`, the data
 * dictionary and docs/extract define no values, and the only code in existence is one the seed
 * author chose. So this returns known:false for everything, and the screen em-dashes the cell.
 * That is deliberate and is the whole content of B-432 — the moment Wei rules, the cases go here.
 */
export function methodMeta(code: string): MethodMeta {
  return { known: false, code };
}

/**
 * Is this transfer amount acceptable to send?
 *
 * The server re-validates against the remaining balance and 409s an over-transfer (revrec.ts), so
 * this is the form's explanation of the limit, never its enforcement. Mirrors the prototype's
 * WIPTransferForm.save(): a non-number, a non-positive value, or more than the balance is refused.
 */
export function isValidTransfer(amount: number, balance: number): boolean {
  return Number.isFinite(amount) && amount > 0 && amount <= balance;
}
