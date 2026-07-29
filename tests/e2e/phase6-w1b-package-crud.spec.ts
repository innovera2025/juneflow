import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// Phase-6 W1b package-CRUD — a live REAL-PG proof (B-196/B-197). The owner creates/edits the
// GLOBAL plan catalog through the write door's NEW insertOne primitive. The invariants:
//  1. OWNER creates a package (POST /admin/packages) → 201, and money=SERVER: the YEARLY price
//     is DERIVED server-side (price_m × 10 = "ประหยัด 2 เดือน") — a CLIENT-sent price_y is
//     IGNORED, and the currency is server-set 'THB' (client can't override).
//  2. OWNER edits a package (PUT /admin/packages/{id}) → 200, changes persist (name/price/cols).
//  3. NON-OWNER → 403 on create AND edit (no cross-tenant/global write).
//  4. NO delete — DELETE /admin/packages/{id} has no route (B-196=ก).
// E2E_LIVE-gated + F4-safe. Runs on a throwaway stack, so creating test packages is harmless.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "juneflow-dev";
const OWNER_EMAIL = process.env.E2E_LOGIN_EMAIL ?? "wipha@rungrueang.co.th";
const NONOWNER_EMAIL = "somchai@rungrueang.co.th";

function rowsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (body.data ?? body.items ?? body) as unknown;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

liveDescribe("Phase-6 W1b package-CRUD (live seeded stack, owner write)", () => {
  let owner: APIRequestContext;
  let tenant: APIRequestContext;
  let rateLimited = false;
  let template: Record<string, unknown> = {};

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
    // an existing package as a template — its `size` (enum) + `menus` (valid nav ids) are
    // guaranteed-valid so create/edit don't 400 on a guessed enum/nav id.
    template = rowsOf((await (await owner.get("/api/v1/admin/packages")).json()) as Record<string, unknown>)[0] ?? {};
  });

  test.afterAll(async () => {
    await owner?.dispose();
    await tenant?.dispose();
  });

  test.beforeEach(() => {
    test.skip(rateLimited || !template.size, "login throttled (429) or no seed package — skip honestly");
  });

  function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: "e2e-w1b-pkg",
      size: template.size,
      menus: template.menus,
      price_m: 500,
      // hostile fields the server MUST ignore / override:
      price_y: 999999,
      yearly: 999999,
      currency_code: "USD",
      id: "00000000-0000-0000-0000-000000000000",
      ...overrides,
    };
  }

  test("OWNER creates a package → 201, money=SERVER (price_y=price_m×10, client price_y & currency IGNORED)", async () => {
    const res = await owner.post("/api/v1/admin/packages", { data: createBody({ name: "e2e-w1b-create", popular: true }) });
    expect(res.status(), "owner authorized to create a plan").toBe(201);
    const pkg = await res.json();
    expect(num(pkg.price_m), "monthly price persisted").toBe(500);
    expect(num(pkg.price_y), "YEARLY is server-derived price_m×10 — the client's 999999 is IGNORED").toBe(5000);
    expect(pkg.currency_code, "currency is server-set THB — the client's USD is IGNORED").toBe("THB");
    expect(pkg.popular, "non-money col persisted").toBe(true);
    expect(String(pkg.id), "the door assigned a real id, not the injected zero-uuid").not.toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });

  test("OWNER edits a package → 200, changes persist (money still server-derived)", async () => {
    const created = await (await owner.post("/api/v1/admin/packages", { data: createBody({ name: "e2e-w1b-edit-src" }) })).json();
    const id = String(created.id);
    const res = await owner.put(`/api/v1/admin/packages/${id}`, { data: createBody({ name: "e2e-w1b-edited", price_m: 700 }) });
    expect(res.status()).toBe(200);
    const upd = await res.json();
    expect(upd.name, "edit persisted the new name").toBe("e2e-w1b-edited");
    expect(num(upd.price_y), "yearly re-derived from the new monthly (700×10)").toBe(7000);
  });

  test("NON-OWNER → create AND edit → 403 (no global-catalog write)", async () => {
    const create = await tenant.post("/api/v1/admin/packages", { data: createBody() });
    expect(create.status(), "non-owner cannot create a plan").toBe(403);
    const put = await tenant.put(`/api/v1/admin/packages/${String(template.id)}`, { data: createBody() });
    expect(put.status(), "non-owner cannot edit a plan").toBe(403);
  });

  test("NO delete-package route (B-196) — DELETE is not wired", async () => {
    const res = await owner.delete(`/api/v1/admin/packages/${String(template.id)}`);
    // No route → Fastify 404 (or 405). Must NOT be a 2xx (a real delete would orphan subscriptions).
    expect(res.status(), "delete-package is deliberately unbuilt (B-196)").toBeGreaterThanOrEqual(404);
    // sanity: the template package still exists
    const still = rowsOf((await (await owner.get("/api/v1/admin/packages")).json()) as Record<string, unknown>).find(
      (p) => String(p.id) === String(template.id),
    );
    expect(still, "the package was NOT deleted").toBeTruthy();
  });
});
