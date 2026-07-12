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
// TODO(P0-BE-13): full app skeleton - register auditLogPlugin (every mutation),
//                 quota middleware (402 QUOTA_EXCEEDED + upgrade_url),
//                 POST /files presigned skeleton (Cloudflare R2, fake in dev),
//                 auth + resource routes per packages/contracts/openapi.yaml,
//                 and mount the better-auth HTTP handler (auth.handler).
// TODO(P0-BE-14): feature-flag mechanism to hide unfinished modules
//                 (dev stays green / always demoable).

import Fastify from "fastify";
import { createDb } from "@juneflow/db/client";
import { registerTenantScope } from "./plugins/tenant-scope.js";
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
});

app.get("/health", async () => ({ ok: true }));

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
