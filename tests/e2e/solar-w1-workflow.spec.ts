import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// Solar Wave-1 (FLOW-EPC) workflow writes — a live REAL-PG proof (B-212). Four NON-MONEY
// workflow surfaces on the solar tag: open/close an O&M ticket, add a permit step, add a
// warranty registry item. money=NONE by ruling (spec-scout: the mock forms carry no money
// field; O&M/warranty do NOT post cost/provision — Wei B-212). The PPA money surface is
// Wave-1b (reuse AR-invoice posting · a separate spec).
//
// Invariants proven live (INVARIANT-based, minimal field assumptions — the write body is the
// opaque Entity, so we discover shapes from the list GET rather than hard-coding columns):
//  1. OWNER opens an O&M ticket → 201; it APPEARS in GET /solar/om-tickets (count +1).
//  2. Close it → 200 and its status becomes 'closed'; a RE-close → 409 (idempotent, the close
//     lands on the FINAL status UPDATE WHERE status != 'closed' — 0 rows → 409, mirrors gr/pm).
//  3. Close an UNKNOWN id → 404.
//  4. Add a permit step → 201 (count +1); add a warranty → 201 (count +1).
//  5. Tenant-scope: the door force-sets company_id — a smuggled company_id is dropped, the row
//     stays in the caller's tenant (a plain cross-tenant write is impossible by construction).
//
// E2E_LIVE-gated + F4-safe (login 429 → honest skip). DORMANT until the Solar Wave-1 endpoints
// land (they 404 today); orch-B runs it live at the merge SHA per sub-wave.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "juneflow-dev";
const OWNER_EMAIL = process.env.E2E_LOGIN_EMAIL ?? "wipha@rungrueang.co.th";
const MISSING_UUID = "00000000-0000-0000-0000-000000000000";

function rowsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (body.data ?? body.items ?? body) as unknown;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}
/** The status-ish field on a row, whatever it is named (opaque Entity). */
function statusOf(row: Record<string, unknown> | undefined): string {
  return String(row?.status ?? row?.state ?? "");
}

liveDescribe("Solar Wave-1 workflow writes (live seeded stack, non-money)", () => {
  let owner: APIRequestContext;
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
    if (ot === "RATE_LIMITED" || !ot) {
      rateLimited = true;
      return;
    }
    owner = await playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: `Bearer ${ot}` } });
    const users = rowsOf((await (await owner.get("/api/v1/admin/users")).json().catch(() => ({}))) as Record<string, unknown>);
    ownerCompanyId = String(users.find((u) => u.email === OWNER_EMAIL)?.company_id ?? "");
  });

  test.afterAll(async () => {
    await owner?.dispose();
  });

  test.beforeEach(() => {
    test.skip(rateLimited, "login throttled (429) or a seed user missing — skip honestly");
  });

  async function list(path: string): Promise<Array<Record<string, unknown>>> {
    const res = await owner.get(`/api/v1/${path}`);
    if (!res.ok()) return [];
    return rowsOf((await res.json()) as Record<string, unknown>);
  }

  test("OWNER opens an O&M ticket → 201 and it appears in the list (+1)", async () => {
    const before = (await list("solar/om-tickets")).length;
    const res = await owner.post("/api/v1/solar/om-tickets", {
      data: { title: "e2e-w1 O&M", priority: "medium", status: "open", company_id: MISSING_UUID }, // smuggled company_id must be dropped
    });
    expect(res.status(), "owner may open an O&M ticket").toBe(201);
    const created = await res.json();
    expect(String(created.company_id), "the door force-set the caller's tenant (smuggled id dropped)").toBe(ownerCompanyId);
    const after = await list("solar/om-tickets");
    expect(after.length, "the new ticket is listed").toBe(before + 1);
    return created;
  });

  test("close an O&M ticket → 200 status=closed · RE-close → 409 (idempotent) · unknown → 404", async () => {
    // create a fresh ticket to close (independent of ordering)
    const created = await (await owner.post("/api/v1/solar/om-tickets", { data: { title: "e2e-w1 close-target", status: "open" } })).json();
    const id = String(created.id);

    const close1 = await owner.post(`/api/v1/solar/om-tickets/${id}/close`);
    expect(close1.status(), "first close succeeds").toBe(200);
    const afterClose = (await list("solar/om-tickets")).find((t) => String(t.id) === id);
    expect(statusOf(afterClose), "the ticket is now closed").toBe("closed");

    const close2 = await owner.post(`/api/v1/solar/om-tickets/${id}/close`);
    expect(close2.status(), "re-close is a 409 (idempotent · 0-row on the final UPDATE)").toBe(409);

    const missing = await owner.post(`/api/v1/solar/om-tickets/${MISSING_UUID}/close`);
    expect(missing.status(), "unknown ticket → 404").toBe(404);
  });

  test("OWNER adds a permit step → 201 and it appears (+1)", async () => {
    const before = (await list("solar/permit-steps")).length;
    const res = await owner.post("/api/v1/solar/permit-steps", {
      data: { name: "e2e-w1 permit", org: "กฟภ.", status: "pending", company_id: MISSING_UUID },
    });
    expect(res.status(), "owner may add a permit step").toBe(201);
    expect(String((await res.json()).company_id), "tenant force-set").toBe(ownerCompanyId);
    expect((await list("solar/permit-steps")).length, "the permit step is listed").toBe(before + 1);
  });

  test("OWNER adds a warranty registry item → 201 and it appears (+1) · money=NONE", async () => {
    const before = (await list("solar/warranties")).length;
    const res = await owner.post("/api/v1/solar/warranties", {
      data: { item: "e2e-w1 inverter", brand: "Huawei", qty: 1, status: "active", company_id: MISSING_UUID },
    });
    expect(res.status(), "owner may add a warranty item").toBe(201);
    const created = await res.json();
    expect(String(created.company_id), "tenant force-set").toBe(ownerCompanyId);
    // money=NONE: a warranty add composes no JV/GL — there is no amount/currency posting on this row.
    expect((await list("solar/warranties")).length, "the warranty item is listed").toBe(before + 1);
  });

  // Wave-1b (PPA · money) — placeholder. PPA billing reuses the AR-invoice create path
  // (customer=กฟภ. · manual amount · VAT round(amt*0.07) SERVER-computed · post AR via the
  // existing revenue account · Wei B-212). Filled when Wave-1b lands.
  test.skip("Wave-1b: solar.ppa ออกใบแจ้งหนี้ค่าไฟ → AR invoice, VAT+total SERVER-computed (money=SERVER)", () => {});
});
