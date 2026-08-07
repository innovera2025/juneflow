import { test, expect, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import {
  clientFor,
  isRateLimited,
  okJson,
  USER_MD_L4,
  USER_SITE_L1,
} from "./_api-client.js";

// B-332 — the `field-checkin` schema bundle, LIVE on real Postgres (Gate G4).
//
// Migration 0062 adds three things to a table that SUMS INTO PAYROLL:
//   1. worker.user_id (+ the partial unique index worker_user_uq) — the auth link,
//      so the server can answer "which worker is this caller?";
//   2. attendance.checked_in_at / checked_out_at + four coordinate columns — the
//      field check-in/out pair, with CHECK-OUT AS A COLUMN ON THE SAME ROW;
//   3. the split write gate: recording somebody ELSE's day still needs
//      finance.create; a worker clocking THEMSELVES in is an identity question.
//
// WHAT ONLY REAL POSTGRES CAN SETTLE, and why every one of these is here:
//
//   A. THE CONSTRAINT REJECTS NO LEGITIMATE WORK. The design refused a
//      unique(worker_id, day) natural key. A stub cannot prove that refusal was
//      right, because a stub has no index to reject anything. Three cases are
//      exercised against the real table: a cost-centre-split day, a night shift
//      crossing midnight, and a correction filed AFTER check-out. Each is a real
//      INSERT that a unique(worker_id, day) would have turned into a 23505.
//      The correction case is the decisive one: there is no UPDATE/PUT/PATCH/DELETE
//      on attendance anywhere, so a second INSERT is the ONLY way to correct a day.
//
//   B. THE CONCURRENT SECOND CHECK-OUT. A parallel burst proves NOTHING here — the
//      single-threaded API serialises it. The race is CONSTRUCTED: a second psql
//      session holds an uncommitted colliding UPDATE open, the API fires into the
//      row lock, and the test asserts the API genuinely BLOCKED before answering.
//      That is what distinguishes a guard on the UPDATE's own WHERE (correct) from
//      a guard on a preceding SELECT (B-149: two round trips, both writers pass).
//
//   C. THE B-307 KEY STILL DEDUPS after the new columns and the new gate land.
//
//   D. THE HONEST REFUSALS. A user with no worker row, and a worker with no user
//      link, are both refused — never auto-created, never name-matched. A
//      fabricated worker carries day_rate NULL, and num(null) is 0, so payroll
//      would pay 0.00 behind a clean 201 and a balanced JV. Silently-zero.
//
//   E. CROSS-TENANT FK EXPOSURE — the risk Wei flagged to review hardest. Postgres
//      cannot express "the referenced user must share company_id". This test
//      CONSTRUCTS the corrupt link by raw SQL (the API refuses to create one) and
//      proves it is invisible to the read path.
//
// E2E_LIVE-gated + F4-safe (login 429 → graceful skip). Needs DATABASE_URL for the
// constructed race and the raw-SQL setups; without it those tests skip rather than
// pass vacuously.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;
const PG_URL = process.env.DATABASE_URL ?? "";

const rowsOf = (b: Record<string, unknown>): Array<Record<string, unknown>> => {
  const d = (b.data ?? b) as unknown;
  return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
};

/** A private day/period per run so a re-run never collides (the key index is GLOBAL). */
const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const key = (suffix: string): string => `b332-${RUN}-${suffix}`;
/** A randomised year keeps each run's payroll SUM covering only its own rows. */
const YEAR = 2100 + Math.floor(Math.random() * 400);
const DAY_RATE = 500;

liveDescribe("B-332 field check-in schema bundle (G4, live seeded stack, money=SERVER)", () => {
  let md: APIRequestContext; // Director — carries finance.create
  let site: APIRequestContext; // Site Engineer — finance perms are ALL false
  let siteUserId = "";
  let workerId = ""; // the worker linked to the Site Engineer
  let unlinkedWorkerId = ""; // a worker with user_id NULL
  let rateLimited = false;

  test.beforeAll(async () => {
    try {
      md = await clientFor(USER_MD_L4);
      site = await clientFor(USER_SITE_L1);
    } catch (e) {
      if (isRateLimited(e)) {
        rateLimited = true;
        return;
      }
      throw e;
    }

    const me = await okJson(await site.get("/api/v1/me"), "GET /me (site engineer)");
    siteUserId = String((me.user as Record<string, unknown>).id);

    // The defect this slice closes, asserted from the SEEDED perms matrix rather
    // than from any handler: the field-check-in screen's own persona has NO
    // finance.create, so before B-332 the screen's only write was a 403 for him.
    const perms = ((me.role as Record<string, unknown>)?.perms ?? {}) as Record<
      string,
      Record<string, boolean>
    >;
    expect(perms.finance?.create ?? false).toBe(false);

    // Link a fresh worker to the Site Engineer — or ADOPT the link if a previous run
    // on this stack already made one. worker_user_uq is 1:1 and there is no unlink
    // endpoint, so a create-only setup would 409 on the second run against the same
    // database. Adopting keeps the spec re-runnable without weakening anything: the
    // uniqueness itself is asserted by the explicit duplicate probe below.
    const existing = rowsOf(
      await okJson(await md.get("/api/v1/labor/workers"), "GET /labor/workers"),
    ).find((w) => w.user_id === siteUserId);
    if (existing) {
      workerId = String(existing.id);
    } else {
      const linked = await okJson(
        await md.post("/api/v1/labor/workers", {
          data: { name: `B-332 linked ${RUN}`, day_rate: DAY_RATE, user_id: siteUserId },
        }),
        "POST /labor/workers (linked)",
      );
      workerId = String(linked.id);
    }
    // The pay assertion below is exact, so an adopted worker must carry the same rate.
    const rate = rowsOf(
      await okJson(await md.get("/api/v1/labor/workers"), "GET /labor/workers"),
    ).find((w) => w.id === workerId)?.day_rate;
    expect(Number(rate)).toBe(DAY_RATE);

    const unlinked = await okJson(
      await md.post("/api/v1/labor/workers", {
        data: { name: `B-332 unlinked ${RUN}`, day_rate: DAY_RATE },
      }),
      "POST /labor/workers (unlinked)",
    );
    unlinkedWorkerId = String(unlinked.id);
  });

  test.beforeEach(() => {
    test.skip(
      rateLimited,
      "B-082 F4 login rate-limiter (429): the throttle blocks setup login. Skipping until F4 is tuned — B-099.",
    );
  });

  test.afterAll(async () => {
    await Promise.all([md, site].filter(Boolean).map((c) => c.dispose()));
  });

  /** Count the tenant's attendance rows for a worker+day, through the API's own read. */
  async function rowsFor(worker: string, day: string): Promise<Array<Record<string, unknown>>> {
    const body = await okJson(await md.get("/api/v1/labor/attendance"), "GET /labor/attendance");
    return rowsOf(body).filter((r) => r.worker_id === worker && r.day === day);
  }

  // -------------------------------------------------------------------------
  // A. The auth link
  // -------------------------------------------------------------------------

  test("the link is stored, and worker_user_uq refuses a SECOND worker claiming the same user", async () => {
    const workers = rowsOf(await okJson(await md.get("/api/v1/labor/workers"), "GET /labor/workers"));
    expect(workers.find((w) => w.id === workerId)?.user_id).toBe(siteUserId);
    // Two workers resolving from one login would make "which worker am I?" ambiguous
    // at the door — on a table that sums into payroll that means clocking one man's
    // day onto another man's pay.
    const dup = await md.post("/api/v1/labor/workers", {
      data: { name: `B-332 impostor ${RUN}`, user_id: siteUserId },
    });
    expect(dup.status()).toBe(409);
    // An honest conflict — NOT a replay handing back the other worker's row.
    expect((await dup.json()).message).toMatch(/already linked/i);
  });

  test("a user_id outside this tenant is refused at WRITE time — the only place the cross-tenant FK invariant can be established", async () => {
    const res = await md.post("/api/v1/labor/workers", {
      data: { name: `B-332 foreign ${RUN}`, user_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/user not found in this tenant/i);
  });

  // -------------------------------------------------------------------------
  // B. The split gate
  // -------------------------------------------------------------------------

  test("a Site Engineer can clock HIMSELF in with no finance.create — and still cannot clock in anybody else", async () => {
    const day = `${YEAR}-03-04`;
    const self = await site.post("/api/v1/labor/attendance", {
      data: { worker_id: workerId, day, idempotency_key: key("self") },
    });
    expect(self.status()).toBe(201);

    const other = await site.post("/api/v1/labor/attendance", {
      data: { worker_id: unlinkedWorkerId, day, idempotency_key: key("other") },
    });
    expect(other.status()).toBe(403);
    // The unlinked worker's day was never written.
    expect(await rowsFor(unlinkedWorkerId, day)).toHaveLength(0);
  });

  test("self-service may not assert OVERTIME — the 1.5× premium is a supervisor judgement, and the refusal is loud, not a silent zero", async () => {
    const day = `${YEAR}-03-05`;
    const res = await site.post("/api/v1/labor/attendance", {
      data: { worker_id: workerId, day, ot: 4, idempotency_key: key("ot") },
    });
    expect(res.status()).toBe(400);
    expect(await rowsFor(workerId, day)).toHaveLength(0);
    // The SAME request from a finance.create holder is accepted — no shipped caller
    // lost anything; the restriction applies only to the new door.
    const asFinance = await md.post("/api/v1/labor/attendance", {
      data: { worker_id: workerId, day, ot: 4, idempotency_key: key("ot-md") },
    });
    expect(asFinance.status()).toBe(201);
    expect((await asFinance.json()).ot).toBe(4);
  });

  // -------------------------------------------------------------------------
  // B2. THE PAYEE MAY NOT INFLATE HIS OWN PAY (B-332 gate-4.5 finding 1)
  //
  // Door 2 handed the attendance write to the person who RECEIVES the money, and
  // createLaborPayroll pays by SUMMING ROWS. Before the fix this was five 201s and a
  // 5× payout behind a clean balanced JV — requested by the beneficiary, and invisible
  // to jv_source_doc_uq because the inflated amount posts as ONE correct-looking JV.
  //
  // This is a LIVE test rather than a unit test for a specific reason: the unit suite
  // can only show the handler asks the question, while this shows the real table
  // answers it — and the payroll figure at the end is the only assertion that proves
  // the defect was about money and not about status codes.
  // -------------------------------------------------------------------------

  test("FIVE self-service check-ins for one day are ONE row and ONE day's pay — the 5× payout, closed", async () => {
    const day = `${YEAR}-01-02`;
    const period = `${YEAR}-01`;

    // Exactly the reviewer's probe: the payee, five taps, NO idempotency key (a key
    // would not have mattered — a screen remount mints a new one, see below).
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await site.post("/api/v1/labor/attendance", {
        data: { worker_id: workerId, day },
      });
      statuses.push(res.status());
    }
    expect(statuses).toEqual([201, 409, 409, 409, 409]);

    const rows = await rowsFor(workerId, day);
    expect(rows).toHaveLength(1);
    expect(rows.reduce((s, r) => s + Number(r.day_fraction), 0)).toBe(1);

    // THE money assertion. Five accepted rows paid 5 × DAY_RATE here before the guard.
    const payroll = await okJson(
      await md.post("/api/v1/labor/payroll", { data: { worker_id: workerId, period } }),
      "POST /labor/payroll",
    );
    expect(payroll.amount).toBe(DAY_RATE);
  });

  test("a REMOUNT is caught where the idempotency key could not see it — a NEW key for the same worker+day is a DUPLICATE, not a replay", async () => {
    const day = `${YEAR}-01-03`;
    const first = await site.post("/api/v1/labor/attendance", {
      data: { worker_id: workerId, day, idempotency_key: key("remount-1") },
    });
    expect(first.status()).toBe(201);
    // The phone mints its key per screen instance, so this passes
    // attendance_idempotency_uq untouched — which is exactly why a key requirement
    // would NOT have closed finding 1 and an explicit pre-check was needed.
    const remount = await site.post("/api/v1/labor/attendance", {
      data: { worker_id: workerId, day, idempotency_key: key("remount-2") },
    });
    expect(remount.status()).toBe(409);
    expect(await rowsFor(workerId, day)).toHaveLength(1);
  });

  test("the guard is PER DAY, and a genuine replay still returns the original row — no legitimate case is refused", async () => {
    // A different day is ordinary work, not a duplicate.
    const nextDay = await site.post("/api/v1/labor/attendance", {
      data: { worker_id: workerId, day: `${YEAR}-01-04` },
    });
    expect(nextDay.status()).toBe(201);

    // And the B-307 replay path is untouched: same key twice → the ORIGINAL row, 201.
    const day = `${YEAR}-01-05`;
    const payload = { worker_id: workerId, day, idempotency_key: key("dup-replay") };
    const a = await site.post("/api/v1/labor/attendance", { data: payload });
    const b = await site.post("/api/v1/labor/attendance", { data: payload });
    expect([a.status(), b.status()]).toEqual([201, 201]);
    expect((await b.json()).id).toBe((await a.json()).id);
    expect(await rowsFor(workerId, day)).toHaveLength(1);
  });

  test("self-service may not assert a COST CENTRE — it is the duplicate guard's own escape hatch (one re-inflation per centre)", async () => {
    const day = `${YEAR}-01-06`;
    const ccs = rowsOf(await okJson(await md.get("/api/v1/cost-centers"), "GET /cost-centers"));
    test.skip(ccs.length === 0, "needs a seeded cost centre");
    const res = await site.post("/api/v1/labor/attendance", {
      data: { worker_id: workerId, day, status: "half", cc_id: ccs[0]!.id },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/cc_id cannot be set on a self-service check-in/i);
    expect(await rowsFor(workerId, day)).toHaveLength(0);
  });

  test("DEACTIVATING a worker revokes the new door — and does NOT revoke the supervisor's (B-332 gate-4.5 finding 4)", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL — there is no PUT/PATCH on worker to flip `active`");
    const day = `${YEAR}-01-07`;
    const pg = new Client({ connectionString: PG_URL });
    await pg.connect();
    try {
      await pg.query("UPDATE worker SET active = false WHERE id = $1", [workerId]);
      // `active` is the only "off the roster" flag there is; before this the only real
      // revocation was deleting the user account.
      const self = await site.post("/api/v1/labor/attendance", {
        data: { worker_id: workerId, day, idempotency_key: key("inactive-self") },
      });
      expect(self.status()).toBe(403);
      expect(await rowsFor(workerId, day)).toHaveLength(0);

      // Door 1 is deliberately NOT gated on it: a supervisor must still be able to
      // record a corrected day for a worker who has since left.
      const roster = await md.post("/api/v1/labor/attendance", {
        data: { worker_id: workerId, day, idempotency_key: key("inactive-roster") },
      });
      expect(roster.status()).toBe(201);
    } finally {
      await pg.query("UPDATE worker SET active = true WHERE id = $1", [workerId]);
      await pg.end();
    }
  });

  // -------------------------------------------------------------------------
  // C. THE POINT OF THE WHOLE DESIGN — check-out is a column, not a row
  // -------------------------------------------------------------------------

  test("check-out stamps the SAME row: one row, one day's pay — a second row would have paid the day TWICE", async () => {
    const day = `${YEAR}-04-01`;
    const period = `${YEAR}-04`;
    const k = key("pair");

    const inRes = await site.post("/api/v1/labor/attendance", {
      data: {
        worker_id: workerId,
        day,
        idempotency_key: k,
        checked_in_at: `${day}T00:45:00.000Z`,
        checkin_lat: 13.8076,
        checkin_lng: 100.4519,
      },
    });
    expect(inRes.status()).toBe(201);
    const checkIn = await inRes.json();
    expect(checkIn.checked_in_at).toBe(`${day}T00:45:00.000Z`);
    expect(checkIn.checked_out_at).toBeNull();

    const outRes = await site.post("/api/v1/labor/attendance/checkout", {
      data: {
        worker_id: workerId,
        day,
        check_in_key: k,
        checked_out_at: `${day}T10:30:00.000Z`,
        checkout_lat: 13.8077,
        checkout_lng: 100.452,
      },
    });
    expect(outRes.status()).toBe(200);
    const closed = await outRes.json();
    // THE assertion: the SAME row id came back, now carrying the check-out.
    expect(closed.id).toBe(checkIn.id);
    expect(closed.checked_out_at).toBe(`${day}T10:30:00.000Z`);
    // Six decimals survive the round trip — the mobile formatter's exact precision.
    expect(closed.checkin_lat).toBe(13.8076);
    expect(closed.checkout_lng).toBe(100.452);

    // ONE row for the day…
    expect(await rowsFor(workerId, day)).toHaveLength(1);
    // …and THIS is what makes it money: payroll SUMS ROWS, and day_fraction defaults
    // to 1, so a check-out written as its own row would have paid 2.0 days here.
    const payroll = await okJson(
      await md.post("/api/v1/labor/payroll", { data: { worker_id: workerId, period } }),
      "POST /labor/payroll",
    );
    expect(payroll.amount).toBe(DAY_RATE);
  });

  test("a replayed check-out is idempotent (200, the original row); a DIFFERENT instant on a closed day is 409 and never overwrites", async () => {
    const day = `${YEAR}-04-02`;
    const k = key("replay");
    await okJson(
      await site.post("/api/v1/labor/attendance", {
        data: { worker_id: workerId, day, idempotency_key: k },
      }),
      "check-in",
    );
    const out = { worker_id: workerId, day, check_in_key: k, checked_out_at: `${day}T10:00:00.000Z` };

    const first = await site.post("/api/v1/labor/attendance/checkout", { data: out });
    expect(first.status()).toBe(200);
    // The SyncProcessor's at-least-once retry re-sends the identical instant.
    const replay = await site.post("/api/v1/labor/attendance/checkout", { data: out });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).id).toBe((await first.json()).id);

    const second = await site.post("/api/v1/labor/attendance/checkout", {
      data: { ...out, checked_out_at: `${day}T18:00:00.000Z` },
    });
    expect(second.status()).toBe(409);
    // The FIRST close is the record — a later request cannot rewrite when he left.
    const [row] = await rowsFor(workerId, day);
    expect(row?.checked_out_at).toBe(`${day}T10:00:00.000Z`);
    expect(await rowsFor(workerId, day)).toHaveLength(1);
  });

  test("a check-out EARLIER than its own check-in is refused, and the row keeps its open state (B-332 gate-4.5 finding 6)", async () => {
    const day = `${YEAR}-04-04`;
    const k = key("backwards");
    await okJson(
      await site.post("/api/v1/labor/attendance", {
        data: { worker_id: workerId, day, idempotency_key: k, checked_in_at: `${day}T08:00:00.000Z` },
      }),
      "check-in for the backwards close",
    );
    // The coordinates were range-checked from the start; the instant pair was not, so
    // this stored happily and answered 200 before the guard. 400 (not 409) matches how
    // a bad coordinate is refused — and a 5xx would wedge the phone's whole drain.
    const backwards = await site.post("/api/v1/labor/attendance/checkout", {
      data: { worker_id: workerId, day, check_in_key: k, checked_out_at: `${day}T06:00:00.000Z` },
    });
    expect(backwards.status()).toBe(400);
    expect((await backwards.json()).message).toMatch(/earlier than checked_in_at/i);
    // Nothing was written: the day is still open, so the honest close below can happen.
    const [open] = await rowsFor(workerId, day);
    expect(open?.checked_out_at).toBeNull();

    const honest = await site.post("/api/v1/labor/attendance/checkout", {
      data: { worker_id: workerId, day, check_in_key: k, checked_out_at: `${day}T17:00:00.000Z` },
    });
    expect(honest.status()).toBe(200);
  });

  test("a check-out for a key that never checked in is an honest 404 — it does not create the row it failed to find", async () => {
    const day = `${YEAR}-04-03`;
    const res = await site.post("/api/v1/labor/attendance/checkout", {
      data: {
        worker_id: workerId,
        day,
        check_in_key: key("never-existed"),
        checked_out_at: `${day}T10:00:00.000Z`,
      },
    });
    expect(res.status()).toBe(404);
    expect(await rowsFor(workerId, day)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // D. THE CONSTRAINT REJECTS NO LEGITIMATE WORK
  //    Each of these is an INSERT that unique(worker_id, day) would have 23505'd.
  // -------------------------------------------------------------------------

  test("LEGITIMATE #1 — a cost-centre-split day: two `half` rows on one date, summing to exactly one day's pay", async () => {
    const day = `${YEAR}-05-01`;
    const ccs = rowsOf(await okJson(await md.get("/api/v1/cost-centers"), "GET /cost-centers"));
    test.skip(ccs.length < 2, "needs two seeded cost centres");

    for (const [i, cc] of ccs.slice(0, 2).entries()) {
      const res = await md.post("/api/v1/labor/attendance", {
        data: {
          worker_id: workerId,
          day,
          status: "half",
          cc_id: cc.id,
          idempotency_key: key(`split-${i}`),
        },
      });
      expect(res.status()).toBe(201);
      expect((await res.json()).day_fraction).toBe(0.5);
    }
    const rows = await rowsFor(workerId, day);
    expect(rows).toHaveLength(2);
    // Correct pay, correctly split across cost centres — 0.5 + 0.5, not 2.0.
    expect(rows.reduce((s, r) => s + Number(r.day_fraction), 0)).toBe(1);
  });

  test("LEGITIMATE #2 — a night shift crossing midnight: ONE row, checked out on the next calendar day", async () => {
    const day = `${YEAR}-05-10`;
    const k = key("night");
    await okJson(
      await md.post("/api/v1/labor/attendance", {
        data: { worker_id: workerId, day, idempotency_key: k, checked_in_at: `${day}T15:00:00.000Z` },
      }),
      "night check-in",
    );
    // 22:00 Bangkok on `day` → 06:00 Bangkok the NEXT day; both are stamps on the
    // one row, so the shift needs no second row and no second `day` value.
    const res = await md.post("/api/v1/labor/attendance/checkout", {
      data: { worker_id: workerId, day, check_in_key: k, checked_out_at: `${day}T23:00:00.000Z` },
    });
    expect(res.status()).toBe(200);
    const closed = await res.json();
    expect(new Date(String(closed.checked_out_at)).getTime()).toBeGreaterThan(
      new Date(String(closed.checked_in_at)).getTime(),
    );
    expect(await rowsFor(workerId, day)).toHaveLength(1);
  });

  // B-332 gate-4.5 finding 2 — THIS TEST'S NAME USED TO SAY "a correction". It does not
  // correct anything, and the claim that it did was the decisive justification for
  // refusing unique(worker_id, day). createLaborPayroll SUMS ROWS, so the second row is
  // ADDED to the first: on a 500/day worker, one `full` day paid 500 and filing the
  // `half` "correction" paid 750 — reducing the day RAISED the pay, where a day
  // genuinely corrected to half owes 250. Asserted below so the file cannot drift back
  // into claiming otherwise.
  //
  // What the test still legitimately proves is the narrower thing the index question
  // actually turns on: a SECOND row on one date is ACCEPTED rather than 23505'd. There
  // is no correction path at all today — no UPDATE/PUT/PATCH/DELETE on attendance
  // anywhere in registerLaborRoute, no supersede column — and B-335 is open for one.
  test("LEGITIMATE #3 — a second row on one date is ACCEPTED after check-out (and it ADDS to the day's pay rather than correcting it — B-335)", async () => {
    const day = `${YEAR}-05-20`;
    const period = `${YEAR}-05`;
    const k = key("second-row");
    // A worker of this test's own, so the period's payroll covers only these two rows.
    const solo = await okJson(
      await md.post("/api/v1/labor/workers", {
        data: { name: `B-332 second-row ${RUN}`, day_rate: DAY_RATE },
      }),
      "POST /labor/workers (second-row subject)",
    );
    const soloId = String(solo.id);

    await okJson(
      await md.post("/api/v1/labor/attendance", {
        data: { worker_id: soloId, day, status: "full", idempotency_key: k },
      }),
      "original (a full day)",
    );
    await md.post("/api/v1/labor/attendance/checkout", {
      data: { worker_id: soloId, day, check_in_key: k, checked_out_at: `${day}T10:00:00.000Z` },
    });

    // The supervisor now files what everyone calls the correction: he worked HALF a day.
    const second = await md.post("/api/v1/labor/attendance", {
      data: { worker_id: soloId, day, status: "half", idempotency_key: key("second-row-2") },
    });
    expect(second.status()).toBe(201);
    const rows = await rowsOf(
      await okJson(await md.get("/api/v1/labor/attendance"), "GET /labor/attendance"),
    ).filter((r) => r.worker_id === soloId && r.day === day);
    expect(rows).toHaveLength(2);

    // …and it ADDED. 1.0 + 0.5 = 1.5 days, not the 0.5 a correction would leave.
    const payroll = await okJson(
      await md.post("/api/v1/labor/payroll", { data: { worker_id: soloId, period } }),
      "POST /labor/payroll",
    );
    expect(payroll.amount).toBe(DAY_RATE * 1.5);
    expect(payroll.amount).toBeGreaterThan(DAY_RATE / 2); // what a real correction owes
  });

  // -------------------------------------------------------------------------
  // E. The B-307 key still dedups
  // -------------------------------------------------------------------------

  test("B-307 REGRESSION — a replayed check-in still returns the ORIGINAL row after the new columns and the new gate land", async () => {
    const day = `${YEAR}-06-01`;
    const k = key("b307");
    const payload = {
      worker_id: workerId,
      day,
      idempotency_key: k,
      checked_in_at: `${day}T01:00:00.000Z`,
    };
    const first = await site.post("/api/v1/labor/attendance", { data: payload });
    const replay = await site.post("/api/v1/labor/attendance", { data: payload });
    expect(first.status()).toBe(201);
    expect(replay.status()).toBe(201);
    expect((await replay.json()).id).toBe((await first.json()).id);
    expect(await rowsFor(workerId, day)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // F. THE CONSTRUCTED RACE — a parallel burst would prove nothing here
  // -------------------------------------------------------------------------

  test("CONSTRUCTED RACE — a second writer holding an uncommitted check-out BLOCKS the API on the row lock, and the API then loses honestly", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to hold a colliding transaction open");
    const day = `${YEAR}-07-01`;
    const k = key("race");
    const created = await okJson(
      await site.post("/api/v1/labor/attendance", {
        data: { worker_id: workerId, day, idempotency_key: k },
      }),
      "race check-in",
    );

    const pg = new Client({ connectionString: PG_URL });
    await pg.connect();
    try {
      // Session 2 takes the row lock and HOLDS it uncommitted. A parallel burst
      // against the API cannot reproduce this: the single-threaded API serialises
      // its own requests, so nothing would ever contend.
      await pg.query("BEGIN");
      await pg.query("UPDATE attendance SET checked_out_at = $1 WHERE id = $2", [
        `${day}T09:00:00.000Z`,
        created.id,
      ]);

      const startedAt = Date.now();
      const apiCall = site.post("/api/v1/labor/attendance/checkout", {
        data: {
          worker_id: workerId,
          day,
          check_in_key: k,
          checked_out_at: `${day}T17:00:00.000Z`,
        },
      });
      // Give the API time to reach its UPDATE and block; then release.
      await new Promise((r) => setTimeout(r, 2500));
      await pg.query("COMMIT");

      const res = await apiCall;
      const blockedMs = Date.now() - startedAt;

      // The API genuinely WAITED on a real row lock — this is what separates a
      // guard on the UPDATE's own WHERE from a guard on a preceding SELECT.
      expect(blockedMs).toBeGreaterThan(2000);
      // It re-evaluated `checked_out_at IS NULL` against the newly-committed
      // version, matched 0 rows, and refused rather than overwriting.
      expect(res.status()).toBe(409);
    } finally {
      await pg.end();
    }

    // Ground truth: the FIRST writer's instant survived, and there is still ONE row.
    const rows = await rowsFor(workerId, day);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.checked_out_at).toBe(`${day}T09:00:00.000Z`);
  });

  // -------------------------------------------------------------------------
  // G. Cross-tenant FK exposure — the risk Wei flagged to review hardest
  // -------------------------------------------------------------------------

  test("CROSS-TENANT — a corrupt worker→user link into ANOTHER company is invisible to the read path", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to construct a link the API refuses to create");
    const pg = new Client({ connectionString: PG_URL });
    await pg.connect();
    try {
      const me = await okJson(await md.get("/api/v1/me"), "GET /me (md)");
      const mdUserId = String((me.user as Record<string, unknown>).id);
      const other = await pg.query<{ id: string }>(
        `SELECT c.id FROM company c
          WHERE c.id <> (SELECT company_id FROM "user" WHERE id = $1) LIMIT 1`,
        [mdUserId],
      );
      test.skip(other.rowCount === 0, "needs a second company in the stack");
      const foreignCompany = other.rows[0]!.id;

      // The subject is the MD, who holds finance.create and is linked to no worker.
      // That combination is what makes the assertion sharp: a 400 below can only be
      // the TENANT door refusing the worker id, never the permission gate.
      const inserted = await pg.query<{ id: string }>(
        `INSERT INTO worker (company_id, name, day_rate, user_id)
           VALUES ($1, $2, 9999, $3) RETURNING id`,
        [foreignCompany, `B-332 cross-tenant ${RUN}`, mdUserId],
      );
      const foreignWorkerId = inserted.rows[0]!.id;
      try {
        // The MD is a member of the FIRST company. A row now links her to a worker in
        // the OTHER one — Postgres cannot forbid that, since an FK cannot require the
        // referenced user to share company_id. Her tenant-scoped read still cannot
        // see it, so the corrupt link can never become a cross-tenant payroll write.
        const res = await md.post("/api/v1/labor/attendance", {
          data: { worker_id: foreignWorkerId, day: `${YEAR}-08-01`, idempotency_key: key("xt") },
        });
        expect(res.status()).toBe(400);
        expect((await res.json()).message).toMatch(/not found in this tenant/i);

        // …and the foreign worker is absent from this tenant's list entirely.
        const workers = rowsOf(
          await okJson(await md.get("/api/v1/labor/workers"), "GET /labor/workers"),
        );
        expect(workers.some((w) => w.id === foreignWorkerId)).toBe(false);
      } finally {
        await pg.query("DELETE FROM worker WHERE id = $1", [foreignWorkerId]);
      }

      // SECOND, and it cuts the other way: because worker_user_uq is GLOBAL (no
      // company_id in the key), a user who ALREADY holds a legitimate link cannot be
      // squatted from another tenant at all — the corrupt INSERT is refused outright.
      // Recorded deliberately: the same globality means a corrupt row created FIRST
      // would DENY the legitimate link (a 409 on POST /labor/workers). That is a
      // denial surface, not a leak, and it is only reachable from corrupt data —
      // `user.company_id` is NOT NULL, so a cross-company link is always corrupt.
      await expect(
        pg.query(
          `INSERT INTO worker (company_id, name, day_rate, user_id) VALUES ($1, $2, 1, $3)`,
          [foreignCompany, `B-332 squat ${RUN}`, siteUserId],
        ),
      ).rejects.toThrow(/worker_user_uq/);
    } finally {
      await pg.end();
    }
  });
});
