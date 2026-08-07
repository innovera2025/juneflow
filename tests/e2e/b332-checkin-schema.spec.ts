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
//   A. THE CONSTRAINT REJECTS NO LEGITIMATE WORK. The design refused the FULL
//      unique(worker_id, day) natural key, and B-336 then added a PARTIAL one
//      (attendance_self_day_uq — one UNCOSTED row per worker per day). A stub cannot
//      prove either judgement, because a stub has no index to reject anything. Three
//      shapes are exercised against the real table: a cost-centre-split day, a night
//      shift crossing midnight, and a MIXED split (one costed half, one uncosted).
//      Each is a real INSERT that the full natural key would have turned into a
//      23505 and the partial one lets through. A FOURTH case, the "correction" filed
//      after check-out, was in this list until B-336 and is now REFUSED: it corrected
//      nothing (payroll SUMS rows, so it paid MORE for less work), which is why it
//      moved from the legitimate list to the duplicate class.
//
//   B. CONCURRENCY, in two different shapes because the two writes need different
//      proofs. The CHECK-OUT race is CONSTRUCTED — a second psql session holds an
//      uncommitted colliding UPDATE open, the API fires into the row lock, and the
//      test asserts the API genuinely BLOCKED before answering; that is what
//      distinguishes a guard on the UPDATE's own WHERE (correct) from a guard on a
//      preceding SELECT (B-149: two round trips, both writers pass). The CHECK-IN
//      needs the opposite: a real parallel BURST, because the defect is two INSERTs
//      racing a SELECT-then-INSERT pre-check (B-336). The burst tests are the only
//      ones in the repository that die when attendance_self_day_uq is dropped from a
//      live database — the api suite stays fully green without it, probed.
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

// ---------------------------------------------------------------------------
// B-337 (Wei 2026-08-08, option ก) — THE SELF-SERVICE DAYS ARE REAL DAYS NOW
// ---------------------------------------------------------------------------
// Every SELF-SERVICE case below used to send a day in the randomised YEAR (2100-2499),
// which is how it stayed re-runnable and how each payroll assertion covered only its
// own rows. Wei's ruling makes a fabricated day a 400 on that door — that IS the
// ruling — so those days now come from the server's own window instead. NOTHING that
// any of those tests ASSERTS has changed; only the date they say it about.
//
// The ROSTER-door cases (LEGITIMATE #1/#2/#4, RECLASSIFIED, the constructed race, the
// cross-tenant probe) keep their fabricated years deliberately: door 1 is NOT bounded
// by the window, and their solo workers are what isolates them.
//
// Two consequences the fixtures now have to carry, both stated rather than hidden:
//   1. RE-RUNNABILITY. Real days repeat, and attendance_self_day_uq (B-336) refuses a
//      second uncosted row for a worker+day — so a second run on one stack would 409
//      where the first got 201. The adopted worker's window is therefore cleared in
//      beforeAll (raw SQL: there is no DELETE on attendance — B-335).
//   2. PAYROLL ISOLATION. The window is 8 days, so the three fabricated MONTHS that
//      used to separate the two money assertions no longer exist. Each money assertion
//      gets its OWN worker linked to the Site Engineer for its duration instead, which
//      is exactly as isolating and does not weaken what it proves.
//
// The window is mirrored from labor.ts rather than imported (this spec drives the API
// black-box, over HTTP, and must not link its implementation).
const BUSINESS_OFFSET_MS = 7 * 60 * 60_000; // Thailand, UTC+07:00 year-round, no DST
const MS_PER_DAY = 86_400_000;
const businessNow = (): number =>
  process.env.SEED_FROZEN_NOW && Number.isFinite(Date.parse(process.env.SEED_FROZEN_NOW))
    ? Date.parse(process.env.SEED_FROZEN_NOW)
    : Date.now();
/** The calendar date `agoDays` before the business today (0 = today). 0..7 are legal. */
const windowDay = (agoDays: number): string =>
  new Date(businessNow() + BUSINESS_OFFSET_MS - agoDays * MS_PER_DAY).toISOString().slice(0, 10);
