// GET /project-types — the 4 product project types + their WBS/module config
// (P1-BE-06, docs/extract/PROJECT-TYPES.md).
//
// Contract (openapi.yaml /project-types GET): the B-014 paginated list envelope
// {data, page, page_size, total} (EntityList) where each `data` row is an
// opaque ProjectType. The row shape follows the seeded product-level reference
// config (schema project_type / seed PROJECT_TYPES): {id, key, name, hierarchy,
// modules}.
//   key       = project_type KEY (realestate | solar | civil | service).
//   hierarchy = ordered WBS label list per type (e.g. [ไซต์, โซน/Array, String,
//               Inverter]) — the "hierarchy[]" of the contract summary.
//   modules   = the nav-id set opened for the type (the enabled-module keys) —
//               persisted as a string[] by the seed; returned verbatim.
//
// project_type is a PLATFORM-GLOBAL reference table (erd.html shows no
// company_id — it is shared product config, not tenant-owned data). It is
// therefore read through TenantDb.selectReference(), the runtime-allowlisted
// unscoped door for the exactly-three reference tables (package / project_type /
// company). There is no per-tenant filtering — every tenant sees the same 4
// types — but the endpoint still fails closed behind the tenant middleware:
// without a resolved tenant, request.db is absent and the handler answers 401
// (same posture as GET /projects & GET /companies). No tenant-owned table is
// touched, so there is no scope to leak.
//
// filter/page query params are accepted per the contract but not interpreted
// (their semantics are undefined — inventing filter behavior would violate
// PLAN.md §0 rule 4); the full 4-row list is returned as one page, exactly like
// GET /projects.
import type { FastifyInstance } from "fastify";
import { projectTypes } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

/** Register GET /project-types on the given (already /api/v1-prefixed) scope. */
export function registerProjectTypesRoute(app: FastifyInstance): void {
  app.get("/project-types", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    // project_type has no company_id — read it through the reference door.
    const rows = await db.selectReference(projectTypes);

    return reply.code(200).send(
      // B-014: wrap the project types in the paginated list envelope
      // ({data, page, page_size, total}). The 4 product types are returned as
      // one full page (filter/page/page_size accepted but not interpreted) —
      // see list-envelope.ts.
      listEnvelope(
        rows.map((t) => ({
          id: t.id,
          key: t.key,
          name: t.name,
          hierarchy: t.hierarchy,
          modules: t.modules,
        })),
      ),
    );
  });
}
