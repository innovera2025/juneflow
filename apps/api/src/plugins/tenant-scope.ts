// Tenant scope plugin (STUB - not registered yet).
//
// Hard architectural rule (PLAN.md section 5 + Appendix A, apps/api/CLAUDE.md):
//   company_id is enforced via middleware on EVERY query - no query may escape
//   tenant scope, not even one. Single DB, company_id middleware scope
//   (RLS deferred, see PLAN.md section 12).
//   The JWT carries company_id = tenant scope (docs/handoff/api-contract.md).
//
// TODO(P0-BE-11): implement -
//   - resolve company_id from the better-auth session / Bearer JWT
//   - attach a tenant-scoped DB handle (drizzle) to the request so repositories
//     can only issue company_id-scoped queries
//   - reject requests without a valid tenant context
//   - wrap with fastify-plugin so hooks apply across encapsulation contexts
//   - gate G3: unit tests prove no query escapes scope

import type { FastifyInstance, FastifyRequest } from "fastify";

export interface TenantContext {
  companyId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

export async function tenantScopePlugin(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request: FastifyRequest) => {
    // TODO(P0-BE-11): derive company_id from the auth session; reject if missing.
    // Fail closed until implemented - this plugin must never silently no-op.
    void request;
    throw new Error("NOT_IMPLEMENTED: tenant-scope middleware (P0-BE-11)");
  });
}
