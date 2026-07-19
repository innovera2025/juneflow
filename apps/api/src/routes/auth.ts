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

// F4 (B-082) + B-099: the public login endpoint had NO throttle — credential
// brute-force / password-spraying was unbounded. A minimal fixed-window limiter
// caps attempts without a new dependency.
//
// B-099: the PRIMARY guard is per-USER (keyed by the submitted email). A real
// office shares one NAT egress IP but each account logs in rarely, so a tight
// per-IP cap over-blocked a legitimate multi-approver office (orch-B finance-E2E
// tripped 429 at ~5 distinct logins from one IP). Keying the tight cap on the
// ACCOUNT stops credential-stuffing against a single login without penalizing a
// busy shared IP; a much LOOSER per-IP cap still cuts off a broad spray from one
// source. State is per route-registration (per app instance), so it resets
// between tests and never leaks across processes.
const LOGIN_WINDOW_MS = 60_000;
// Per-account cap (the primary guard) — a real user logs in a handful of times.
const LOGIN_MAX_PER_USER = 10;
// Per-IP cap (coarse spray backstop) — set well above a whole office's legitimate
// burst so a shared NAT IP is never the limiting factor; only a broad spray trips it.
const LOGIN_MAX_PER_IP = 50;

interface AttemptWindow {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counter keyed by an arbitrary identity (account email or client
 * IP); true once that key exceeds `max` attempts inside the window.
 */
function loginRateLimited(
  windows: Map<string, AttemptWindow>,
  key: string,
  now: number,
  max: number,
): boolean {
  const current = windows.get(key);
  if (!current || now >= current.resetAt) {
    // Opportunistically drop expired windows so the map stays bounded even
    // under spraying (many distinct keys).
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
    }
    windows.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > max;
}

/** Register POST /auth/login on the given (already /api/v1-prefixed) scope. */
export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  // Per-app login attempt windows (B-099): a per-account window (keyed by email)
  // is the primary guard; a coarse per-IP window still bounds a broad spray.
  const userWindows = new Map<string, AttemptWindow>();
  const ipWindows = new Map<string, AttemptWindow>();

  app.post("/auth/login", async (request, reply) => {
    const body = request.body as
      | { email?: unknown; password?: unknown }
      | null
      | undefined;
    const email = typeof body?.email === "string" ? body.email : "";
    const password = typeof body?.password === "string" ? body.password : "";

    // F4 + B-099: throttle brute-force before touching the credential seam. The
    // per-account window (keyed by the normalized email) is the tight primary
    // guard; the per-IP window is a looser spray backstop. A blank email cannot
    // target an account, so only the per-IP cap applies in that case. The `||`
    // short-circuits: once the account cap trips, the IP window isn't advanced.
    const ip = request.ip || "unknown";
    const now = Date.now();
    const accountKey = email.trim().toLowerCase();
    const throttled =
      (accountKey !== "" &&
        loginRateLimited(userWindows, accountKey, now, LOGIN_MAX_PER_USER)) ||
      loginRateLimited(ipWindows, ip, now, LOGIN_MAX_PER_IP);
    if (throttled) {
      return reply
        .code(429)
        .header("retry-after", String(Math.ceil(LOGIN_WINDOW_MS / 1000)))
        .send({
          code: "RATE_LIMITED",
          message: "Too many login attempts, please try again later",
        });
    }
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
