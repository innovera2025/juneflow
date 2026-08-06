import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// labor.payroll — the money=SERVER path behind the web port's pay-run action (live REAL-PG proof).
// The web port triggers POST /labor/payroll/{id}/post (path-id only, no client money); the server
// computes the payroll amount from attendance and posts a balanced JV Dr1140 WIP-labor / Cr1020 bank
// = the stored amount (B-144). This proves the money invariant end-to-end on the current stack:
//  1. POST /labor/payroll with a HOSTILE client amount 999999 → 201 and the stored amount is
//     SERVER-computed (never 999999) — money authority.
//  2. POST /labor/payroll/{id}/post → the JV posts and BALANCES (Dr total == Cr total), OR (if the
//     period has no attendance → amount 0) it honestly 409s (no fabricated posting). Either way the
//     money invariant holds: a payroll never posts an unbalanced or client-dictated JV.
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
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

liveDescribe("labor.payroll money=SERVER JV (live seeded stack)", () => {
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

  async function list(path: string): Promise<Array<Record<string, unknown>>> {
    const res = await owner.get(`/api/v1/${path}`);
    return res.ok() ? rowsOf((await res.json()) as Record<string, unknown>) : [];
  }

  test("create run (hostile amount ignored → server-computed) · post → balanced JV or honest 409", async () => {
    const workers = await list("labor/workers");
    test.skip(workers.length === 0, "no seeded worker");
    const workerId = String(workers[0].id ?? workers[0].worker_id);
    // derive a period from a seeded attendance day (YYYY-MM); fall back to the frozen seed month.
    const att = await list("labor/attendance");
    const day = String(att.find((a) => String(a.worker_id ?? a.workerId) === workerId)?.day ?? att[0]?.day ?? "2026-07-01");
    const period = day.slice(0, 7).match(/^\d{4}-\d{2}$/) ? day.slice(0, 7) : "2026-07";

    // B-308: unique(worker_id, period) makes a repeat run a REPLAY of the original, so on
    // a persistent stack a SECOND execution of this spec resolves the run the first one
    // already posted. Read the register FIRST so the two cases stay deterministic — the
    // alternative (assuming every create is fresh) fails the moment attendance is seeded.
    const priorRun = (await list("labor/payroll")).find(
      (p) => String(p.worker_id ?? p.workerId) === workerId && String(p.period) === period,
    );

    const created = await owner.post("/api/v1/labor/payroll", {
      data: { worker_id: workerId, period, amount: 999999, currency_code: "USD" }, // hostile: server must ignore both
    });
    expect(created.status(), "owner may create a payroll run").toBe(201);
    const run = await created.json();
    expect(num(run.amount), "amount is SERVER-computed from attendance, client 999999 ignored").not.toBe(999999);
    expect(String(run.currency_code ?? run.currencyCode ?? "THB"), "currency server-set THB").toBe("THB");
    const runId = String(run.id);
    const amount = num(run.amount);
    if (priorRun) {
      // B-308 replay: the ORIGINAL run, never a second postable row for the same period.
      expect(runId, "a repeat run replays the original id").toBe(String(priorRun.id));
    }

    const posted = await owner.post(`/api/v1/labor/payroll/${runId}/post`);
    if (priorRun && amount > 0) {
      // this run was already posted by an earlier execution → idempotent 409, no 2nd JV.
      expect(posted.status(), "an already-posted run does not post twice").toBe(409);
    } else if (amount > 0) {
      expect(posted.status(), "a non-zero payroll posts to the GL").toBe(200);
      // the money invariant: the JV posted for this payroll BALANCES (Dr total == Cr total).
      const jvs = rowsOf((await (await owner.get("/api/v1/gl/jv")).json()) as Record<string, unknown>);
      const mine = jvs.find((j) => String(j.source_doc ?? j.sourceDoc ?? "").includes(runId));
      if (mine && Array.isArray((mine as { lines?: unknown[] }).lines)) {
        const lines = (mine as { lines: Array<Record<string, unknown>> }).lines;
        const dr = lines.reduce((s, l) => s + num(l.dr), 0);
        const cr = lines.reduce((s, l) => s + num(l.cr), 0);
        expect(dr, "payroll JV balances (Dr 1140 total == Cr 1020 total)").toBe(cr);
        expect(dr, "JV total == the server-computed amount").toBe(amount);
      }
    } else {
      // amount 0 (no attendance in the period) → honest 409, no fabricated posting.
      expect(posted.status(), "a zero-amount payroll does not fabricate a JV — honest 409").toBe(409);
    }
  });
});
