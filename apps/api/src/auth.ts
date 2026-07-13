// better-auth — self-hosted in OUR Postgres (P0-BE-11 → P1-BE-01).
//
// PLAN.md §3 + Appendix A: "Auth = better-auth (self-host ใน Postgres เรา) —
// ไม่ใช่ Clerk/hosted". We own every user record because tenant isolation binds
// `company_id` to every query (src/db/tenant-db.ts).
//
// B-016(ก): better-auth does NOT touch the dictionary `user` table (sacred
// migration 0000). It runs on its own tables — auth_user / auth_session /
// auth_account / auth_verification — defined in @juneflow/db (packages/db/src/
// schema/auth.ts, migration 0008) and wired here via modelName + the drizzle
// adapter. company_id on auth_user links a session to its tenant.
//
// B-028(ก): clients authenticate with `Authorization: Bearer <token>` per the
// contract (openapi.yaml bearerAuth) — the bearer() plugin accepts the session
// token issued by POST /auth/login (src/routes/auth.ts).
//
// The instance is built lazily (getAuth) so importing this file — e.g. from unit
// tests or `tsc` — never opens a DB connection or reads secrets.
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { bearer } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "@juneflow/db/client";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "@juneflow/db/schema";
import type { FastifyRequest } from "fastify";

/**
 * DEV-ONLY fallback secret — NEVER active in production (gate 4.5 rework).
 * better-auth (correctly) refuses to run on ITS built-in default secret under
 * NODE_ENV=production — which is what made every /api/v1/* request 500 on the
 * compose stack (P1-BE-01 root cause: the api image sets NODE_ENV=production
 * and infra passes no BETTER_AUTH_SECRET). This constant exists ONLY for
 * explicitly non-production processes (local dev/tests); in production a
 * missing BETTER_AUTH_SECRET fails fast at boot (resolveAuthSecret below), so
 * no real deployment can ever sign sessions with a repo-committed value
 * (infra/CLAUDE.md secrets rule). Compose-side provisioning → BLOCKERS B-038.
 */
const DEV_ONLY_SECRET =
  "juneflow-dev-only-secret--set-BETTER_AUTH_SECRET-in-real-deployments";

/** True when this process would run on the dev fallback (index.ts warns). */
export function usingDevAuthSecret(): boolean {
  return !process.env.BETTER_AUTH_SECRET;
}

/**
 * Resolve the signing secret, fail-closed by environment:
 * - BETTER_AUTH_SECRET set → use it (all environments).
 * - missing + NODE_ENV=production → throw (fail fast at boot — a production
 *   process must never fall back to a committed secret).
 * - missing + non-production → DEV_ONLY_SECRET (compose/local dev boots from
 *   one `docker compose up`, PLAN.md §7), with a boot warning from index.ts.
 */
export function resolveAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "BETTER_AUTH_SECRET is not set. Refusing to start in production with " +
        "the dev fallback secret — provision it via env (infra/.env or host " +
        "env; see BLOCKERS.md B-038 for compose dev provisioning).",
    );
  }
  return DEV_ONLY_SECRET;
}

/** Build the self-hosted better-auth instance over our Postgres via Drizzle. */
function buildAuth() {
  return betterAuth({
    // Drizzle adapter over OUR schema: better-auth reads/writes the auth_*
    // tables from packages/db (migration 0008) — never the dictionary `user`.
    database: drizzleAdapter(createDb(), {
      provider: "pg",
      schema: {
        auth_user: authUsers,
        auth_session: authSessions,
        auth_account: authAccounts,
        auth_verification: authVerifications,
      },
    }),
    secret: resolveAuthSecret(),
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    emailAndPassword: { enabled: true },
    // Bearer tokens so `Authorization: Bearer <token>` works, matching the
    // contract (openapi.yaml bearerAuth + B-028(ก)).
    plugins: [bearer()],
    // B-016(ก): separate tables via modelName; tenant binding via company_id.
    // `input: false` — a client can never claim another tenant.
    user: {
      modelName: "auth_user",
      additionalFields: {
        companyId: { type: "string", required: false, input: false },
      },
    },
    session: { modelName: "auth_session" },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
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

/** Session user shape we rely on (companyId is our additional field). */
interface SessionUser {
  id: string;
  email: string;
  name: string;
  companyId?: string | null;
}

/** Tenant + session-user context resolved from the bearer session. */
export interface AuthSessionContext {
  companyId: string;
  user: { id: string; email: string; name: string };
}

/**
 * Resolve the caller's tenant (company_id) AND session user from the
 * better-auth session. Returns null when there is no valid session or the
 * session user carries no tenant — the tenant-scope middleware then fails the
 * request closed. Used as the default resolver in production; unit tests
 * inject their own resolver instead.
 */
export async function resolveAuthContext(
  request: FastifyRequest,
  auth: Auth = getAuth(),
): Promise<AuthSessionContext | null> {
  const session = await auth.api.getSession({ headers: toHeaders(request) });
  if (!session) return null;
  const user = session.user as unknown as SessionUser;
  if (!user.companyId) return null;
  return {
    companyId: user.companyId,
    user: { id: user.id, email: user.email, name: user.name },
  };
}

/** Result of a credential sign-in: bearer token + the auth_user identity. */
export interface SignInResult {
  token: string;
  companyId: string | null;
  user: { id: string; email: string; name: string };
}

/** Credential sign-in seam for POST /auth/login (injectable in unit tests). */
export type SignIn = (
  email: string,
  password: string,
) => Promise<SignInResult | null>;

/**
 * Sign in with email + password via better-auth. Returns null on invalid
 * credentials (any better-auth APIError — wrong password, unknown user,
 * malformed email); rethrows real infrastructure failures.
 */
export async function signInWithEmail(
  email: string,
  password: string,
  auth: Auth = getAuth(),
): Promise<SignInResult | null> {
  try {
    const result = await auth.api.signInEmail({
      body: { email, password },
    });
    if (!result.token) return null;
    const user = result.user as unknown as SessionUser;
    return {
      token: result.token,
      companyId: user.companyId ?? null,
      user: { id: user.id, email: user.email, name: user.name },
    };
  } catch (err) {
    if (err instanceof APIError) return null;
    throw err;
  }
}
