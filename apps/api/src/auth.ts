// better-auth — self-hosted in OUR Postgres (P0-BE-11).
//
// PLAN.md §3 + Appendix A: "Auth = better-auth (self-host ใน Postgres เรา) —
// ไม่ใช่ Clerk/hosted". We own every user record because tenant isolation binds
// `company_id` to every query (src/db/tenant-db.ts). better-auth manages its own
// session/account/verification tables in the same PostgreSQL 16 instance
// (created via the better-auth CLI, NOT drizzle migrations — so they are not
// sacred merged migrations).
//
// Scope note: this module owns the auth INSTANCE (self-host config) + tenant
// resolution used by the tenant-scope middleware. Mounting the HTTP auth routes
// (`/auth/login` etc. per docs/handoff/api-contract.md) belongs to the full app
// skeleton + contract routes in P0-BE-13.
//
// The instance is built lazily (getAuth) so importing this file — e.g. from unit
// tests or `tsc` — never opens a DB connection or reads secrets.
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Pool } from "pg";
import type { FastifyRequest } from "fastify";

/** Build the self-hosted better-auth instance over our Postgres pool. */
function buildAuth() {
  return betterAuth({
    // Pass a raw pg Pool: better-auth self-hosts its tables in this same DB.
    database: new Pool(
      process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {},
    ),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true },
    // Bearer tokens so `Authorization: Bearer <token>` works, matching the
    // contract (docs/handoff/api-contract.md: every request carries a Bearer jwt).
    plugins: [bearer()],
    // Tenant binding: each user belongs to exactly one company. `company_id` is
    // set server-side (input: false) — a client can never claim another tenant.
    user: {
      additionalFields: {
        companyId: { type: "string", required: false, input: false },
      },
    },
  });
}

export type Auth = ReturnType<typeof buildAuth>;

let cached: Auth | undefined;

/** Build (once) the self-hosted better-auth instance over our Postgres pool. */
export function getAuth(): Auth {
  cached ??= buildAuth();
  return cached;
}

/** Web `Headers` from Fastify's IncomingHttpHeaders, for better-auth's API. */
function toHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }
  return headers;
}

/**
 * Resolve the caller's tenant (company_id) from the better-auth session.
 * Returns null when there is no valid session — the tenant-scope middleware
 * then fails the request closed. Used as the default resolver in production;
 * unit tests inject their own resolver instead.
 */
export async function resolveTenantFromAuth(
  request: FastifyRequest,
  auth: Auth = getAuth(),
): Promise<string | null> {
  const session = await auth.api.getSession({ headers: toHeaders(request) });
  if (!session) return null;
  const companyId = (session.user as { companyId?: string | null }).companyId;
  return companyId ?? null;
}
