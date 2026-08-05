// G3 unit tests (PLAN.md §9) — B-282, the auth PRODUCTION chain.
//
// What this covers, and why each part is here rather than assumed:
//   1. the happy chain end to end — invite → forgot → reset → LOGIN. The last
//      link is the point: before B-282 an invited user was provisioned no
//      credential at all, so the assertion that matters is that a sign-in with
//      the newly set password succeeds and that a sign-in BEFORE the reset does
//      not (FakeCredentialStore.signInWith verifies against what setPassword
//      actually stored, so a reset that quietly did nothing fails here).
//   2. every negative the slice names: expired token, reused token, wrong token,
//      unknown address (must be indistinguishable from a known one), and a
//      cross-tenant attempt.
//   3. the enumeration properties — identical status AND identical body bytes on
//      /auth/forgot regardless of whether the address exists, and no token in
//      any response body on any of the three endpoints.
//   4. the generated SQL of the one production statement that touches a
//      tenant-owned table (DbCredentialStore.activateInvitedUser), because a
//      fake cannot prove the company_id predicate is really bound.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import {
  DbCredentialStore,
  hashResetToken,
  newResetToken,
  RESET_TOKEN_TTL_MS,
  type ResetDeliveryMessage,
} from "../auth-provisioning.js";
import { FakeCredentialStore } from "../auth-provisioning-fake.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";
const EMAIL = "napha@juneflow.co.th";

/** The auth routes are public, so nothing here ever reaches request.db. */
function inertDb(): Db {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  } as unknown as Db;
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

interface Harness {
  app: FastifyInstance;
  credentials: FakeCredentialStore;
  delivered: ResetDeliveryMessage[];
}

async function buildHarness(overrides: Partial<AppDeps> = {}): Promise<Harness> {
  const credentials =
    (overrides.credentials as FakeCredentialStore | undefined) ??
    new FakeCredentialStore();
  const delivered: ResetDeliveryMessage[] = [];
  app = await buildApp({
    db: overrides.db ?? inertDb(),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: createFakeR2Storage("https://r2.test"),
    quota: new QuotaGuard({
      resolver: unlimitedQuotaResolver,
      upgradeUrl: "https://upgrade.test",
    }),
    auditSink: async () => {},
    credentials,
    deliverReset: overrides.deliverReset ?? ((m) => void delivered.push(m)),
    logger: false,
  });
  return { app, credentials, delivered };
}

const forgot = (h: Harness, email: unknown) =>
  h.app.inject({
    method: "POST",
    url: "/api/v1/auth/forgot",
    headers: { "content-type": "application/json" },
    payload: { email },
  });

const reset = (h: Harness, token: unknown, password: unknown) =>
  h.app.inject({
    method: "POST",
    url: "/api/v1/auth/reset",
    headers: { "content-type": "application/json" },
    payload: { token, password },
  });

