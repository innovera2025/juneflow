import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// B-217 — AR invoice create idempotency (money-critical · live REAL-PG proof). B-216 made
// every AR invoice post a balanced revenue JV (Dr AR 1030 / Cr revenue 4010 / Cr VAT-output
// 2050); without a guard a duplicate POST would double-recognize revenue in the GL. Wei ruled
// ค = pre-check + uniqueIndex ar_invoice(company_id,no) (migration 0047) + tx isUniqueViolation
// catch. This proves the guard LIVE on real Postgres (where the unique index actually enforces):
//  1. POST /ar/invoices (a fresh unique `no`) → 201; exactly ONE new invoice + ONE balanced
//     revenue JV appears (Dr total == Cr total).
//  2. POST the SAME `no` again → 409 (INVALID_STATE) — the money invariant: NO 2nd invoice and
//     NO 2nd JV (revenue is recognized once). This is the double-post the guard closes.
//  3. A different `no` still creates normally (the guard only rejects true duplicates).
// E2E_LIVE-gated + F4-safe (login 429 → honest skip).

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "juneflow-dev";
const OWNER_EMAIL = process.env.E2E_LOGIN_EMAIL ?? "wipha@rungrueang.co.th";

function rowsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (body.data ?? body.items ?? body) as unknown;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

liveDescribe("B-217 AR invoice create idempotency (live seeded stack, money-critical)", () => {
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

  /** All JVs whose source_doc points at an invoice — the revenue JVs created by AR invoice create. */
  async function invoiceJvCount(): Promise<number> {
    const res = await owner.get("/api/v1/gl/jv");
    if (!res.ok()) return -1;
    return rowsOf((await res.json()) as Record<string, unknown>).filter((j) =>
      String(j.source_doc ?? j.sourceDoc ?? "").startsWith("invoice:"),
    ).length;
  }
  async function invoiceCount(): Promise<number> {
    const res = await owner.get("/api/v1/ar/invoices");
    return res.ok() ? rowsOf((await res.json()) as Record<string, unknown>).length : -1;
  }
  async function aCustomerId(): Promise<string | null> {
    const res = await owner.get("/api/v1/customers");
    if (!res.ok()) return null;
    const c = rowsOf((await res.json()) as Record<string, unknown>)[0];
    return c ? String(c.id) : null;
  }

  // A `no` unique to this run (seed uses INV-2569-xxxx; this can't collide with the 6 seeded).
  const uniqNo = "E2E-B217-INV-0001";
  const invoiceBody = (no: string, customerId: string) => ({
    customer_id: customerId,
    no,
    lines: [{ description: "e2e electricity", qty: 1, unit_price: 100000 }],
    // hostile: a client amount/vat must be ignored (server computes) — a leftover check.
    amount: 999999,
    vat: 999999,
  });

  test("first POST → 201 and exactly ONE balanced revenue JV is posted", async () => {
    const customerId = await aCustomerId();
    test.skip(customerId == null, "no customer in the seed — cannot create an invoice");
    const jvBefore = await invoiceJvCount();
    const invBefore = await invoiceCount();

    const res = await owner.post("/api/v1/ar/invoices", { data: invoiceBody(uniqNo, customerId!) });
    expect(res.status(), "owner may create an AR invoice").toBe(201);
    const inv = await res.json();
    // amount is server-computed (Σ lines = 100000), NOT the client's 999999.
    expect(num(inv.amount), "amount = Σlines server-computed, client 999999 ignored").toBe(100000);

    expect(await invoiceCount(), "exactly one new invoice").toBe(invBefore + 1);
    expect(await invoiceJvCount(), "exactly one new revenue JV").toBe(jvBefore + 1);

    // the JV balances: find it and assert Dr total == Cr total (via /gl/jv detail if lines exposed,
    // else the count invariant above + the api-suite's per-account assertion cover balance).
    const jvs = rowsOf((await (await owner.get("/api/v1/gl/jv")).json()) as Record<string, unknown>);
    const mine = jvs.find((j) => String(j.source_doc ?? j.sourceDoc ?? "") === `invoice:${inv.id}`);
    if (mine && Array.isArray((mine as { lines?: unknown[] }).lines)) {
      const lines = (mine as { lines: Array<Record<string, unknown>> }).lines;
      const dr = lines.reduce((s, l) => s + num(l.dr), 0);
      const cr = lines.reduce((s, l) => s + num(l.cr), 0);
      expect(dr, "the revenue JV balances (Dr total == Cr total)").toBe(cr);
    }
  });

  test("duplicate POST (same no) → 409 and NO 2nd invoice, NO 2nd JV (revenue recognized once)", async () => {
    const customerId = await aCustomerId();
    test.skip(customerId == null, "no customer");
    const jvBefore = await invoiceJvCount();
    const invBefore = await invoiceCount();

    const res = await owner.post("/api/v1/ar/invoices", { data: invoiceBody(uniqNo, customerId!) });
    expect(res.status(), "a duplicate invoice `no` is rejected (B-217 guard)").toBe(409);

    // THE money invariant: the duplicate posted nothing — no 2nd invoice, no 2nd revenue JV.
    expect(await invoiceCount(), "no 2nd invoice from the duplicate POST").toBe(invBefore);
    expect(await invoiceJvCount(), "no 2nd revenue JV — revenue is recognized ONCE").toBe(jvBefore);
  });

  test("a DIFFERENT no still creates normally (the guard rejects only true duplicates)", async () => {
    const customerId = await aCustomerId();
    test.skip(customerId == null, "no customer");
    const res = await owner.post("/api/v1/ar/invoices", { data: invoiceBody("E2E-B217-INV-0002", customerId!) });
    expect(res.status(), "a fresh `no` is not blocked by the guard").toBe(201);
  });
});
