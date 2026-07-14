/*
 * Org-structure tree helpers for MasterCompany (P1-WEB-08) — pure, i18n-free logic
 * ported 1:1 from pototype/master.jsx MasterCompany (L116-169).
 *
 * The prototype tracks collapse/parent links by the mock's `code`; the server links
 * nodes by the real `id` (GET /org-units returns the opaque Entity {id, parent_id,
 * level, icon, name, code, note} in pre-order — apps/api/src/routes/org-units.ts),
 * so this port keys collapse + child lookups on `id`. Everything visual (nesting by
 * level, collapse hide-stack, counts) is otherwise identical to the prototype.
 */

/** One org node — the opaque /org-units Entity fields the prototype reads. */
export interface OrgNode {
  id: string;
  parent_id: string | null;
  level: number;
  icon: string;
  name: string;
  code: string;
  note: string;
}

/** Narrow the opaque Entity ({ [k]: unknown }) to the fields the screen renders. */
export function toOrgNode(e: Record<string, unknown>): OrgNode {
  const parent = e.parent_id ?? e.parentId;
  return {
    id: typeof e.id === "string" ? e.id : String(e.id ?? ""),
    parent_id: typeof parent === "string" ? parent : null,
    level: typeof e.level === "number" ? e.level : Number(e.level ?? 0),
    icon: typeof e.icon === "string" ? e.icon : "",
    name: typeof e.name === "string" ? e.name : "",
    code: typeof e.code === "string" ? e.code : "",
    note: typeof e.note === "string" ? e.note : "",
  };
}

/**
 * A row has children when the next row in the pre-order list sits one (or more)
 * level deeper (master.jsx:158 `rows[i+1] && rows[i+1].lvl > rows[i].lvl`).
 */
export function hasChildren(rows: readonly OrgNode[], i: number): boolean {
  return !!rows[i + 1] && rows[i + 1].level > rows[i].level;
}

/** Direct children of a node (the collapse count "· N sub-units", master.jsx:207). */
export function childCount(rows: readonly OrgNode[], id: string): number {
  return rows.filter((x) => x.parent_id === id).length;
}

/** Header counts: companies = level 0, depts = level >= 1 (master.jsx:119-120). */
export function orgCounts(rows: readonly OrgNode[]): {
  companies: number;
  depts: number;
} {
  return {
    companies: rows.filter((r) => r.level === 0).length,
    depts: rows.filter((r) => r.level >= 1).length,
  };
}

/**
 * Visible rows: hide any row that has a collapsed ancestor (master.jsx:160-169).
 * Pushes a level onto a hide-stack when a collapsed row with children is seen and
 * pops it once a row returns to (or above) that level.
 */
export function visibleRows(
  rows: readonly OrgNode[],
  collapsed: ReadonlySet<string>,
): { r: OrgNode; i: number }[] {
  const out: { r: OrgNode; i: number }[] = [];
  const hideStack: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    while (hideStack.length && r.level <= hideStack[hideStack.length - 1]) {
      hideStack.pop();
    }
    if (hideStack.length === 0) out.push({ r, i });
    if (collapsed.has(r.id) && hasChildren(rows, i)) hideStack.push(r.level);
  }
  return out;
}
