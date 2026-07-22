/*
 * Tax report row helpers (tax.vat + tax.wht) — pure, i18n-free, ASCII-only logic ported from
 * pototype/tax.jsx TaxVAT/TaxWHT + tax-forms.jsx PND30Form/PND53Form. NO Thai/baht here (B-073);
 * every colour the .tsx paints is an @juneflow/tokens var().
 *
 * The prototype held mock arrays inline (TaxVAT output/input invoices, TaxWHT payee rows). Section-0
 * rule 3: those mock seeds are dropped — the figures come from the real server reports:
 *   GET /tax/reports/vat -> PP30 VAT summary (apps/api/src/routes/tax.ts vatReport)
 *   GET /tax/reports/wht -> PND withholding summary (whtReport)
 * Both are the opaque EntityOk (a SINGLE report object, snake_case), NOT a list envelope — so
 * `unwrap()` yields the report object directly (mirrors gl trial-balance).
 *
 * HONEST DATA GAPS (never fabricated) — see tax.ts for the server notes:
 *   - The VAT wire is AGGREGATE only { output_vat, output_base, input_vat, input_base, net_vat };
 *     there is NO per-invoice list -> the prototype's output/input invoice tables render honest-empty
 *     (an em-dash body), while the KPIs + summary cards carry the REAL Σ figures.
 *   - The WHT wire is AGGREGATE only { pnd3, pnd53, total_wht } (each group = { count, wht, base });
 *     there is NO per-payee list -> the prototype's payee table renders honest-empty, while the KPIs
 *     + the attachment listing form totals carry the REAL group figures.
 *   - PP30 boxes v2/v3 (zero-rated/exempt sales), v10 (carried credit), v13/v14 (surcharge/penalty)
 *     have NO wire field -> they are honest-zero (B-124); the form's row() renders a zero box as an
 *     em-dash automatically.
 *   - The PND3-vs-PND53 split is the SERVER's tax_id-length heuristic (already applied in the wire
 *     groups). classifyWhtForm() mirrors that heuristic for the client (used only where a raw tax_id
 *     is available); it is a documented approximation, never a legal ruling.
 */

