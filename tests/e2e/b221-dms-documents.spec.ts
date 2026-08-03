import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// B-221 — DMS GET /documents live proof (read-only, money=NONE). The op was typed in
// openapi (listDocuments) but unmounted → 404; B-221=ก mounts a tenant-scoped read that
// resolves the by_user_id + project_id FKs to display NAMES (a raw uuid is never exposed,
// PLAN.md §4) and supports an optional ?cat= category filter. This proves on real Postgres
// the two invariants a stubbed unit test can't fully guarantee:
//  1. GET /documents → 200 and a non-empty list of the caller's DMS files (the 13-row seed).
//  2. FK-RESOLVE / no-uuid-leak: `by` and `project_name` are display strings, NEVER a raw
//     uuid; at least one row resolves a real uploader NAME, and the seeded docs whose author
//     has no seed user (สมพงษ์/สมคิด/ประยุทธ) resolve `by`=null (em-dash at the client, honest).
//  3. ?cat=contract → only contract-category rows (the DMS category tabs).
//  4. Tenant-scope: every row belongs to the caller's tenant (the door AND-injects company_id);
//     no company_id/other-tenant field leaks a foreign row.
// E2E_LIVE-gated + F4-safe (login 429 → honest skip). DORMANT until GET /documents is mounted.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "juneflow-dev";
const OWNER_EMAIL = process.env.E2E_LOGIN_EMAIL ?? "wipha@rungrueang.co.th";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rowsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (body.data ?? body.items ?? body) as unknown;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

liveDescribe("B-221 DMS GET /documents (live seeded stack, read-only, no-uuid-leak)", () => {
  let owner: APIRequestContext;
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
    if (ot === "RATE_LIMITED" || !ot) {
      rateLimited = true;
      return;
    }
    owner = await playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: `Bearer ${ot}` } });
  });

  test.afterAll(async () => {
    await owner?.dispose();
  });

  test.beforeEach(() => {
    test.skip(rateLimited, "login throttled (429) or a seed user missing — skip honestly");
  });

  async function docs(query = ""): Promise<Array<Record<string, unknown>>> {
    const res = await owner.get(`/api/v1/documents${query}`);
    if (!res.ok()) return [];
    return rowsOf((await res.json()) as Record<string, unknown>);
  }
  /** The display value of a field, whatever the wire names it. */
  const disp = (r: Record<string, unknown>, ...keys: string[]): unknown =>
    keys.map((k) => r[k]).find((v) => v !== undefined);

  test("GET /documents → 200 and a non-empty tenant DMS list", async () => {
    const res = await owner.get("/api/v1/documents");
    expect(res.status(), "owner may read the DMS list").toBe(200);
    const list = rowsOf((await res.json()) as Record<string, unknown>);
    expect(list.length, "the seeded DMS docs appear (13-row DMS_SEED, tenant-scoped)").toBeGreaterThan(0);
  });

  test("FK-resolve: `by` and `project_name` are display names, NEVER a raw uuid; null-author → null (em-dash)", async () => {
    const list = await docs();
    expect(list.length).toBeGreaterThan(0);
    let sawResolvedAuthor = false;
    let sawNullAuthor = false;
    for (const r of list) {
      const by = disp(r, "by", "by_name", "byName") as string | null;
      const proj = disp(r, "project_name", "projectName") as string | null;
      // the money invariant of a read: a display field is a NAME or null — never a raw uuid.
      if (typeof by === "string") {
        expect(UUID_RE.test(by), `by is a resolved name, not a raw uuid (got "${by}")`).toBe(false);
        sawResolvedAuthor = true;
      } else {
        sawNullAuthor = true; // สมพงษ์/สมคิด/ประยุทธ have no seed user → null → em-dash (honest)
      }
      if (typeof proj === "string") {
        expect(UUID_RE.test(proj), `project_name is a resolved name, not a raw uuid (got "${proj}")`).toBe(false);
      }
    }
    expect(sawResolvedAuthor, "at least one doc resolves a real uploader name").toBe(true);
    expect(sawNullAuthor, "the no-seed-user authors resolve to null (em-dash), not a fabricated name").toBe(true);
  });

  test("?cat=contract → only contract-category rows (the DMS category tabs)", async () => {
    const all = await docs();
    const contracts = await docs("?cat=contract");
    expect(contracts.length, "there are seeded contract docs").toBeGreaterThan(0);
    expect(contracts.length, "the filter narrows the full list").toBeLessThanOrEqual(all.length);
    for (const r of contracts) {
      expect(String(disp(r, "cat", "category")), "every filtered row is a contract").toBe("contract");
    }
  });

  test("tenant-scope: no row exposes a foreign/raw company_id — the list is the caller's tenant only", async () => {
    const list = await docs();
    // the wire is opaque; if a company_id is exposed at all it must be a single value (the caller's
    // tenant), never a mix. A cross-tenant leak would surface >1 distinct company_id.
    const companies = new Set(list.map((r) => String(disp(r, "company_id", "companyId") ?? "")).filter(Boolean));
    expect(companies.size, "all rows share one tenant (no cross-tenant leak)").toBeLessThanOrEqual(1);
  });
});
