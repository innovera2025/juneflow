/*
 * Cash-flow view-model helpers for GLCashFlow (gl.cashflow) — pure, i18n-free, ASCII-only logic
 * ported from pototype/accounting-extra2.jsx GLCashFlow (L270-340). Route gl.cashflow
 * (docs/extract/NAV-ROUTES.md L65, section "acct").
 *
 * The prototype held the whole statement in local literals (CASHFLOW_DATA — fixed Thai row labels
 * + hardcoded per-period figures, computing net/net-change/closing on the client). §0 rule 3:
 * those mocks are dropped — every figure is the REAL server aggregation from GET
 * /gl/reports/cashflow (apps/api/src/routes/gl.ts cashFlow L684-783). The wire is the opaque
 * EntityOk OBJECT (NOT a B-014 list envelope):
 *   { method: "direct",
 *     operating:  { lines: CfLine[], net },
 *     investing:  { lines: CfLine[], net },
 *     financing:  { lines: CfLine[], net },
 *     opening_cash, net_change, closing_cash,
 *     prior, currency_code }
 *   CfLine = { account_code, account_name, amount }
 *
 * METHOD = DIRECT (B-134 = option A): the server derives each line from real cash-account JV movements and
 * the statement self-reconciles — Sigma(operating.net + investing.net + financing.net) == net_change
 * to the cent (every JV is balanced, C9). All amounts are server-signed + round2.
 *
 * MONEY AUTHORITY (§0 + apps/web/CLAUDE.md): the server owns 100% of the authoritative figures.
 * Every section `net`, opening_cash, net_change and closing_cash is read STRAIGHT off the wire and
 * NEVER recomputed here — the only client work is presentational display-scaling (millions) and
 * sign/parentheses formatting.
 *
 * HONEST DIVERGENCES (never fabricated), documented in gl.ts and surfaced here:
 *   - honest-empty investing / financing: no cash JV against the investing/financing COA codes in
 *     the seed -> the wire returns { lines: [], net: 0 } (a real 0, not a dropped section). The
 *     section stays structurally present (title + net 0, no rows).
 *   - opening_cash = 0: no opening-balance JV exists in the seed, so opening is an honest 0 and
 *     closing_cash == net_change. No opening figure is invented.
 *   - prior period (wire `prior: null`): no prior-year period exists -> intentionally dropped
 *     (the screen asserts no comparative). Never fabricated.
 * ASCII-only, tokens-free, no Thai/baht (B-073).
 */

/** The Unicode MINUS SIGN (U+2212) — matches the prototype's delta sign glyph; ASCII-safe (not
 *  Thai/baht, B-073). */
const MINUS = "−";

/** One cash-flow line as the table consumes it (narrowed from an opaque wire CfLine). */
export interface CfLineVM {
  /** account_code ("" when null — the row still shows via its label). */
  code: string;
  /** account_name — the DB row label; "" -> em-dash in the .tsx. */
  label: string;
  /** Server-signed amount in FULL baht (system of record); negative = cash paid out. */
  amount: number;
}

/** One activity section (operating / investing / financing). */
export interface CfSectionVM {
  lines: CfLineVM[];
  /** Section net — server-authoritative (read straight off the wire, never summed here). */
  net: number;
}

/** The whole cash-flow payload (the narrowed EntityOk object). */
export interface CashFlowVM {
  operating: CfSectionVM;
  investing: CfSectionVM;
  financing: CfSectionVM;
  /** Server opening_cash (honest 0 in the seed). */
  openingCash: number;
  /** Server net_change (== operating.net + investing.net + financing.net; self-reconciling). */
  netChange: number;
  /** Server closing_cash (== opening_cash + net_change). */
  closingCash: number;
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

/** Coerce an unknown to a plain record ({} when it is not an object). */
function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Coerce an unknown to an array ([] when it is not one). */
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Narrow one opaque wire CfLine to a CfLineVM. */
export function toCfLine(e: Record<string, unknown>): CfLineVM {
  return {
    code: str(e.account_code ?? e.accountCode),
    label: str(e.account_name ?? e.accountName),
    amount: num(e.amount),
  };
}

/** Narrow one opaque wire section { lines, net } to a CfSectionVM. Missing/empty -> honest-empty
 *  ({ lines: [], net: 0 }); `net` is read straight off the wire (server-authoritative). */
export function toCfSection(v: unknown): CfSectionVM {
  const obj = asRecord(v);
  return {
    lines: asArray(obj.lines).map((r) => toCfLine(asRecord(r))),
    net: num(obj.net),
  };
}

/**
 * Narrow the opaque EntityOk object into a CashFlowVM. The wire is a single object (unwrap()
 * already stripped the envelope) — NOT a list, so every branch is read off the object directly.
 * A missing/empty payload yields honest-empty sections, zero totals, and a THB default (nothing
 * is fabricated).
 */
export function toCashFlow(
  entity: Record<string, unknown> | null | undefined,
): CashFlowVM {
  const obj = asRecord(entity);
  return {
    operating: toCfSection(obj.operating),
    investing: toCfSection(obj.investing),
    financing: toCfSection(obj.financing),
    openingCash: num(obj.opening_cash ?? obj.openingCash),
    netChange: num(obj.net_change ?? obj.netChange),
    closingCash: num(obj.closing_cash ?? obj.closingCash),
    currencyCode: str(obj.currency_code ?? obj.currencyCode) || "THB",
  };
}

/**
 * Group a FULL-baht amount with thousands separators ("1000000" -> "1,000,000"), matching the
 * prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits + comma only (no baht
 * symbol / decimals); negative keeps a leading "-"; non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Statement-style amount: cash paid out (negative) shows in parentheses "(1,500,000)", cash in
 * shows plain "1,500,000" (prototype accounting-extra2.jsx L286/291 `v < 0 ? (fmt(-v)) : fmt(v)`).
 */
export function formatParen(n: number): string {
  return n < 0 ? `(${formatMoney(-n)})` : formatMoney(n);
}

/**
 * Display-scale a FULL-baht figure to millions with 2dp for the KPI value (prototype `(n/1e6)
 * .toFixed(2)`). A pure presentation scaling — the underlying figure stays server-authoritative.
 */
export function formatMillions(n: number): string {
  return (n / 1e6).toFixed(2);
}

/**
 * The signed net-change delta for the closing-cash KPI sub (prototype `${net >= 0 ? "+" : MINUS}
 * ${fmt(Math.abs(net))}`) — a "+" or a Unicode minus sign prefixing the grouped absolute figure.
 */
export function formatDelta(n: number): string {
  return (n >= 0 ? "+" : MINUS) + formatMoney(Math.abs(n));
}
