/*
 * Pure, i18n-free, ASCII-only row logic for BOQArchive (P2-WEB-07), derived from
 * pototype/boq.jsx BOQArchive (L1468-1631). The archive is the SAME server catalogue as
 * BOQList (GET /boq -> the tenant BOQ docs), so the row shape + status tone + version
 * label + money format + project-name map are reused verbatim from boq-rows.ts (already
 * unit-tested in boq-rows.test.ts) — this module only adds the archive-specific search.
 *
 * The prototype's archive toolbar placeholder is "search BOQ no, project, Block..." — i.e.
 * the free-text query matches the doc no, the project NAME, and the Block/scope (unlike the
 * BOQList search, which never covered the project name because BoqRow carries only a
 * project_id). filterArchiveRows resolves the project id to a name (the same GET /projects
 * map the row's project column uses) and folds it into the searchable haystack, so a search
 * for a project name finds its docs. project/status stay exact-match filters.
 *
 * B-278 UPDATE — the approver / approve-date columns DO have a wire source. GET /boq's
 * docWire carries { approved_by, approved_by_name, approved_at } (apps/api/src/routes/boq.ts
 * docWire, migration 0021 / B-081-F4; pinned by boq.test.ts's exact-key assertion on the list
 * rows), and the list handler resolves the display name from `users`. Those two columns are
 * now real: toArchiveApproval narrows them and the view renders them.
 *
 * STILL with NO source on the LIST payload — the view keeps an honest em-dash and this module
 * never invents a value (C10, boq-list precedent):
 *   - attachment count: there is no attachments table at all.
 *   - revise count + the revise-history timeline: `version_history` exists only on the DETAIL
 *     payload (GET /boq/{id}), not on the list rows this screen reads.
 *   - the year filter: `approved_at` is the only date on the payload and it is null for every
 *     unapproved doc, so filtering the archive by it would silently hide drafts — that needs a
 *     filter-semantics ruling, not a guess (B-279).
 */
import type { BoqRow } from "./boq-rows";

/** Toolbar filter inputs: exact project id + exact status code + free-text query. */
export interface ArchiveFilter {
  projectId: string;
  status: string;
  q: string;
}

/**
 * Filter the archive docs like BOQArchive's toolbar. project (by id) + status (by code) are
 * exact-match; the free-text query matches the doc no, name, scope, AND the resolved project
 * name (prototype placeholder "search BOQ no, project, Block..."). An empty field means "no
 * filter on that field". `projectNames` is the GET /projects id->name map (boq-rows
 * projectNameById); a doc whose project is not in the map contributes no project name to its
 * haystack (never a fabricated one).
 */
export function filterArchiveRows(
  rows: readonly BoqRow[],
  projectNames: ReadonlyMap<string, string>,
  f: ArchiveFilter,
): BoqRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((d) => {
    if (f.projectId && d.projectId !== f.projectId) return false;
    if (f.status && d.status !== f.status) return false;
    if (q) {
      const projectName = projectNames.get(d.projectId) ?? "";
      const haystack = (d.no + d.name + d.scope + projectName).toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/* --------------------------------------------------------------------------- */
/* Archive approval columns (B-278) — GET /boq approved_by_name + approved_at   */
/* --------------------------------------------------------------------------- */

/**
 * The archive's two approval cells for one doc, narrowed off the opaque /boq row. Kept
 * out of BoqRow (shared by 20 modules; only the archive renders these) and keyed back
 * onto the filtered rows by doc id.
 */
export interface ArchiveApproval {
  /** Doc id — the join key onto the BoqRow the table renders. */
  id: string;
  /** Resolved approver display name (server-side users join); "" when the doc has none. */
  approverName: string;
  /** Raw approved_at instant off the wire; "" when the doc is not approved. */
  approvedAt: string;
}

/** Read a string field off an opaque row; "" for null/undefined (mirrors boq-rows.str). */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * Narrow one opaque /boq row to its approval cells. snake_case (server convention) or
 * camelCase, mirroring boq-rows.toBoqRow. A draft doc carries null for both — that becomes
 * "" here and an em-dash in the view; no name and no date is ever invented.
 */
export function toArchiveApproval(e: Record<string, unknown>): ArchiveApproval {
  return {
    id: str(e.id),
    approverName: str(e.approved_by_name ?? e.approvedByName),
    approvedAt: str(e.approved_at ?? e.approvedAt),
  };
}

/** id -> ArchiveApproval map for the rendered rows (rows without an id are skipped). */
export function archiveApprovalById(
  rows: readonly Record<string, unknown>[] | undefined,
): Map<string, ArchiveApproval> {
  const map = new Map<string, ArchiveApproval>();
  for (const r of rows ?? []) {
    const a = toArchiveApproval(r);
    if (a.id) map.set(a.id, a);
  }
  return map;
}

/**
 * Format a wire timestamp as an ISO calendar date (YYYY-MM-DD, UTC) — the house convention
 * (pr-rows.formatDate / gl/jv-rows.formatDate / ap/pv-rows.formatDate), deterministic and
 * ASCII. The prototype printed a Thai buddhist-era date with a clock time ("22 Oct 68 -
 * 10:15"), but that came from a mock `date` string; approved_at is a real UTC instant, so
 * the cell shows that. "" for a missing/invalid value -> the view renders its em-dash.
 */
export function formatApprovedAt(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
