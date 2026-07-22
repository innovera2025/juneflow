/*
 * Trial-balance row + KPI helpers for GLTrialBalance (gl.trial) — pure, i18n-free,
 * ASCII-only logic ported from pototype/gl.jsx GLTrialBalance (L511-576).
 *
 * The prototype held the trial balance in a local TRIAL mock (gl.jsx L494-509). §0 rule 3:
 * that mock is dropped — the rows are the REAL per-account Dr/Cr sums the server aggregates
 * from jv_line grouped by account (GET /gl/reports/trial-balance, apps/api/src/routes/gl.ts
 * trialBalance). The wire is the opaque EntityOk OBJECT (NOT a B-014 list envelope):
 *   { rows: [{ account_code, account_name, debit, credit }],
 *     totals: { total_debit, total_credit }, currency_code }
 *
 * HONEST DIVERGENCES (never fabricated), documented in gl.ts and surfaced here:
 *   - carry / opening balance: NO wire field (the aggregation is period movement only) -> the
 *     "carry" column em-dashes every row (the .tsx renders DASH; nothing is computed here).
 *   - balance: computed as `debit - credit` (period NET), NOT `carry + debit - credit` as the
 *     prototype's mock did — carry has no wire, so this is a period-net figure, NOT a true
 *     running balance. FLAGGED (F-GL2) so it is never mistaken for a carried-forward balance.
 *   - KPI account-type: the wire carries no explicit account_type column, so the four KPI
 *     groups are derived by account_code PREFIX (the prototype's own code.startsWith heuristic):
 *     '1'=asset, '2'=liability, '4'=revenue, '5'=expense ('3'=equity is NOT a KPI). FLAGGED
 *     (F-GL2) as a code-prefix heuristic pending an explicit account-type on the wire.
 *   - only accounts with jv_line activity appear (gl.ts) — mock-only accounts legitimately do
 *     not show; that is an expected §0 divergence classed honest at G5.
 * ASCII-only, tokens-free, no Thai/baht (B-073).
 */

/** A trial-balance row as the table consumes it (narrowed from the opaque wire row). */
export interface TrialRow {
  accountCode: string;
  accountName: string;
  /** Period Sigma-dr for the account (FULL baht, server system of record). */
  debit: number;
  /** Period Sigma-cr for the account (FULL baht). */
  credit: number;
}

/** The footer totals (real Sigma dr / Sigma cr across every posted leg). */
export interface TrialTotals {
  totalDebit: number;
  totalCredit: number;
}

/** The whole trial balance (the narrowed EntityOk object). */
export interface TrialBalance {
  rows: TrialRow[];
  totals: TrialTotals;
  currencyCode: string;
}

/** Coarse Thai-COA account classification (derived from the leading code digit). */
export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense"
  | "other";

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

/** Round to 2dp the way the server does (avoids float dust in the debit-credit net). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Coerce an unknown to a plain record ({} when it is not an object). */
function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Coerce an unknown to an array ([] when it is not one). */
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Narrow one opaque /gl/reports/trial-balance row to a TrialRow. */
export function toTrialRow(e: Record<string, unknown>): TrialRow {
  return {
    accountCode: str(e.account_code ?? e.accountCode),
    accountName: str(e.account_name ?? e.accountName),
    debit: num(e.debit),
    credit: num(e.credit),
  };
}

/**
 * Narrow the opaque EntityOk object into a TrialBalance. The wire is a single object
 * (unwrap() already stripped the envelope) — NOT a list, so rows/totals are read off the
 * object directly. A missing/empty payload yields no rows, zero totals, and a THB default.
 */
export function toTrialBalance(
  entity: Record<string, unknown> | null | undefined,
): TrialBalance {
  const obj = asRecord(entity);
  const rows = asArray(obj.rows).map((r) => toTrialRow(asRecord(r)));
  const totals = asRecord(obj.totals);
  return {
    rows,
    totals: {
      totalDebit: num(totals.total_debit ?? totals.totalDebit),
      totalCredit: num(totals.total_credit ?? totals.totalCredit),
    },
    currencyCode: str(obj.currency_code ?? obj.currencyCode) || "THB",
  };
}

/**
 * Period NET balance for a row = debit - credit. This is NOT `carry + debit - credit` as the
 * prototype's mock computed — carry has no wire field, so this is a period-net figure, never a
 * carried-forward running balance (F-GL2). Rounded to 2dp to kill float dust.
 */
export function rowBalance(row: TrialRow): number {
  return round2(row.debit - row.credit);
}

/**
 * Thai-COA account classification by the leading code digit — the prototype's own
 * code.startsWith heuristic (gl.jsx L550-551). No explicit account_type is on the wire, so
 * this is a code-prefix derivation (F-GL2).
 */
export function accountType(code: string): AccountType {
  switch (code.trim().charAt(0)) {
    case "1":
      return "asset";
    case "2":
      return "liability";
    case "3":
      return "equity";
    case "4":
      return "revenue";
    case "5":
      return "expense";
    default:
      return "other";
  }
}

/**
 * Dr/Cr suffix for the balance cell, mirroring gl.jsx L559 exactly (with balance = the period
 * NET debit-credit): balance < 0 -> "(Cr)"; else asset -> "(Dr)"; else liability/equity ->
 * "(Cr)"; else "" (revenue/expense/other with a non-negative balance carry no suffix). The
 * prototype's `isLiability` is code prefix "2" OR "3", so equity shares the "(Cr)" branch.
 */
export function balanceSuffix(code: string, balance: number): string {
  if (balance < 0) return "(Cr)";
  const type = accountType(code);
  if (type === "asset") return "(Dr)";
  if (type === "liability" || type === "equity") return "(Cr)";
  return "";
}

/**
 * Sigma (debit - credit) over the accounts whose code prefix maps to `type` — the raw signed
 * KPI total (assets/liabilities sum positive/negative; revenue is credit-normal so it sums
 * negative). The KPI card shows the ABS value in millions (millionsAbs). Equity ('3') is never
 * a KPI group, so it is excluded from every sum.
 */
export function kpiSum(rows: readonly TrialRow[], type: AccountType): number {
  return round2(
    rows.reduce(
      (s, r) => (accountType(r.accountCode) === type ? s + (r.debit - r.credit) : s),
      0,
    ),
  );
}

/**
 * Group a FULL-baht amount with thousands separators ("1000000" -> "1,000,000"), matching the
 * prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0) and jv-rows.formatMoney. ASCII
 * digits + comma only (no baht symbol / decimals); non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * KPI "value in millions", shown ABS with one decimal ("152.1"), mirroring the prototype's
 * GLTrialBalance MiniKpi value format (gl.jsx L529-532 render 1-decimal M-baht figures). The
 * sign is dropped (the card carries the Dr/Cr semantics implicitly per group); non-finite -> 0.
 */
export function millionsAbs(n: number): string {
  const v = Number.isFinite(n) ? Math.abs(n) : 0;
  return (v / 1e6).toFixed(1);
}