// ---------------------------------------------------------------------------
describe("B-282 chain — forgot → reset → login", () => {
  it("issues a token, resets the password, and the account can then log in", async () => {
    const credentials = new FakeCredentialStore();
    // A provisioned invite: credentialed, but no password yet.
    credentials.seed({ authUserId: "au-1", companyId: COMPANY_A, email: EMAIL });
    const h = await buildHarness({ credentials });

    // Before any reset the account cannot sign in — the pre-B-282 state.
    expect(credentials.signInWith(EMAIL, "correct-horse")).toBeNull();

    const asked = await forgot(h, EMAIL);
    expect(asked.statusCode).toBe(200);
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0]!.kind).toBe("forgot");
    expect(h.delivered[0]!.to).toBe(EMAIL);
    expect(credentials.tokens.size).toBe(1);

    const token = h.delivered[0]!.token;
    const done = await reset(h, token, "correct-horse");
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ ok: true });

    // The last link: the credential now actually works.
    expect(credentials.signInWith(EMAIL, "correct-horse")).not.toBeNull();
    // ...and only with the new password.
    expect(credentials.signInWith(EMAIL, "wrong-password")).toBeNull();
  });

  it("stores only the DIGEST — the raw token never appears in a response", async () => {
    const credentials = new FakeCredentialStore();
    credentials.seed({ authUserId: "au-1", companyId: COMPANY_A, email: EMAIL });
    const h = await buildHarness({ credentials });

    const res = await forgot(h, EMAIL);
    const token = h.delivered[0]!.token;

    expect(res.body).not.toContain(token);
    expect([...credentials.tokens.keys()]).toEqual([hashResetToken(token)]);
    // The stored key is a digest, not the token.
    expect([...credentials.tokens.keys()][0]).not.toBe(token);

    const done = await reset(h, token, "correct-horse");
    expect(done.body).not.toContain(token);
  });

  it("kills every live session when the password changes", async () => {
    const credentials = new FakeCredentialStore();
    credentials.seed({
      authUserId: "au-1",
      companyId: COMPANY_A,
      email: EMAIL,
      sessions: ["live-bearer-1", "live-bearer-2"],
    });
    const h = await buildHarness({ credentials });

    await forgot(h, EMAIL);
    await reset(h, h.delivered[0]!.token, "correct-horse");

    expect(credentials.accounts.get("au-1")!.sessions).toEqual([]);
  });

  it("completes the invite state machine (invited → active) on the token's OWN tenant", async () => {
    const credentials = new FakeCredentialStore();
    credentials.seed({ authUserId: "au-1", companyId: COMPANY_A, email: EMAIL });
    const h = await buildHarness({ credentials });

    await forgot(h, EMAIL);
    await reset(h, h.delivered[0]!.token, "correct-horse");

    expect(credentials.activations).toHaveLength(1);
    expect(credentials.activations[0]).toEqual({
      authUserId: "au-1",
      companyId: COMPANY_A,
      email: EMAIL,
    });
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/v1/auth/forgot — no account enumeration", () => {
  it("answers an unknown address IDENTICALLY to a known one (status + body bytes)", async () => {
    const credentials = new FakeCredentialStore();
    credentials.seed({ authUserId: "au-1", companyId: COMPANY_A, email: EMAIL });
    const known = await buildHarness({ credentials });
    const knownRes = await forgot(known, EMAIL);
    await known.app.close();

    const unknown = await buildHarness();
    const unknownRes = await forgot(unknown, "nobody@example.test");

    expect(unknownRes.statusCode).toBe(knownRes.statusCode);
    expect(unknownRes.body).toBe(knownRes.body);
    // ...and nothing was issued or sent for the unknown address.
    expect(unknown.credentials.tokens.size).toBe(0);
    expect(unknown.delivered).toHaveLength(0);
  });

  it("answers a malformed address with the same body and never touches the store", async () => {
    const h = await buildHarness();
    const res = await forgot(h, "not-an-email");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(h.credentials.tokens.size).toBe(0);
  });

  it("keeps the uniform 200 when the TOKEN WRITE throws (a 500 would be an oracle)", async () => {
    // Only the known-address branch reaches the write, so a 500 here would mean
    // "this address exists" — the exact signal the uniform 200 exists to hide.
    const credentials = new FakeCredentialStore();
    credentials.seed({ authUserId: "au-1", companyId: COMPANY_A, email: EMAIL });
    credentials.issueError = new Error("verification insert failed");
    const known = await buildHarness({ credentials });
    const knownRes = await forgot(known, EMAIL);
    await known.app.close();

    const unknown = await buildHarness();
    const unknownRes = await forgot(unknown, "nobody@example.test");

    expect(knownRes.statusCode).toBe(200);
    expect(knownRes.body).toBe(unknownRes.body);
  });

  it("keeps the uniform 200 when delivery THROWS (a 500 would be an oracle)", async () => {
    const credentials = new FakeCredentialStore();
    credentials.seed({ authUserId: "au-1", companyId: COMPANY_A, email: EMAIL });
    const h = await buildHarness({
      credentials,
      deliverReset: () => {
        throw new Error("smtp is down");
      },
    });

    const res = await forgot(h, EMAIL);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("throttles repeated requests for the same address from one source", async () => {
    const credentials = new FakeCredentialStore();
    credentials.seed({ authUserId: "au-1", companyId: COMPANY_A, email: EMAIL });
    const h = await buildHarness({ credentials });

    let last;
    for (let i = 0; i < 6; i++) last = await forgot(h, EMAIL);
    expect(last!.statusCode).toBe(429);
    expect(last!.json().code).toBe("RATE_LIMITED");
    // The victim's inbox got 5 messages, not 6 — the cap really bounds delivery.
    expect(h.delivered).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/v1/auth/reset — negative paths", () => {
  async function invited() {
    const credentials = new FakeCredentialStore();
    credentials.seed({ authUserId: "au-1", companyId: COMPANY_A, email: EMAIL });
    const h = await buildHarness({ credentials });
    await forgot(h, EMAIL);
    return { h, credentials, token: h.delivered[0]!.token };
  }

  it("rejects an EXPIRED token and leaves the password unset", async () => {
    const credentials = new FakeCredentialStore();
    credentials.seed({ authUserId: "au-1", companyId: COMPANY_A, email: EMAIL });
    credentials.issueExpiredAt = new Date(Date.now() - 1_000);
    const h = await buildHarness({ credentials });
    await forgot(h, EMAIL);

    const res = await reset(h, h.delivered[0]!.token, "correct-horse");
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_TOKEN");
    expect(credentials.accounts.get("au-1")!.password).toBeNull();
    expect(credentials.signInWith(EMAIL, "correct-horse")).toBeNull();
  });

  it("rejects a REUSED token — single use, and the first password survives", async () => {
    const { h, credentials, token } = await invited();

    const first = await reset(h, token, "correct-horse");
    expect(first.statusCode).toBe(200);

    const second = await reset(h, token, "attacker-chosen");
    expect(second.statusCode).toBe(400);
    expect(second.json().code).toBe("INVALID_TOKEN");
    // The replay did NOT overwrite the legitimate password.
    expect(credentials.accounts.get("au-1")!.password).toBe("correct-horse");
    expect(credentials.signInWith(EMAIL, "attacker-chosen")).toBeNull();
  });

  it("rejects a WRONG token with the same opaque error", async () => {
    const { h } = await invited();
    const res = await reset(h, newResetToken().token, "correct-horse");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: "INVALID_TOKEN",
      message: "This password reset link is invalid or has expired",
    });
  });

  it("rejects an EMPTY / missing token", async () => {
    const { h } = await invited();
    expect((await reset(h, "", "correct-horse")).statusCode).toBe(400);
    expect((await reset(h, undefined, "correct-horse")).statusCode).toBe(400);
  });

  it("rejects a token whose STORED digest does not match (constant-time re-check)", async () => {
    const { h, credentials, token } = await invited();
    // A store that matched loosely and handed back a near-miss record.
    credentials.corruptStoredHash = hashResetToken("some-other-token");

    const res = await reset(h, token, "correct-horse");
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_TOKEN");
    expect(credentials.accounts.get("au-1")!.password).toBeNull();
  });

  it("rejects a too-short password WITHOUT burning the token", async () => {
    const { h, credentials, token } = await invited();

    const weak = await reset(h, token, "short");
    expect(weak.statusCode).toBe(400);
    expect(weak.json().code).toBe("VALIDATION");
    // The token is still live — a policy rejection must not cost the user their
    // one-shot link.
    expect(credentials.tokens.size).toBe(1);

    const good = await reset(h, token, "correct-horse");
    expect(good.statusCode).toBe(200);
  });

  it("throttles token guessing from one source", async () => {
    const h = await buildHarness();
    let last;
    for (let i = 0; i < 21; i++) last = await reset(h, newResetToken().token, "correct-horse");
    expect(last!.statusCode).toBe(429);
    expect(last!.json().code).toBe("RATE_LIMITED");
  });
});

// ---------------------------------------------------------------------------
describe("B-282 tenant scope — a reset cannot cross companies", () => {
  it("activates ONLY the token's own company, never a same-email row elsewhere", async () => {
    const credentials = new FakeCredentialStore();
    // The SAME address credentialed in two tenants is impossible today
    // (auth_user.email is globally unique — B-283), but the reset path must not
    // depend on that: force the situation and prove the activation is pinned.
    credentials.seed({ authUserId: "au-a", companyId: COMPANY_A, email: EMAIL });
    credentials.accounts.set("au-b", {
      authUserId: "au-b",
      companyId: COMPANY_B,
      email: EMAIL,
      password: null,
      sessions: [],
    });
    const h = await buildHarness({ credentials });

    // Issue against tenant B's account specifically.
    const { token, hash } = newResetToken();
    await credentials.issueResetToken("au-b", hash, new Date(Date.now() + RESET_TOKEN_TTL_MS));

    const res = await reset(h, token, "correct-horse");
    expect(res.statusCode).toBe(200);

    expect(credentials.activations).toEqual([
      { authUserId: "au-b", companyId: COMPANY_B, email: EMAIL },
    ]);
    // Tenant A's credential is untouched.
    expect(credentials.accounts.get("au-a")!.password).toBeNull();
    expect(credentials.accounts.get("au-b")!.password).toBe("correct-horse");
  });

  it("binds company_id + status='invited' into activateInvitedUser's SQL", async () => {
    // The fake cannot prove the real predicate, so assert the generated SQL of
    // the production store — the one statement that touches a tenant table.
    const captured: SQL[] = [];
    const db = {
      update: () => ({
        set: () => ({
          where: (where: SQL) => {
            captured.push(where);
            return Promise.resolve([]);
          },
        }),
      }),
    } as unknown as Db;

    await new DbCredentialStore(db).activateInvitedUser({
      authUserId: "au-1",
      companyId: COMPANY_A,
      email: EMAIL,
    });

    expect(captured).toHaveLength(1);
    const params = new PgDialect().sqlToQuery(captured[0]!).params;
    expect(params).toContain(COMPANY_A);
    expect(params).toContain(EMAIL);
    expect(params).toContain("invited");
  });

  it("does nothing at all when the account carries no tenant binding", async () => {
    let touched = false;
    const db = {
      update: () => {
        touched = true;
        return { set: () => ({ where: () => Promise.resolve([]) }) };
      },
    } as unknown as Db;

    await new DbCredentialStore(db).activateInvitedUser({
      authUserId: "au-1",
      companyId: null,
      email: EMAIL,
    });

    expect(touched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("B-282 — the declared ops are actually mounted", () => {
  it("does not 404 POST /auth/forgot or POST /auth/reset", async () => {
    // The whole slice starts here: both ops were declared in openapi.yaml with
    // no handler behind them, so every call answered the flat 404.
    const h = await buildHarness();
    expect((await forgot(h, "nobody@example.test")).statusCode).not.toBe(404);
    expect((await reset(h, "x", "correct-horse")).statusCode).not.toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("B-282 token minting", () => {
  it("mints unguessable, unique, structureless tokens", () => {
    const minted = new Set<string>();
    for (let i = 0; i < 200; i++) minted.add(newResetToken().token);
    expect(minted.size).toBe(200);

    const { token, hash } = newResetToken();
    // 32 random bytes → 43 base64url chars, no padding.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // sha256 hex.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashResetToken(token));
    // Carries no user id / counter / timestamp.
    expect(token).not.toContain("au-");
  });
});
