import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

// B-223 — Solar OM-create with a responsible-team + a real inverter_id (live create-POST proof,
// money=NONE). The web RF2OMForm (om-ticket-form.tsx) now sends {title:desc, inverter_id (from
// the REAL useSolarInverters list), priority, team} to POST /solar/om-tickets. The backend adds
// solar_om_ticket.team (migration 0049) + stores it as free text. This proves on real Postgres
// what a stubbed unit test can't fully guarantee (the solar forms have no co-located unit test —
// same live-proof precedent as B-215/B-219):
//  1. POST with a REAL inverter_id + a team label → 201; status is server-set 'open'.
//  2. team ROUND-TRIPS: the created ticket carries back the exact team label sent ("ทีม O&M B"),
//     and it appears in the caller's GET /solar/om-tickets list (+1, tenant-scoped).
//  3. FK-checked inverter_id: a bogus (in-tenant-absent) inverter_id → 404 (the door FK-checks;
//     the form only ever sends ids from the real list, so this is the fail-closed guarantee).
// E2E_LIVE-gated + F4-safe (login 429 → honest skip).

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
const statusOf = (r: Record<string, unknown> | undefined): string => String(r?.status ?? r?.state ?? "");

liveDescribe("B-223 Solar OM-create with team + real inverter_id (live, money=NONE)", () => {
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

  async function list(path: string): Promise<Array<Record<string, unknown>>> {
    const res = await owner.get(`/api/v1/${path}`);
    return res.ok() ? rowsOf((await res.json()) as Record<string, unknown>) : [];
  }
  /** A real inverter_id from the list the form actually uses (useSolarInverters → GET /solar/inverters). */
  async function anInverterId(): Promise<string | null> {
    const inv = await list("solar/inverters");
    return inv[0] ? String(inv[0].id) : null;
  }

  test("POST {title, real inverter_id, priority, team} → 201, status server-set 'open', team round-trips (+1)", async () => {
    const inverterId = await anInverterId();
    test.skip(inverterId == null, "no seeded inverter — cannot create an O&M ticket faithfully");
    const before = (await list("solar/om-tickets")).length;

    const res = await owner.post("/api/v1/solar/om-tickets", {
      // exactly what om-ticket-form.tsx sends: desc→title, a real inverter_id, priority, the team label.
      // hostile: a smuggled status='closed' + foreign company_id must be ignored (server-set open, door-scoped).
      data: { title: "e2e-b223 INV offline", inverter_id: inverterId, priority: "ด่วน", team: "ทีม O&M B", status: "closed", company_id: MISSING_UUID },
    });
    expect(res.status(), "owner may create an O&M ticket with a team").toBe(201);
    const created = await res.json();
    expect(statusOf(created), "status is SERVER-set 'open' (a smuggled 'closed' is ignored)").toBe("open");
    // THE B-223 invariant: the responsible team round-trips exactly (stored free-text, on the wire).
    expect(String(created.team ?? ""), "the team label round-trips (stored + resolved on the wire)").toBe("ทีม O&M B");

    const after = await list("solar/om-tickets");
    expect(after.length, "the new ticket is listed in the caller's tenant (+1)").toBe(before + 1);
    const mine = after.find((t) => String(t.id) === String(created.id));
    expect(String(mine?.team ?? ""), "the listed ticket carries the team").toBe("ทีม O&M B");
  });

  test("FK-checked inverter_id: a bogus (in-tenant-absent) inverter_id → 404 (fail closed)", async () => {
    const res = await owner.post("/api/v1/solar/om-tickets", {
      data: { title: "e2e-b223 bogus inverter", inverter_id: MISSING_UUID, priority: "ปกติ", team: "ทีม O&M A" },
    });
    // the door FK-checks the inverter in-tenant; a non-existent id is rejected (404), never a silent orphan.
    expect(res.status(), "a bogus inverter_id is rejected (the form only sends ids from the real list)").toBe(404);
  });
});
