// Tenant scope middleware (P0-BE-11).
//
// Hard architectural rule (PLAN.md §5 + Appendix A, apps/api/CLAUDE.md):
//   company_id is enforced via middleware on EVERY query — no query may escape
//   tenant scope, not even one. Single DB, company_id middleware scope
//   (RLS deferred, see PLAN.md §12). The Bearer token carries the session whose
//   user.company_id = tenant scope (docs/handoff/api-contract.md).
//
// This plugin is the request-side half: it resolves company_id from the
// better-auth session (src/auth.ts), rejects any non-public request without a
// valid tenant (fail closed, 401), and attaches a tenant-scoped DB handle
// (src/db/tenant-db.ts) as request.db. Handlers get ONLY that scoped handle — the
// un-scoped base db is never exposed on the request — so a query cannot escape
// scope even by mistake.
//
// Registered directly on the root instance (not via app.register) so the hooks
// apply globally to every route. When routes gain their own encapsulation
// contexts (P0-BE-13), wrap this with fastify-plugin so the hooks still apply.
//
// G3: src/plugins/tenant-scope.test.ts proves rejection-without-tenant and that
// a resolved tenant yields a company_id-scoped request.db.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "@juneflow/db/client";
import { TenantDb } from "../db/tenant-db.js";

export interface TenantContext {
  companyId: string;
}

/** The authenticated session user (better-auth auth_user), when resolved. */
export interface AuthUserContext {
  id: string;
  email: string;
  name: string;
}

declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantContext;
    /** Tenant-scoped DB handle — the ONLY db access a handler may use. */
    db?: TenantDb;
    /** Session user identity (set when the resolver returns one — e.g. /me). */
    authUser?: AuthUserContext;
  }
}

/**
 * Resolver result: a bare company_id (legacy shape, kept for tests/simple
 * resolvers) or a full context carrying the session user. null → reject.
 */
export type ResolvedTenant =
  | string
  | { companyId: string; user?: AuthUserContext }
  | null;

export interface TenantScopeOptions {
  /** Un-scoped base handle; wrapped per-request into a company_id-scoped TenantDb. */
  db: Db;
  /** Resolve the caller's tenant (default: better-auth session). null → reject. */
  resolveCompanyId: (request: FastifyRequest) => Promise<ResolvedTenant>;
  /**
   * Routes reachable without a tenant (login, health). Matched by exact path or
   * `prefix/*` wildcard. Everything else fails closed.
   */
  publicPaths?: readonly string[];
}

/** Default unauthenticated surface: health probe + the auth endpoints. */
export const DEFAULT_PUBLIC_PATHS = [
  "/health",
  "/api/auth/*",
  "/api/v1/auth/*",
] as const;

function isPublic(pathname: string, publicPaths: readonly string[]): boolean {
  for (const pattern of publicPaths) {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      if (pathname === prefix || pathname.startsWith(prefix + "/")) return true;
    } else if (pathname === pattern) {
      return true;
    }
  }
  return false;
}

export async function registerTenantScope(
  app: FastifyInstance,
  options: TenantScopeOptions,
): Promise<void> {
  const publicPaths = options.publicPaths ?? DEFAULT_PUBLIC_PATHS;

  app.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // routerPath is undefined for 404s; fall back to the raw path (without query).
      const pathname = request.url.split("?", 1)[0] ?? request.url;
      if (isPublic(pathname, publicPaths)) return;

      const resolved = await options.resolveCompanyId(request);
      const companyId =
        typeof resolved === "string" ? resolved : resolved?.companyId;
      if (!companyId) {
        await reply.code(401).send({
          code: "UNAUTHENTICATED",
          message: "Missing tenant context",
        });
        return reply; // stop the chain; no handler runs without a tenant.
      }

      request.tenant = { companyId };
      request.db = new TenantDb(options.db, companyId);
      if (typeof resolved === "object" && resolved?.user) {
        request.authUser = resolved.user;
      }
    },
  );
}
