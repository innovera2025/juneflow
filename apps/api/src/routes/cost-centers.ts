// GET /cost-centers — the tenant's cost centers (P1-BE-07, master.jsx CC_SEED /
// docs/extract/MOCK-DATA.md).
//
// Contract (openapi.yaml /cost-centers GET): the B-014 paginated list envelope
// {data, page, page_size, total} (EntityList) where each `data` row is an
// opaque Entity. The data-dictionary schema for cost_center is {code, name,
// project_id} (+ id) — schema cost_center (project.ts) / seed CC_SEED. The mock
// carried extra columns (type/owner/budget/status) that were deliberately NOT
// modeled in the schema, so they are not returned: inventing fields with no
// schema home would violate PLAN.md §0 rule 4. Only the real schema columns go
// on the wire (timestamps dropped), exactly like GET /project-types.
//
// cost_center carries NO company_id of its own — it hangs off project_id
// (NOT NULL FK → project, erd.html), so it is a PARENT-FK-scoped tenant table
// (like project_node / boq_doc), NOT a platform-global reference table. It is
// read through TenantDb.selectThrough() anchored on the company_id-scoped
// project root:
//
//   SELECT cost_center.* FROM cost_center
//     INNER JOIN project ON cost_center.project_id = project.id
//   WHERE project.company_id = <this tenant>
//
// selectReference() would throw for it (cost_center is not on the
// REFERENCE_TABLES allowlist), and it must never be read bare — the join to the
// scoped project root is the only door, so another tenant's cost centers can
// never leak. Without a resolved tenant, request.db is absent and the handler
// answers 401 (same posture as GET /projects & GET /companies).
//
// filter/page query params are accepted per the contract but not interpreted
// (their semantics are undefined — inventing filter behavior would violate
// PLAN.md §0 rule 4); the full tenant-scoped list is returned as one page.
import type { FastifyInstance } from "fastify";
import { costCenters, projects } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

/** Register GET /cost-centers on the given (already /api/v1-prefixed) scope. */
export function registerCostCentersRoute(app: FastifyInstance): void {
  app.get("/cost-centers", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    // cost_center has no company_id — scope it through its project root.
    const rows = await db.selectThrough(costCenters, [
      { fk: costCenters.projectId, parent: projects },
    ]);

    return reply.code(200).send(
      // B-014: wrap the cost centers in the paginated list envelope
      // ({data, page, page_size, total}). The full tenant-scoped list is
      // returned as one page (filter/page/page_size accepted but not
      // interpreted) — see list-envelope.ts.
      listEnvelope(
        rows.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          project_id: c.projectId,
        })),
      ),
    );
  });
}
