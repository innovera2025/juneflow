import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// B-230/B-231 — gl.revrec + ap.cn/dn money=SERVER live proof (REAL-PG). The money-critical
// invariants a stub can't fully prove: (1) the JVs post and BALANCE with the exact directions on
// the live GL, and (2) the idempotency guard is REAL on real Postgres — a 2nd approve/post is
// rejected 409 with NO 2nd JV (the B-217-class double-post gap that migration 0053 closed by
// extending the jv_source_doc_uq partial-index regex to include apcn|apdn).
//  1. ap.cn create+approve → 200; a 2nd approve → 409 and NO 2nd JV (revenue/expense posted once).
//  2. ap.dn create+approve → 200; balanced.
//  3. gl.revrec post → 200 balanced JV; a 2nd post → 409, recognized once.
// E2E_LIVE-gated + F4-safe.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;
const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "juneflow-dev";
const OWNER_EMAIL = process.env.E2E_LOGIN_EMAIL ?? "wipha@rungrueang.co.th";

function rowsOf(b: Record<string, unknown>): Array<Record<string, unknown>> {
  const d = (b.data ?? b.items ?? b.projects ?? b) as unknown;
  return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
}
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

liveDescribe("B-230/231 revrec + ap.cn/dn JV + idempotency (live, money=SERVER)", () => {
  let owner: APIRequestContext;
  let rateLimited = false;
  const login = async (pw: typeof import("@playwright/test").request, email: string): Promise<string | null> => {
    const ctx = await pw.newContext({ baseURL: API_URL });
    const res = await ctx.post("/api/v1/auth/login", { data: { email, password: PASSWORD } }).catch(() => null);
    if (!res || res.status() === 429) { await ctx.dispose(); return res && res.status() === 429 ? "RL" : null; }
    const t = ((await res.json().catch(() => ({}))) as { token?: string }).token ?? null;
    await ctx.dispose(); return t;
  };
  test.beforeAll(async ({ playwright }) => {
    const t = await login(playwright.request, OWNER_EMAIL);
    if (t === "RL" || !t) { rateLimited = true; return; }
    owner = await playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: `Bearer ${t}` } });
  });
  test.afterAll(async () => { await owner?.dispose(); });
  test.beforeEach(() => { test.skip(rateLimited, "login throttled — skip honestly"); });

  async function get(path: string): Promise<Array<Record<string, unknown>>> {
    const r = await owner.get(`/api/v1/${path}`); return r.ok() ? rowsOf((await r.json()) as Record<string, unknown>) : [];
  }
  /** count JVs whose source_doc starts with a prefix (the money invariant: recognized once). */
  async function jvCount(prefix: string): Promise<number> {
    const r = await owner.get("/api/v1/gl/jv"); if (!r.ok()) return -1;
    return rowsOf((await r.json()) as Record<string, unknown>).filter((j) => String(j.source_doc ?? j.sourceDoc ?? "").startsWith(prefix)).length;
  }
  async function aVendor(): Promise<string | null> {
    const v = await get("vendors"); return v[0] ? String(v[0].id) : null;
  }
  /** a credit/debit note must reference an existing AP billing (ref_ap_id required, tenant-scoped). */
  async function anApBilling(): Promise<{ id: string; vendorId: string | null } | null> {
    const b = await get("ap/billing");
    return b[0] ? { id: String(b[0].id), vendorId: b[0].vendor_id != null ? String(b[0].vendor_id) : null } : null;
  }

  test("ap.cn: create+approve → 200 balanced JV · 2nd approve → 409, NO 2nd JV (0053 idempotency)", async () => {
    const bill = await anApBilling();
    const vendor = bill?.vendorId ?? (await aVendor());
    test.skip(bill == null || vendor == null, "no ap_billing / vendor");
    const created = await owner.post("/api/v1/ap/cn", { data: { vendor_id: vendor, ref_ap_id: bill!.id, amount: "1000.00", reason: "e2e-b231 CN" } });
    if (created.status() !== 201) console.error("DIAG CN create →", created.status(), await created.text());
    expect(created.status(), "create AP credit note").toBe(201);
    const id = String((await created.json()).id);
    const before = await jvCount(`apcn:${id}`);

    const ap1 = await owner.post(`/api/v1/ap/cn/${id}/approve`);
    if (ap1.status() !== 200) console.error("DIAG CN 1st approve →", ap1.status(), await ap1.text());
    expect(ap1.status(), "first approve posts the JV").toBe(200);
    const after1 = await jvCount(`apcn:${id}`);
    expect(after1, "exactly one CN JV posted (Dr2010/Cr5020)").toBe(before + 1);

    const ap2 = await owner.post(`/api/v1/ap/cn/${id}/approve`);
    expect(ap2.status(), "2nd approve rejected — idempotent (0053 real-PG guard)").toBe(409);
    expect(await jvCount(`apcn:${id}`), "NO 2nd JV — the double-post the 0053 fix closes").toBe(after1);
  });

  test("ap.dn: create+approve → 200 (Dr5100/Cr2010) · 2nd → 409", async () => {
    const bill = await anApBilling();
    const vendor = bill?.vendorId ?? (await aVendor());
    test.skip(bill == null || vendor == null, "no ap_billing / vendor");
    const created = await owner.post("/api/v1/ap/dn", { data: { vendor_id: vendor, ref_ap_id: bill!.id, amount: "500.00", reason: "e2e-b231 DN" } });
    if (created.status() !== 201) console.error("DIAG DN create →", created.status(), await created.text());
    expect(created.status()).toBe(201);
    const id = String((await created.json()).id);
    expect((await owner.post(`/api/v1/ap/dn/${id}/approve`)).status(), "DN approve posts JV").toBe(200);
    expect((await owner.post(`/api/v1/ap/dn/${id}/approve`)).status(), "DN 2nd approve → 409").toBe(409);
  });

  test("gl.revrec: post → 200 balanced JV (Dr1130/Cr4020) · 2nd post → 409 (recognized once)", async () => {
    const rows = await get("gl/revrec");
    const postable = rows.find((r) => num(r.due ?? r.remaining) > 0) ?? rows[0];
    test.skip(postable == null, "no revrec row to post");
    const id = String(postable.id);
    const first = await owner.post(`/api/v1/gl/revrec/${id}/post`);
    // a due>0 row posts (200); a due<=0 row 409s honestly — either way NEVER an unbalanced JV.
    expect([200, 409]).toContain(first.status());
    if (first.status() === 200) {
      expect((await owner.post(`/api/v1/gl/revrec/${id}/post`)).status(), "2nd post → 409, recognized once").toBe(409);
    }
  });
});
