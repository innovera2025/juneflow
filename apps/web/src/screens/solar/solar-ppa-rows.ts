/*
 * solar.ppa list-row helpers (read-only) — pure, i18n-free, ASCII-only logic narrowed from
 * pototype/solar.jsx SolarPPA (L110-161). The prototype held the monthly billing rows in a
 * local array (L111-117); §0 rule 3 drops that mock — the real server rows are
 *   /solar/ppa-invoices : { id, project_id, month, mwh, rate, amount, currency_code, status, created_at }
 * (apps/api/src/routes/solar.ts). The YTD revenue KPI + the table footer total are DERIVED
 * from the returned amounts; the other three KPIs (counterparty / FiT rate / COD) are fixed
 * illustrative figures rendered via i18n value-keys in the screen.
 *
 * STATUS: the ppa status enum has NO i18n label keys, so the screen renders the RAW backend
 * value as the badge child; ppaStatusKind maps the code to a ds.jsx tone only (paid ->
 * approved, issued|billed -> pending, else draft). Reported honest divergence: the ppa
 * status labels are a future i18n round.
 */
import { str, num, type StatusKind } from "./solar-shared";

/** A PPA monthly billing row as the table consumes it (GET /solar/ppa-invoices row). */
export interface PpaRow {
  id: string;
  /** Billing period label (free text, e.g. "2569-01"). */
  month: string;
  /** Units sold in MWh (server stored; 0 when absent). */
  mwh: number;
  /** Tariff rate per kWh (server stored; 0 when absent). */
  rate: number;
  /** Billed amount in FULL currency units (money -> currencyCode; 0 when absent). */
  amount: number;
  currencyCode: string;
  /** Status code (paid|issued|billed|..., not enumerated) — drives the badge tone only. */
  status: string;
}

/** Narrow an opaque /solar/ppa-invoices row to PpaRow (snake_case wire / camelCase fallback). */
export function toPpaRow(e: Record<string, unknown>): PpaRow {
  return {
    id: str(e.id),
    month: str(e.month),
    mwh: num(e.mwh),
    rate: num(e.rate),
    amount: num(e.amount),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    status: str(e.status),
  };
}

/** Sum the billed amounts (KPI "revenue YTD" numerator + the tfoot total, solar.jsx L118). */
export function ytdAmount(rows: readonly PpaRow[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

/** KPI value "revenue YTD" in millions to 2dp (solar.jsx (ytd/1e6).toFixed(2), L129). */
export function kpiYtdValue(rows: readonly PpaRow[]): string {
  return (ytdAmount(rows) / 1e6).toFixed(2);
}

/** Tariff-rate display "X.XX" (solar.jsx r.rate.toFixed(2), L147). */
export function rateText(rate: number): string {
  return (Number.isFinite(rate) ? rate : 0).toFixed(2);
}

/**
 * PPA status -> ds.jsx badge tone kind (solar.jsx L149, translated to codes): paid ->
 * approved, issued | billed -> pending, anything else -> draft. The visible LABEL is the
 * raw backend value (no i18n key exists), chosen in the screen; only the tone is here.
 */
export function ppaStatusKind(status: string): StatusKind {
  switch (status) {
    case "paid":
      return "approved";
    case "issued":
    case "billed":
      return "pending";
    default:
      return "draft";
  }
}
