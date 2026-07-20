/*
 * GL Posting Inbox row helpers (gl.inbox) — pure, i18n-free, ASCII-only logic ported from
 * pototype/gl.jsx GLPostingInbox (L236-427) + PostingInboxFilter (L438-510).
 *
 * The prototype held the inbox in local state (POST_INBOX, L219-227). Section-0 rule 3: that
 * mock seed is dropped — the list is the real server catalogue (GET /gl/posting-inbox, apps/api/
 * src/routes/gl.ts postingInbox -> gl-posting.ts listGlPostingDocs). The wire row (opaque Entity,
 * snake_case) is:
 *   { source: 'pv'|'rv'|'gr'|'payroll', id, doc_no: string|null, amount: number|null,
 *     currency_code: string|null, posted: boolean, jv_no: string|null, created_at }.
 *
 * HONEST DATA GAPS (never fabricated) — see gl-posting.ts for the full posted-marker note:
 *   - the seed never writes a "table:uuid" jv.source_doc, so on the current data NO doc resolves
 *     as posted: every row is PENDING (posted=false, jv_no=null) and the posted tab/KPI render a
 *     legitimate empty/0 (decision C10, not a bug).
 *   - the prototype's `desc` (description) + `by` (creator) columns have NO wire field -> the
 *     screen em-dashes those cells (this module carries no desc/by).
 *   - `doc_no` is null for pv/rv/payroll (no doc-number column) and real for gr (gr.no) -> the
 *     cell em-dashes on null.
 *   - `amount` is null for gr (it carries a quantity, not money) -> the value cell + the KPI sum
 *     skip nulls honestly.
 *   - the prototype's `scheduled` + `error` statuses are mock-only (no wire) -> deriveStatus only
 *     ever returns 'posted' | 'pending', so those two tabs + their KPIs count 0 / render empty.
 *
 * Every colour the .tsx paints from these rows is an @juneflow/tokens var(); no Thai/baht leaks
 * here (B-073).
 */

/** Derived posting state. The wire has only posted/pending; scheduled/error are mock-only. */
export type InboxStatus = "posted" | "pending";

/** The five prototype tabs. scheduled/error have no wire rows -> always empty/0. */
export type InboxTab = "all" | "pending" | "posted" | "scheduled" | "error";

