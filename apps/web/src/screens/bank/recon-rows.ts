/*
 * Bank-reconciliation row helpers for BankReconciliation (P2-WEB-15) — pure,
 * i18n-free, ASCII-only logic ported from pototype/bank.jsx BankReconciliation
 * (L83-156).
 *
 * The prototype held ONE statement with 8 lines in a local array (bank.jsx L84-93)
 * whose match state was a decorative hand-toggle. Juneflow §0 rule: that mock seed is
 * dropped — the data is the real server catalogue:
 *   GET /bank/statements            (apps/api/src/routes/bank.ts listStatements) — each
 *     statement carries the recon KPIs { line_count, matched_count, matched_pct,
 *     bank_balance = Σ signed, book_balance, difference, period, currency_code }.
 *   GET /bank/statements/{id}/lines (listStatementLines) — each line { id, line_date,
 *     description, amount (SIGNED), matched, matched_doc, suggestions }.
 * The seed models one statement PER line (mirroring the mock's 1-line-per-statement
 * layout), so the view aggregates a period's statements back into the prototype's
 * single-statement recon table (activePeriodStatements + reconKpis).
 *
 * HONEST GAPS the screen em-dashes (never fabricated):
 *   - `book_balance` (book balance, per ledger) and `difference` are honest
 *     null on every statement — there is no ledger cash-balance source in this scope
 *     (bank.ts header GAP), so both KPI values em-dash rather than invent a figure.
 *   - `bank_balance` (bank balance) IS real but is the SIGNED sum of the period's
 *     statement-line movements, NOT a full account closing balance — so it will not
 *     equal the prototype's illustrative 18.42 M (flagged in the screen).
 *   - a matched line's linked-doc `ref` is honest null for a pv/rv (no doc-number
 *     column) and for an RV with no seeded row (matched_doc null) — the cell em-dashes
 *     there; a cheque match carries its real `no`.
 * The matched-count, unmatched-count, and matched-percent KPIs ARE real derivations.
 * Every colour is an @juneflow/tokens var(); no Thai/baht leaks here.
 */

/** A statement as the recon KPIs consume it (GET /bank/statements row, narrowed). */
export interface ReconStatement {
  id: string;
  /** Accounting period (e.g. "2569-05"); "" when absent. */
  period: string;
  locked: boolean;
  lineCount: number;
  matchedCount: number;
  /** Matched percent (server), or null when the statement has no lines. */
  matchedPct: number | null;
  /** Σ SIGNED line amounts, FULL baht (real net movement, not a closing balance). */
  bankBalance: number;
  /** Honest null — no ledger cash-balance source (bank.ts GAP). */
  bookBalance: number | null;
  /** Honest null — needs bookBalance to be derivable. */
  difference: number | null;
  currencyCode: string;
  createdAt: string;
}

/** A resolved matched doc, or an auto-match suggestion, on a line. */
export interface DocRef {
  /** "pv" | "cheque" | "rv". */
  type: string;
  id: string;
  /** Human-readable doc id where the source has one (cheque.no), else "" -> em-dash. */
  ref: string;
  amount: number;
}

