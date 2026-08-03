// GET /documents — the tenant's DMS file list (B-221 · Solar-tail · Wei=ก).
//
// Contract (openapi.yaml listDocuments GET — ALREADY typed, opaque-Entity, NO
// openapi edit this wave): the B-014 paginated list envelope {data, page,
// page_size, total} (EntityList) where each `data` row is an opaque Entity — the
// snake_case wire of the REAL document columns (schema misc.ts `documents` +
// B-221 additive columns name/by_user_id/size/status). A read on an opaque
// endpoint needs no contract change.
//
// The DMS list (dms.jsx) shows: name · cat · project · version · by (uploader) ·
// size · status · expiry · link_module. `project_name` and `by` are RESOLVED from
// their FKs — a raw uuid is NEVER exposed in a display field (PLAN.md §4): the
// per-tenant project/user sets are read through the same scoped door and mapped
// id→name in memory. A null project_id / by_user_id resolves to null (em-dash at
// the client — some mock files have no uploader, per B-221 seed).
//
// Optional `?cat=` filter: the DMS category tabs (contract/drawing/permit/…) read
// one category at a time. Applied as a simple in-memory filter over the tenant-
// scoped set (mirror ar.ts listInvoices), so the scope guard is never weakened.
//
// Tenant scope (fail closed): `document` carries its own company_id (NOT NULL FK →
// company, misc.ts document_company_idx), so it is read through the scoped
// TenantDb.select() door, which AND-injects `WHERE company_id = <this tenant>` on
// every query — projects and users likewise. A bare cross-tenant read is
// impossible (the un-scoped handle is private to TenantDb), so another tenant's
// files (or a foreign uploader/project name) can never leak. Without a resolved
// tenant, request.db is absent and the handler answers a flat 401 (same posture as
// GET /doc-numbering, /projects, /companies).
//
// money=NONE — the DMS list posts no JV/GL. GET-only: createDocument (POST) and
// listDocumentVersions are deferred (there is no document_version table — B-221
// invents none). Newest-first (created_at desc — the latest upload on top).
import type { FastifyInstance } from "fastify";
import { documents, projects, users } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";

type DocumentRow = typeof documents.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type UserRow = typeof users.$inferSelect;

/** Newest-first (created_at desc); a missing timestamp sorts last (mirror solar.ts). */
function byCreatedDesc(a: DocumentRow, b: DocumentRow): number {
  const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return bt - at;
}

/**
 * Resolve an FK id to its display name via a tenant-scoped id→name map (never
 * expose the raw uuid). A null id (or an id absent from the scoped set) → null.
 */
function resolveName(byId: Map<string, string>, id: string | null): string | null {
  return id != null ? byId.get(id) ?? null : null;
}

/** GET /documents handler body — tenant-scoped read + FK resolve + optional cat filter. */
async function listDocuments(
  db: TenantDb,
  cat: string,
): Promise<Record<string, unknown>[]> {
  // All three reads go through the scoped door (WHERE company_id = <this tenant>).
  const [docRows, projRows, userRows] = await Promise.all([
    db.select(documents) as Promise<DocumentRow[]>,
    db.select(projects) as Promise<ProjectRow[]>,
    db.select(users) as Promise<UserRow[]>,
  ]);

  // FK resolvers: a display field carries the resolved name, never the raw uuid.
  const projById = new Map(projRows.map((p) => [p.id, p.name]));
  const userById = new Map(userRows.map((u) => [u.id, u.name]));

  const filtered = cat ? docRows.filter((d) => d.cat === cat) : docRows;

  return [...filtered].sort(byCreatedDesc).map((d) => ({
    id: d.id,
    name: d.name,
    cat: d.cat,
    project_name: resolveName(projById, d.projectId),
    version: d.version,
    by: resolveName(userById, d.byUserId),
    size: d.size,
    status: d.status,
    expiry: d.expiry,
    link_module: d.linkModule,
    url: d.url,
    at: d.createdAt,
  }));
}

/** Register GET /documents on the given (already /api/v1-prefixed) scope. */
export function registerDocumentsRoute(app: FastifyInstance): void {
  app.get("/documents", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    // Optional `?cat=` filter (trimmed; absent/blank → the full tenant list).
    const catRaw = (request.query as { cat?: unknown }).cat;
    const cat = typeof catRaw === "string" ? catRaw.trim() : "";

    return reply.code(200).send(listEnvelope(await listDocuments(db, cat)));
  });
}
