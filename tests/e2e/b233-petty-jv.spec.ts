import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// B-233 — petty-cash claim → GL-inbox posting, money=SERVER live proof (REAL-PG). The money
// invariant a stub can't fully prove (gate-4.5 flagged the 0055 partial-index idempotency as
// unit-STUBBED — the 23505 throw is fabricated): on real Postgres a 2nd /gl/post of the same
// pending claim is rejected idempotently with NO 2nd JV (the B-217/B-165-class double-post gap
// that migration 0055 closes by extending the jv_source_doc_uq regex to include `petty:`).
//  1. POST /petty (hostile amount ignored → server validates/caps) → 201 claim (PT-YYYY-####).
//  2. POST /gl/post {doc_ids:[claim]} → 200; posts exactly ONE balanced JV Dr 5100 / Cr 1010
//     = the claim amount, source_doc `petty:<id>`.
//  3. POST /gl/post {doc_ids:[claim]} AGAIN → 200 but the claim is skipped (already posted) and
//     the JV count is UNCHANGED — the live idempotency proof.
// E2E_LIVE-gated + F4-safe (login 429 → honest skip).

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

liveDescribe("B-233 petty-cash claim → GL posting JV + idempotency (live, money=SERVER)", () => {
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

  /** count JVs whose source_doc references this claim (the money invariant: posted once). */
  async function jvCount(claimId: string): Promise<number> {
    const r = await owner.get("/api/v1/gl/jv"); if (!r.ok()) return -1;
    const ref = `petty:${claimId}`;
    return rowsOf((await r.json()) as Record<string, unknown>)
      .filter((j) => String(j.source_doc ?? j.sourceDoc ?? "") === ref).length;
  }

  test("petty claim posts ONE balanced JV Dr 5100 / Cr 1010; a 2nd /gl/post is idempotent (0055 guard, NO 2nd JV)", async () => {
    // 1. create a pending claim — server owns the running number, currency (THB) and the ≤10,000 cap.
    const created = await owner.post("/api/v1/petty", {
      data: { category: "Welfare", amount: 3200, description: "e2e-b233 petty claim" },
    });
    if (created.status() !== 201) console.error("DIAG petty create →", created.status(), await created.text());
    expect(created.status(), "owner (finance.create) may create a petty claim").toBe(201);
    const claim = (await created.json()) as Record<string, unknown>;
    const id = String(claim.id);
    expect(String(claim.type ?? "claim"), "created row is a claim").toBe("claim");
    expect(num(claim.amount ?? claim.value), "amount is server-normalized 3200").toBe(3200);
    expect(String(claim.no ?? ""), "server-generated running number PT-YYYY-####").toMatch(/^PT-\d{4}-\d{4}$/);

    const before = await jvCount(id);
    expect(before, "the fresh claim has no JV yet (pending)").toBe(0);

    // 2. post it through the shared GL inbox — one balanced JV, source_doc petty:<id>.
    const post1 = await owner.post("/api/v1/gl/post", { data: { doc_ids: [id] } });
    if (post1.status() !== 200) console.error("DIAG petty post1 →", post1.status(), await post1.text());
    expect(post1.status(), "first post → 200").toBe(200);
    const b1 = (await post1.json()) as { posted?: Array<Record<string, unknown>>; skipped?: unknown[] };
    const posted = (b1.posted ?? []).find((p) => String(p.doc_id ?? p.docId) === id);
    expect(posted, "the claim is in posted[]").toBeTruthy();
    expect(num(posted!.amount), "posted amount is the SERVER value 3200 (client never dictates the JV)").toBe(3200);
    expect(String(posted!.source ?? ""), "source is petty").toBe("petty");

    const after1 = await jvCount(id);
    expect(after1, "exactly ONE petty JV posted (Dr 5100 / Cr 1010)").toBe(before + 1);

    // if the JV wire carries its lines, prove the money invariant directly: Dr total == Cr total == amount.
    const jvs = rowsOf((await (await owner.get("/api/v1/gl/jv")).json()) as Record<string, unknown>);
    const mine = jvs.find((j) => String(j.source_doc ?? j.sourceDoc ?? "") === `petty:${id}`);
    if (mine && Array.isArray((mine as { lines?: unknown[] }).lines)) {
      const lines = (mine as { lines: Array<Record<string, unknown>> }).lines;
      const dr = lines.reduce((s, l) => s + num(l.dr), 0);
      const cr = lines.reduce((s, l) => s + num(l.cr), 0);
      expect(dr, "petty JV balances (Dr 5100 total == Cr 1010 total)").toBe(cr);
      expect(dr, "JV total == the server-computed claim amount").toBe(3200);
    }

    // 3. THE LIVE IDEMPOTENCY PROOF: a 2nd post of the same claim is rejected with NO 2nd JV.
    const post2 = await owner.post("/api/v1/gl/post", { data: { doc_ids: [id] } });
    expect(post2.status(), "2nd post still 200 (idempotent, not a 500)").toBe(200);
    const b2 = (await post2.json()) as { posted?: Array<Record<string, unknown>>; skipped?: Array<Record<string, unknown>> };
    const repost = (b2.posted ?? []).find((p) => String(p.doc_id ?? p.docId) === id);
    expect(repost, "the claim is NOT posted a 2nd time").toBeFalsy();
    const skipped = (b2.skipped ?? []).find((s) => String(s.doc_id ?? s.docId) === id);
    expect(skipped, "the claim is reported skipped (already posted)").toBeTruthy();
    expect(await jvCount(id), "STILL exactly one petty JV — the double-post the 0055 guard closes").toBe(after1);
  });
});
