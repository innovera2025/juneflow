// POST /auth/login — contract auth entry (P1-BE-01).
//
// Contract (openapi.yaml /auth/login): AuthLoginInput {email,password} →
// 200 AuthLoginResult {token required + user + company + package} | 401 Error.
// B-028(ก): the token is a bearer credential (`Authorization: Bearer <token>`);
// better-auth's bearer plugin accepts the session token issued here.
//
// The route is public (tenant-scope publicPaths /api/v1/auth/*) — it therefore
// receives NO request.db. After better-auth verifies the credentials, we build
// a TenantDb from the auth_user's company_id, so even the login enrichment
// reads (user/company/package) stay tenant-scoped.
import type { FastifyInstance } from "fastify";
import type { Db } from "@juneflow/db/client";
import { TenantDb } from "../db/tenant-db.js";
import type { SignIn } from "../auth.js";
import {
  loadOwnCompany,
  loadPackageUsage,
  loadUserByEmail,
  serializeCompany,
  serializeUser,
} from "./profile-data.js";

export interface AuthRouteOptions {
  /** Base handle — used ONLY to construct a TenantDb after auth succeeds. */
  db: Db;
  /** Credential sign-in seam (prod: better-auth signInWithEmail). */
  signIn: SignIn;
}

const INVALID_CREDENTIALS = {
  code: "INVALID_CREDENTIALS",
  message: "Invalid email or password",
} as const;

/** Register POST /auth/login on the given (already /api/v1-prefixed) scope. */
export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  app.post("/auth/login", async (request, reply) => {
    const body = request.body as
      | { email?: unknown; password?: unknown }
      | null
      | undefined;
    const email = typeof body?.email === "string" ? body.email : "";
    const password = typeof body?.password === "string" ? body.password : "";
    // Contract declares 200/401 only — missing/invalid input is a failed login.
    if (!email || !password) {
      return reply.code(401).send(INVALID_CREDENTIALS);
    }

    const signedIn = await options.signIn(email, password);
    if (!signedIn) return reply.code(401).send(INVALID_CREDENTIALS);

    // A credentialed auth_user without a tenant binding cannot access any
    // tenant-scoped resource — fail closed (misprovisioned account).
    if (!signedIn.companyId) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Account has no tenant binding",
      });
    }

    const db = new TenantDb(options.db, signedIn.companyId);
    const [userRow, companyRow, pkg] = await Promise.all([
      loadUserByEmail(db, signedIn.user.email),
      loadOwnCompany(db),
      loadPackageUsage(db),
    ]);

    // AuthLoginResult: token required; user/company/package are the real
    // seed-backed entities when present.
    return reply.code(200).send({
      token: signedIn.token,
      user: userRow ? serializeUser(userRow) : { ...signedIn.user },
      company: companyRow ? serializeCompany(companyRow) : undefined,
      package: pkg ?? undefined,
    });
  });
}