/** Read a finite number off an opaque field, else 0 (drizzle numerics arrive as strings). */
export function num(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Read a string field off an opaque row; "" when absent/null. */
export function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** Round to 2 dp (money authority is the server; this only tidies client-derived boxes). */
export function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

// ---------------------------------------------------------------------------
// VAT (PP30) report
// ---------------------------------------------------------------------------

/** The VAT report as the screen consumes it (GET /tax/reports/vat, narrowed). */
export interface VatReport {
  /** Σ ar_invoice.vat — output/sales VAT. */
  outputVat: number;
  /** Σ ar_invoice.amount — output/sales taxable base. */
  outputBase: number;
  /** Σ ap_billing.vat — input/purchase VAT. */
  inputVat: number;
  /** Σ ap_billing.amount — input/purchase base. */
  inputBase: number;
  /** round2(output_vat - input_vat): >0 payable, <0 credit. */
  netVat: number;
  /** Report period "YYYY-MM" where filtered, else "" (all periods). */
  period: string;
  /** Money currency of the figures (server authority, "THB"). */
  currencyCode: string;
}

/** Narrow an opaque /tax/reports/vat Entity to the VatReport the screen needs. */
export function toVatReport(e: Record<string, unknown>): VatReport {
  return {
    outputVat: num(e.output_vat ?? e.outputVat),
    outputBase: num(e.output_base ?? e.outputBase),
    inputVat: num(e.input_vat ?? e.inputVat),
    inputBase: num(e.input_base ?? e.inputBase),
    netVat: num(e.net_vat ?? e.netVat),
    period: str(e.period),
    currencyCode: str(e.currency_code ?? e.currencyCode),
  };
}

/** The empty (all-zero) VAT report — the honest default before the query resolves. */
export const EMPTY_VAT_REPORT: VatReport = {
  outputVat: 0,
  outputBase: 0,
  inputVat: 0,
  inputBase: 0,
  netVat: 0,
  period: "",
  currencyCode: "",
};

/**
 * The 16 numbered PP30 boxes (v1-v16), computed from the VAT report exactly as the RD form does
 * (tax-forms.jsx PND30Form). REAL where the wire has it, HONEST-ZERO where it does not (B-124):
 *   v1  = output base (total sales; the wire has no zero-rated/exempt split)
 *   v2  = zero-rated sales   -> 0 (no wire, honest-zero)
 *   v3  = exempt sales       -> 0 (no wire, honest-zero)
 *   v4  = v1 - v2 - v3 (taxable sales)
 *   v5  = output VAT         v6 = input base        v7 = input VAT
 *   v8  = tax payable this month (net_vat > 0)
 *   v9  = tax overpaid this month (net_vat < 0)
 *   v10 = credit carried forward -> 0 (no wire, honest-zero)
 *   v11 = net tax payable (v8 - v10)      v12 = net tax overpaid (v10 - v8)
 *   v13 = surcharge -> 0     v14 = penalty -> 0     (no wire, honest-zero)
 *   v15 = v11 + v13 + v14     v16 = max(0, v12 - v13 - v14)
 * The zero boxes render as an em-dash in the form (row() shows "—" for a zero box), which is the
 * honest-zero surface the ruling asks for.
 */
export interface VatBoxes {
  v1: number; v2: number; v3: number; v4: number;
  v5: number; v6: number; v7: number; v8: number;
  v9: number; v10: number; v11: number; v12: number;
  v13: number; v14: number; v15: number; v16: number;
}

export function vatBoxes(r: VatReport): VatBoxes {
  const v1 = r.outputBase;
  const v2 = 0;
  const v3 = 0;
  const v4 = round2(v1 - v2 - v3);
  const v5 = r.outputVat;
  const v6 = r.inputBase;
  const v7 = r.inputVat;
  const v8 = r.netVat > 0 ? r.netVat : 0;
  const v9 = r.netVat < 0 ? round2(-r.netVat) : 0;
  const v10 = 0;
  const v11 = v8 > v10 ? round2(v8 - v10) : 0;
  const v12 = v8 < v10 ? round2(v10 - v8) : 0;
  const v13 = 0;
  const v14 = 0;
  const v15 = round2(v11 + v13 + v14);
  const v16 = Math.max(0, round2(v12 - v13 - v14));
  return { v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16 };
}

// ---------------------------------------------------------------------------
// WHT (PND3 / PND53) report
// ---------------------------------------------------------------------------

/** One withholding group's aggregate figures (count of bills, Σ wht, Σ base). */
export interface WhtGroup {
  count: number;
  wht: number;
  base: number;
}

/** The WHT report as the screen consumes it (GET /tax/reports/wht, narrowed). */
export interface WhtReport {
  /** PND3 (individual) group — server heuristic: non-13-digit tax_id. */
  pnd3: WhtGroup;
  /** PND53 (juristic) group — server heuristic: 13-digit tax_id. */
  pnd53: WhtGroup;
  /** Σ of both groups' wht. */
  totalWht: number;
  /** Report period "YYYY-MM" where filtered, else "" (all periods). */
  period: string;
  /** Money currency of the figures (server authority, "THB"). */
  currencyCode: string;
}

/** Narrow one opaque wht group ({ count, wht, base }); missing -> honest zeros. */
function toWhtGroup(value: unknown): WhtGroup {
  const g = (value ?? {}) as Record<string, unknown>;
  return { count: num(g.count), wht: num(g.wht), base: num(g.base) };
}

/** Narrow an opaque /tax/reports/wht Entity to the WhtReport the screen needs. */
export function toWhtReport(e: Record<string, unknown>): WhtReport {
  return {
    pnd3: toWhtGroup(e.pnd3),
    pnd53: toWhtGroup(e.pnd53),
    totalWht: num(e.total_wht ?? e.totalWht),
    period: str(e.period),
    currencyCode: str(e.currency_code ?? e.currencyCode),
  };
}

/** The empty (all-zero) WHT report — the honest default before the query resolves. */
export const EMPTY_WHT_REPORT: WhtReport = {
  pnd3: { count: 0, wht: 0, base: 0 },
  pnd53: { count: 0, wht: 0, base: 0 },
  totalWht: 0,
  period: "",
  currencyCode: "",
};

/** The PND form kind: "3" (individual) | "53" (juristic). */
export type WhtForm = "3" | "53";

/**
 * The PND3-vs-PND53 heuristic (mirrors the server's isCompanyTaxId in tax.ts). A 13-digit tax_id is
 * treated as a juristic company -> "53"; any other (missing/short) -> "3" (individual). HEURISTIC,
 * NOT authoritative — a Thai personal ID is also 13 digits, so this is an approximation the UI must
 * present as a documented split, never a legal ruling. Used only where a raw tax_id is available
 * (the current aggregate wire has already applied this split server-side).
 */
export function classifyWhtForm(taxId: string): WhtForm {
  const digits = taxId.replace(/\D/g, "");
  return digits.length === 13 ? "53" : "3";
}

/** The group for a form kind (drives the attachment listing form's real totals). */
export function whtGroupFor(r: WhtReport, form: WhtForm): WhtGroup {
  return form === "53" ? r.pnd53 : r.pnd3;
}

/** Total number of counted withholding bills across both groups (the "all" tab count). */
export function whtAllCount(r: WhtReport): number {
  return r.pnd3.count + r.pnd53.count;
}

// ---------------------------------------------------------------------------
// Money formatting (ASCII, th-TH grouping — no baht symbol / no Thai digits)
// ---------------------------------------------------------------------------

/**
 * Group a money magnitude with thousands separators and no decimals ("2240000" -> "2,240,000"),
 * matching the prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits + comma
 * only (no baht symbol); non-finite -> "0". Used by the KPIs + summary cards.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Group a money magnitude with thousands separators and exactly 2 decimals ("2240000" ->
 * "2,240,000.00"), matching the RD forms' Intl fmtB (tax-forms.jsx th-TH minimum/maximumFractionDigits
 * 2). ASCII digits + comma + dot only; non-finite -> "0.00". Used by the PP30 / attachment listing forms.
 */
export function formatMoney2(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  const sign = safe < 0 ? "-" : "";
  const fixed = Math.abs(safe).toFixed(2);
  const [int, frac] = fixed.split(".");
  return sign + int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + frac;
}

/**
 * Scale a money magnitude to millions with exactly 2 decimals ("2240000" -> "2.24"), matching the
 * prototype's VAT KPI value (tax.jsx value="2.24" / "0.84" / "1.40"; its "M baht" unit is the i18n
 * subcon.unitMBaht key, never this string). ASCII digits + dot only; non-finite -> "0.00".
 */
export function millions(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  return (safe / 1e6).toFixed(2);
}

/**
 * Scale a money magnitude to thousands with no decimals + thousands grouping ("240000" -> "240"),
 * matching the prototype's WHT total KPI value (tax.jsx value="240"; its "K baht" unit is the i18n
 * tax.unitKB key, never this string). ASCII digits + comma only; non-finite -> "0".
 */
export function thousands(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  const rounded = Math.round(safe / 1e3);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
