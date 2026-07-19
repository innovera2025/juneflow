import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import {
  API_URL,
  clientFor,
  glAccountIds,
  isRateLimited,
  okJson,
  uniqueNo,
  USER_FINMGR_TIER2,
} from "./_api-client.js";

// B-097 transaction-door atomicity — a live BEGIN/COMMIT ROLLBACK proof (Gate G4).
//
// The gl.jv handler (apps/api/src/routes/gl.ts) writes a jv HEADER then its LINES
// inside a SINGLE TenantDb.transaction() (B-097). account_id on a jv_line is an FK
// to gl_account (onDelete restrict) that the handler does NOT pre-validate — so a
// line carrying a non-existent account_id fails at the DB INSIDE the transaction,
// AFTER the header row was written. If the door truly rolls back, the header must
// vanish (no orphaned jv); if it did not, a partial jv would leak.
//
// This is the ONE thing the unit tests can't assert (they use a passthrough handle
// with no real BEGIN/COMMIT) — it needs a real Postgres. Gated on E2E_LIVE; uses a
// SINGLE seed login so it stays well under the B-082 F4 login throttle.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;
const BOGUS_ACCOUNT = "00000000-0000-0000-0000-000000000000"; // no such gl_account

liveDescribe("B-097 transaction door — atomic rollback on a mid-tx failure (G4, live seeded stack)", () => {
  let finMgr: APIRequestContext;
  let rateLimited = false;

  test.beforeAll(async () => {
    try {
      finMgr = await clientFor(USER_FINMGR_TIER2);
    } catch (e) {
      if (isRateLimited(e)) {
        rateLimited = true;
        return;
      }
      throw e;
    }
  });

  test.beforeEach(() => {
    test.skip(
      rateLimited,
      "B-082 F4 login rate-limiter (429): skipping until F4 is tuned (B-099).",
    );
  });

  test.afterAll(async () => {
    await Promise.all([finMgr].filter(Boolean).map((c) => c.dispose()));
  });

  // Does a JV numbered `no` exist? (GET /gl/jv is a tenant-scoped list.)
  async function jvExists(no: string): Promise<boolean> {
    const body = await okJson(await finMgr.get("/api/v1/gl/jv"), "listJv");
    const rows = (body.items ?? body.data ?? body) as Array<Record<string, unknown>>;
    return Array.isArray(rows) && rows.some((r) => r.no === no);
  }

  test("a jv whose line has a bad account_id FK rolls back the header — no orphaned jv", async () => {
    const [a0] = await glAccountIds(finMgr); // one REAL account for the good leg
    const no = uniqueNo("E2E-B097");

    // The JV is BALANCED (Σdr === Σcr = 100000) so it PASSES the double-entry guard
    // and reaches the transaction; the second leg carries a non-existent account_id,
    // so the line INSERT fails on the FK INSIDE the tx, after the header was written.
    const res = await finMgr.post("/api/v1/gl/jv", {
      data: {
        no,
        memo: "B-097 rollback proof — bad account FK on the credit leg",
        lines: [
          { account_id: a0, dr: 100_000, cr: 0 },
          { account_id: BOGUS_ACCOUNT, dr: 0, cr: 100_000 },
        ],
      },
    });

    // It must NOT succeed (the FK failure aborts the write). Any error status is fine —
    // the point is the write did not commit, not the exact code.
    expect(res.status(), "bad-account jv must not be created (201)").not.toBe(201);
    expect(res.status(), "bad-account jv → 4xx/5xx").toBeGreaterThanOrEqual(400);

    // THE PROOF: the header must have rolled back with the failed line — no orphaned jv.
    expect(
      await jvExists(no),
      `jv ${no} must NOT exist — B-097 must roll the header back when a line fails`,
    ).toBe(false);
  });
});
