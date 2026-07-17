/*
 * Cheque-register row helpers for BankCheque (P2-WEB-15) — pure, i18n-free,
 * ASCII-only logic ported from pototype/bank.jsx BankCheque (L3-81).
 *
 * The prototype held the register in a local array (bank.jsx L46-52) with
 * denormalised bank/payee/PV strings + hardcoded money. Juneflow §0 rule: that mock
 * seed is dropped — the list is the real server catalogue (GET /bank/cheque,
 * apps/api/src/routes/bank.ts listCheque) of opaque Entity rows narrowed here. The
 * wire carries { id, no, amount, due_date, status, pv_id, pv_no, currency_code,
 * created_at }.
 *
 * HONEST GAPS the screen em-dashes (never fabricated):
 *   - `pv_no` is an honest null on EVERY row (bank.ts: the pv table has no doc-number
 *     column) -> the "PV/RV ref" cell em-dashes. The PV-2026-xxxx refs the
 *     prototype shows are not reconstructable from a pv_id UUID.
 *   - the wire carries NO bank/account and NO payee column for a cheque -> the
 *     "bank / account" and "payee / from" cells em-dash unless a payee is
 *     resolvable via the cheque's pv_id (the view joins GET /ap/pv payee where the
 *     back-linked PV is one of the seeded rows; else honest em-dash).
 *   - the wire carries NO out/in direction and NO cleared-date -> the "cheques issued
 *     this month" + "cheques received" KPIs em-dash (no direction/month partition),
 *     and the per-row wait-days / cleared-date sub-lines are omitted (not fabricated).
 * The by-status KPIs (waiting / cleared / returned counts + their amount subs) and the
 * status badge ARE real derivations off the loaded rows. Every colour is an
 * @juneflow/tokens var() or a prototype-verbatim STATUS hex; no Thai/baht leaks here.
 */

/** A cheque as the register table consumes it (GET /bank/cheque row, narrowed). */
export interface ChequeRow {
  id: string;
  /** Cheque number (real, e.g. "CH-040128"). */
  no: string;
  /** Face value, FULL baht (server system of record). */
  amount: number;
  /** Date on the cheque (nullable); "" when absent -> em-dash. */
  dueDate: string;
  /** Lifecycle status: wait | cleared | returned. */
  status: string;
  /** Back-link to the issuing PV (UUID), or "" -> used to resolve a payee. */
  pvId: string;
  /** Honest null on the wire (pv has no doc-number column) -> "" here. */
  pvNo: string;
  currencyCode: string;
  /** Row creation timestamp. */
  createdAt: string;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Narrow an opaque /bank/cheque Entity row to the ChequeRow the table needs. */
export function toChequeRow(e: Record<string, unknown>): ChequeRow {
  return {
    id: str(e.id),
    no: str(e.no),
    amount: num(e.amount),
    dueDate: str(e.due_date ?? e.dueDate),
    status: str(e.status),
    pvId: str(e.pv_id ?? e.pvId),
    pvNo: str(e.pv_no ?? e.pvNo),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/**
 * Group a FULL-baht amount with thousands separators ("561150" -> "561,150"),
 * matching the prototype's fmt (th-TH maximumFractionDigits 0). ASCII digits + comma
 * only (no baht symbol / decimals); non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Millions with 2dp ("8420000" -> "8.42"), prototype KPI sub caption. */
export function formatMillions(n: number): string {
  return (n / 1e6).toFixed(2);
}

/** Which i18n status label a wire status renders (resolved in the view — no Thai here). */
export type ChequeStatusKind = "cleared" | "wait" | "returned";

/** Narrow the wire status to a known kind (unknown -> "wait", the neutral pending). */
export function chequeStatusKind(status: string): ChequeStatusKind {
  switch (status) {
    case "cleared":
      return "cleared";
    case "returned":
      return "returned";
    default:
      return "wait";
  }
}

/**
 * Status-badge tone (bank.jsx L66-70). bg/fg are @juneflow/tokens var() references.
 * cleared -> ok, wait -> warn, returned -> danger.
 */
export function chequeStatusTone(status: string): { bg: string; fg: string } {
  switch (chequeStatusKind(status)) {
    case "cleared":
      return { bg: "var(--ok-soft)", fg: "var(--ok)" };
    case "returned":
      return { bg: "var(--danger-soft)", fg: "var(--danger)" };
    default:
      return { bg: "var(--warn-soft)", fg: "var(--warn)" };
  }
}

/**
 * The five KPI-card numbers (bank.jsx L17-21). `thisMonthCount` + `receivedCount` are
 * null (honest) — the cheque wire carries no out/in direction and no issue-month
 * partition, so "cheques issued this month" and "cheques received" cannot be derived
 * without fabricating a direction. The waiting / cleared / returned counts + their
 * amount sums ARE real derivations off the loaded rows.
 */
export interface ChequeKpis {
  /** Honest null — needs an out-direction + month partition the wire lacks. */
  thisMonthCount: number | null;
  waitCount: number;
  waitAmount: number;
  clearedCount: number;
  clearedAmount: number;
  returnedCount: number;
  returnedAmount: number;
  /** Honest null — needs an in-direction the wire lacks. */
  receivedCount: number | null;
}

/** Compute the derivable KPI numbers from the loaded rows (bank.jsx L17-21). */
export function chequeKpis(rows: readonly ChequeRow[]): ChequeKpis {
  const byStatus = (kind: ChequeStatusKind) =>
    rows.filter((r) => chequeStatusKind(r.status) === kind);
  const sum = (rs: readonly ChequeRow[]) => rs.reduce((s, r) => s + r.amount, 0);
  const wait = byStatus("wait");
  const cleared = byStatus("cleared");
  const returned = byStatus("returned");
  return {
    thisMonthCount: null,
    waitCount: wait.length,
    waitAmount: sum(wait),
    clearedCount: cleared.length,
    clearedAmount: sum(cleared),
    returnedCount: returned.length,
    returnedAmount: sum(returned),
    receivedCount: null,
  };
}

/**
 * The four TabBar counts (bank.jsx L26-29) — presentational (active fixed, no
 * partition), but honest counts. `out` = all register rows (the wire carries no
 * direction, so every issued cheque falls here); `received` = 0 (no in-direction rows
 * are identifiable, honest — not the mock's 12); wait/returned are by-status.
 */
export interface ChequeTabCounts {
  out: number;
  received: number;
  wait: number;
  returned: number;
}

/** Count rows per tab (bank.jsx L26-29). */
export function chequeTabCounts(rows: readonly ChequeRow[]): ChequeTabCounts {
  return {
    out: rows.length,
    received: 0,
    wait: rows.filter((r) => chequeStatusKind(r.status) === "wait").length,
    returned: rows.filter((r) => chequeStatusKind(r.status) === "returned").length,
  };
}
