// GET + POST + PUT /project-types — the project-type catalogue (P1-BE-06 read;
// P1-BE-14 write, B-065; master.ptype / project-type-screen.jsx MasterProjectType
// + ProjectTypeForm, docs/extract/PROJECT-TYPES.md).
//
// Contract (openapi.yaml /project-types): GET → the B-014 paginated list envelope
// {data, page, page_size, total} (EntityList) of opaque Entity rows; POST → 201
// EntityCreated; PUT /project-types/{id} → 200 EntityOk. The row shape follows
// the schema project_type: {id, key, name, hierarchy, modules}. company_id and
// timestamps are internal scope/metadata and never cross the wire.
//   key       = the project-type key (realestate | solar | civil | service for
//               the 4 global defaults; a free-form "custom_…" for tenant types).
//   hierarchy = ordered WBS label list (string[]).
//   modules   = enabled nav-id set (string[]).
//
// TENANT SCOPE (B-065, hybrid ownership — the tenant-leak fix):
//   - The 4 product defaults are GLOBAL (company_id IS NULL): shared, seeded,
//     read by every tenant, and READ-ONLY to tenants.
//   - CUSTOM types created here are OWNED by the caller's tenant (company_id =
//     tenant) and must NEVER leak to another tenant.
//   Before B-065, project_type was a platform-global reference table, so a
//   tenant's POST/PUT would have mutated shared data visible to ALL tenants.
//   GET now reads through the hybrid TenantDb.selectGlobalOrOwned() door
//   (company_id IS NULL OR company_id = <tenant>); POST writes through the
//   scoped insert() door (force-sets company_id = <tenant>); PUT writes through
//   the scoped update() door (WHERE company_id = <tenant>), which matches ZERO
//   rows for a global default or another tenant's type → 404. Without a
//   resolved tenant, request.db is absent and the handler answers 401 (same
//   posture as GET /projects & /companies).
//
// EDITING A GLOBAL DEFAULT (B-065 decision — flagged for diff-reviewer): the
// mock lets a user edit any type (ProjectTypeForm keeps preset.id), but in
// multi-tenant editing a shared default would corrupt data for ALL tenants. We
// pick the no-leak-safe behavior: PUT on a global default (or another tenant's
// type) returns 404 (the scoped update simply matches no row — it also never
// reveals whether the id exists globally).
//
// filter/page query params are accepted per the contract but not interpreted
// (undefined semantics — inventing filter behavior would violate PLAN.md §0
// rule 4); the full list is returned as one page, exactly like GET /projects.
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { projectTypes } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

type ProjectTypeRow = typeof projectTypes.$inferSelect;

/** The opaque Entity wire shape for one project type (company_id/timestamps dropped). */
function toWire(t: ProjectTypeRow): Record<string, unknown> {
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    hierarchy: t.hierarchy,
    modules: t.modules,
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Parse a WBS hierarchy from opaque JSON: a string[] (the persisted wire shape)
 * or the mock's "a → b → c" string (project-type-screen.jsx splits on →,>,/,,).
 */
function toHierarchy(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/→|>|\/|,/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Parse the enabled-module set: a string[] of nav ids (the persisted wire
 * shape) or the mock's {navId: boolean} map (ProjectTypeForm `modules`) — take
 * the truthy keys.
 */
function toModules(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((x) => String(x).trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, on]) => Boolean(on))
      .map(([k]) => k);
  }
  return [];
}

/** Register GET + POST + PUT /project-types on the given (already /api/v1-prefixed) scope. */
export function registerProjectTypesRoute(app: FastifyInstance): void {
  app.get("/project-types", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    // Hybrid read (B-065): the 4 global defaults (company_id IS NULL) PLUS this
    // tenant's own custom types (company_id = tenant). Never another tenant's.
    const rows = await db.selectGlobalOrOwned(projectTypes);

    return reply.code(200).send(
      // B-014: wrap the project types in the paginated list envelope
      // ({data, page, page_size, total}) — one full page (filter/page/page_size
      // accepted but not interpreted). See list-envelope.ts.
      listEnvelope(rows.map(toWire)),
    );
  });

  app.post("/project-types", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = str(body.name).trim();
    const hierarchy = toHierarchy(body.hierarchy);
    const modules = toModules(body.modules);
    // The client may echo the key/id it generated (mock: "custom_<base36 ts>");
    // otherwise the server mints an unguessable one. Never one of the 4 default
    // keys — a duplicate against the tenant's visible set is rejected below.
    const key =
      str(body.key ?? body.id).trim() ||
      `custom_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

    // Validation mirrors ProjectTypeForm.save (project-type-screen.jsx:129-134):
    // name + hierarchy are required.
    if (!name) {
      return reply.code(400).send({ code: "VALIDATION", message: "name is required" });
    }
    if (hierarchy.length === 0) {
      return reply.code(400).send({ code: "VALIDATION", message: "hierarchy is required" });
    }

    // Duplicate-key guard across the tenant's VISIBLE set (global defaults + own
    // custom types) — a custom type may not shadow a global default or an
    // existing own key. The scoped read never sees another tenant's keys, so
    // this can neither leak nor collide across tenants.
    const visible = await db.selectGlobalOrOwned(projectTypes);
    if (visible.some((t) => t.key === key)) {
      return reply.code(409).send({
        code: "DUPLICATE_KEY",
        message: `project type key ${key} already exists`,
      });
    }

    // Scoped insert force-sets company_id = <this tenant> (any client value is
    // ignored) — the new type is tenant-OWNED and can never be global or land
    // under another tenant.
    const [created] = await db
      .insert(projectTypes, { key, name, hierarchy, modules })
      .returning();

    return reply.code(201).send(toWire(created!));
  });

  app.put("/project-types/:id", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = str(body.name).trim();
    const hierarchy = toHierarchy(body.hierarchy);
    const modules = toModules(body.modules);

    if (!name) {
      return reply.code(400).send({ code: "VALIDATION", message: "name is required" });
    }
    if (hierarchy.length === 0) {
      return reply.code(400).send({ code: "VALIDATION", message: "hierarchy is required" });
    }

    // Scoped update: WHERE company_id = <this tenant> AND id = :id. A global
    // default (company_id IS NULL) or another tenant's type matches ZERO rows,
    // so `updated` is undefined → 404 (B-065 no-leak-safe decision). key is the
    // type's identity and is never reassigned here.
    const [updated] = await db
      .update(projectTypes, { name, hierarchy, modules }, eq(projectTypes.id, id))
      .returning();

    if (!updated) {
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: "project type not found",
      });
    }

    return reply.code(200).send(toWire(updated));
  });
}
