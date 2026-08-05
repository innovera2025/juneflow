// POST /auth/login + /auth/forgot + /auth/reset — the contract auth surface
// (P1-BE-01 · B-282).
//
// Contract (openapi.yaml): /auth/login AuthLoginInput {email,password} → 200
// AuthLoginResult {token required + user + company + package} | 401 Error;
// /auth/forgot (~L111) and /auth/reset (~L127) take an opaque Entity body and
// answer 200 EntityOk. All three carry `security: []` — they are public.
// B-028(ก): the login token is a bearer credential (`Authorization: Bearer
// <token>`); better-auth's bearer plugin accepts the session token issued here.
//
// B-282: /auth/forgot and /auth/reset were DECLARED in the contract but never
// mounted, so a user who lost (or, after the invite fix, never had) a password
// had no route back in. They are mounted here, on the same throttle machinery
// and the same injected-seam pattern as login.
//
// The routes are public (tenant-scope publicPaths /api/v1/auth/*) — they
// therefore receive NO request.db. After better-auth verifies the credentials,
// login builds a TenantDb from the auth_user's company_id, so even the login
// enrichment reads (user/company/package) stay tenant-scoped; the reset path
// touches tenant data only through CredentialStore.activateInvitedUser, which
// pins its update to the token's own auth_user.company_id.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "@juneflow/db/client";
import { TenantDb } from "../db/tenant-db.js";
import type { SignIn } from "../auth.js";
import {
  hashResetToken,
  newResetToken,
  resetHashesMatch,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  RESET_TOKEN_TTL_MS,
  type CredentialStore,
  type ResetDelivery,
  type ResetDeliveryMessage,
} from "../auth-provisioning.js";
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
  /** Credential/reset seam (prod: DbCredentialStore over the base handle). */
  credentials: CredentialStore;
  /** Reset-token delivery seam (default: no-op — see auth-provisioning.ts). */
  deliverReset: ResetDelivery;
}

const INVALID_CREDENTIALS = {
  code: "INVALID_CREDENTIALS",
  message: "Invalid email or password",
} as const;

/**
 * The ONE response POST /auth/forgot ever gives. Identical for a known address,
 * an unknown one, a malformed one, and a delivery failure — the endpoint must
 * never become an account-enumeration oracle.
 */
const FORGOT_ACCEPTED = { ok: true } as const;

/**
 * The ONE failure POST /auth/reset gives for anything token-shaped: unknown,
 * already used, expired, or issued for a deleted account. Distinguishing them
 * would tell an attacker which guesses were "closer".
 */
