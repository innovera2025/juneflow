/*
 * docnum-rows — pure row transforms for MasterDocNum (P1-WEB-12), ported from the
 * render logic of pototype/master.jsx MasterDocNum (L863-876).
 *
 * The opaque GET /doc-numbering row (B-014 envelope `.data`, doc-numbering.test.ts wire
 * shape) is normalised to a typed DocNumRow, and the two prototype display rules that
 * carry real logic are isolated here so they can be unit-tested (gate G3):
 *
 *   - nextRunning (B-060, master.jsx:874): the "next number" column is running + 1 padded
 *     to 4 digits ONLY when `running` is all-digits; a non-numeric counter (the BOQ row
 *     "B-02 v3") renders verbatim. `running` is TEXT on the wire (leading zeros kept).
 *   - lockedLabelKey (B-067, master.jsx:876 + doc-numbering.ts): the wire `locked` is a
 *     lock-mode CODE (all | dept | warehouse | none); the FE resolves each to its i18n
 *     dict key — all->docnum.lockAll, dept->docnum.lockDept, warehouse->docnum.lockWarehouse,
 *     none (and any unknown) -> null, which the screen renders as the literal em-dash "—"
 *     (the section 0 / B-064 language-neutral punctuation precedent).
 */
import type { DictKey } from "@juneflow/i18n";

/** Typed doc-numbering counter row (the fields GET /doc-numbering puts on the wire). */
export interface DocNumRow {
  id: string;
  /** Document type display name (e.g. "Purchase Order"). */
  type: string;
  /** Running-number prefix (e.g. "PO"). */
  prefix: string;
  /** Last-used running number as TEXT, verbatim (leading zeros kept; may be non-numeric). */
  running: string;
  /** Reset cadence — a Thai display string on the wire; the screen renders it via tp(). */
  reset_rule: string;
  /** Lock-mode code: all | dept | warehouse | none. */
  locked: string;
}

/** Normalise an opaque GET /doc-numbering row to a typed DocNumRow. */
export function toDocNumRow(raw: Record<string, unknown>): DocNumRow {
  return {
    id: String(raw.id ?? ""),
    type: String(raw.type ?? ""),
    prefix: String(raw.prefix ?? ""),
    running: String(raw.running ?? ""),
    reset_rule: String(raw.reset_rule ?? ""),
    locked: String(raw.locked ?? ""),
  };
}

/**
 * "next number" column value (master.jsx:874, B-060): pad to 4 digits + 1 ONLY when
 * `running` is all-digits; otherwise the raw text (the BOQ "B-02 v3" row) passes through
 * unchanged.
 */
export function nextRunning(running: string): string {
  return /^\d+$/.test(running)
    ? (Number.parseInt(running, 10) + 1).toString().padStart(4, "0")
    : running;
}

/**
 * Map the wire lock-mode code to its i18n dict key (B-067). "none" — and any code with no
 * mapping — returns null, so the screen renders the literal em-dash "—".
 */
export function lockedLabelKey(locked: string): DictKey | null {
  switch (locked) {
    case "all":
      return "docnum.lockAll";
    case "dept":
      return "docnum.lockDept";
    case "warehouse":
      return "docnum.lockWarehouse";
    default:
      return null; // "none" (and any unknown code) -> literal "—"
  }
}
