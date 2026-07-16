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
 * The prototype's mock archive columns with NO wire source (approver / approve-date /
 * attachment count / revise-history timeline) are NOT modelled here — the view renders an
 * honest em-dash for each and this module never invents a value (C10, boq-list precedent).
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
