// GET /projects — first resource list route (P1-BE-01).
//
// Contract (openapi.yaml /projects GET): bare array of Project
// {id, name, type, budget, currency_code, status} — required [id, name, type,
// status]; pagination envelope intentionally unspecified (B-014 → bare array).
// `type` is the project_type KEY (realestate|solar|civil|service): the table
// stores type_id → project_type (erd.html), so we resolve keys via the
// reference table. Every project read is tenant-scoped through request.db.
//
// filter/page query params are accepted per the contract but not interpreted:
// the contract gives them no semantics ("free-text/structured" — undefined),
// and inventing filter behavior would violate PLAN.md §0 rule 4. The full
// list is what the shell (B-020 ProjectSwitcher) consumes.
import type { FastifyInstance } from "fastify";
import { projects, projectTypes } from "@juneflow/db/schema";

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

    const [rows, typeRows] = await Promise.all([
      db.select(projects),
      db.selectReference(projectTypes),
    ]);
    const typeKeyById = new Map(typeRows.map((t) => [t.id, t.key]));

    return reply.code(200).send(
      rows.map((p) => ({
        id: p.id,
        name: p.name,
        // type_id is NOT NULL + FK-restrict onto project_type, so the key
        // always resolves for a well-formed row.
        type: typeKeyById.get(p.typeId),
        budget: p.budget == null ? null : Number(p.budget),
        currency_code: p.currencyCode,
        status: p.status,
      })),
    );
  });
}
