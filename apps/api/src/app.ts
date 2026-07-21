// Juneflow API — Fastify app assembly (P1-BE-01).
//
// Split out of the entrypoint so the wiring is unit-testable (G3): index.ts
// builds this app with production deps and listens; tests build it with
// injected seams (resolver / signIn / storage / quota / audit sink).
//
// Contract surface (packages/contracts/openapi.yaml):
// - All contract routes live under the contract server prefix /api/v1
//   (P1-BE-01 audit debt 1 — live contract tests must not 404).
// - Every error body is flat {code,message} per the Error schema: tenant-scope
//   401, route errors, the not-found handler (debt 2) and the global error
//   handler below. files.ts nested 401 fixed the same round (debt 3).
// - /health stays at the root: it is NOT a contract endpoint — it is the
//   compose healthcheck probe (infra/docker-compose.yml pins it).
import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "@juneflow/db/client";
import {
  registerTenantScope,
  DEFAULT_PUBLIC_PATHS,
  type ResolvedTenant,
} from "./plugins/tenant-scope.js";
import type { FastifyRequest } from "fastify";
import {
  registerAuditLog,
  createDbAuditSink,
  type AuditSink,
} from "./plugins/audit-log.js";
import { QuotaGuard } from "./plugins/quota.js";
import { FeatureFlags, registerFeatureFlags } from "./plugins/feature-flags.js";
import { registerFilesRoute, type FileStorage } from "./routes/files.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerMeRoute } from "./routes/me.js";
import { loadUserByEmail } from "./routes/profile-data.js";
import { registerProjectsRoute } from "./routes/projects.js";
import { registerCountsRoute } from "./routes/counts.js";
import { registerCompaniesRoute } from "./routes/companies.js";
import { registerProjectTypesRoute } from "./routes/project-types.js";
import { registerCostCentersRoute } from "./routes/cost-centers.js";
import { registerDocNumberingRoute } from "./routes/doc-numbering.js";
import { registerModelsRoute } from "./routes/models.js";
import { registerVendorsRoute } from "./routes/vendors.js";
import { registerUsersRoute } from "./routes/users.js";
import { registerRolesRoute } from "./routes/roles.js";
import { registerOrgUnitsRoute } from "./routes/org-units.js";
import { registerProjectNodesRoute } from "./routes/project-nodes.js";
import { registerBoqRoute } from "./routes/boq.js";
import { registerAiQtoRoute } from "./routes/ai-qto.js";
import { registerPrRoute } from "./routes/pr.js";
import { registerPoRoute } from "./routes/po.js";
import { registerWoRoute } from "./routes/wo.js";
import { registerGrRoute } from "./routes/gr.js";
import { registerSubconRoute } from "./routes/subcon.js";
import { registerPmRoute } from "./routes/pm.js";
import { registerNotificationsRoute } from "./routes/notifications.js";
import { registerDashboardRoute } from "./routes/dashboard.js";
import { registerAuditLogRoute } from "./routes/audit-log.js";
import { registerBoqReportsRoute } from "./routes/boq-reports.js";
import { registerAnalyticsRoute } from "./routes/analytics.js";
import { registerGlRoute } from "./routes/gl.js";
import { registerArRoute } from "./routes/ar.js";
import { registerCustomersRoute } from "./routes/customers.js";
import { registerEtaxRoute } from "./routes/etax.js";
import { registerFaRoute } from "./routes/fa.js";
import { registerApRoute } from "./routes/ap.js";
import { registerBankRoute } from "./routes/bank.js";
import { registerTaxRoute } from "./routes/tax.js";
import type { SignIn } from "./auth.js";

export interface AppDeps {
  /** Base (un-scoped) DB handle — only plugins/TenantDb construction see it. */
  db: Db;
  /** Tenant/session resolver (prod: better-auth resolveAuthContext). */
  resolveTenant: (request: FastifyRequest) => Promise<ResolvedTenant>;
  /** Credential sign-in seam (prod: better-auth signInWithEmail). */
  signIn: SignIn;
  /** File storage seam for POST /files. */
  storage: FileStorage;
  /** Quota guard (402 QUOTA_EXCEEDED + upgrade_url). */
  quota: QuotaGuard;
  /** Feature flags (defaults: DEFAULT_FEATURE_FLAGS). */
  features?: FeatureFlags;
  /** Audit sink override for tests (defaults to the DB sink). */
  auditSink?: AuditSink;
  /** Fastify logger toggle (tests turn it off). */
  logger?: boolean;
}

