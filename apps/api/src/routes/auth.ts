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

// F4 (B-082) + B-099 + B-100: the public login endpoint had NO throttle —
// credential brute-force / password-spraying was unbounded. A minimal
// fixed-window limiter caps attempts without a new dependency.
//
// B-099 made the tight cap per-account; B-100 hardens that against an
// account-lockout DoS (orch-B skeptic finding). Three rules:
//   (ก) only FAILED attempts count — a correct login never advances a window;
//   (ข) a correct credential bypasses the account counter — a valid user is
//       never throttled, even mid-spray, and their window is cleared on success;
//   (ค) the account window is keyed on account+IP, so an attacker spraying a
//       victim's (unauthenticated, attacker-supplied) email from their own IP
//       fills only (victim, attackerIP) and can never lock out the real victim.
// A coarse per-IP window still backstops a broad spray from one source. State is
// per route-registration (per app instance), so it resets between tests and
// never leaks across processes.
const LOGIN_WINDOW_MS = 60_000;
// Per-(account+IP) FAILED-attempt cap (the primary guard).
const LOGIN_MAX_PER_USER = 10;
// Coarse per-IP FAILED-attempt cap (broad-spray backstop) — well above a whole
// office's legitimate burst so a shared NAT IP is never the limiting factor.
const LOGIN_MAX_PER_IP = 50;

interface AttemptWindow {
  count: number;
  resetAt: number;
}

/**
 * Read-only: has `key` already reached `max` failed attempts in the current
 * window? An expired or absent window is not over the limit.
 */
function overFailureLimit(
  windows: Map<string, AttemptWindow>,
  key: string,
  now: number,
  max: number,
): boolean {
  const current = windows.get(key);
  if (!current || now >= current.resetAt) return false;
  return current.count >= max;
}

/**
 * Record ONE failed attempt for `key`, opening or rolling its fixed window, and
 * return the window's new count. Only failures are ever counted (B-100), so a
 * successful login never advances a throttle.
 */
function registerFailure(
  windows: Map<string, AttemptWindow>,
  key: string,
  now: number,
): number {
  const current = windows.get(key);
  if (!current || now >= current.resetAt) {
    // Opportunistically drop expired windows so the map stays bounded even under
    // a wide spray of distinct account+IP keys (B-100 MED: userWindows growth).
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
    }
    windows.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return 1;
  }
  current.count += 1;
  return current.count;
}

/** Register POST /auth/login on the given (already /api/v1-prefixed) scope. */
export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  // Per-app login FAILED-attempt windows (B-099/B-100): the primary window is
  // keyed on account+IP; a coarse per-IP window backstops a broad spray. Both
  // count only failures and reset per app instance.
  const userWindows = new Map<string, AttemptWindow>();
  const ipWindows = new Map<string, AttemptWindow>();

  app.post("/auth/login", async (request, reply) => {
    const body = request.body as
      | { email?: unknown; password?: unknown }
      | null
      | undefined;
    const email = typeof body?.email === "string" ? body.email : "";
    const password = typeof body?.password === "string" ? body.password : "";

    // Contract declares 200/401 only — missing/invalid input is a failed login.
    // Malformed input never touches the throttle (it cannot guess a password).
    if (!email || !password) {
      return reply.code(401).send(INVALID_CREDENTIALS);
    }

    const ip = request.ip || "unknown";
    const now = Date.now();
    const accountKey = email.trim().toLowerCase();
    // B-100 (ค): the per-account failure window is keyed on account+IP. B-099
    // keyed it on the (attacker-supplied, unauthenticated) email alone and counted
    // EVERY attempt, so ~11 requests against a victim's email tripped the window
    // and locked the real victim out (an account-lockout DoS). Scoping the key to
    // the source IP means an attacker's spray fills only (victim, attackerIP) —
    // the real victim, from their own IP, keeps an untouched window.
    const pairKey = `${accountKey}|${ip}`;
    const rateLimited = () =>
      reply
        .code(429)
        .header("retry-after", String(Math.ceil(LOGIN_WINDOW_MS / 1000)))
        .send({
          code: "RATE_LIMITED",
          message: "Too many login attempts, please try again later",
        });

    // Coarse per-IP backstop (B-099): a broad spray from one source is malicious
    // regardless of which account it targets — pre-block it before the credential
    // seam. Read-only + NOT account-keyed, so it can never lock out one victim.
    if (overFailureLimit(ipWindows, ip, now, LOGIN_MAX_PER_IP)) {
      return rateLimited();
    }

    const signedIn = await options.signIn(email, password);
    if (!signedIn) {
      // B-100 (ก): only FAILED attempts count. Record the failure against the
      // account+IP window and the coarse IP window; once this account+IP is over
      // the cap, throttle the (still-failing) attacker — otherwise a plain 401.
      registerFailure(ipWindows, ip, now);
      if (registerFailure(userWindows, pairKey, now) > LOGIN_MAX_PER_USER) {
        return rateLimited();
      }
      return reply.code(401).send(INVALID_CREDENTIALS);
    }

    // B-100 (ข): a CORRECT credential bypasses the account counter entirely — a
    // valid login is never throttled — and clears the account+IP failure window,
    // so a burst of typos before the right password does not leave it throttled.
    userWindows.delete(pairKey);

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