/** A statement line as the recon table consumes it (line wire, narrowed). */
export interface ReconLine {
  id: string;
  statementId: string;
  /** Calendar date of the line (nullable); "" when absent -> em-dash. */
  lineDate: string;
  description: string;
  /** SIGNED amount, FULL baht — deposit +, withdrawal −. */
  amount: number;
  currencyCode: string;
  matched: boolean;
  /** The linked doc for a matched line (null when unmatched or the row is absent). */
  matchedDoc: DocRef | null;
  /** Auto-match candidates for an unmatched line (F-BANK1); [] when matched. */
  suggestions: DocRef[];
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

/** Read a nullable numeric field: null stays null, else coerced (invalid -> null). */
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Narrow an opaque doc-ref (matched_doc / suggestion) to DocRef; null when absent. */
export function toDocRef(v: unknown): DocRef | null {
  if (v == null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const type = str(o.type);
  const id = str(o.id);
  if (type === "" || id === "") return null;
  return { type, id, ref: str(o.ref), amount: num(o.amount) };
}

/** Narrow an opaque /bank/statements Entity row to a ReconStatement. */
export function toReconStatement(e: Record<string, unknown>): ReconStatement {
  return {
    id: str(e.id),
    period: str(e.period),
    locked: e.locked === true,
    lineCount: num(e.line_count ?? e.lineCount),
    matchedCount: num(e.matched_count ?? e.matchedCount),
    matchedPct: numOrNull(e.matched_pct ?? e.matchedPct),
    bankBalance: num(e.bank_balance ?? e.bankBalance),
    bookBalance: numOrNull(e.book_balance ?? e.bookBalance),
    difference: numOrNull(e.difference),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/** Narrow an opaque statement-line Entity row to a ReconLine. */
export function toReconLine(e: Record<string, unknown>): ReconLine {
  const suggestionsRaw = Array.isArray(e.suggestions) ? e.suggestions : [];
  return {
    id: str(e.id),
    statementId: str(e.statement_id ?? e.statementId),
    lineDate: str(e.line_date ?? e.lineDate),
    description: str(e.description),
    amount: num(e.amount),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    matched: e.matched === true,
    matchedDoc: toDocRef(e.matched_doc ?? e.matchedDoc),
    suggestions: suggestionsRaw
      .map((s) => toDocRef(s))
      .filter((s): s is DocRef => s !== null),
  };
}

/**
 * Group a FULL-baht amount with thousands separators, ASCII digits + comma only,
 * no baht / decimals; non-finite -> "0". Preserves a leading minus.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Signed money for a statement line (bank.jsx L138: "+" prefix on deposits). Negative
 * keeps its minus; positive gets a leading "+"; zero renders "0".
 */
export function formatSignedMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const body = formatMoney(n);
  return n > 0 ? `+${body}` : body;
}

/** Millions with 2dp ("18420000" -> "18.42"), prototype KPI value. */
export function formatMillions(n: number): string {
  return (n / 1e6).toFixed(2);
}

/** Token colour for a signed line amount (bank.jsx L138: negative danger, else ok). */
export function amountColor(n: number): string {
  return n < 0 ? "var(--danger)" : "var(--ok)";
}

/** Format a calendar date to ISO (YYYY-MM-DD, deterministic ASCII); "" when invalid. */
export function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Pick the active statement period (the newest statement's period) and the statements
 * in it. The prototype shows a single "Bank Statement · {period}" recon card; the seed
 * models one statement per line all sharing a period, so the view reconstructs that
 * single card by aggregating the newest period's statements. Returns "" period + [] when
 * there are no statements.
 */
export function activePeriodStatements(statements: readonly ReconStatement[]): {
  period: string;
  statements: ReconStatement[];
} {
  if (statements.length === 0) return { period: "", statements: [] };
  const sorted = [...statements].sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bt - at; // newest first
  });
  const period = sorted[0]!.period;
  return { period, statements: sorted.filter((s) => s.period === period) };
}

/** The four recon KPI numbers (bank.jsx L109-114), aggregated across the statements. */
export interface ReconKpis {
  /** Sum of SIGNED line movements, FULL baht (bank balance — real, but net movement). */
  bankBalance: number;
  /** Honest null — no ledger cash-balance source (book balance). */
  bookBalance: number | null;
  /** Honest null — needs bookBalance (difference). */
  difference: number | null;
  lineCount: number;
  matchedCount: number;
  /** lineCount - matchedCount (real). */
  unmatchedCount: number;
  /** matched / total * 100, or null when there are no lines. */
  matchedPct: number | null;
}

/** Aggregate the recon KPIs across a period's statements (bank.jsx L94-113). */
export function reconKpis(statements: readonly ReconStatement[]): ReconKpis {
  const lineCount = statements.reduce((s, r) => s + r.lineCount, 0);
  const matchedCount = statements.reduce((s, r) => s + r.matchedCount, 0);
  return {
    bankBalance: statements.reduce((s, r) => s + r.bankBalance, 0),
    bookBalance: null,
    difference: null,
    lineCount,
    matchedCount,
    unmatchedCount: lineCount - matchedCount,
    matchedPct: lineCount === 0 ? null : Math.round((matchedCount / lineCount) * 100),
  };
}

/** Sort lines newest-first by line_date (the recon table order, bank.jsx STMT order). */
export function sortLinesByDateDesc(lines: readonly ReconLine[]): ReconLine[] {
  return [...lines].sort((a, b) => {
    const at = a.lineDate ? new Date(a.lineDate).getTime() : 0;
    const bt = b.lineDate ? new Date(b.lineDate).getTime() : 0;
    return bt - at;
  });
}

/**
 * The match body for a chosen suggestion — exactly one of pv_id/cheque_id/rv_id keyed
 * by the doc type. An unknown type yields an empty body (the caller guards on it).
 */
export function matchBodyFor(doc: DocRef): {
  pv_id?: string;
  cheque_id?: string;
  rv_id?: string;
} {
  switch (doc.type) {
    case "pv":
      return { pv_id: doc.id };
    case "cheque":
      return { cheque_id: doc.id };
    case "rv":
      return { rv_id: doc.id };
    default:
      return {};
  }
}
