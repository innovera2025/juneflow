/*
 * BOQ approval-queue helpers for BOQApproval (P2-WEB-06) — pure, i18n-free, ASCII-only
 * logic derived from pototype/boq.jsx BOQApproval (L1108-1371) + its APPROVAL_LIST /
 * DIFF_ROWS mock (L1069-1106).
 *
 * The prototype fed the screen from two hardcoded arrays: APPROVAL_LIST (the pending
 * queue, with denormalised project/age strings and a per-doc v-from -> v-to delta) and
 * DIFF_ROWS (a version-to-version line diff with before/after prices). §0 rule 3: that
 * mock is dropped. The real queue is the server catalogue filtered to the docs awaiting
 * approval (GET /boq, status "pending"); the doc wire is
 *   { id, no, name, scope, project_id, version, status, currency_code, total }
 * (apps/api/src/routes/boq.ts docWire) — so THIS module only owns the queue-shaping and
 * the version arithmetic that IS derivable from that wire (a doc at version N was
 * necessarily revised from N-1). The monetary deltas / prior-version value / per-line
 * diff have NO source on the wire and are rendered as honest em-dashes by the view, never
 * fabricated here (see boq-approval.tsx WIRE GAPS).
 */
import { toBoqRow, formatMoney, versionLabel, type BoqRow } from "./boq-rows";

export type { BoqRow };
export { formatMoney, versionLabel };

/** Arrow glyph (U+2192) used in the "v{n-1} -> v{n}" version-transition label. */
const ARROW = String.fromCharCode(0x2192);

/** Narrow the opaque /boq Entity rows to the BoqRow shape (reuses boq-rows.toBoqRow). */
export function toBoqRows(rows: readonly Record<string, unknown>[]): BoqRow[] {
  return rows.map(toBoqRow);
}

/**
 * The approval queue = the docs awaiting approval (status "pending"), in the server's
 * order (boq-list precedent: the list is not client-re-sorted). GET /boq has no status
 * filter param, so the pending subset is derived client-side.
 */
export function pendingDocs(rows: readonly BoqRow[]): BoqRow[] {
  return rows.filter((d) => d.status === "pending");
}

/** Resolve the selected doc by `no`, falling back to the first queue doc (or undefined). */
export function selectedDoc(docs: readonly BoqRow[], no: string): BoqRow | undefined {
  return docs.find((d) => d.no === no) ?? docs[0];
}

/** True when the doc is its first edition (version <= 1) — no prior version to diff. */
export function isFirstEdition(version: number): boolean {
  return version <= 1;
}

/** Previous-version label "v{n-1}"; "" when first edition (nothing precedes v1). */
export function prevVersionLabel(version: number): string {
  return version > 1 ? "v" + (version - 1) : "";
}

/**
 * Version-transition label the header/queue render (prototype "v3 -> v4"). A revise to
 * version N necessarily came from N-1, so the arrow form is real derived metadata; a
 * first edition (N<=1) collapses to the single current label "v1".
 */
export function versionTransition(version: number): string {
  const cur = versionLabel(version);
  const prev = prevVersionLabel(version);
  return prev ? prev + " " + ARROW + " " + cur : cur;
}