/** Assemble the full Fastify app (plugins + handlers + /api/v1 routes). */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? true });

  // Contract Error is flat {code,message} — including 404s (audit debt 2).
  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      code: "NOT_FOUND",
      message: `Route ${request.method}:${request.url} not found`,
    });
  });

  // Every failure path answers the flat contract Error shape. 5xx details go
  // to the log only (e.g. the better-auth misconfig that 500ed the stack —
  // P1-BE-01 root cause — must not leak internals to clients).
  app.setErrorHandler((error, request, reply) => {
    const err = error as {
      statusCode?: unknown;
      code?: unknown;
      message?: unknown;
    };
    const statusCode =
      typeof err.statusCode === "number" && err.statusCode >= 400
        ? err.statusCode
        : 500;
    if (statusCode >= 500) {
      request.log.error(error);
      return reply
        .code(statusCode)
        .send({ code: "INTERNAL_ERROR", message: "Internal server error" });
    }
    return reply.code(statusCode).send({
      code: typeof err.code === "string" ? err.code : "BAD_REQUEST",
      message: typeof err.message === "string" ? err.message : "Request failed",
    });
  });

  // Enforce company_id tenant scope on every non-public request (fail closed).
  await registerTenantScope(app, {
    db: deps.db,
    resolveCompanyId: deps.resolveTenant,
    publicPaths: DEFAULT_PUBLIC_PATHS,
  });

  // Feature flags: hide modules that are not finished yet so dev stays green.
  await registerFeatureFlags(app, deps.features ?? new FeatureFlags());

  // Every successful mutation writes an AuditLog row (single choke point).
  // Attribute the row to the DICTIONARY user (audit_log.user_id FK), resolved
  // from the session email exactly like GET /me — the session carries the
  // better-auth auth_user id, which is NOT the dictionary user id (F2 fix). The
  // lookup runs only on successful mutations (the audit hook fires there) and
  // fails closed to a null actor when the caller has no dictionary row.
  await registerAuditLog(app, {
    sink: deps.auditSink ?? createDbAuditSink(deps.db),
    resolveUserId: async (request) => {
      const db = request.db;
      const authUser = request.authUser;
      if (!db || !authUser) return null;
      try {
        const user = await loadUserByEmail(db, authUser.email);
        return user?.id ?? null;
      } catch {
        // A transient actor-lookup failure must not drop the whole audit row —
        // degrade to a null actor (the mutation is still recorded).
        return null;
      }
    },
  });

  // Compose healthcheck probe (root — not part of the contract surface).
  app.get("/health", async () => ({ ok: true }));

  // Contract routes under the contract server prefix /api/v1.
  await app.register(
    async (v1) => {
      await registerAuthRoutes(v1, { db: deps.db, signIn: deps.signIn });
      registerMeRoute(v1);
      registerProjectsRoute(v1, { quota: deps.quota });
      registerCountsRoute(v1);
      registerCompaniesRoute(v1);
      registerProjectTypesRoute(v1);
      registerCostCentersRoute(v1);
      registerDocNumberingRoute(v1);
      registerModelsRoute(v1);
      registerVendorsRoute(v1);
      registerUsersRoute(v1);
      registerRolesRoute(v1);
      registerOrgUnitsRoute(v1);
      registerProjectNodesRoute(v1);
      registerBoqRoute(v1);
      registerAiQtoRoute(v1, { quota: deps.quota });
      registerPrRoute(v1);
      registerPoRoute(v1);
      registerWoRoute(v1);
      registerGrRoute(v1);
      registerSubconRoute(v1);
      registerPmRoute(v1);
      registerNotificationsRoute(v1);
      registerDashboardRoute(v1);
      registerAuditLogRoute(v1);
      registerBoqReportsRoute(v1);
      registerAnalyticsRoute(v1);
      registerGlRoute(v1);
      registerArRoute(v1);
      registerCustomersRoute(v1);
      registerEtaxRoute(v1);
      registerFaRoute(v1);
      registerApRoute(v1);
      registerBankRoute(v1);
      registerTaxRoute(v1);
      await registerFilesRoute(v1, {
        storage: deps.storage,
        quota: deps.quota,
      });
    },
    { prefix: "/api/v1" },
  );

  return app;
}
