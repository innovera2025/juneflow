import { test, expect, type APIRequestContext } from "@playwright/test";
import { clientFor, isRateLimited, okJson, USER_MD_L4 } from "./_api-client.js";

// B-308 — POST /labor/payroll idempotency, the money=SERVER LIVE proof (REAL-PG).
// The invariant a stub can only FABRICATE (labor.test.ts fakes the 23505 throw): on real
// Postgres a 2nd POST /labor/payroll for the SAME worker+period returns the ORIGINAL run
// (201, same id) instead of minting a second postable one — so a double-click on
// "run payroll" can no longer pay the same period twice.
//
// WHY a stub cannot settle this: the existing GL guard is per payroll ROW —
// postLaborPayroll keys source_doc `payroll:<id>` against jv_source_doc_uq — so two runs
// carry two DIFFERENT ids and BOTH post as clean, balanced, uncorrelatable JVs. Confirmed
// live before the fix (B-307 reviewer's stack):
//     payroll run1 f72db5ac… 687.5 / run2 bdc2e8a1… 687.5   (distinct ids)
//     GL post1 200 {"jv_no":"JV-2026-0419","amount":687.5}
//     GL post2 200 {"jv_no":"JV-2026-0420","amount":687.5}
//   → 1,375.00 booked Dr 1140 / Cr 1020 for ONE day's work.
// The fix is the natural key unique(worker_id, period) (migration 0058) + a 23505 catch
// that replays the original row (Wei ruling B-308 = ก).
//
// The proof, end to end:
//   1. a fresh worker + a randomised private period, with ONE attendance day (687.50).
//   2. POST /labor/payroll → 201 (the ORIGINAL run), amount SERVER-computed = 687.50.
//   3. POST the SAME body again → 201 with the SAME id, byte-for-byte (not 409, not a 2nd run).
//   4. GET /labor/payroll → EXACTLY ONE run for that worker+period.
//   5. POST both ids to the GL → the FIRST posts (200, a jv_no); the second is the
//      already-posted case (409). THE LEDGER CARRIES ONE JV FOR ONE AMOUNT — this is
//      the assertion that encodes the defect; a row count alone does not reach the money.
//   6. CONTROL: the NEXT period still creates a DISTINCT run — the key rejects no real work.
// E2E_LIVE-gated + F4-safe (login 429 → graceful skip).

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const rowsOf = (b: Record<string, unknown>): Array<Record<string, unknown>> => {
  const d = (b.data ?? b) as unknown;
  return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
};

/** The pay rule under test — flows.html labor: day_rate × day_fraction + ot × (day_rate/8) × 1.5. */
const DAY_RATE = 500;
const OT_HOURS = 2;
const ONE_DAY_PAY = DAY_RATE * 1 + OT_HOURS * (DAY_RATE / 8) * 1.5; // 500 + 187.50 = 687.50