const INVALID_RESET_TOKEN = {
  code: "INVALID_TOKEN",
  message: "This password reset link is invalid or has expired",
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

// B-282 — the reset paths get their OWN windows, never the login ones. Sharing
// LOGIN's ipWindows would let a forgot-spray from a NAT IP throttle that whole
// office out of LOGIN too (an availability coupling the B-100 rework
// deliberately removed from the account key; the same reasoning applies here).
//
// Unlike login, EVERY /auth/forgot request counts: there is no "success" that
// proves the requester is legitimate, and an unthrottled forgot is a
// mail-bombing primitive aimed at a victim's inbox. Both keys are attacker-side
// (their supplied email + their own IP), so an attacker can never fill a window
// that a real user would be measured against — the B-100 (ค) lockout-DoS rule.
const FORGOT_MAX_PER_PAIR = 5;
const FORGOT_MAX_PER_IP = 30;
// /auth/reset is keyed on IP alone (a token is not an account identifier). The
// token is 256-bit random, so this bounds noise rather than guessing.
const RESET_MAX_PER_IP = 20;

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

/** Flat 429 + retry-after, shared by every throttled auth path. */
function rateLimited(reply: FastifyReply, message: string): FastifyReply {
  return reply
    .code(429)
    .header("retry-after", String(Math.ceil(LOGIN_WINDOW_MS / 1000)))
    .send({ code: "RATE_LIMITED", message });
}

/**
 * Hand a freshly issued token to the delivery seam, absorbing any failure.
 *
 * A delivery failure must NOT change the caller-visible outcome: on /auth/forgot
 * a 500 here would mean "this address exists" (the unknown-address path never
 * calls delivery), which is precisely the oracle the uniform 200 exists to
 * prevent. The log line carries the flow and the error's CLASS only — never the
 * message, never the recipient, and above all never `message.token`.
 */
async function deliver(
  request: FastifyRequest,
  send: ResetDelivery,
  message: ResetDeliveryMessage,
): Promise<void> {
  try {
    await send(message);
  } catch (err) {
    request.log.error(
      { kind: message.kind, error: (err as { name?: string })?.name },
      "password-reset delivery failed",
    );
  }
}

/**
 * Register the public auth routes — POST /auth/login, /auth/forgot, /auth/reset
 * — on the given (already /api/v1-prefixed) scope.
 */
export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  // Per-app login FAILED-attempt windows (B-099/B-100): the primary window is
  // keyed on account+IP; a coarse per-IP window backstops a broad spray. Both
  // count only failures and reset per app instance.
  const userWindows = new Map<string, AttemptWindow>();
  const ipWindows = new Map<string, AttemptWindow>();
  // B-282: independent windows for the reset paths (see the constants above).
  const forgotPairWindows = new Map<string, AttemptWindow>();
  const forgotIpWindows = new Map<string, AttemptWindow>();
  const resetIpWindows = new Map<string, AttemptWindow>();

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
    const tooManyLogins = () =>
      rateLimited(reply, "Too many login attempts, please try again later");

    // Coarse per-IP backstop (B-099): a broad spray from one source is malicious
    // regardless of which account it targets — pre-block it before the credential
    // seam. Read-only + NOT account-keyed, so it can never lock out one victim.
    if (overFailureLimit(ipWindows, ip, now, LOGIN_MAX_PER_IP)) {
      return tooManyLogins();
    }

    const signedIn = await options.signIn(email, password);
    if (!signedIn) {
      // B-100 (ก): only FAILED attempts count. Record the failure against the
      // account+IP window and the coarse IP window; once this account+IP is over
      // the cap, throttle the (still-failing) attacker — otherwise a plain 401.
      registerFailure(ipWindows, ip, now);
      if (registerFailure(userWindows, pairKey, now) > LOGIN_MAX_PER_USER) {
        return tooManyLogins();
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

  // --- POST /auth/forgot (B-282) --------------------------------------------
  // Request a reset. Answers the SAME 200 body for every input — known address,
  // unknown address, malformed address, delivery failure — so it can never be
  // used to discover which addresses have accounts.
  app.post("/auth/forgot", async (request, reply) => {
    const body = request.body as { email?: unknown } | null | undefined;
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const ip = request.ip || "unknown";
    const now = Date.now();
    const pairKey = `${email.toLowerCase()}|${ip}`;

    // Throttle BEFORE any lookup. Both windows are keyed on values the
    // requester supplies about themselves, so the 429 is identical whether or
    // not the address exists — the throttle is not an oracle either.
    if (
      overFailureLimit(forgotIpWindows, ip, now, FORGOT_MAX_PER_IP) ||
      overFailureLimit(forgotPairWindows, pairKey, now, FORGOT_MAX_PER_PAIR)
    ) {
      return rateLimited(reply, "Too many reset requests, please try again later");
    }
    registerFailure(forgotIpWindows, ip, now);
    registerFailure(forgotPairWindows, pairKey, now);

    // A syntactically impossible address cannot match an account — answer the
    // uniform body without touching the store.
    if (!email.includes("@")) return reply.code(200).send(FORGOT_ACCEPTED);

    // Minted unconditionally so the CSPRNG + digest work is identical on both
    // branches. The residual asymmetry is one DB write plus the delivery call on
    // the known-address branch; closing that fully would need a decoy write,
    // which is not worth the extra failure mode.
    const { token, hash } = newResetToken();
    const expiresAt = new Date(now + RESET_TOKEN_TTL_MS);

    const account = await options.credentials.findByEmail(email);
    if (account) {
      await options.credentials.issueResetToken(account.authUserId, hash, expiresAt);
      // Delivered to the address ON THE ACCOUNT, never to the address supplied
      // in the body — those are equal here, but pinning it to the stored value
      // means no future change to the lookup can redirect someone's token.
      await deliver(request, options.deliverReset, {
        to: account.email,
        token,
        kind: "forgot",
        expiresAt,
      });
    }

    return reply.code(200).send(FORGOT_ACCEPTED);
  });

  // --- POST /auth/reset (B-282) ---------------------------------------------
  // Consume a token and set the password. Single-use is enforced inside the
  // store by DELETE ... RETURNING (atomic), not by a check-then-write here.
  app.post("/auth/reset", async (request, reply) => {
    const body = request.body as
      | { token?: unknown; password?: unknown }
      | null
      | undefined;
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const ip = request.ip || "unknown";
    const now = Date.now();

    if (overFailureLimit(resetIpWindows, ip, now, RESET_MAX_PER_IP)) {
      return rateLimited(reply, "Too many reset attempts, please try again later");
    }

    // One indistinguishable answer for every token-shaped failure.
    const invalidToken = () => {
      registerFailure(resetIpWindows, ip, now);
      return reply.code(400).send(INVALID_RESET_TOKEN);
    };

    if (!token) return invalidToken();
    if (
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      // A password-policy rejection is the caller's own input problem and says
      // nothing about the token, so it is NOT counted against the token window.
      return reply.code(400).send({
        code: "VALIDATION",
        message: `password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
      });
    }

    // Only the digest ever leaves this frame — the raw token is never stored,
    // logged, or echoed.
    const hash = hashResetToken(token);
    const record = await options.credentials.consumeResetToken(hash);
    if (!record) return invalidToken();
    // Second layer: the digest the store returned must equal the one we asked
    // for, compared in constant time. Guards against a store that matched the
    // record loosely (prefix/LIKE/case-folded) and handed back a near-miss.
    if (!resetHashesMatch(record.hash, hash)) return invalidToken();
    // Consumed either way — an expired token is dead, and re-presenting it now
    // takes the "already used" path.
    if (record.expiresAt.getTime() <= now) return invalidToken();

    // Sets the credential AND drops every live session for the account.
    await options.credentials.setPassword(record.account.authUserId, password);
    // Completes the invite state machine (invited → active), pinned to the
    // token's own auth_user.company_id — a reset can never cross tenants.
    await options.credentials.activateInvitedUser(record.account);

    return reply.code(200).send({ ok: true });
  });
}
