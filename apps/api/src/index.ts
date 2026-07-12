// Juneflow API - Fastify server entrypoint (Phase 0 scaffold).
//
// Scope (PLAN.md section 5 + apps/api/CLAUDE.md):
// - Fastify + TS, better-auth self-hosted in our Postgres, BullMQ worker.
// - Endpoint pattern per docs/handoff/api-contract.md: standard resource CRUD,
//   status changes ONLY via action endpoints (POST /x/:id/approve).
// - Every query tenant-scoped by company_id (src/plugins/tenant-scope.ts).
// - Every mutation writes AuditLog via middleware (src/plugins/audit-log.ts).
// - Quota exceeded -> HTTP 402 QUOTA_EXCEEDED + upgrade_url.
//
// DONE(P0-BE-11): tenant-scope middleware registered (company_id enforced on
//                 every query via request.db) + better-auth self-hosted in
//                 Postgres (src/auth.ts) as the default company_id resolver.
// DONE(P0-BE-13): app skeleton — audit-log middleware (every mutation writes an
//                 AuditLog row), quota mechanism + guaranteed 402 QUOTA_EXCEEDED
//                 + upgrade_url, POST /files presigned skeleton (fake R2 in dev),
//                 BullMQ worker skeleton (src/worker.ts), health endpoint.
// DONE(P0-BE-14): feature-flag mechanism (src/plugins/feature-flags.ts) hides
//                 unfinished modules so dev stays green / always demoable. Flags
//                 default via DEFAULT_FEATURE_FLAGS and are overridable by env;
//                 requireFeature(flag) 404s a hidden module on future routes.
//                 No GET /feature-flags endpoint — not in the contract, B-018(ค).
// TODO(later):    auth + resource routes per packages/contracts/openapi.yaml,
//                 mount the better-auth HTTP handler, and swap the unlimited
//                 quota resolver for a subscription-backed one once usage
//                 counting exists.

import Fastify from "fastify";
import { createDb } from "@juneflow/db/client";
import { registerTenantScope, DEFAULT_PUBLIC_PATHS } from "./plugins/tenant-scope.js";
import { registerAuditLog, createDbAuditSink } from "./plugins/audit-log.js";
import { QuotaGuard, unlimitedQuotaResolver } from "./plugins/quota.js";
import { FeatureFlags, registerFeatureFlags } from "./plugins/feature-flags.js";
import { registerFilesRoute, createFakeR2Storage } from "./routes/files.js";
import { resolveTenantFromAuth } from "./auth.js";

const app = Fastify({ logger: true });

// Base (un-scoped) DB handle. Never handed to route handlers directly — the
// tenant-scope hook wraps it per-request into a company_id-scoped TenantDb.
const db = createDb();

// Enforce company_id tenant scope on every non-public request, resolving the
// tenant from the self-hosted better-auth session.
await registerTenantScope(app, {
  db,
  resolveCompanyId: (request) => resolveTenantFromAuth(request),
  publicPaths: DEFAULT_PUBLIC_PATHS,
});

// Feature flags: hide modules that are not finished yet so dev stays green /
// demoable. Defaults come from DEFAULT_FEATURE_FLAGS; env (FEATURE_<FLAG> /
// FEATURE_FLAGS) can reveal an in-progress module without a code change.
await registerFeatureFlags(app, new FeatureFlags());

// Every successful mutation writes an AuditLog row (single choke point).
// resolveUserId stays null until the better-auth session exposes the acting
// user id (auth wiring — B-016); the row still records tenant/action/entity.
await registerAuditLog(app, {
  sink: createDbAuditSink(db),
});

// Quota mechanism. Usage counting is wired with the resource routes; until then
// the resolver reports unlimited so dev stays green, while the 402 path is live.
const quota = new QuotaGuard({
  resolver: unlimitedQuotaResolver,
  upgradeUrl:
    process.env.BILLING_UPGRADE_URL ??
    "https://app.juneflow.local/settings/subscription",
});

app.get("/health", async () => ({ ok: true }));

// POST /files — presigned upload skeleton (fake R2 in dev), storage-quota gated.
await registerFilesRoute(app, {
  storage: createFakeR2Storage(),
  quota,
});

const port = Number(process.env.PORT ?? 3000);

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`Juneflow API listening on :${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