/** The payroll period (`YYYY-MM`) a window day falls in — the window can straddle one. */
const periodOf = (day: string): string => day.slice(0, 7);

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

    // B-337: clear THIS worker's window so the run starts where the last one did.
    // Scoped to the spec's own subject and to the 8 days the self-service door can
    // even write — it touches no seeded row and no other worker. Skipped silently
    // without DATABASE_URL; the self-service tests then simply require a fresh stack.
    if (PG_URL) {
      const pg = new Client({ connectionString: PG_URL });
      await pg.connect();
      try {
        await pg.query("DELETE FROM attendance WHERE worker_id = $1 AND day >= $2", [
          workerId,
          windowDay(7),
        ]);
      } finally {
        await pg.end();
      }
    }
  });

  /**
   * Run `body` with a FRESH worker linked to the Site Engineer, then put the original
   * link back. worker_user_uq is 1:1 and there is no unlink endpoint, so the swap is
   * raw SQL — the same reason the deactivation test below reaches for it. Used only
   * where a payroll SUM must cover one test's rows and nothing else (B-337 collapsed
   * the fabricated months that used to do that job).
   */
  async function withOwnLinkedWorker(
    label: string,
    body: (id: string) => Promise<void>,
  ): Promise<void> {
    const pg = new Client({ connectionString: PG_URL });
    await pg.connect();
    let ownId = "";
    try {
      await pg.query("UPDATE worker SET user_id = NULL WHERE id = $1", [workerId]);
      const own = await okJson(
        await md.post("/api/v1/labor/workers", {
          data: { name: `B-332 ${label} ${RUN}`, day_rate: DAY_RATE, user_id: siteUserId },
        }),
        `POST /labor/workers (${label})`,
      );
      ownId = String(own.id);
      await body(ownId);
    } finally {
      if (ownId) await pg.query("UPDATE worker SET user_id = NULL WHERE id = $1", [ownId]);
      await pg.query("UPDATE worker SET user_id = $2 WHERE id = $1", [workerId, siteUserId]);
      await pg.end();
    }
  }

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
    const day = windowDay(0); // B-337: today, the shape the screen actually produces
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
    const day = windowDay(1);
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
    test.skip(!PG_URL, "needs DATABASE_URL: B-337 leaves no fabricated month to isolate the SUM");
    const day = windowDay(2);
    const period = periodOf(day);

    await withOwnLinkedWorker("five-taps", async (subject) => {
      // Exactly the reviewer's probe: the payee, five taps, NO idempotency key (a key
      // would not have mattered — a screen remount mints a new one, see below).
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await site.post("/api/v1/labor/attendance", {
          data: { worker_id: subject, day },
        });
        statuses.push(res.status());
      }
      expect(statuses).toEqual([201, 409, 409, 409, 409]);

      const rows = await rowsFor(subject, day);
      expect(rows).toHaveLength(1);
      expect(rows.reduce((s, r) => s + Number(r.day_fraction), 0)).toBe(1);

      // THE money assertion. Five accepted rows paid 5 × DAY_RATE here before the guard.
      const payroll = await okJson(
        await md.post("/api/v1/labor/payroll", { data: { worker_id: subject, period } }),
        "POST /labor/payroll",
      );
      expect(payroll.amount).toBe(DAY_RATE);
    });
  });

  // B-336 — THE CONCURRENT CLASS. THE ONLY TESTS IN THE REPOSITORY THAT DIE WHEN
  // attendance_self_day_uq IS DROPPED FROM A LIVE DATABASE.
  //
  // The test above fires five taps IN SERIES and passes on the pre-check alone. These
  // fire them AT ONCE, which is what a double-tapped phone actually does, and at the
  // pre-check-only SHA that wrote two rows and paid the day twice in 2 of 3 runs — the
  // B-165/B-167 lesson exactly: a guard proven sequentially is not proven, and the
  // static reviews did not see it either. Under READ COMMITTED both requests complete
  // findRecordedDay's SELECT before either INSERT commits, so only a DB-layer
  // constraint can settle it.
  //
  // NO KEY IS SENT, deliberately — attendance_idempotency_uq is PARTIAL and exempts
  // NULL keys, so this burst passes straight through it and ONLY the B-336 index can
  // catch it. That is what makes the assertion sharp: it cannot pass on some other
  // constraint by accident.
  //
  // WHY IT IS BOTH A MONEY AND A STATUS ASSERTION. One row is the money. The 409s are
  // the phone: at the index-WITHOUT-catch SHA this burst answered [201,500], which
  // keeps the money right but wedges the SyncProcessor's whole write drain behind a
  // deferred 5xx. Both halves have to hold.
  //
  // FLAKE-HONEST: the race is probabilistic, so a PASS on one run is weak evidence and
  // a FAIL is strong evidence. Two widths trade a little runtime for that asymmetry.
  //
  // B-337 FIXTURE NOTE: these four share ONE worker of their own, linked to the Site
  // Engineer for the group's duration, because the money test at the end sums a PERIOD
  // and the ruling left no fabricated month to separate it from the rest of the file.
  // The three bursts are otherwise UNCHANGED — same widths, same absence of a key, same
  // build-then-await construction, same assertions.
  test.describe("B-336 the concurrent class", () => {
    let burstWorker = "";
    let burstDays: string[] = [];
    let unlink: (() => Promise<void>) | null = null;

    test.beforeAll(async () => {
      if (rateLimited || !PG_URL) return;
      const pg = new Client({ connectionString: PG_URL });
      await pg.connect();
      await pg.query("UPDATE worker SET user_id = NULL WHERE id = $1", [workerId]);
      const own = await okJson(
        await md.post("/api/v1/labor/workers", {
          data: { name: `B-332 burst ${RUN}`, day_rate: DAY_RATE, user_id: siteUserId },
        }),
        "POST /labor/workers (burst subject)",
      );
      burstWorker = String(own.id);
      // Three days inside ONE payroll period, so the money assertion still covers all
      // three bursts. The window can straddle a month end, so they are picked, not
      // assumed: the offset with the most window days in its own month wins.
      const all = [0, 1, 2, 3, 4, 5, 6, 7].map(windowDay);
      const newest = all.filter((d) => periodOf(d) === periodOf(all[0]!));
      const oldest = all.filter((d) => periodOf(d) === periodOf(all[7]!));
      // 8 days across at most 2 months, so one side always holds at least 4.
      burstDays = (newest.length >= 3 ? newest : oldest).slice(0, 3);
      expect(burstDays).toHaveLength(3);
      unlink = async () => {
        await pg.query("UPDATE worker SET user_id = NULL WHERE id = $1", [burstWorker]);
        await pg.query("UPDATE worker SET user_id = $2 WHERE id = $1", [workerId, siteUserId]);
        await pg.end();
      };
    });

    test.afterAll(async () => {
      if (unlink) await unlink();
    });

    test.beforeEach(() => {
      test.skip(!PG_URL, "needs DATABASE_URL: B-337 leaves no fabricated month to isolate the SUM");
    });

    for (const [i, n] of [2, 10].entries()) {
      test(`CONCURRENT — a burst of ${n} simultaneous self-service check-ins is ONE row and ONE day's pay (B-336)`, async () => {
        const day = burstDays[i]!;

        // Built first, awaited together: a map that awaited INSIDE would serialise them
        // and the test would pass against the very defect it exists to catch.
        const inFlight = [];
        for (let j = 0; j < n; j += 1) {
          inFlight.push(
            site.post("/api/v1/labor/attendance", { data: { worker_id: burstWorker, day } }),
          );
        }
        const statuses = (await Promise.all(inFlight)).map((r) => r.status());

        // EXACTLY ONE 201; every other caller refused, and refused with a 4xx it can act
        // on rather than a 5xx it defers.
        expect(statuses.filter((s) => s === 201)).toHaveLength(1);
        expect(statuses.filter((s) => s === 409)).toHaveLength(n - 1);
        expect(await rowsFor(burstWorker, day)).toHaveLength(1);
      });
    }

    test("CONCURRENT — the burst does not cost the offline REPLAY its 201: the same key in flight four times still resolves to one row, for every caller", async () => {
      // The case where BOTH indexes are violated by one INSERT. Postgres names only one
      // of them, so a catch that dispatched on the constraint NAME before resolving the
      // caller's own key could answer 409 here — and the phone DEAD-LETTERS a 4xx, which
      // silently loses this worker's day. Measured on PG 16 the name that arrives is
      // attendance_idempotency_uq (relation index OID order), which is not a contract, so
      // this asserts the OUTCOME rather than the name.
      const day = burstDays[2]!;
      const payload = { worker_id: burstWorker, day, idempotency_key: key("burst-replay") };
      const inFlight = [];
      for (let i = 0; i < 4; i += 1) {
        inFlight.push(site.post("/api/v1/labor/attendance", { data: payload }));
      }
      const settled = await Promise.all(inFlight);
      expect(settled.map((r) => r.status())).toEqual([201, 201, 201, 201]);

      const ids = new Set(await Promise.all(settled.map(async (r) => String((await r.json()).id))));
      expect(ids.size).toBe(1); // one row, handed back to every caller
      expect(await rowsFor(burstWorker, day)).toHaveLength(1);
    });

    test("the money after the bursts: three days recorded, three days paid — not the sixteen check-ins that were asked for", async () => {
      // The three tests above requested 2 + 10 + 4 = 16 check-ins across three days in
      // one period. Payroll SUMS rows, so this is where any leak surfaces as cash rather
      // than as a row count.
      const payroll = await okJson(
        await md.post("/api/v1/labor/payroll", {
          data: { worker_id: burstWorker, period: periodOf(burstDays[0]!) },
        }),
        "POST /labor/payroll",
      );
      expect(payroll.amount).toBe(DAY_RATE * 3);
    });
  });

  test("a REMOUNT is caught where the idempotency key could not see it — a NEW key for the same worker+day is a DUPLICATE, not a replay", async () => {
    const day = windowDay(3);
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
      data: { worker_id: workerId, day: windowDay(4) },
    });
    expect(nextDay.status()).toBe(201);

    // And the B-307 replay path is untouched: same key twice → the ORIGINAL row, 201.
    const day = windowDay(5);
    const payload = { worker_id: workerId, day, idempotency_key: key("dup-replay") };
    const a = await site.post("/api/v1/labor/attendance", { data: payload });
    const b = await site.post("/api/v1/labor/attendance", { data: payload });
    expect([a.status(), b.status()]).toEqual([201, 201]);
    expect((await b.json()).id).toBe((await a.json()).id);
    expect(await rowsFor(workerId, day)).toHaveLength(1);
  });

  test("self-service may not assert a COST CENTRE — it is the duplicate guard's own escape hatch (one re-inflation per centre)", async () => {
    const day = windowDay(6);
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
    const day = windowDay(7); // the FAR EDGE of the B-337 window
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
    test.skip(!PG_URL, "needs DATABASE_URL: B-337 leaves no fabricated month to isolate the SUM");
    // B-337: a real window day, on a worker of this test's own so the period SUM below
    // still covers exactly these rows. Assertions unchanged.
    const day = windowDay(0);
    const period = periodOf(day);
    const k = key("pair");
    await withOwnLinkedWorker("checkout-pair", async (workerId) => {
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
  });

  test("a replayed check-out is idempotent (200, the original row); a DIFFERENT instant on a closed day is 409 and never overwrites", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL: B-337 makes the check-in day a real one");
    const day = windowDay(0); // B-337: a real window day, on this test's own worker
    const k = key("replay");
    await withOwnLinkedWorker("checkout-replay", async (subject) => {
      await okJson(
        await site.post("/api/v1/labor/attendance", {
          data: { worker_id: subject, day, idempotency_key: k },
        }),
        "check-in",
      );
      const out = { worker_id: subject, day, check_in_key: k, checked_out_at: `${day}T10:00:00.000Z` };

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
      const [row] = await rowsFor(subject, day);
      expect(row?.checked_out_at).toBe(`${day}T10:00:00.000Z`);
      expect(await rowsFor(subject, day)).toHaveLength(1);
    });
  });

  test("a check-out EARLIER than its own check-in is refused, and the row keeps its open state (B-332 gate-4.5 finding 6)", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL: B-337 makes the check-in day a real one");
    const day = windowDay(0); // B-337: a real window day, on this test's own worker
    const k = key("backwards");
    await withOwnLinkedWorker("checkout-backwards", async (workerId) => {
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

  // B-332 gate-4.5 finding 2 — THIS TEST'S NAME USED TO SAY "a correction", then "a
  // second row is ACCEPTED". It now says REFUSED, and the history matters because the
  // 201 it used to assert was the decisive justification for refusing a unique key.
  //
  // The claim was that a second INSERT is the only way to correct a day. The INSERT was
  // accepted, but it corrected nothing: createLaborPayroll SUMS ROWS, so on a 500/day
  // worker one `full` day paid 500 and filing the `half` "correction" paid 750 —
  // reducing the day RAISED the pay, where a day genuinely corrected to half owes 250.
  //
  // B-336 therefore reclassifies this INSERT from "legitimate work a natural key would
  // reject" to "the duplicate class", and attendance_self_day_uq now refuses it on BOTH
  // doors. Note carefully what did and did not change:
  //   - NOTHING is corrected. There is still no UPDATE/PUT/PATCH/DELETE on attendance
  //     anywhere in registerLaborRoute and no supersede column. B-335 is open for a real
  //     correction path, and this index does not foreclose it — that path will be an
  //     UPDATE or a supersede marker, not a second INSERT;
  //   - what IS closed is the inflation. The day stays at one day's pay instead of
  //     climbing to 1.5, which is the assertion this test now carries.
  // The three genuinely legitimate shapes are LEGITIMATE #1, #2 and the mixed split
  // below, all still 201 — that is what keeps the predicate honest.
  test("RECLASSIFIED (B-336) — the `correction` second row on one date is REFUSED, and the day stays at one day's pay instead of climbing to 1.5", async () => {
    const day = `${YEAR}-05-20`;
    const period = `${YEAR}-05`;
    const k = key("second-row");
    // A worker of this test's own, so the period's payroll covers only these rows.
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
    // This is the ROSTER door (finance.create, and md holds it), which has no
    // application pre-check — so a 409 here can ONLY have come from the index + catch.
    // A 500 would mean the catch stopped naming the constraint; a 201, that the index
    // is gone.
    const second = await md.post("/api/v1/labor/attendance", {
      data: { worker_id: soloId, day, status: "half", idempotency_key: key("second-row-2") },
    });
    expect(second.status()).toBe(409);
    expect((await second.json()).message).toMatch(/already recorded/i);

    const rows = rowsOf(
      await okJson(await md.get("/api/v1/labor/attendance"), "GET /labor/attendance"),
    ).filter((r) => r.worker_id === soloId && r.day === day);
    expect(rows).toHaveLength(1);

    // THE MONEY. This paid DAY_RATE * 1.5 before the index. It does not correct the day
    // down to 250 — nothing does yet (B-335) — but it no longer pays MORE for less work.
    const payroll = await okJson(
      await md.post("/api/v1/labor/payroll", { data: { worker_id: soloId, period } }),
      "POST /labor/payroll",
    );
    expect(payroll.amount).toBe(DAY_RATE);
  });

  test("LEGITIMATE #4 — a MIXED split: one half charged to a cost centre, one left uncosted. Only ONE row is cc_id NULL, so the index sees no collision", async () => {
    // The shape that proves the predicate is doing real discrimination rather than
    // banning second rows outright: two rows, one date, one worker, and it passes
    // because exactly one of them falls inside `WHERE cc_id IS NULL`.
    const day = `${YEAR}-05-25`;
    const period = `${YEAR}-05`;
    const ccs = rowsOf(await okJson(await md.get("/api/v1/cost-centers"), "GET /cost-centers"));
    test.skip(ccs.length === 0, "needs a seeded cost centre");
    const solo = await okJson(
      await md.post("/api/v1/labor/workers", {
        data: { name: `B-332 mixed-split ${RUN}`, day_rate: DAY_RATE },
      }),
      "POST /labor/workers (mixed-split subject)",
    );
    const soloId = String(solo.id);

    const costed = await md.post("/api/v1/labor/attendance", {
      data: { worker_id: soloId, day, status: "half", cc_id: ccs[0]!.id },
    });
    const uncosted = await md.post("/api/v1/labor/attendance", {
      data: { worker_id: soloId, day, status: "half" },
    });
    expect([costed.status(), uncosted.status()]).toEqual([201, 201]);

    const payroll = await okJson(
      await md.post("/api/v1/labor/payroll", { data: { worker_id: soloId, period } }),
      "POST /labor/payroll",
    );
    expect(payroll.amount).toBe(DAY_RATE); // 0.5 + 0.5 — one day, correctly split
  });

  // -------------------------------------------------------------------------
  // E. The B-307 key still dedups
  // -------------------------------------------------------------------------

  test("B-307 REGRESSION — a replayed check-in still returns the ORIGINAL row after the new columns and the new gate land", async () => {
    // B-337: a real window day on the shared worker. The offsets this file hands the
    // shared subject are distinct BY CONSTRUCTION — 0 clock-in · 1 OT (roster row) ·
    // 2 here · 3-5 the duplicate guard · 6 cc (no row) · 7 deactivation (roster row) —
    // because attendance_self_day_uq refuses a second uncosted row for a worker+day,
    // so two tests sharing an offset would 409 the second one for the wrong reason.
    const day = windowDay(2);
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
    const day = windowDay(0); // B-337: a real window day, on this test's own worker
    const k = key("race");
    await withOwnLinkedWorker("race", async (workerId) => {
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

  // -------------------------------------------------------------------------
  // H. A MALFORMED `day` (B-332 gate-4.5 finding 2)
  // -------------------------------------------------------------------------
  // The one place this can be proven. `attendance.day` is a Postgres `date` column
  // and the string went straight to it, so the answer was decided by Postgres' date
  // parser and NOT by any code a stub can exercise: at 0de5782 a malformed day was a
  // 500 (22007/22008) on BOTH new doors, and `infinity` / `today` / an MDY date / an
  // ISO instant were all accepted and coerced. The api suite can see neither half —
  // it has no date column to raise the error and no parser to do the coercing.
  //
  // WHY THE 500 WAS THE SHARP END: the mobile SyncProcessor dead-letters a 4xx
  // permanently but DEFERS a 5xx and STOPS the drain, so one malformed queued op
  // wedges every write behind it for that worker, silently.

  test("a malformed `day` is a 400 on BOTH doors, never a 500 — the shape that wedges the phone's offline drain", async () => {
    for (const day of ["not-a-date", `${YEAR}-13-45`, `${YEAR}-02-30`]) {
      const create = await md.post("/api/v1/labor/attendance", {
        data: { worker_id: workerId, day, idempotency_key: key(`bad-${day}`) },
      });
      expect(create.status(), `create day=${day}`).toBe(400);
      expect((await create.json()).message).toMatch(/YYYY-MM-DD calendar date/);

      const checkout = await md.post("/api/v1/labor/attendance/checkout", {
        data: {
          worker_id: workerId,
          day,
          check_in_key: key(`bad-${day}`),
          checked_out_at: `${YEAR}-01-04T10:00:00.000Z`,
        },
      });
      expect(checkout.status(), `checkout day=${day}`).toBe(400);
      expect((await checkout.json()).message).toMatch(/YYYY-MM-DD calendar date/);
    }
  });

  test("the values the `date` column silently ACCEPTED are refused too — an ISO instant, an MDY date, a relative keyword, and `infinity`", async () => {
    // Each of these 201'd at 0de5782 and stored something the caller did not say:
    // 2121-01-01T00:00:00Z → 2121-01-01 · 01/02/2121 → 2121-01-02 under a DateStyle of
    // MDY and 1 Feb under DMY · today → the SERVER's current date · infinity → a row
    // no period query can ever sum. One spelling is the only rule checkable at the edge.
    for (const day of [`${YEAR}-01-01T00:00:00Z`, "01/02/2121", "today", "infinity"]) {
      const res = await md.post("/api/v1/labor/attendance", {
        data: { worker_id: workerId, day, idempotency_key: key(`coerced-${day}`) },
      });
      expect(res.status(), `day=${day}`).toBe(400);
    }
  });

  // -------------------------------------------------------------------------
  // I. B-337 — WHICH DAY (Wei 2026-08-08, option ก)
  // -------------------------------------------------------------------------
  // Finding 2 above bounds the SHAPE of `day`. This is the other axis and the money
  // one: at 0de5782, `2121-01-01..10` were ten 201s FOR THE PAYEE HIMSELF and
  // POST /labor/payroll {period:"2121-01"} paid 5000 on a 500/day worker. Payroll SUMS
  // rows, so naming N dates was N days' pay, behind one clean balanced JV.
  //
  // Both directions are asserted, because a window that only refuses is not a window:
  // it must still accept the day a genuine offline queue drains LATE (sync_processor
  // level (a) has no expiry and drains on app-resume), or the 4xx dead-letters that
  // day permanently and the man is simply never paid for it.

  test("B-337 — the payee's fabricated days are REFUSED on his own door, and the ten-day reproduction pays nothing", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to isolate the period SUM");
    await withOwnLinkedWorker("b337-repro", async (subject) => {
      const statuses: number[] = [];
      for (let d = 1; d <= 10; d += 1) {
        const res = await site.post("/api/v1/labor/attendance", {
          data: { worker_id: subject, day: `2121-01-${String(d).padStart(2, "0")}` },
        });
        statuses.push(res.status());
      }
      expect(statuses).toEqual(Array(10).fill(400));
      for (const day of ["2199-12-31", "1999-01-01"]) {
        const res = await site.post("/api/v1/labor/attendance", {
          data: { worker_id: subject, day },
        });
        expect(res.status(), `day=${day}`).toBe(400);
      }
      // THE money assertion — the whole point. It was 5000.
      const payroll = await okJson(
        await md.post("/api/v1/labor/payroll", { data: { worker_id: subject, period: "2121-01" } }),
        "POST /labor/payroll (2121-01)",
      );
      expect(payroll.amount).toBe(0);
    });
  });

  test("B-337 — and the other direction: TODAY posts, the far edge of the window (a week-late drain) posts, one day beyond it and tomorrow do not", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to isolate the period SUM");
    await withOwnLinkedWorker("b337-window", async (subject) => {
      // The far edge FIRST: a check-in taken 7 days ago on a phone with no signal,
      // draining only now. If this were refused the window would be wrong — that day
      // is real work, and a 4xx is a permanent dead-letter.
      const far = await site.post("/api/v1/labor/attendance", {
        data: { worker_id: subject, day: windowDay(7), idempotency_key: key("b337-far") },
      });
      expect(far.status(), `far edge ${windowDay(7)}`).toBe(201);

      const today = await site.post("/api/v1/labor/attendance", {
        data: { worker_id: subject, day: windowDay(0), idempotency_key: key("b337-today") },
      });
      expect(today.status(), `today ${windowDay(0)}`).toBe(201);

      // One day past the edge, and tomorrow. Distinct messages: one is a stale queue,
      // the other cannot be anything but fabrication.
      const stale = await site.post("/api/v1/labor/attendance", {
        data: { worker_id: subject, day: windowDay(8) },
      });
      expect(stale.status(), `beyond the edge ${windowDay(8)}`).toBe(400);
      expect((await stale.json()).message).toMatch(/more than 7 days old/i);

      const future = await site.post("/api/v1/labor/attendance", {
        data: { worker_id: subject, day: windowDay(-1) },
      });
      expect(future.status(), `tomorrow ${windowDay(-1)}`).toBe(400);
      expect((await future.json()).message).toMatch(/cannot be in the future/i);

      // Door 1 is NOT bounded: the supervisor still records the days the payee cannot.
      const roster = await md.post("/api/v1/labor/attendance", {
        data: { worker_id: subject, day: "2121-01-01", idempotency_key: key("b337-roster") },
      });
      expect(roster.status()).toBe(201);
    });
  });
});
