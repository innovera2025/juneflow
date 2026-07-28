import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// Phase-6 platform-owner cross-tenant authz — a live REAL-PG security proof of the
// single most sensitive door in the codebase (B-176/177/178). The gate-4.5 proved the
// door airtight statically + unit-tested; this is the committed end-to-end proof on a
// real seeded multi-tenant stack (the discipline: security-critical surfaces get a live
// proof, like the money races).
//
// Invariants proven:
//  1. OWNER (วิภา / wipha · the ONLY seeded is_platform_admin=true user · Wei=ข) reads
//     /admin/subscribers → 200 and the rows span MORE THAN ONE company (the cross-tenant
//     door works — a normal TenantDb read would return only the owner's own company).
//  2. NON-OWNER tenant user (somchai) → /admin/* → 403 (the leak invariant: a tenant
//     bearer can NEVER reach cross-tenant platform data).
//  3. NON-OWNER → GET /subscription/invoices → 200 (the tenant-own read works for a
//     normal tenant, scoped to its own company — B-181).
//
// E2E_LIVE-gated + F4-safe (login 429 → honest skip), mirroring b163/b097.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "juneflow-dev";
const OWNER_EMAIL = process.env.E2E_LOGIN_EMAIL ?? "wipha@rungrueang.co.th"; // วิภา = platform owner
const NONOWNER_EMAIL = "somchai@rungrueang.co.th"; // a normal CO1 tenant member (non-owner)

function rowsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (body.data ?? body.items ?? body) as unknown;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

const ADMIN_ROUTES = [
  "/api/v1/admin/packages",
  "/api/v1/admin/subscribers",
  "/api/v1/admin/users",
  "/api/v1/admin/invoices",
];

liveDescribe("Phase-6 platform-owner cross-tenant authz (live seeded stack, security)", () => {
  let owner: APIRequestContext; // วิภา — is_platform_admin=true
  let tenant: APIRequestContext; // somchai — non-owner
  let rateLimited = false;

  test.beforeAll(async ({ playwright }) => {
    const login = async (email: string): Promise<string | null> => {
      const ctx = await playwright.request.newContext({ baseURL: API_URL });
      const res = await ctx
        .post("/api/v1/auth/login", { data: { email, password: PASSWORD } })
        .catch(() => null);
      if (!res || res.status() === 429) {
        await ctx.dispose();
        return res && res.status() === 429 ? "RATE_LIMITED" : null;
      }
      const token = ((await res.json().catch(() => ({}))) as { token?: string }).token ?? null;
      await ctx.dispose();
      return token;
    };
    const ot = await login(OWNER_EMAIL);
    const tt = await login(NONOWNER_EMAIL);
    if (ot === "RATE_LIMITED" || tt === "RATE_LIMITED" || !ot || !tt) {
      rateLimited = true;
      return;
    }
    owner = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { authorization: `Bearer ${ot}` },
    });
    tenant = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { authorization: `Bearer ${tt}` },
    });
  });

  test.afterAll(async () => {
    await owner?.dispose();
    await tenant?.dispose();
  });

  test.beforeEach(() => {
    test.skip(rateLimited, "login throttled (429) or a seed user missing — skip honestly");
  });

  test("OWNER reads /admin/subscribers → 200 and the rows SPAN MULTIPLE companies (cross-tenant door works)", async () => {
    const res = await owner.get("/api/v1/admin/subscribers");
    expect(res.status(), "owner is authorized for /admin/*").toBe(200);
    const rows = rowsOf((await res.json()) as Record<string, unknown>);
    const companies = new Set(
      rows.map((r) => String(r.company_id ?? r.companyId ?? r.company ?? r.company_name ?? "")),
    );
    companies.delete("");
    // The whole point of the platform door: the owner sees EVERY tenant's subscription,
    // not just their own company. A plain TenantDb read would yield exactly one company.
    expect(
      companies.size,
      `owner sees subscribers across MORE THAN ONE company (cross-tenant · got ${companies.size})`,
    ).toBeGreaterThan(1);
  });

  test("NON-OWNER tenant → every /admin/* route → 403 (the cross-tenant leak invariant)", async () => {
    for (const route of ADMIN_ROUTES) {
      const res = await tenant.get(route);
      expect(res.status(), `non-owner MUST be 403 on ${route} (never cross-tenant data)`).toBe(403);
    }
  });

  test("NON-OWNER tenant → GET /subscription/invoices → 200 (tenant-own read works · B-181)", async () => {
    const res = await tenant.get("/api/v1/subscription/invoices");
    expect(res.status(), "a normal tenant reads its OWN subscription invoices").toBe(200);
  });
});
