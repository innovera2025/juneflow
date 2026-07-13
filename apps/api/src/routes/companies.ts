// GET /companies — the tenant's affiliated group companies (P1-BE-03, B-041(ก+)).
//
// Contract (openapi.yaml /companies → Company[]): bare array (B-014) of
// {id, name, short, color, biz, tax_id, doc_prefix, project_count} — the
// Multi-Company switcher rows (company-accept.jsx COMPANIES / PLAN.md
// Appendix B item 14).
//
// Group semantics (platform.ts): companies link into a group via the
// self-referential group_parent_id (the group head). The tenant's group head =
// its own company's group_parent_id (or itself when it IS the head); the
// members are every company whose group_parent_id points at that head. A
// tenant can therefore only ever see its own group — the head is derived from
// request.db.companyId, never from client input.
//
// project_count is derived from the tenant's OWN project rows (company_id
// attribution). Under hard tenant scoping (PLAN.md §5) another company's
// projects are never readable, so members without tenant-attributed projects
// count 0 — the prototype's per-member split (PROJECT_COMPANY) has no schema
// home yet; see BLOCKERS.md B-046.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { companies, projects } from "@juneflow/db/schema";
import { loadOwnCompany } from "./profile-data.js";

/** Register GET /companies on the given (already /api/v1-prefixed) scope. */
export function registerCompaniesRoute(app: FastifyInstance): void {
  app.get("/companies", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    const own = await loadOwnCompany(db);
    // A session whose tenant has no company row cannot be served — fail
    // closed rather than inventing a group (same posture as GET /me).
    if (!own) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "No company record for this tenant",
      });
    }

    const head = own.groupParentId ?? own.id;
    const [members, projectRows] = await Promise.all([
      db.selectReference(companies, eq(companies.groupParentId, head)),
      db.select(projects),
    ]);

    const projectCount = new Map<string, number>();
    for (const p of projectRows) {
      projectCount.set(p.companyId, (projectCount.get(p.companyId) ?? 0) + 1);
    }

    return reply.code(200).send(
      members.map((c) => ({
        id: c.id,
        name: c.name,
        short: c.short,
        color: c.color,
        biz: c.biz,
        tax_id: c.taxId,
        doc_prefix: c.docPrefix,
        project_count: projectCount.get(c.id) ?? 0,
      })),
    );
  });
}
