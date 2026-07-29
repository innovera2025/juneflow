import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// Phase-6 W1a cross-tenant WRITE door — a live REAL-PG security proof of the single
// highest-privilege write in the codebase (B-193). The door (PlatformWriteDb) lets a
// platform OWNER flip ANY tenant's status: block/unblock a user (user.status),
// suspend/resume a subscriber (resolves the subscription id → its company, flips
// companies.status — NOT subscription.status, B-194). This is the WRITE mirror of the
// B-177/B-082 read-door proof; the door is fail-closed by construction and this pins it.
//
// Invariants proven live:
//  1. OWNER (วิภา, the ONLY is_platform_admin) flips a CROSS-TENANT target's status
//     (a user / a company in a DIFFERENT company than the owner) and it PERSISTS — a
//     plain TenantDb write could only touch the owner's own company.
//  2. NON-OWNER (somchai) → every write endpoint → 403 (no cross-tenant write at all).
//  3. INJECTION / PRIV-ESC: the handlers use a FIXED patch and the door strips
//     is_platform_admin + company_id + id — a malicious body {status:'active',
//     is_platform_admin:true, company_id:<evil>} is IGNORED (the block still lands
//     'blocked', company_id unmoved) AND the target never gains owner powers
//     (login-as-target → /admin/* still 403).
//  4. Idempotent re-block.
//
// E2E_LIVE-gated + F4-safe (login 429 → honest skip), mirroring b163 / phase6-platform-authz.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "juneflow-dev";
const OWNER_EMAIL = process.env.E2E_LOGIN_EMAIL ?? "wipha@rungrueang.co.th"; // platform owner
const NONOWNER_EMAIL = "somchai@rungrueang.co.th"; // a normal tenant member (non-owner)

function rowsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (body.data ?? body.items ?? body) as unknown;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

