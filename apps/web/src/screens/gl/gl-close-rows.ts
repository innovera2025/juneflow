/*
 * GL Period Close row helpers (gl.close) — pure, i18n-free, ASCII-only logic ported from
 * pototype/gl.jsx GLPeriodClose (L741-842).
 *
 * The prototype held everything in local mock state: a hardcoded 10-step `checklist` (L742-753,
 * each with a fabricated done flag + note) and a hardcoded close-history list (L812-816, Thai BE
 * months + a `by`/`date`). Section-0 rule 3: those mocks are dropped as DATA — the real system of
 * record is GET /gl/periods (apps/api/src/routes/gl.ts listPeriods). Its wire row (opaque Entity,
 * snake_case) is:
 *   { id, period: 'YYYY-MM' (CE), locked: boolean, created_at }.
 *
 * HONEST DATA GAPS (never fabricated):
 *   - The close-TARGET period is DERIVED from the wire (the earliest still-open, CE-valid period),
 *     NOT the prototype's hardcoded Buddhist-Era month (gl.jsx L759). The server rejects a
 *     Buddhist-Era year on POST /gl/close-period (isValidCePeriod), so deriveOpenPeriod mirrors it:
 *     only ever names a period the close action can actually lock (else null -> nothing closeable).
 *   - Close history = the LOCKED periods on the wire (newest first). The wire has NO locked_by /
 *     locked_at column, so the "who / when locked" line em-dashes the actor and shows created_at
 *     (the row-insert timestamp — the only date the wire exposes) for the date, honestly.
 *   - The 10 checklist steps are STATIC labels (gl.close.step1..step10); there is NO per-step
 *     completion wire, so the screen renders them all as pending (done-states are presentational,
 *     not fabricated as done). STEP_KEYS below is the label-key list the screen maps over.
 *
 * Every colour the .tsx paints from these rows is an @juneflow/tokens var(); no Thai/baht leaks
 * here (B-073) — the runtime strings all resolve through t() in the .tsx.
 */
import type { DictKey } from "@juneflow/i18n";

/** A GL accounting period as the screen consumes it (GET /gl/periods row, narrowed). */
export interface PeriodRow {
  id: string;
  /** CE 'YYYY-MM' key (a Buddhist-Era-labelled seed row is preserved verbatim, never rewritten). */
  period: string;
  /** True once the period is closed (back-posting into it is rejected 409). */
  locked: boolean;
  /** Row-insert timestamp (the only date the wire exposes); "" when absent. */
  createdAt: string;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a boolean field off an opaque row (true only for a real `true` / "true"). */
function bool(v: unknown): boolean {
  return v === true || v === "true";
}

/** Narrow an opaque /gl/periods Entity row to the PeriodRow the screen needs. */
export function toPeriodRow(e: Record<string, unknown>): PeriodRow {
  return {
    id: str(e.id),
    period: str(e.period),
    locked: bool(e.locked),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/**
 * A STRICT CE 'YYYY-MM' key — 4-digit CE year (2000-2100) + month 01-12. Mirrors the server guard
 * (apps/api/src/routes/gl.ts isValidCePeriod), so a Buddhist-Era year (25xx/26xx — e.g. the bank
 * seed's '2569-05') is rejected: it falls outside the CE window and can never be named as the
 * close target (the POST would 400).
 */
export function isValidCePeriod(period: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12;
}

/**
 * The close-target period: the EARLIEST still-open, CE-valid period (books are closed oldest-first).
 * Returns null when nothing is closeable (no open CE period) — the screen then disables the close
 * action and titles the period em-dash, honestly (never the prototype's mock BE month).
 */
export function deriveOpenPeriod(rows: readonly PeriodRow[]): string | null {
  const open = rows
    .filter((r) => !r.locked && isValidCePeriod(r.period))
    .map((r) => r.period)
    .sort(); // ascending — 'YYYY-MM' sorts lexicographically as chronological
  return open[0] ?? null;
}

/**
 * The close history: the LOCKED periods, most-recent first (the prototype lists the months
 * descending, gl.jsx L812-816). Buddhist-Era-labelled locked rows are kept verbatim — they ARE
 * closed periods in the data, so listing them is honest.
 */
export function lockedHistory(rows: readonly PeriodRow[]): PeriodRow[] {
  return rows
    .filter((r) => r.locked)
    .slice()
    .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));
}

/**
 * Format a row-insert timestamp as an ISO date (YYYY-MM-DD, UTC — deterministic, ASCII). The wire
 * has no dedicated locked_at, so the history date uses created_at, formatted honestly. Returns ""
 * for a missing/invalid timestamp (the cell then em-dashes).
 */
export function formatPeriodDate(createdAt: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * The 10 period-close checklist steps (gl.jsx GLPeriodClose checklist L742-753). STATIC label keys
 * — there is NO per-step completion wire, so the screen maps these to presentational (all-pending)
 * rows; the prototype's per-step done flags + notes are fabricated mock data and are dropped
 * (rule 3, never fabricate).
 *
 * === MISSING-KEY BLOCKER (STOP+report; do NOT mint - PLAN.md sec-0 rule 2) ===
 * gl.close.step3 - the FA-depreciation step (gl.jsx L745) - is ABSENT from the Wave-A i18n batch:
 * i18n-full.json ships gl.close.step1,2,4..10 (9 of 10). It cannot be minted here (consume-only
 * i18n) and cannot even be type-referenced (DictKey = keyof typeof dict, so t("gl.close.step3") is
 * a COMPILE error). The checklist therefore renders 9 of the prototype's 10 steps until a sacred
 * i18n round adds gl.close.step3; when it lands, insert "gl.close.step3" at index 2 below (between
 * step2 and step4) - no other change is needed.
 */
export const STEP_KEYS: readonly DictKey[] = [
  "gl.close.step1",
  "gl.close.step2",
  // "gl.close.step3",  <- MISSING from Wave-A (see blocker above); insert here once added.
  "gl.close.step4",
  "gl.close.step5",
  "gl.close.step6",
  "gl.close.step7",
  "gl.close.step8",
  "gl.close.step9",
  "gl.close.step10",
];

/** Checklist progress (drives the header sub-line + the progress bar width). */
export interface Progress {
  completed: number;
  total: number;
  /** Percent complete, rounded 0-100 (0 when total is 0). */
  pct: number;
}

/** Compute progress from a done-count over a total step-count. */
export function computeProgress(completed: number, total: number): Progress {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, pct };
}

/** A run of text with a bold flag, from splitBold(). */
export interface TextSegment {
  text: string;
  bold: boolean;
}

/**
 * Split a string that embeds literal <b>…</b> markup into ordered {text, bold} segments, so the
 * .tsx can render the bold run with a real <b> element instead of dangerouslySetInnerHTML (which
 * the codebase never uses). gl.close.noteBody is the ONLY i18n value carrying <b> markup; keeping
 * this pure + tested preserves the prototype's bold emphasis honestly. A string with no markup
 * returns a single non-bold segment.
 */
export function splitBold(raw: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const re = /<b>(.*?)<\/b>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) segments.push({ text: raw.slice(last, m.index), bold: false });
    segments.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < raw.length) segments.push({ text: raw.slice(last), bold: false });
  return segments;
}
