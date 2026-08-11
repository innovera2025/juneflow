import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { clientFor, isRateLimited, okJson, USER_MD_L4 } from "./_api-client.js";

// B-307 — POST /labor/attendance idempotency, the money=SERVER LIVE replay proof (REAL-PG).
// The invariant a stub can only FABRICATE (labor.test.ts fakes the 23505 throw): on real
// Postgres a 2nd POST /labor/attendance carrying the SAME client idempotency_key returns
// the ORIGINAL row (201, same id) with NO duplicate — so the mobile offline
// SyncProcessor's at-least-once retry of a check-in it never heard back on can never
// double-pay the worker.
//
// WHY this is money and not data hygiene: POST /labor/payroll computes the payout by
// SUMMING attendance ROWS in the period (labor.ts — a JS accumulate over every in-period
// row, NOT a DISTINCT-day aggregate). A duplicate row therefore inflates the payout by a
// full day's pay, and the downstream guard cannot see it: the payroll → JV post is keyed
// on `payroll:<id>` (jv_source_doc_uq), so the INFLATED amount posts as one clean balanced
// Dr 1140 / Cr 1020 JV. Nothing else in the system would ever detect it.
//
// The proof, end to end:
//   1. POST /labor/attendance {worker_id, day, ot, idempotency_key: K} → 201 (the ORIGINAL).
//   2. POST the SAME body again → 201 with the SAME id, byte-for-byte (not 409, not a 2nd row).
//   3. GET /labor/attendance → EXACTLY ONE row with that id.
//   4. POST /labor/payroll for that worker+period → the SERVER-computed amount equals the
//      SINGLE-day figure, not double. THIS is the assertion that encodes the defect; a row
//      count alone does not.
//   5. CONTROL: a NEW key still creates a DISTINCT row — only a REPLAY dedupes.
// The worker is created per-run and the day is randomised, so the period sums only this
// run's rows and re-runs never collide (attendance_idempotency_uq is a GLOBAL index).
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

liveDescribe("B-307 POST /labor/attendance idempotency replay (G4, live seeded stack, money=SERVER)", () => {
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

  test("a replayed check-in (same idempotency_key) returns the ORIGINAL row — no duplicate, and PAYROLL still pays ONE day", async () => {
    // A fresh worker + a randomised day inside a private period, so the payroll SUM
    // below covers exactly this run's attendance and nothing else.
    const period = `20${30 + Math.floor(Math.random() * 60)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}`;
    // Three DISTINCT days in that period: the one under test, the control create, and
    // the reused-key/different-anchor probe. Fixed (not random) so they can never
    // collide with each other — a collision would silently invert an expectation.
    const day = `${period}-05`;
    const controlDay = `${period}-06`;
    const otherDay = `${period}-07`;

    let workerId = "";
    await test.step("create a worker at a known day_rate", async () => {
      const w = await okJson(
        await finance.post("/api/v1/labor/workers", {
          data: { name: `E2E-B307-${Date.now()}`, day_rate: DAY_RATE },
        }),
        "createWorker",
      );
      workerId = String(w.id);
      expect(num(w.day_rate), "the worker's day_rate is stored as given").toBe(DAY_RATE);
    });

    const key = randomUUID(); // fixed for the run's two POSTs; fresh per run (index is global)
    const body = { worker_id: workerId, day, ot: OT_HOURS, status: "full", idempotency_key: key };

    let attId = "";
    let original: Record<string, unknown> = {};
    await test.step("first POST → 201, the ORIGINAL attendance row", async () => {
      const res = await finance.post("/api/v1/labor/attendance", { data: body });
      if (res.status() !== 201) console.error("DIAG attendance create1 →", res.status(), await res.text());
      expect(res.status(), "first create → 201").toBe(201);
      original = (await res.json()) as Record<string, unknown>;
      attId = String(original.id);
      // day_fraction is SERVER-DERIVED from status (never a client value).
      expect(num(original.day_fraction), "status full → day_fraction 1 (server-derived)").toBe(1);
      expect(num(original.ot)).toBe(OT_HOURS);
    });

    await test.step("REPLAY: same key → 201, the SAME id, byte-for-byte the original (not 409, not a duplicate)", async () => {
      const res = await finance.post("/api/v1/labor/attendance", { data: body });
      if (res.status() !== 201) console.error("DIAG attendance replay →", res.status(), await res.text());
      expect(res.status(), "replay → 201 (idempotent, not 409/500)").toBe(201);
      const replay = (await res.json()) as Record<string, unknown>;
      expect(String(replay.id), "the replay returns the ORIGINAL row id").toBe(attId);
      // ONE sender produces both bodies, so they are identical by construction.
      expect(replay).toEqual(original);
    });

    await test.step("GET /labor/attendance shows EXACTLY ONE row with that id", async () => {
      const list = await okJson(await finance.get("/api/v1/labor/attendance"), "GET /labor/attendance");
      const mine = rowsOf(list).filter((a) => String(a.id) === attId);
      expect(mine.length, "the replayed check-in exists exactly once").toBe(1);
      const forWorkerDay = rowsOf(list).filter(
        (a) => String(a.worker_id) === workerId && String(a.day) === day,
      );
      expect(forWorkerDay.length, "one worker-day → one row (the replay added none)").toBe(1);
    });

    await test.step("THE MONEY PROOF: payroll pays ONE day (687.50), not double", async () => {
      const pay = await okJson(
        await finance.post("/api/v1/labor/payroll", { data: { worker_id: workerId, period } }),
        "createPayroll",
      );
      // day_rate × 1 + 2h OT × (day_rate/8) × 1.5. A duplicate row would double this —
      // and it would then post as ONE clean balanced JV, undetectable downstream.
      expect(num(pay.amount), "SERVER-computed payout = a single day").toBe(ONE_DAY_PAY);
      expect(num(pay.amount), "NOT the double-pay the duplicate row would cause").not.toBe(ONE_DAY_PAY * 2);
      expect(pay.currency_code, "money carries its currency").toBe("THB");
    });

    await test.step("CONTROL: a NEW key still creates a DISTINCT row (only a replay dedupes)", async () => {
      const res = await finance.post("/api/v1/labor/attendance", {
        data: { ...body, day: controlDay, idempotency_key: randomUUID() },
      });
      if (res.status() !== 201) console.error("DIAG attendance control →", res.status(), await res.text());
      expect(res.status(), "a fresh key → 201").toBe(201);
      const fresh = (await res.json()) as Record<string, unknown>;
      expect(String(fresh.id), "a new key creates a genuinely NEW row").not.toBe(attId);
    });

    await test.step("CONTROL: the same key against a DIFFERENT day 409s (never hands back a day that was not recorded)", async () => {
      const res = await finance.post("/api/v1/labor/attendance", {
        data: { ...body, day: otherDay, idempotency_key: key },
      });
      // The resolver anchors on worker_id + day, so a mismatched anchor resolves
      // nothing → the insert trips the global index → an honest 409, never someone
      // else's (or another day's) record dressed up as a success.
      expect(res.status(), "reused key + different anchor → honest 409").toBe(409);
      expect(((await res.json()) as Record<string, unknown>).code).toBe("INVALID_STATE");
    });
  });
});