liveDescribe("B-308 POST /labor/payroll idempotency (G4, live seeded stack, money=SERVER)", () => {
  let finance: APIRequestContext; // MD/Director — carries finance.create + finance.approve
  let rateLimited = false;

  test.beforeAll(async () => {
    try {
      finance = await clientFor(USER_MD_L4);
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
      "B-082 F4 login rate-limiter (429): the throttle blocks setup login. Skipping until F4 is tuned — B-099.",
    );
  });

  test.afterAll(async () => {
    await finance?.dispose();
  });

  test("a second run of the same worker+period returns the ORIGINAL run — one row, and the GL carries ONE JV, not two", async () => {
    // A fresh worker + a randomised private period, so the payroll SUM covers exactly
    // this run's attendance and a re-run of this spec never collides with an earlier one
    // (payroll_worker_period_uq is a GLOBAL index on worker_id + period).
    const year = 2030 + Math.floor(Math.random() * 60);
    const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
    const period = `${year}-${month}`;
    const nextPeriod = `${year + 1}-${month}`; // the control period (never the same key)

    let workerId = "";
    await test.step("create a worker at a known day_rate", async () => {
      const w = await okJson(
        await finance.post("/api/v1/labor/workers", {
          data: { name: `E2E-B308-${Date.now()}`, day_rate: DAY_RATE },
        }),
        "createWorker",
      );
      workerId = String(w.id);
      expect(num(w.day_rate), "the worker's day_rate is stored as given").toBe(DAY_RATE);
    });

    await test.step("record ONE attendance day in that period (the whole payout)", async () => {
      const a = await okJson(
        await finance.post("/api/v1/labor/attendance", {
          data: { worker_id: workerId, day: `${period}-05`, ot: OT_HOURS, status: "full" },
        }),
        "createAttendance",
      );
      expect(num(a.day_fraction), "a full day pays 1 (SERVER-derived)").toBe(1);
    });

    let runId = "";
    let replayId = "";
    await test.step("run payroll TWICE — the second is the ORIGINAL, byte-for-byte", async () => {
      const first = await finance.post("/api/v1/labor/payroll", {
        data: { worker_id: workerId, period },
      });
      expect(first.status(), "the first run is created").toBe(201);
      const run = (await first.json()) as Record<string, unknown>;
      runId = String(run.id);
      expect(num(run.amount), "amount is SERVER-computed = ONE day's pay").toBe(ONE_DAY_PAY);

      // THE DOUBLE-CLICK. Before B-308 this minted a second run with its own id.
      const second = await finance.post("/api/v1/labor/payroll", {
        data: { worker_id: workerId, period },
      });
      expect(second.status(), "the repeat is idempotent — 201 with the original").toBe(201);
      const replay = (await second.json()) as Record<string, unknown>;
      replayId = String(replay.id);
      expect(replayId, "the SAME run id — no second postable row exists").toBe(runId);
      expect(replay, "byte-identical to the original 201").toEqual(run);
    });

    await test.step("the register holds EXACTLY ONE run for that worker+period", async () => {
      const rows = rowsOf(
        (await (await finance.get("/api/v1/labor/payroll")).json()) as Record<string, unknown>,
      );
      const mine = rows.filter(
        (r) => String(r.worker_id ?? r.workerId) === workerId && String(r.period) === period,
      );
      expect(mine, "one worker + one period = one run").toHaveLength(1);
      expect(String(mine[0]!.id)).toBe(runId);
      expect(num(mine[0]!.amount), "and it pays ONE day, not two").toBe(ONE_DAY_PAY);
    });

    await test.step("THE MONEY: posting both returned ids books ONE JV for ONE amount", async () => {
      const post1 = await finance.post(`/api/v1/labor/payroll/${runId}/post`);
      expect(post1.status(), "the run posts to the GL").toBe(200);
      const posted = (await post1.json()) as Record<string, unknown>;
      expect(num(posted.amount), "the JV books ONE day's pay").toBe(ONE_DAY_PAY);
      const jvNo = String(posted.jv_no);
      expect(jvNo, "a real voucher number").toMatch(/^JV-\d{4}-\d{4}$/);

      // The id the DOUBLE-CLICK returned. Before B-308 it was a DIFFERENT run and this
      // posted a SECOND balanced JV (the live JV-2026-0419 / JV-2026-0420 pair).
      const post2 = await finance.post(`/api/v1/labor/payroll/${replayId}/post`);
      expect(post2.status(), "the double-click has nothing new to post").toBe(409);

      // …and the ledger proves it: exactly ONE JV references this worker's runs.
      const jvs = rowsOf(
        (await (await finance.get("/api/v1/gl/jv")).json()) as Record<string, unknown>,
      );
      const mine = jvs.filter((j) =>
        String(j.source_doc ?? j.sourceDoc ?? "").includes(runId),
      );
      expect(mine, "ONE JV for one day's work — not two").toHaveLength(1);
      expect(String(mine[0]!.no ?? mine[0]!.jv_no)).toBe(jvNo);
      const lines = ((mine[0]!.lines ?? []) as Array<Record<string, unknown>>) ?? [];
      if (lines.length > 0) {
        const dr = lines.reduce((s, l) => s + num(l.dr), 0);
        const cr = lines.reduce((s, l) => s + num(l.cr), 0);
        expect(dr, "balanced Dr 1140 / Cr 1020").toBe(cr);
        expect(dr, "…booking ONE day's pay, not 1,375.00").toBe(ONE_DAY_PAY);
      }
    });

    await test.step("CONTROL: the NEXT period still creates a distinct run", async () => {
      const res = await finance.post("/api/v1/labor/payroll", {
        data: { worker_id: workerId, period: nextPeriod },
      });
      expect(res.status(), "a different period is real work, never a replay").toBe(201);
      const run = (await res.json()) as Record<string, unknown>;
      expect(String(run.id), "a genuinely new run").not.toBe(runId);
      expect(num(run.amount), "no attendance in that period → honest 0").toBe(0);
    });
  });
});
