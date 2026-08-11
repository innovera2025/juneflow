// Juneflow API - Fastify server entrypoint.
//
// Scope (PLAN.md section 5 + apps/api/CLAUDE.md):
// - Fastify + TS, better-auth self-hosted in our Postgres, BullMQ worker.
// - Endpoint pattern per docs/handoff/api-contract.md: standard resource CRUD,
//   status changes ONLY via action endpoints (POST /x/:id/approve).
// - Every query tenant-scoped by company_id (src/plugins/tenant-scope.ts).
// - Every mutation writes AuditLog via middleware (src/plugins/audit-log.ts).
// - Quota exceeded -> HTTP 402 QUOTA_EXCEEDED + upgrade_url.
//
// DONE(P0-BE-11): tenant-scope middleware (company_id enforced on every query
//                 via request.db) + better-auth self-hosted in Postgres.
// DONE(P0-BE-13): app skeleton — audit-log middleware, quota + 402, POST /files
//                 presigned skeleton, BullMQ worker skeleton, health endpoint.
// DONE(P0-BE-14): feature-flag mechanism (src/plugins/feature-flags.ts).
// DONE(P1-BE-01): app assembly moved to src/app.ts (testable buildApp) —
//                 contract routes mounted under /api/v1 (contract server), flat
//                 {code,message} error/not-found handlers, first resource
//                 routes GET /me + GET /projects + POST /auth/login (bearer per
//                 B-028(ก), better-auth on auth_* tables per B-016(ก)).
// TODO(later):    remaining resource routes per packages/contracts/openapi.yaml,
//                 mount the better-auth HTTP handler if a flow ever needs it,
//                 and swap the unlimited quota resolver for a
//                 subscription-backed one once usage counting exists.

import { createDb } from "@juneflow/db/client";
import { buildApp } from "./app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "./plugins/quota.js";
import { SubscriptionQuotaResolver } from "./plugins/subscription-quota.js";
import { createFakeR2Storage } from "./routes/files.js";
import {
  resolveAuthContext,
  resolveAuthSecret,
  signInWithEmail,
  usingDevAuthSecret,
} from "./auth.js";

// Fail fast at BOOT (gate 4.5 rework): better-auth builds lazily on the first
// request, so validate the secret config here — a production process with no
// BETTER_AUTH_SECRET must die now with a clear message, not 500 per-request
// or silently sign sessions with a committed dev value.
resolveAuthSecret();

// Base (un-scoped) DB handle. Never handed to route handlers directly — the
// tenant-scope hook wraps it per-request into a company_id-scoped TenantDb.
const db = createDb();

// Quota mechanism. Production enforces the tenant's real subscription-backed
// limits (B-082 F2 — the unlimited stub allowed seat/AI/project abuse); non-prod
// keeps the unlimited/dev resolver so the local stack stays green. The 402 path
// is identical either way.
const quotaResolver =
  process.env.NODE_ENV === "production"
    ? new SubscriptionQuotaResolver(db)
    : unlimitedQuotaResolver;
const quota = new QuotaGuard({
  resolver: quotaResolver,
  upgradeUrl:
    process.env.BILLING_UPGRADE_URL ??
    "https://app.juneflow.local/settings/subscription",
});

const app = await buildApp({
  db,
  resolveTenant: (request) => resolveAuthContext(request),
  signIn: signInWithEmail,
  storage: createFakeR2Storage(),
  quota,
});

if (usingDevAuthSecret()) {
  app.log.warn(
    "BETTER_AUTH_SECRET is not set — running on the DEV-ONLY fallback secret. " +
      "Set BETTER_AUTH_SECRET for any real deployment (infra/.env or host env).",
  );
}

// B-282: the credential store is real (buildApp defaults it to
// DbCredentialStore), but NO delivery adapter is wired — apps/api has no mail
// dependency and @juneflow/notifications ships no concrete SmtpTransport
// (BLOCKERS.md B-269). Tokens are therefore issued and stored correctly but go
// nowhere. The warning is unconditional rather than config-driven: there is no
// env switch to read, and inventing one would be a guess.
app.log.warn(
  "No password-reset delivery adapter is wired — the /users invite, " +
    "POST /auth/forgot and POST /admin/users/:id/reset-password issue valid " +
    "tokens that are NOT sent to anyone. Pass buildApp({ deliverReset }) once a " +
    "transport exists (wiring steps in src/auth-provisioning.ts; BLOCKERS.md " +
    "B-282 / B-269).",
);

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