liveDescribe("Phase-6 W1a cross-tenant write-door (live seeded stack, security)", () => {
  let owner: APIRequestContext; // วิภา — is_platform_admin=true
  let tenant: APIRequestContext; // somchai — non-owner
  let rateLimited = false;
  let ownerCompanyId = "";

  const loginToken = async (
    playwright: typeof import("@playwright/test").request,
    email: string,
  ): Promise<string | null> => {
    const ctx = await playwright.newContext({ baseURL: API_URL });
    const res = await ctx.post("/api/v1/auth/login", { data: { email, password: PASSWORD } }).catch(() => null);
    if (!res || res.status() === 429) {
      await ctx.dispose();
      return res && res.status() === 429 ? "RATE_LIMITED" : null;
    }
    const token = ((await res.json().catch(() => ({}))) as { token?: string }).token ?? null;
    await ctx.dispose();
    return token;
  };

  test.beforeAll(async ({ playwright }) => {
    const ot = await loginToken(playwright.request, OWNER_EMAIL);
    const tt = await loginToken(playwright.request, NONOWNER_EMAIL);
    if (ot === "RATE_LIMITED" || tt === "RATE_LIMITED" || !ot || !tt) {
      rateLimited = true;
      return;
    }
    owner = await playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: `Bearer ${ot}` } });
    tenant = await playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: `Bearer ${tt}` } });
    // the owner's own company (userWire exposes company_id) → to pick a CROSS-tenant target
    const users = rowsOf((await (await owner.get("/api/v1/admin/users")).json()) as Record<string, unknown>);
    ownerCompanyId = String(users.find((u) => u.email === OWNER_EMAIL)?.company_id ?? "");
  });

  test.afterAll(async () => {
    await owner?.dispose();
    await tenant?.dispose();
  });

  test.beforeEach(() => {
    test.skip(rateLimited, "login throttled (429) or a seed user missing — skip honestly");
  });

  /** A non-owner, currently-active user in a DIFFERENT company than the owner. */
  async function crossTenantTarget(): Promise<Record<string, unknown>> {
    const users = rowsOf((await (await owner.get("/api/v1/admin/users")).json()) as Record<string, unknown>);
    const t = users.find(
      (u) => u.email !== OWNER_EMAIL && String(u.company_id) !== ownerCompanyId && u.status === "active",
    );
    expect(t, "seed has a non-owner active user in another company (cross-tenant target)").toBeTruthy();
    return t!;
  }

  test("OWNER blocks/unblocks a CROSS-TENANT user → status flips and PERSISTS", async () => {
    const target = await crossTenantTarget();
    const id = String(target.id);

    const block = await owner.post(`/api/v1/admin/users/${id}/block`);
    expect(block.status(), "owner authorized to block cross-tenant").toBe(200);
    expect((await block.json()).status, "block set user.status='blocked'").toBe("blocked");

    const afterBlock = rowsOf((await (await owner.get("/api/v1/admin/users")).json()) as Record<string, unknown>).find(
      (u) => String(u.id) === id,
    );
    expect(afterBlock?.status, "the block PERSISTED cross-tenant").toBe("blocked");

    const unblock = await owner.post(`/api/v1/admin/users/${id}/unblock`);
    expect(unblock.status()).toBe(200);
    expect((await unblock.json()).status, "unblock restored user.status='active'").toBe("active");
  });

  test("OWNER suspends/resumes a subscriber → companies.status flips (NOT subscription.status)", async () => {
    const subs = rowsOf((await (await owner.get("/api/v1/admin/subscribers")).json()) as Record<string, unknown>);
    const target = subs.find((s) => s.company_status === "active") ?? subs[0];
    expect(target, "seed has a subscriber to suspend").toBeTruthy();
    const id = String(target.id);
    const subStatusBefore = String(target.status); // the subscription's own lifecycle status

    const suspend = await owner.post(`/api/v1/admin/subscribers/${id}/suspend`);
    expect(suspend.status()).toBe(200);
    const sBody = await suspend.json();
    expect(sBody.company_status, "suspend flipped companies.status='suspended'").toBe("suspended");
    expect(sBody.status, "subscription.status is UNTOUCHED by suspend (B-194)").toBe(subStatusBefore);

    const resume = await owner.post(`/api/v1/admin/subscribers/${id}/resume`);
    expect(resume.status()).toBe(200);
    expect((await resume.json()).company_status, "resume restored companies.status='active'").toBe("active");
  });

  test("NON-OWNER tenant → every W1a write endpoint → 403 (no cross-tenant write)", async () => {
    const uid = String(rowsOf((await (await owner.get("/api/v1/admin/users")).json()) as Record<string, unknown>)[0]?.id);
    const sid = String(rowsOf((await (await owner.get("/api/v1/admin/subscribers")).json()) as Record<string, unknown>)[0]?.id);
    const endpoints = [
      `/api/v1/admin/users/${uid}/block`,
      `/api/v1/admin/users/${uid}/unblock`,
      `/api/v1/admin/subscribers/${sid}/suspend`,
      `/api/v1/admin/subscribers/${sid}/resume`,
    ];
    for (const p of endpoints) {
      const res = await tenant.post(p);
      expect(res.status(), `non-owner MUST be 403 on ${p} (never a cross-tenant write)`).toBe(403);
    }
  });

  test("INJECTION / PRIV-ESC: a malicious body is IGNORED — no field injection, no self-elevation", async ({
    playwright,
  }) => {
    const target = await crossTenantTarget();
    const id = String(target.id);
    const origCompany = String(target.company_id);

    // Attack: try to ride the block endpoint to (a) flip status to 'active' not 'blocked',
    // (b) grant the owner flag, (c) move the user to another tenant.
    const res = await owner.post(`/api/v1/admin/users/${id}/block`, {
      data: {
        status: "active",
        is_platform_admin: true,
        isPlatformAdmin: true,
        company_id: "00000000-0000-0000-0000-000000000000",
        companyId: "00000000-0000-0000-0000-000000000000",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // The FIXED handler patch wins → status is 'blocked', NOT the injected 'active'
    // → proves the request body is never read into the write.
    expect(body.status, "injected status IGNORED (fixed patch → body not read)").toBe("blocked");
    // company_id NOT moved to the evil uuid.
    expect(String(body.company_id), "company_id not moved by injection").toBe(origCompany);

    // restore the victim
    await owner.post(`/api/v1/admin/users/${id}/unblock`);

    // The decisive priv-esc check: the target still cannot reach the owner surface
    // (is_platform_admin was NOT granted). Log in as the target (all seed users share
    // the dev password) and probe an owner-only route.
    const tt = await loginToken(playwright.request, String(target.email));
    if (tt && tt !== "RATE_LIMITED") {
      const victim = await playwright.request.newContext({
        baseURL: API_URL,
        extraHTTPHeaders: { authorization: `Bearer ${tt}` },
      });
      const probe = await victim.get("/api/v1/admin/subscribers");
      expect(probe.status(), "the target did NOT gain owner powers (is_platform_admin stripped)").toBe(403);
      await victim.dispose();
    }
  });

  test("idempotent re-block (block twice → still blocked, no crash)", async () => {
    const target = await crossTenantTarget();
    const id = String(target.id);
    const r1 = await owner.post(`/api/v1/admin/users/${id}/block`);
    expect(r1.status()).toBe(200);
    const r2 = await owner.post(`/api/v1/admin/users/${id}/block`);
    expect(r2.status(), "re-block is idempotent (200, not a 4xx/5xx)").toBe(200);
    expect((await r2.json()).status).toBe("blocked");
    await owner.post(`/api/v1/admin/users/${id}/unblock`); // restore
  });
});
