import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// Phase-6 W1c plan/seat writes — a live REAL-PG proof (B-201/195/191). Two write surfaces over
// the TENANT-owned `subscription` table, where the door's company_id strip is LOAD-BEARING:
//   1. OWNER PUT /admin/subscribers/{id}/package {package_id,seats} via PlatformWriteDb — sets a
//      sub's plan/seats cross-tenant, but the company_id strip stops any RE-HOME (a smuggled
//      company_id is dropped). Non-owner → 403.
//   2. TENANT POST /subscription/change-plan + /renew via the auto-scoped TenantDb — a tenant
//      touches ONLY its OWN subscription (a smuggled id/company_id can never reach another
//      tenant). money=SERVER: change-plan swaps immediately with NO prorated charge + NO
//      renew_at shift (B-191); renew's next date is server-computed, a client date is ignored.
// E2E_LIVE-gated + F4-safe.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "juneflow-dev";
const OWNER_EMAIL = process.env.E2E_LOGIN_EMAIL ?? "wipha@rungrueang.co.th";
const TENANT_EMAIL = "somchai@rungrueang.co.th";
const EVIL_UUID = "00000000-0000-0000-0000-000000000000";

function rowsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (body.data ?? body.items ?? body) as unknown;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

liveDescribe("Phase-6 W1c plan/seat writes (live seeded stack, security + money)", () => {
  let owner: APIRequestContext;
  let tenant: APIRequestContext;
  let rateLimited = false;

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
    const tt = await loginToken(playwright.request, TENANT_EMAIL);
    if (ot === "RATE_LIMITED" || tt === "RATE_LIMITED" || !ot || !tt) {
      rateLimited = true;
      return;
    }
    owner = await playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: `Bearer ${ot}` } });
    tenant = await playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: `Bearer ${tt}` } });
  });

  test.afterAll(async () => {
    await owner?.dispose();
    await tenant?.dispose();
  });

  test.beforeEach(() => {
    test.skip(rateLimited, "login throttled (429) or a seed user missing — skip honestly");
  });

  async function subscribers(): Promise<Array<Record<string, unknown>>> {
    return rowsOf((await (await owner.get("/api/v1/admin/subscribers")).json()) as Record<string, unknown>);
  }
  async function packages(): Promise<Array<Record<string, unknown>>> {
    return rowsOf((await (await owner.get("/api/v1/admin/packages")).json()) as Record<string, unknown>);
  }

  test("OWNER set-package flips plan+seats but the company_id strip STOPS a re-home (LOAD-BEARING)", async () => {
    const subs = await subscribers();
    const target = subs[0];
    expect(target, "seed has a subscriber").toBeTruthy();
    const id = String(target.id);
    const origCompany = String(target.company_id);
    const newPkg = (await packages()).find((p) => String(p.id) !== String(target.package_id)) ?? (await packages())[0];

    const res = await owner.put(`/api/v1/admin/subscribers/${id}/package`, {
      data: {
        package_id: String(newPkg.id),
        seats: 7,
        // hostile: try to re-home the sub to another tenant + reassign the PK
        company_id: EVIL_UUID,
        companyId: EVIL_UUID,
        id: EVIL_UUID,
      },
    });
    expect(res.status(), "owner authorized to set a subscriber's package").toBe(200);
    const body = await res.json();
    expect(String(body.package_id), "package_id was set").toBe(String(newPkg.id));
    expect(Number(body.seats), "seats override persisted").toBe(7);
    expect(String(body.company_id), "company_id was NOT re-homed (the door strip is load-bearing)").toBe(origCompany);

    // persisted + still same company
    const after = (await subscribers()).find((s) => String(s.id) === id);
    expect(String(after?.company_id), "the sub stayed in its original tenant").toBe(origCompany);
    expect(String(after?.package_id), "the plan change persisted").toBe(String(newPkg.id));
  });

  test("NON-OWNER → set-package → 403 (no cross-tenant admin write)", async () => {
    const id = String((await subscribers())[0]?.id);
    const res = await tenant.put(`/api/v1/admin/subscribers/${id}/package`, {
      data: { package_id: String((await packages())[0]?.id), seats: 3 },
    });
    expect(res.status(), "a non-owner cannot set a subscriber's package").toBe(403);
  });

  test("TENANT change-plan touches ONLY its own sub + money=SERVER (no charge, no renew shift, smuggled ids ignored)", async () => {
    // the tenant's own subscription (via /me)
    const meBefore = (await (await tenant.get("/api/v1/subscription/me")).json()) as Record<string, unknown>;
    test.skip(meBefore == null || meBefore.id == null, "the tenant has no subscription — cannot prove change-plan");
    const ownSubId = String(meBefore.id);
    const renewBefore = String(meBefore.renew_at ?? "");
    const invCountBefore = rowsOf(
      (await (await tenant.get("/api/v1/subscription/invoices")).json()) as Record<string, unknown>,
    ).length;

    // A DIFFERENT tenant's subscription (read via owner) — must stay untouched.
    const otherSub = (await subscribers()).find((s) => String(s.id) !== ownSubId);
    const otherBefore = otherSub ? String(otherSub.package_id) : null;

    const newPkg = (await packages()).find((p) => String(p.id) !== String(meBefore.package_id)) ?? (await packages())[0];
    const res = await tenant.post("/api/v1/subscription/change-plan", {
      data: {
        package_id: String(newPkg.id),
        cycle: "yearly",
        // hostile: try to steer the write at ANOTHER tenant's sub
        id: otherSub ? String(otherSub.id) : EVIL_UUID,
        company_id: otherSub ? String(otherSub.company_id) : EVIL_UUID,
      },
    });
    expect(res.status(), "tenant can change its OWN plan").toBe(200);
    const me = await res.json();
    expect(String(me.package_id), "the tenant's OWN plan changed to the new package").toBe(String(newPkg.id));
    expect(me.cycle, "cycle swapped to yearly").toBe("yearly");
    expect(String(me.renew_at ?? ""), "renew_at is UNSHIFTED by a plan change (B-191 no proration)").toBe(renewBefore);

    // money=SERVER: no charge/invoice was created by the swap
    const invCountAfter = rowsOf(
      (await (await tenant.get("/api/v1/subscription/invoices")).json()) as Record<string, unknown>,
    ).length;
    expect(invCountAfter, "change-plan writes NO platform_invoice (B-191 no prorated charge)").toBe(invCountBefore);

    // cross-tenant isolation: the OTHER tenant's sub was NOT touched by the smuggled id
    if (otherSub) {
      const otherAfter = String((await subscribers()).find((s) => String(s.id) === String(otherSub.id))?.package_id);
      expect(otherAfter, "the smuggled id/company_id could NOT reach another tenant's sub").toBe(otherBefore);
    }
  });

  test("TENANT renew advances renew_at by one server-computed cycle — a client date is IGNORED", async () => {
    const meBefore = (await (await tenant.get("/api/v1/subscription/me")).json()) as Record<string, unknown>;
    test.skip(meBefore == null || meBefore.id == null, "no subscription");
    const before = new Date(String(meBefore.renew_at));
    const cycle = String(meBefore.cycle);

    const res = await tenant.post("/api/v1/subscription/renew", {
      data: { renew_at: "2099-01-01T00:00:00Z", renewAt: "2099-01-01T00:00:00Z" }, // hostile client date
    });
    expect(res.status()).toBe(200);
    const after = new Date(String((await res.json()).renew_at));
    expect(after.getUTCFullYear(), "renew_at is server-computed, NOT the client's 2099").not.toBe(2099);
    // exactly one cycle forward from the prior renew_at
    const expected = new Date(before.getTime());
    if (cycle === "yearly") expected.setUTCFullYear(expected.getUTCFullYear() + 1);
    else expected.setUTCMonth(expected.getUTCMonth() + 1);
    expect(after.getTime(), `renew advanced exactly one ${cycle} cycle (server-computed UTC)`).toBe(expected.getTime());
  });
});
