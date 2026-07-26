/*
 * Financial-statement view-model helpers for GLStatements (gl.statements) — pure, i18n-free,
 * ASCII-only logic ported from pototype/gl.jsx GLStatements (L582-735: BalanceSheet L644-684 +
 * ProfitLoss L686-735). Route gl.statements (docs/extract/NAV-ROUTES.md L63, section "acct").
 *
 * The prototype held the whole balance sheet + P&L in local literals (fixed Thai row labels and
 * hardcoded 2569/2568 comparative figures). §0 rule 3: those mocks are dropped — every figure is
 * the REAL server aggregation from GET /gl/reports/statements (apps/api/src/routes/gl.ts
 * glStatements L527-624). The wire is the opaque EntityOk OBJECT (NOT a B-014 list envelope):
 *   { balance_sheet: {
 *       assets:      { rows: StmtRow[], subtotal },
 *       liabilities: { rows: StmtRow[], subtotal },
 *       equity:      { rows: StmtRow[], net_income_line: { amount, prior_amount }, subtotal },
 *       total_assets, total_liabilities_equity, prior_total_assets, balanced },
 *     income_statement: {
 *       revenue: { rows: StmtRow[], total, prior_total },
 *       expense: { rows: StmtRow[], total, prior_total },
 *       net_income, prior_net_income },
 *     currency_code }
 *   StmtRow = { account_code, account_name, amount, prior_amount }
 * All amounts are server-signed + round2 (asset/expense debit-normal; liability/equity/revenue
 * credit-normal), and `balanced` is a REAL server equality (assets == liabilities + equity + NI,
 * holding when every JV is balanced — the C9 invariant POST /gl/jv enforces).
 *
 * MONEY AUTHORITY (§0 + apps/web/CLAUDE.md): the server owns 100% of the authoritative figures.
 * The top-level subtotals (liabilities.subtotal, equity.subtotal, revenue.total, expense.total),
 * total_assets, total_liabilities_equity, net_income and the `balanced` flag are read STRAIGHT
 * off the wire — never recomputed here.
 *
 * HONEST DIVERGENCES (never fabricated), documented in gl.ts and surfaced here:
 *   - CURRENT vs NON-CURRENT asset split (F-STMT1): the wire carries ONE `assets` bucket with a
 *     single subtotal, but the prototype BalanceSheet renders two asset sections. The rows are
 *     re-bucketed by account_code prefix ("11" -> current, else -> non-current) — the ONLY
 *     client-side money computation, and only a PRESENTATION re-split of server row amounts. The
 *     two split subtotals sum back to the server `assets.subtotal`; they are a derived display
 *     total, never an authoritative one.
 *   - prior-period column (F-STMT2): every prior_amount / prior_total / prior_total_assets /
 *     prior_net_income is null (all JVs are 2026, period_id NULL — no prior-year data). No prior
 *     figure is invented; the .tsx em-dashes every prior cell.
 *   - honest-empty sections: a bucket with no jv_line activity yields empty rows + a 0 subtotal
 *     (a real 0, not a dropped section) — the section stays structurally present.
 * ASCII-only, tokens-free, no Thai/baht (B-073).
 */

/** One statement row as the table consumes it (narrowed from an opaque wire StmtRow). */
export interface StmtRowVM {
  /** account_code ("" when null — the row still shows via its label). */
  code: string;
  /** account_name — the DB row label (like gl-trial); "" -> em-dash in the .tsx. */
  label: string;
  /** Server-signed amount in FULL baht (system of record). */
  amount: number;
}

/** A plain statement section (assets split / liabilities / revenue / expense). */
export interface StmtSectionVM {
  rows: StmtRowVM[];
  /** Section total. Server-authoritative for liabilities/revenue/expense; a derived
   *  presentation sum for the two asset splits (F-STMT1). */
  subtotal: number;
}

/** The equity section — member rows plus the synthetic "current-period profit" line, whose
 *  label is resolved from i18n in the .tsx (gl.stmt.rowCurrentProfit). */
export interface EquitySectionVM {
  /** equity.rows (share capital / retained earnings, honest-empty in the seed). */
  members: StmtRowVM[];
  /** net_income_line.amount — folded into the section per gl.ts (equity.subtotal already
   *  includes it), rendered as the "current-period profit" row. */
  netIncome: number;
  /** Server equity.subtotal (= equity members + net income). */
  subtotal: number;
}

/** The balance-sheet tab view model. */
export interface BalanceSheetVM {
  /** asset rows with account_code prefix "11" (F-STMT1 client split). */
  currentAssets: StmtSectionVM;
  /** asset rows without the "11" prefix (F-STMT1 client split). */
  nonCurrentAssets: StmtSectionVM;
  /** liabilities.rows + server liabilities.subtotal. */
  currentLiab: StmtSectionVM;
  /** equity members + net-income line + server equity.subtotal. */
  equity: EquitySectionVM;
  /** Server total_assets. */
  totalAssets: number;
  /** Server total_liabilities_equity. */
  totalLiabilitiesEquity: number;
  /** Server balanced flag (a REAL equality, never asserted). */
  balanced: boolean;
}