/** A posting-inbox row as the table consumes it (GET /gl/posting-inbox row, narrowed). */
export interface InboxRow {
  /** Wire source kind (pv/rv/gr/payroll); drives the source tag label + tone. */
  source: string;
  id: string;
  /** Real doc number (gr.no) where present; "" -> the cell em-dashes. */
  docNo: string;
  /** Real money amount where present; null -> the cell em-dashes and the KPI sum skips it. */
  amount: number | null;
  /** Currency of `amount` where present ("" for gr / when absent). */
  currencyCode: string;
  /** True iff a JV posted this doc (source_doc "<table>:<uuid>" ref). */
  posted: boolean;
  /** The posting JV number when posted; "" when pending. */
  jvNo: string;
  /** Row creation timestamp (the only date on the wire). */
  createdAt: string;
  /** Derived: posted ? 'posted' : 'pending'. */
  status: InboxStatus;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row, else null (preserves the honest null gap). */
function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Read a boolean field off an opaque row (true only for a real `true` / "true"). */
function bool(v: unknown): boolean {
  return v === true || v === "true";
}

/** Derived posting state — the wire only ever yields posted/pending (C10). */
export function deriveStatus(posted: boolean): InboxStatus {
  return posted ? "posted" : "pending";
}

/** Narrow an opaque /gl/posting-inbox Entity row to the InboxRow the table needs. */
export function toInboxRow(e: Record<string, unknown>): InboxRow {
  const posted = bool(e.posted);
  return {
    source: str(e.source),
    id: str(e.id),
    docNo: str(e.doc_no ?? e.docNo),
    amount: numOrNull(e.amount),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    posted,
    jvNo: str(e.jv_no ?? e.jvNo),
    createdAt: str(e.created_at ?? e.createdAt),
    status: deriveStatus(posted),
  };
}

/**
 * Source-badge tag (label + tone), mapped from the wire kind. The prototype colour-codes
 * PV (warn) / RV (ok) and falls the rest to the accent tone (gl.jsx L400-404). gr/payroll take
 * the accent (else) branch; a truly unknown kind gets the neutral surface tone. bg/fg are
 * @juneflow/tokens var() references.
 */
export function sourceTag(source: string): { label: string; bg: string; fg: string } {
  switch (source) {
    case "pv":
      return { label: "PV", bg: "var(--warn-soft)", fg: "var(--warn)" };
    case "rv":
      return { label: "RV", bg: "var(--ok-soft)", fg: "var(--ok)" };
    case "gr":
      return { label: "GR", bg: "var(--accent-soft)", fg: "var(--accent)" };
    case "payroll":
      return { label: "Payroll", bg: "var(--accent-soft)", fg: "var(--accent)" };
    default:
      return { label: source.toUpperCase(), bg: "var(--surface-3)", fg: "var(--text-2)" };
  }
}

/** Rows in a tab. all -> every row; pending/posted -> that status; scheduled/error -> [] (no wire). */
export function filterByTab(rows: readonly InboxRow[], tab: InboxTab): InboxRow[] {
  if (tab === "all") return [...rows];
  return rows.filter((r) => r.status === tab);
}

/** Count of rows in a tab (all -> total; scheduled/error -> 0, honest empty). */
export function tabCount(rows: readonly InboxRow[], tab: InboxTab): number {
  return filterByTab(rows, tab).length;
}

/** Count of rows with a derived status. */
export function countByStatus(rows: readonly InboxRow[], status: InboxStatus): number {
  return rows.filter((r) => r.status === status).length;
}

/** Sum of the (non-null) `amount` of rows with a derived status; null amounts are skipped. */
export function sumAmountByStatus(rows: readonly InboxRow[], status: InboxStatus): number {
  return rows.reduce(
    (s, r) => (r.status === status && r.amount != null ? s + r.amount : s),
    0,
  );
}

/** Client-side filter state (only the wire-backed axes: source kind + minimum amount). */
export interface InboxFilter {
  /** Wire source kind, or "" for "all sources". */
  source: string;
  /** Raw minimum-amount input ("" -> no minimum). */
  minAmount: string;
}

/** The empty (no-op) filter. */
export const EMPTY_FILTER: InboxFilter = { source: "", minAmount: "" };

/** Parse the raw min-amount input to a positive number, else 0 (no minimum). */
export function parseMinAmount(raw: string): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** True when any wire-backed filter axis is set (drives the chip toolbar). */
export function isFilterActive(f: InboxFilter): boolean {
  return f.source !== "" || parseMinAmount(f.minAmount) > 0;
}

/**
 * Apply the client-side filter to the loaded rows. A row passes when its source matches (or the
 * filter is "all sources") AND its amount is >= the minimum (rows with a null amount are dropped
 * only when a minimum is set, since they cannot be shown to satisfy it).
 */
export function applyFilter(rows: readonly InboxRow[], f: InboxFilter): InboxRow[] {
  const min = parseMinAmount(f.minAmount);
  return rows.filter((r) => {
    if (f.source !== "" && r.source !== f.source) return false;
    if (min > 0 && (r.amount == null || r.amount < min)) return false;
    return true;
  });
}

/** Distinct source kinds present in the loaded rows (for the filter dropdown), in first-seen order. */
export function distinctSources(rows: readonly InboxRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (r.source !== "" && !seen.has(r.source)) {
      seen.add(r.source);
      out.push(r.source);
    }
  }
  return out;
}

/**
 * Group a money amount with thousands separators ("1000000" -> "1,000,000"), matching the
 * prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits + comma only
 * (no baht symbol / decimals); non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format the row's created_at as an ISO date-time (YYYY-MM-DD HH:mm, UTC — deterministic, ASCII).
 * The prototype showed a Thai buddhist date+time, but that came from a mock `time` field; the wire
 * only exposes created_at (the row-insert timestamp, stored UTC), so the time cell shows that,
 * formatted honestly. Returns "" for a missing/invalid timestamp (the cell then em-dashes).
 */
export function formatTime(createdAt: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16).replace("T", " ");
}
