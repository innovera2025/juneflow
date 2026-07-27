import {
  test,
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import {
  clientFor,
  isRateLimited,
  okJson,
  USER_FINMGR_TIER2,
} from "./_api-client.js";

// B-163 sales money-post concurrency — a live REAL-concurrency proof that the
// booking / down / deal JV posts are race-safe (Gate G4).
//
// The three JV-posting handlers (apps/api/src/routes/land-sales.ts) each key their
// posting on a STABLE source_doc and lean on the jv_source_doc_uq unique index
// (migrations 0037/0042) for idempotency + race-safety:
//   booking  source booking:<unitId>        (the stable project_node id)
//   down     source down:<salesUnitId>:<seq> (seq = existing instalments + 1)
//   deal     source deal:<plotId>
// Under a genuine race, two concurrent first-posts of the SAME entity compute the
// SAME source_doc → the unique index lets exactly one commit; the loser's whole
// transaction rolls back (23505 → 409). No double-book, no partial post, no 500.
//
// A single-event-loop `inject()` cannot prove this — it never overlaps two real DB
// transactions. This spec fires N concurrent HTTP requests via Promise.all over a
// bearer request context, so the server processes them on SEPARATE connections: a
// true Postgres race. This converts the throwaway concurrency proof into permanent,
// E2E_LIVE-gated regression protection.
//
// Gated on E2E_LIVE (mirrors smoke.spec.ts / b097-rollback.spec.ts): default vitest/
// CI runs stay green (the stack need not be up); E2E_LIVE=1 runs it against the
// seeded api. Uses a SINGLE seed login (USER_FINMGR_TIER2 — holds finance.create,
// the B-082 F1 gate on the money posts) so it stays well under the B-082 F4 login
// throttle; a 429 during setup skips gracefully rather than failing (B-099 pending).
// Honest skips (never a false green): when the seeded stack has no free unit/plot to
// race on, the affected variant test.skips with a message rather than passing vacuously.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

/** Concurrent fan-out per race — N simultaneous first-posts of one entity. */
const N = 3;
/** The received booking amount (a legitimate client-supplied receipt figure). */
const BOOKING_AMOUNT = 100_000;
/** The received down-instalment amount. */
const DOWN_AMOUNT = 50_000;

/** Rows out of a B-014 list envelope ({data}) — defensive over {items}/bare array. */
function rowsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (body.data ?? body.items ?? body) as unknown;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

/** The flat Error `code` of a response body ({code,message}), else undefined. */
async function errorCode(res: APIResponse): Promise<string | undefined> {
  try {
    const b = (await res.json()) as { code?: unknown };
    return typeof b.code === "string" ? b.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A FRESH un-booked project_node id (the booking `unit_id`): a unit-kind node from
 * some project's hierarchy that is NOT already in the booking register. Returns null
 * when every unit is booked (→ the variant skips honestly rather than false-pass).
 */
async function freshUnbookedUnitId(client: APIRequestContext): Promise<string | null> {
  const booked = new Set(
    rowsOf(await okJson(await client.get("/api/v1/sales/bookings"), "GET /sales/bookings")).map(
      (r) => String(r.unit_id),
    ),
  );
  const projects = rowsOf(await okJson(await client.get("/api/v1/projects"), "GET /projects"));
  for (const p of projects) {
    const projectId = String(p.id);
    const hier = await okJson(
      await client.get(`/api/v1/projects/${projectId}/hierarchy`),
      `GET /projects/${projectId}/hierarchy`,
    );
    for (const node of rowsOf(hier)) {
      if (node.kind === "unit" && !booked.has(String(node.id))) return String(node.id);
    }
  }
  return null;
}

/**
 * The id of a booked sales_unit (a seeded one, or one a prior booking created). A
 * first-down race needs a unit that already carries a booking. Returns null when the
 * register is empty (→ the down variant skips honestly).
 */
async function firstBookedSalesUnitId(client: APIRequestContext): Promise<string | null> {
  const rows = rowsOf(await okJson(await client.get("/api/v1/sales/bookings"), "GET /sales/bookings"));
  return rows.length ? String(rows[0]!.id) : null;
}

/**
 * A FRESH un-dealt land_plot id: a plot carrying a positive area + price (so the
 * server-computed 10% deposit is > 0) whose deal JV has NOT been posted yet. The
 * dealt set is derived from the journal (source_doc `deal:<plotId>`). Returns null
 * when every priced plot is already dealt (→ the deal variant skips honestly).
 */
async function freshUndealtPlotId(client: APIRequestContext): Promise<string | null> {
  const plots = rowsOf(await okJson(await client.get("/api/v1/land/plots"), "GET /land/plots"));
  const jvs = rowsOf(await okJson(await client.get("/api/v1/gl/jv"), "GET /gl/jv"));
  const dealt = new Set<string>();
  for (const jv of jvs) {
    const src = typeof jv.source_doc === "string" ? jv.source_doc : "";
    if (src.startsWith("deal:")) dealt.add(src.slice("deal:".length));
  }
  for (const plot of plots) {
    const id = String(plot.id);
    const area = Number(plot.area_sqm);
    const price = Number(plot.price_per_rai);
    if (!Number.isFinite(area) || area <= 0) continue;
    if (!Number.isFinite(price) || price <= 0) continue;
    // Mirror the handler's deposit formula (round2(round2(area/1600 × price) × 10%))
    // ONLY to ensure it is positive — a plot whose deposit rounds to 0 is answered
    // 409 by the handler regardless of the race, so it is not a valid race subject.
    const deposit =
      Math.round((Math.round((area / 1600) * price * 100) / 100) * 0.1 * 100) / 100;
    if (deposit <= 0) continue;
    if (!dealt.has(id)) return id;
  }
  return null;
}

liveDescribe("B-163 sales money-post concurrency (live seeded stack, G4)", () => {
  let finMgr: APIRequestContext; // suda — holds finance.create (B-082 F1 money gate)
  // Set when the F4 login throttle (429) blocks setup — every test then skips
  // gracefully instead of failing while F4 tuning (B-099) is pending.
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

  test("BOOKING race: N concurrent first-bookings of one fresh unit → exactly one 201, rest 409, no double-book", async () => {
    const unitId = await freshUnbookedUnitId(finMgr);
    test.skip(
      unitId == null,
      "no un-booked project unit in the seeded stack — cannot prove a fresh-booking race without a false pass",
    );
    const uid = unitId as string;

    // The SAME source_doc (booking:<uid>) for all N: the interleave cannot matter —
    // exactly one commits, the rest trip the unique index → 409.
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        finMgr.post("/api/v1/sales/bookings", { data: { unit_id: uid, amount: BOOKING_AMOUNT } }),
      ),
    );
    const statuses = responses.map((r) => r.status());

    expect(
      statuses.filter((s) => s >= 500),
      `no 5xx from a booking race (got ${statuses.join(",")})`,
    ).toHaveLength(0);
    expect(
      statuses.filter((s) => s === 201),
      `exactly one winning 201 (got ${statuses.join(",")})`,
    ).toHaveLength(1);
    expect(
      statuses.filter((s) => s === 409),
      `the other ${N - 1} are 409 (got ${statuses.join(",")})`,
    ).toHaveLength(N - 1);

    // Every loser is an INVALID_STATE conflict (already booked), not a random 4xx.
    for (const res of responses) {
      if (res.status() === 409) {
        expect(await errorCode(res), "booking loser 409 → INVALID_STATE").toBe("INVALID_STATE");
      }
    }

    // The ledger truth: the unit is booked EXACTLY once, at the received amount.
    const after = rowsOf(
      await okJson(await finMgr.get("/api/v1/sales/bookings"), "GET /sales/bookings (after race)"),
    );
    const mine = after.filter((r) => String(r.unit_id) === uid);
    expect(mine, `unit ${uid} must appear exactly once in the booking register`).toHaveLength(1);
    expect(Number(mine[0]!.booking), "booked at the received amount (no double-book)").toBe(
      BOOKING_AMOUNT,
    );
  });

  test("DOWN race: N concurrent first-downs on one booked unit collide on seq → exactly one wins, rest 409", async () => {
    const salesUnitId = await firstBookedSalesUnitId(finMgr);
    test.skip(
      salesUnitId == null,
      "no booked sales unit in the seeded stack — cannot prove a first-down race without a false pass",
    );
    const suid = salesUnitId as string;

    // seq is server-derived (existing instalments + 1): all N read the same current
    // state → the same seq → the same source_doc down:<suid>:<seq> → exactly one wins.
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        finMgr.post("/api/v1/sales/downs", { data: { sales_unit_id: suid, amount: DOWN_AMOUNT } }),
      ),
    );
    const statuses = responses.map((r) => r.status());

    expect(
      statuses.filter((s) => s >= 500),
      `no 5xx from a down race (got ${statuses.join(",")})`,
    ).toHaveLength(0);
    expect(
      statuses.filter((s) => s === 200 || s === 201),
      `exactly one winning 200/201 (got ${statuses.join(",")})`,
    ).toHaveLength(1);
    expect(
      statuses.filter((s) => s === 409),
      `the other ${N - 1} are 409 (got ${statuses.join(",")})`,
    ).toHaveLength(N - 1);

    for (const res of responses) {
      if (res.status() === 409) {
        expect(await errorCode(res), "down loser 409 → INVALID_STATE").toBe("INVALID_STATE");
      }
    }
  });

  test("DEAL race: N concurrent buy-deals on one fresh plot → exactly one 200/201, rest 409, no 5xx", async () => {
    const plotId = await freshUndealtPlotId(finMgr);
    test.skip(
      plotId == null,
      "no un-dealt priced land plot (area + price, positive deposit) in the seeded stack — cannot prove a fresh-deal race without a false pass",
    );
    const pid = plotId as string;

    // The SAME source_doc (deal:<pid>) for all N → exactly one commit, rest 409.
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        finMgr.post(`/api/v1/land/plots/${pid}/deal`, { data: { type: "buy" } }),
      ),
    );
    const statuses = responses.map((r) => r.status());

    expect(
      statuses.filter((s) => s >= 500),
      `no 5xx from a deal race (got ${statuses.join(",")})`,
    ).toHaveLength(0);
    expect(
      statuses.filter((s) => s === 200 || s === 201),
      `exactly one winning 200/201 (got ${statuses.join(",")})`,
    ).toHaveLength(1);
    expect(
      statuses.filter((s) => s === 409),
      `the other ${N - 1} are 409 (got ${statuses.join(",")})`,
    ).toHaveLength(N - 1);

    for (const res of responses) {
      if (res.status() === 409) {
        expect(await errorCode(res), "deal loser 409 → INVALID_STATE").toBe("INVALID_STATE");
      }
    }
  });
});