/** The P&L tab view model. */
export interface ProfitLossVM {
  /** revenue.rows + server revenue.total. */
  revenue: StmtSectionVM;
  /** expense.rows + server expense.total. */
  expense: StmtSectionVM;
  /** Server net_income (revenue.total - expense.total). */
  netIncome: number;
}

/** The whole statements payload (the narrowed EntityOk object). */
export interface StatementsVM {
  balanceSheet: BalanceSheetVM;
  profitLoss: ProfitLossVM;
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

/** Round to 2dp the way the server does (kills float dust in the client asset-split sum). */
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

/** Narrow one opaque wire StmtRow to a StmtRowVM (prior_amount is intentionally dropped —
 *  always null, F-STMT2). */
export function toStmtRow(e: Record<string, unknown>): StmtRowVM {
  return {
    code: str(e.account_code ?? e.accountCode),
    label: str(e.account_name ?? e.accountName),
    amount: num(e.amount),
  };
}

/** True for a CURRENT asset — account_code prefix "11" (F-STMT1 presentation split). */
export function isCurrentAsset(code: string): boolean {
  return code.trim().startsWith("11");
}

/** Sum the row amounts (round2). Used ONLY for the two asset-split subtotals the wire does not
 *  provide (F-STMT1) — never for a server-authoritative total. */
export function sumAmount(rows: readonly StmtRowVM[]): number {
  return round2(rows.reduce((s, r) => s + r.amount, 0));
}

/**
 * Narrow the opaque EntityOk object into a StatementsVM. The wire is a single object (unwrap()
 * already stripped the envelope) — NOT a list, so every branch is read off the object directly.
 * A missing/empty payload yields honest-empty sections, zero totals, an unbalanced flag, and a
 * THB default (nothing is fabricated).
 */
export function toStatements(
  entity: Record<string, unknown> | null | undefined,
): StatementsVM {
  const obj = asRecord(entity);
  const bs = asRecord(obj.balance_sheet ?? obj.balanceSheet);
  const is = asRecord(obj.income_statement ?? obj.incomeStatement);

  // --- balance sheet ---
  const assets = asRecord(bs.assets);
  const assetRows = asArray(assets.rows).map((r) => toStmtRow(asRecord(r)));
  const currentAssetRows = assetRows.filter((r) => isCurrentAsset(r.code));
  const nonCurrentAssetRows = assetRows.filter((r) => !isCurrentAsset(r.code));

  const liabilities = asRecord(bs.liabilities);
  const equity = asRecord(bs.equity);
  const netIncomeLine = asRecord(equity.net_income_line ?? equity.netIncomeLine);

  const balanceSheet: BalanceSheetVM = {
    // F-STMT1: the two asset-split subtotals are DERIVED (client sum), not on the wire.
    currentAssets: { rows: currentAssetRows, subtotal: sumAmount(currentAssetRows) },
    nonCurrentAssets: { rows: nonCurrentAssetRows, subtotal: sumAmount(nonCurrentAssetRows) },
    currentLiab: {
      rows: asArray(liabilities.rows).map((r) => toStmtRow(asRecord(r))),
      subtotal: num(liabilities.subtotal), // server-authoritative
    },
    equity: {
      members: asArray(equity.rows).map((r) => toStmtRow(asRecord(r))),
      netIncome: num(netIncomeLine.amount),
      subtotal: num(equity.subtotal), // server-authoritative (members + net income)
    },
    totalAssets: num(bs.total_assets ?? bs.totalAssets),
    totalLiabilitiesEquity: num(bs.total_liabilities_equity ?? bs.totalLiabilitiesEquity),
    // Never fabricate balance: only a literal server `true` counts as balanced.
    balanced: (bs.balanced ?? false) === true,
  };

  // --- income statement ---
  const revenue = asRecord(is.revenue);
  const expense = asRecord(is.expense);
  const profitLoss: ProfitLossVM = {
    revenue: {
      rows: asArray(revenue.rows).map((r) => toStmtRow(asRecord(r))),
      subtotal: num(revenue.total), // server-authoritative
    },
    expense: {
      rows: asArray(expense.rows).map((r) => toStmtRow(asRecord(r))),
      subtotal: num(expense.total), // server-authoritative
    },
    netIncome: num(is.net_income ?? is.netIncome),
  };

  return {
    balanceSheet,
    profitLoss,
    currencyCode: str(obj.currency_code ?? obj.currencyCode) || "THB",
  };
}

/**
 * Group a FULL-baht amount with thousands separators ("1000000" -> "1,000,000"), matching the
 * prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0) and gl-trial.formatMoney. ASCII
 * digits + comma only (no baht symbol / decimals); non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
