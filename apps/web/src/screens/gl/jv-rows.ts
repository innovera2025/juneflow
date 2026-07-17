/*
 * Journal-voucher row + form helpers for GLJournalVoucher (P2-WEB-13) — pure, i18n-free,
 * ASCII-only logic ported from pototype/gl.jsx GLJournalVoucher (L17-98) + JVCreateForm
 * (L111-213).
 *
 * The prototype held the JVs in local state (JV_LIST, L7-15). §0 rule 3: that mock seed is
 * dropped — the list is the real server catalogue (GET /gl/jv, apps/api/src/routes/gl.ts
 * listJv) of opaque Entity rows narrowed here. The wire carries { id, no, source_doc, memo,
 * amount (= Σ dr = Σ cr, the real balanced total), currency_code, line_count, period_id,
 * status, created_at }. DATA GAPS the screen em-dashes (never fabricates): `status` is an
 * honest null (jv has no status column — the seed drops JV_BOOKS.status), and there is no
 * separate business/posting-date column (the date cell shows the real `created_at`).
 *
 * The create form re-implements the prototype's client-side double-entry guard: the submit
 * is enabled only when Σ dr === Σ cr AND Σ dr > 0 (gl.jsx L118), matching the server
 * invariant (createJv rejects an unbalanced JV with a 400). Every colour is an
 * @juneflow/tokens var() or a prototype-verbatim hex (B-037(a)); no Thai/baht leaks here.
 */

/** A JV as the list table consumes it (GET /gl/jv row, narrowed from opaque). */
export interface JvRow {
  id: string;
  no: string;
  /** Free-text source label (the seed's source; badge text — data, not i18n). */
  sourceDoc: string;
  memo: string;
  /** Balanced total = Σ dr = Σ cr (FULL baht, server system of record). */
  amount: number;
  currencyCode: string;
  lineCount: number;
  periodId: string;
  /** Honest null on the wire (jv has no status column) — "" here -> em-dash cell. */
  status: string;
  /** Row creation timestamp (the only date on the wire; not a separate posting date). */
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

/** Narrow an opaque /gl/jv Entity row to the JvRow the table needs. */
export function toJvRow(e: Record<string, unknown>): JvRow {
  return {
    id: str(e.id),
    no: str(e.no),
    sourceDoc: str(e.source_doc ?? e.sourceDoc),
    memo: str(e.memo),
    amount: num(e.amount),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    lineCount: num(e.line_count ?? e.lineCount),
    periodId: str(e.period_id ?? e.periodId),
    status: str(e.status),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/**
 * Source-badge tone (gl.jsx L84-88, read off the free-text source label). Exact-match the
 * prototype's three known sources, else the accent fallback. bg/fg are @juneflow/tokens
 * var() references except the FA-auto amber which is the prototype-verbatim hex (B-037(a)).
 */
export function sourceTone(source: string): { bg: string; fg: string } {
  if (source === "Manual") return { bg: "var(--surface-3)", fg: "var(--text-2)" };
  if (source === "REM") return { bg: "var(--info-soft)", fg: "var(--info)" };
  if (source === "FA auto") return { bg: "#FEF3C7", fg: "var(--warn)" };
  return { bg: "var(--accent-soft)", fg: "var(--accent)" };
}

/**
 * Group a FULL-baht amount with thousands separators ("1000000" -> "1,000,000"), matching
 * the prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0) and cc-rows.ts
 * formatMoney. ASCII digits + comma only (no baht symbol / decimals); non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format the row's created_at as an ISO date (YYYY-MM-DD, UTC — deterministic, ASCII).
 * The prototype showed a Thai buddhist date, but that came from a mock `date` field; the
 * wire only exposes `created_at` (the row-insert timestamp), so the date cell shows that,
 * formatted honestly. Returns "" for a missing/invalid timestamp (the cell then em-dashes).
 */
export function formatDate(createdAt: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/* ── Create-form (double-entry) helpers ──────────────────────────────────────── */

/** One editable line in the JV create form (dr/cr are the raw string inputs). */
export interface JvLineDraft {
  accountId: string;
  ccId: string;
  dr: string;
  cr: string;
}

/** Parse a raw dr/cr input to a non-negative finite number (blank/invalid -> 0). */
export function parseAmount(raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Round to 2dp the way the server does (avoids float dust in the balance compare). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface JvTotals {
  dr: number;
  cr: number;
  /** Absolute Sigma-dr minus Sigma-cr difference (the prototype's imbalance amount). */
  diff: number;
  /** gl.jsx L118: balanced === Σ dr === Σ cr AND Σ dr > 0. */
  balanced: boolean;
}

/** Σ dr / Σ cr / balance state for the current lines (gl.jsx L116-118). */
export function jvTotals(lines: readonly JvLineDraft[]): JvTotals {
  const dr = round2(lines.reduce((s, l) => s + parseAmount(l.dr), 0));
  const cr = round2(lines.reduce((s, l) => s + parseAmount(l.cr), 0));
  return { dr, cr, diff: Math.abs(round2(dr - cr)), balanced: dr === cr && dr > 0 };
}

/** A line carries data once it has an account or any amount (empty rows are dropped). */
export function isLineFilled(l: JvLineDraft): boolean {
  return l.accountId.trim() !== "" || parseAmount(l.dr) > 0 || parseAmount(l.cr) > 0;
}

/**
 * Compose the opaque POST /gl/jv body from the form state. Only filled lines are sent;
 * cc_id is included only when chosen. The server re-validates balance + tenant ownership,
 * so this shapes the body without re-asserting the invariant (the submit button already
 * gates on jvTotals().balanced).
 */
export function buildJvBody(
  no: string,
  memo: string,
  lines: readonly JvLineDraft[],
): Record<string, unknown> {
  return {
    no: no.trim(),
    memo: memo.trim(),
    lines: lines.filter(isLineFilled).map((l) => {
      const line: Record<string, unknown> = {
        account_id: l.accountId,
        dr: parseAmount(l.dr),
        cr: parseAmount(l.cr),
      };
      if (l.ccId.trim() !== "") line.cc_id = l.ccId;
      return line;
    }),
  };
}
