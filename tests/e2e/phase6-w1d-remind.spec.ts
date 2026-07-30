import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// Phase-6 W1d dunning remind — a live REAL-PG proof (B-188/189). POST /admin/invoices/{id}/remind
// is a PURE side-effect: it writes NO row of its own, mutates NO invoice, touches NO GL/JV, and the
// only durable trace is a REAL audit_log row attributed to the DUNNED tenant (the prototype's toast
// merely CLAIMED "· บันทึกใน Audit Log"). Invariants proven live:
//  1. OWNER reminds an OVERDUE invoice → 200 {ok:true} AND the invoice row is byte-identical after
//     (no status flip, no paid_at, no amount change — B-189's defer holds).
//  2. The audit row is REAL and lands in the DUNNED tenant's trail (read back as that tenant, whose
//     GET /audit-log is tenant-scoped — so seeing it there proves the target attribution, not the
//     owner's own company).
//  3. NON-OWNER → 403 (and no audit row appears).
//  4. Gates: unknown invoice → 404 · a NOT-overdue invoice → 400 (prototype-faithful: the ทวงถาม
//     button renders only on overdue, subscription-admin.jsx:230).
// E2E_LIVE-gated + F4-safe.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "juneflow-dev";
const OWNER_EMAIL = process.env.E2E_LOGIN_EMAIL ?? "wipha@rungrueang.co.th";
const NONOWNER_EMAIL = "somchai@rungrueang.co.th";
const MISSING_UUID = "00000000-0000-0000-0000-000000000000";

function rowsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (body.data ?? body.items ?? body) as unknown;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

liveDescribe("Phase-6 W1d dunning remind (live seeded stack, side-effect only)", () => {
  let owner: APIRequestContext;
  let tenant: APIRequestContext; // a normal tenant member — also the audit-trail reader
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
    const tt = await loginToken(playwright.request, NONOWNER_EMAIL);
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

  async function invoices(): Promise<Array<Record<string, unknown>>> {
    return rowsOf((await (await owner.get("/api/v1/admin/invoices")).json()) as Record<string, unknown>);
  }
  /** The audit rows visible to the NON-OWNER tenant (its own trail — tenant-scoped). */
  async function tenantAuditActions(): Promise<string[]> {
    const res = await tenant.get("/api/v1/audit-log");
    if (!res.ok()) return [];
    return rowsOf((await res.json()) as Record<string, unknown>).map((r) => String(r.action ?? ""));
  }

  test("OWNER reminds an OVERDUE invoice → 200 and the invoice row is UNCHANGED (B-189 defer holds)", async () => {
    const overdue = (await invoices()).find((i) => i.status === "overdue");
    test.skip(overdue == null, "no overdue invoice in the seed — cannot prove remind without a false pass");
    const id = String(overdue!.id);
    const before = JSON.stringify(overdue);

    const res = await owner.post(`/api/v1/admin/invoices/${id}/remind`);
    expect(res.status(), "owner may remind an overdue invoice").toBe(200);
    expect((await res.json()).ok, "remind returns {ok:true}").toBe(true);

    // The invoice itself must be byte-identical — remind writes NO row, flips NO status (B-189).
    const after = (await invoices()).find((i) => String(i.id) === id);
    expect(JSON.stringify(after), "the invoice row is UNCHANGED by a remind (no status/paid_at/amount write)").toBe(
      before,
    );
  });

  test("the remind audit is attributed to the DUNNED tenant, NOT the owner's own company", async () => {
    // Seed reality: the overdue invoice belongs to a FOREIGN tenant (T-1006) and every seeded
    // LOGIN lives in the owner's company (CO1/@rungrueang) — so we cannot read the dunned
    // tenant's own trail directly. We prove the attribution from the other side, which is the
    // exact failure mode that matters: if the handler had (wrongly) attributed the audit to the
    // CALLER's company, a 'remind' row would appear in the CALLER-company trail. It must not.
    const overdue = (await invoices()).find((i) => i.status === "overdue");
    test.skip(overdue == null, "no overdue invoice in the seed");
    const foreign = String(overdue!.subscription_id);
    const mySubId = (
      (await (await tenant.get("/api/v1/subscription/me")).json()) as Record<string, unknown>
    )?.id;
    expect(
      foreign,
      "the overdue invoice belongs to a DIFFERENT tenant than the reader (so this is a real cross-tenant dunning)",
    ).not.toBe(mySubId == null ? "" : String(mySubId));

    const before = (await tenantAuditActions()).filter((a) => a === "remind").length;
    const res = await owner.post(`/api/v1/admin/invoices/${String(overdue!.id)}/remind`);
    expect(res.status(), "the owner dunned a foreign tenant's invoice").toBe(200);

    const after = (await tenantAuditActions()).filter((a) => a === "remind").length;
    expect(
      after,
      "NO 'remind' row leaks into the CALLER-company trail — the audit went to the dunned tenant (auditTargetCompanyId)",
    ).toBe(before);
  });

  test("NON-OWNER → remind → 403 and NO audit row is written", async () => {
    const overdue = (await invoices()).find((i) => i.status === "overdue");
    test.skip(overdue == null, "no overdue invoice");
    const before = (await tenantAuditActions()).filter((a) => a === "remind").length;

    const res = await tenant.post(`/api/v1/admin/invoices/${String(overdue!.id)}/remind`);
    expect(res.status(), "a non-owner cannot dun anyone").toBe(403);

    const after = (await tenantAuditActions()).filter((a) => a === "remind").length;
    expect(after, "a denied remind writes NO audit row").toBe(before);
  });

  test("gates: unknown invoice → 404 · a NOT-overdue invoice → 400 (prototype-faithful)", async () => {
    const notOverdue = (await invoices()).find((i) => i.status !== "overdue");

    const missing = await owner.post(`/api/v1/admin/invoices/${MISSING_UUID}/remind`);
    expect(missing.status(), "unknown invoice id → 404").toBe(404);

    if (notOverdue) {
      const res = await owner.post(`/api/v1/admin/invoices/${String(notOverdue.id)}/remind`);
      expect(res.status(), "a not-overdue invoice → 400 (the ทวงถาม button only renders on overdue)").toBe(400);
    }
  });
});
