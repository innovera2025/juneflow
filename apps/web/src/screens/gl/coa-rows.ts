/*
 * Chart-of-accounts row helpers for GLChartOfAccounts (P2-WEB-13) — pure, i18n-free,
 * ASCII-only logic ported from pototype/accounting-extra.jsx GLChartOfAccounts
 * (L40-121) + its COA_CLASSES taxonomy (L7-13).
 *
 * The prototype held the accounts in local state (COA_SEED, L14-38) whose rows carried
 * `cls` / `group` / `bal` / `active`. §0 rule 3: that mock seed is dropped — the list is
 * the real server chart (GET /gl/coa, apps/api/src/routes/gl.ts) of opaque Entity rows
 * narrowed here. The wire is only { id, code, name, parent_id, created_at } (coaWire): the
 * account CLASS is a presentational derivation the FE makes from the code's leading digit
 * (handler comment), and NATURE (Dr/Cr) follows from the class. `group` / `bal` (balance)
 * / `active` (status) have NO wire column, so the screen em-dashes those cells (never
 * fabricated). Every colour is an @juneflow/tokens var() or a prototype-verbatim hex
 * (B-037(a)); no Thai/baht leaks here (class names live in coa-strings.json).
 */

/** An account as the table consumes it (GET /gl/coa row, narrowed from opaque). */
export interface CoaRow {
  id: string;
  code: string;
  name: string;
  /** Self-referential parent account id ("" when a top-level account). */
  parentId: string;
  createdAt: string;
}

/**
 * The 5 account classes (accounting-extra.jsx COA_CLASSES, L7-13). `id` is the code's
 * leading digit; `nature` is Dr/Cr; `color` is the prototype-verbatim class colour (var()
 * refs + hexes, B-037(a)). The Thai class NAMES are NOT here (they carry Thai) — they live
 * in coa-strings.json keyed by class id.
 */
export interface CoaClass {
  id: string;
  nature: "Dr" | "Cr";
  color: string;
}

export const COA_CLASSES: readonly CoaClass[] = [
  { id: "1", nature: "Dr", color: "var(--brand)" },
  { id: "2", nature: "Cr", color: "#B4453C" },
  { id: "3", nature: "Cr", color: "#6D28D9" },
  { id: "4", nature: "Cr", color: "var(--brand)" },
  { id: "5", nature: "Dr", color: "#B45309" },
];

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Narrow an opaque /gl/coa Entity row to the CoaRow the table needs. */
export function toCoaRow(e: Record<string, unknown>): CoaRow {
  return {
    id: str(e.id),
    code: str(e.code),
    name: str(e.name),
    parentId: str(e.parent_id ?? e.parentId),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/**
 * The account class = the code's leading digit (accounting-extra.jsx derives `cls` this
 * way; the handler documents cls as a presentational derivation from `code`). Returns ""
 * for a code that does not start with a known class digit.
 */
export function classOf(code: string): string {
  const first = code.trim().charAt(0);
  return COA_CLASSES.some((c) => c.id === first) ? first : "";
}

/** The class descriptor for a class id, or undefined for an unknown id. */
export function coaClass(classId: string): CoaClass | undefined {
  return COA_CLASSES.find((c) => c.id === classId);
}

/** Dr/Cr nature for a class id (accounting-extra.jsx COA_CLASSES[x].nature); "" if unknown. */
export function natureOf(classId: string): "Dr" | "Cr" | "" {
  return coaClass(classId)?.nature ?? "";
}

/**
 * Filter accounts by the search box (code/name — `group` is not on the wire so it is not
 * searched) and the class dropdown (accounting-extra.jsx L45-49, minus the group term).
 * A blank class matches every class; the query is case-insensitive.
 */
export function filterCoa(
  rows: readonly CoaRow[],
  query: string,
  classId: string,
): CoaRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (classId && classOf(r.code) !== classId) return false;
    if (q && !(r.code + r.name).toLowerCase().includes(q)) return false;
    return true;
  });
}

/**
 * Group the (already filtered) accounts under each class in class order, each group's rows
 * ordered by code (accounting-extra.jsx L91-115). Classes with no matching row are omitted.
 * The server already sorts by code; the per-group sort keeps the render deterministic even
 * if the input order changes.
 */
export function groupByClass(
  rows: readonly CoaRow[],
  classId: string,
): { cls: CoaClass; rows: CoaRow[] }[] {
  const groups: { cls: CoaClass; rows: CoaRow[] }[] = [];
  for (const cls of COA_CLASSES) {
    if (classId && cls.id !== classId) continue;
    const items = rows
      .filter((r) => classOf(r.code) === cls.id)
      .slice()
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    if (items.length > 0) groups.push({ cls, rows: items });
  }
  return groups;
}
