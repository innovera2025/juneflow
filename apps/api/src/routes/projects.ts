// GET /projects — first resource list route (P1-BE-01, extended P1-BE-03).
//
// Contract (openapi.yaml /projects GET): the B-014 paginated list envelope
// {data, page, page_size, total} where each `data` row is a Project
// {id, name, type, budget, currency_code, status} + the B-041(ก+) approved
// ProjectSwitcher extensions {short, color, company_id, units, phases[]} —
// required [id, name, type, status].
//
// `type` is the project_type KEY (realestate|solar|civil|service): the table
// stores type_id → project_type (erd.html), so we resolve keys via the
// reference table. Every project read is tenant-scoped through request.db —
// project_node rows (no company_id column) go through the scoped
// selectThrough door anchored on project.
//
// Derived fields (B-041(ก+), numbers come from seed rows — never hardcoded):
//   units      = project_node kind='unit' rows of the project
//   phases[]   = project_node kind='phase' rows: {id, name, units, sold_pct,
//                sale_status} where units counts unit-kind DESCENDANTS of the
//                phase (units may hang under intermediate block nodes) and
//                sold_pct = round(100 × sales_unit stage ∈ {sold, soldBuilt}
//                / units) (0 when the phase has no units).
//
// filter/page query params are accepted per the contract but not interpreted:
// the contract gives them no semantics ("free-text/structured" — undefined),
// and inventing filter behavior would violate PLAN.md §0 rule 4. The full
// list is what the shell (B-020 ProjectSwitcher) consumes.
import type { FastifyInstance } from "fastify";
import {
  projectNodes,
  projects,
  projectTypes,
  salesUnits,
} from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

type ProjectNodeRow = typeof projectNodes.$inferSelect;

/** Sales-unit stages that count as sold (B-041(ก+): sold_pct numerator). */
const SOLD_STAGES = new Set(["sold", "soldBuilt"]);

/**
 * Phase rows for one project: unit-kind descendants are collected per phase
 * through the parent_id tree (units sit under blocks under phases — seed
 * B-009), and sold_pct comes from the sales_unit stage per unit node.
 */
function derivePhases(
  nodes: ProjectNodeRow[],
  stageByUnitId: Map<string, string | null>,
) {
  const childrenByParent = new Map<string, ProjectNodeRow[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId);
    if (siblings) siblings.push(node);
    else childrenByParent.set(node.parentId, [node]);
  }

  const collectUnitIds = (nodeId: string, out: string[]): string[] => {
    for (const child of childrenByParent.get(nodeId) ?? []) {
      if (child.kind === "unit") out.push(child.id);
      collectUnitIds(child.id, out);
    }
    return out;
  };

  return nodes
    .filter((n) => n.kind === "phase")
    .map((phase) => {
      const unitIds = collectUnitIds(phase.id, []);
      const sold = unitIds.filter((id) => {
        const stage = stageByUnitId.get(id);
        return stage != null && SOLD_STAGES.has(stage);
      }).length;
      return {
        id: phase.id,
        name: phase.name,
        units: unitIds.length,
        sold_pct:
          unitIds.length === 0
            ? 0
            : Math.round((100 * sold) / unitIds.length),
        sale_status: phase.saleStatus,
      };
    });
}

/** Register GET /projects on the given (already /api/v1-prefixed) scope. */
export function registerProjectsRoute(app: FastifyInstance): void {
  app.get("/projects", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    const [rows, typeRows, nodeRows, saleRows] = await Promise.all([
      db.select(projects),
      db.selectReference(projectTypes),
      // project_node carries no company_id — scoped through its project root.
      db.selectThrough(projectNodes, [
        { fk: projectNodes.projectId, parent: projects },
      ]),
      db.select(salesUnits),
    ]);
    const typeKeyById = new Map(typeRows.map((t) => [t.id, t.key]));

    const nodesByProject = new Map<string, ProjectNodeRow[]>();
    for (const node of nodeRows) {
      const list = nodesByProject.get(node.projectId);
      if (list) list.push(node);
      else nodesByProject.set(node.projectId, [node]);
    }
    const stageByUnitId = new Map<string, string | null>();
    for (const su of saleRows) {
      if (su.unitId) stageByUnitId.set(su.unitId, su.stage);
    }

    return reply.code(200).send(
      // B-014: wrap the project rows in the paginated list envelope
      // ({data, page, page_size, total}). The full list is returned as one
      // page (filter/page/page_size are accepted but not interpreted) — see
      // list-envelope.ts.
      listEnvelope(
        rows.map((p) => {
          const nodes = nodesByProject.get(p.id) ?? [];
          return {
            id: p.id,
            name: p.name,
            // type_id is NOT NULL + FK-restrict onto project_type, so the key
            // always resolves for a well-formed row.
            type: typeKeyById.get(p.typeId),
            budget: p.budget == null ? null : Number(p.budget),
            currency_code: p.currencyCode,
            status: p.status,
            short: p.short,
            color: p.color,
            company_id: p.companyId,
            units: nodes.filter((n) => n.kind === "unit").length,
            phases: derivePhases(nodes, stageByUnitId),
          };
        }),
      ),
    );
  });
}
