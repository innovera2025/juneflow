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
// TODO(P0-BE-11): register tenantScopePlugin (company_id enforced on every query)
//                 + better-auth self-hosted in Postgres.
// TODO(P0-BE-13): full app skeleton - register auditLogPlugin (every mutation),
//                 quota middleware (402 QUOTA_EXCEEDED + upgrade_url),
//                 POST /files presigned skeleton (Cloudflare R2, fake in dev),
//                 routes per packages/contracts/openapi.yaml (contract test G2).
// TODO(P0-BE-14): feature-flag mechanism to hide unfinished modules
//                 (dev stays green / always demoable).

import Fastify from "fastify";

const app = Fastify({ logger: true });

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
