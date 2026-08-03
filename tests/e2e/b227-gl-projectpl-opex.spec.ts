import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// B-227 — gl.projectpl per-project P&L (money=SERVER) + opex/budgets live proof. gl.projectpl
// computes the P&L server-side from real jv_line (through jv, tenant-scoped); a stubbed unit test
// can't prove the roll-up holds on the LIVE seeded ledger. This asserts on real Postgres:
//  1. GET /gl/reports/project-pl → 200; for EVERY project row the roll-up identities hold
//     (gross_profit = revenue − cogs · pre_tax = ebit − interest · net_income = pre_tax − tax ·
//     tax = pre_tax>0 ? round2(pre_tax×0.20) : 0). A wrong sign/formula corrupts every P&L.
//  2. margins are honest-null at 0 revenue (never a div-by-zero / fabricated 0%).
//  3. opex: POST /opex/budgets with a hostile client currency "USD" → 201 and the stored
//     currency is SERVER "THB" (client value ignored); the SAME (dept,year) again → 409 (dup guard).
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
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
/** pick the first present field name (the wire is opaque; tolerate naming). */
const pick = (r: Record<string, unknown>, ...ks: string[]): number => {
  for (const k of ks) if (r[k] != null) return num(r[k]);
  return NaN;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) < 0.02; // money rounding tolerance

liveDescribe("B-227 gl.projectpl P&L + opex/budgets (live seeded stack, money=SERVER)", () => {
  let owner: APIRequestContext;
  let rateLimited = false;

  const loginToken = async (playwright: typeof import("@playwright/test").request, email: string): Promise<string | null> => {
    const ctx = await playwright.newContext({ baseURL: API_URL });
    const res = await ctx.post("/api/v1/auth/login", { data: { email, password: PASSWORD } }).catch(() => null);
    if (!res || res.status() === 429) { await ctx.dispose(); return res && res.status() === 429 ? "RATE_LIMITED" : null; }
    const token = ((await res.json().catch(() => ({}))) as { token?: string }).token ?? null;
    await ctx.dispose();
    return token;
  };

  test.beforeAll(async ({ playwright }) => {
    const ot = await loginToken(playwright.request, OWNER_EMAIL);
    if (ot === "RATE_LIMITED" || !ot) { rateLimited = true; return; }
    owner = await playwright.request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: `Bearer ${ot}` } });
  });
  test.afterAll(async () => { await owner?.dispose(); });
  test.beforeEach(() => { test.skip(rateLimited, "login throttled (429) — skip honestly"); });

  test("GET /gl/reports/project-pl → 200 and the P&L roll-up identities hold on every project row", async () => {
    const res = await owner.get("/api/v1/gl/reports/project-pl");
    expect(res.status(), "owner may read the per-project P&L").toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // the P&L envelope is { projects: [...], totals: {...} } (NOT the generic {data:[]}).
    const rows = (Array.isArray(body.projects) ? body.projects : rowsOf(body)) as Array<Record<string, unknown>>;
    expect(rows.length, "at least one project P&L row (incl unallocated)").toBeGreaterThan(0);

    let checkedIdentity = 0;
    for (const r of rows) {
      const revenue = pick(r, "revenue");
      const cogs = pick(r, "cogs");
      const sga = pick(r, "sga");
      const interest = pick(r, "interest");
      const gp = pick(r, "gross_profit", "grossProfit", "gp");
      const preTax = pick(r, "pre_tax", "preTax");
      const tax = pick(r, "tax");
      const net = pick(r, "net_income", "netIncome", "net");

      // roll-up identities (the money-critical proof — a wrong sign/formula breaks these)
      if (Number.isFinite(gp) && Number.isFinite(revenue) && Number.isFinite(cogs)) {
        expect(near(gp, revenue - cogs), `gross_profit == revenue − cogs (${gp} vs ${revenue}-${cogs})`).toBe(true);
        checkedIdentity++;
      }
      // ebit is computed server-side but NOT exposed on the wire; verify pre_tax from the
      // exposed gp/sga/interest (pre_tax = gp − sga − interest).
      if (Number.isFinite(preTax) && Number.isFinite(gp) && Number.isFinite(sga) && Number.isFinite(interest)) {
        expect(near(preTax, gp - sga - interest), `pre_tax == gp − sga − interest`).toBe(true);
      }
      if (Number.isFinite(tax) && Number.isFinite(preTax)) {
        const expectTax = preTax > 0 ? round2(preTax * 0.2) : 0;
        expect(near(tax, expectTax), `tax == pre_tax>0 ? round2(pre_tax×0.20) : 0 (${tax} vs ${expectTax})`).toBe(true);
      }
      if (Number.isFinite(net) && Number.isFinite(preTax) && Number.isFinite(tax)) {
        expect(near(net, preTax - tax), `net_income == pre_tax − tax`).toBe(true);
      }
      // honest-null margins at 0 revenue (no div-by-zero, no fabricated 0%)
      if (Number.isFinite(revenue) && revenue === 0) {
        const gpm = r["gross_margin"] ?? r["grossMargin"] ?? r["gp_margin"] ?? null;
        expect(gpm === null || gpm === undefined, "0-revenue → margin is honest-null").toBe(true);
      }
    }
    expect(checkedIdentity, "at least one row exercised the gross_profit identity").toBeGreaterThan(0);
  });

  test("opex: POST with hostile client currency USD → 201 stored THB (server-set) · dup (dept,year) → 409", async () => {
    const uniqDept = "e2e-b227-dept-A";
    const year = 2569;
    const body = { dept: uniqDept, year, months: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], currency_code: "USD" };
    const first = await owner.post("/api/v1/opex/budgets", { data: body });
    expect(first.status(), "owner may create an opex budget").toBe(201);
    const created = await first.json();
    // server owns currency — a client "USD" must be ignored, stored THB.
    expect(String(created.currency_code ?? created.currencyCode ?? ""), "currency is SERVER-set THB, client USD ignored").toBe("THB");

    const dup = await owner.post("/api/v1/opex/budgets", { data: body });
    expect(dup.status(), "a duplicate (dept,year) is rejected 409 (unique guard)").toBe(409);
  });
});
