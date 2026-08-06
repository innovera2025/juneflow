import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { clientFor, isRateLimited, okJson, USER_MD_L4 } from "./_api-client.js";

// B-309 — a PRESENT but NON-STRING idempotency_key, the money=SERVER LIVE proof (REAL-PG).
//
// THE DEFECT (live-proven on the un-patched handlers before this spec existed):
// `str()` returns "" for anything that is not a string, so the ratified B-261 form
// `str(pick(body,"idempotency_key")).trim() || null` collapsed a JSON NUMBER to null
// and the request silently took the NO-KEY path — no dedup, no 400, no warning, while
// the client believed it had sent a key. Measured on the un-patched build:
//   POST /labor/attendance {…, idempotency_key: 123} ×2 → 201, 201, TWO rows,
//   both persisting idempotency_key NULL → payroll 1375.00 instead of 687.50.
//   POST /gr {…, idempotency_key: 123} ×2 → 201, 201, TWO receipts (goods received 2×).
// Wei B-309 = (ก): a present non-string key is a 400 VALIDATION. Silence is the defect.
//
// WHY the unit suites cannot replace this: labor.test.ts / gr.test.ts assert against a
// stub. Only real Postgres proves that the REJECTED request left the money tables
// untouched while the SAME endpoint still dedups a valid string key on the very same
// worker/PO — the two halves that together mean "type-gated, not dedup-broken".
//
// E2E_LIVE-gated + F4-safe (login 429 → graceful skip), mirroring b307/b308.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

const rowsOf = (b: Record<string, unknown>): Array<Record<string, unknown>> => {
  const d = (b.data ?? b) as unknown;
  return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
};

/** The pay rule under test — flows.html labor: day_rate × day_fraction + ot × (day_rate/8) × 1.5. */
const DAY_RATE = 500;
const OT_HOURS = 2;
const ONE_DAY_PAY = DAY_RATE * 1 + OT_HOURS * (DAY_RATE / 8) * 1.5; // 687.50

/** Every non-string shape a JSON body can carry. `null` is NOT here — see the last test. */
const NON_STRING_KEYS: Array<[string, unknown]> = [
  ["a number (the live-proven double-post)", 123],
  ["a float", 1.5],
  ["a boolean", true],
  ["an array", ["1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"]],
  ["an object", { key: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" }],
];

liveDescribe("B-309 a non-string idempotency_key is refused, never silently de-duped (G4, live seeded stack, money=SERVER)", () => {
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

  test("POST /labor/attendance: every non-string key → 400 and writes NOTHING, while a valid string key on the same worker still dedups", async () => {
    // A fresh worker in a private future period, so the payroll SUM below covers
    // exactly this run's attendance and nothing else.
    const stamp = Date.now();
    const worker = await okJson(
      await finance.post("/api/v1/labor/workers", {
        data: { name: `B309-${stamp}`, day_rate: DAY_RATE },
      }),
      "createWorker",
    );
    const workerId = String(worker.id);
    const period = `2098-${String(1 + (stamp % 12)).padStart(2, "0")}`;

    // --- every non-string shape is refused, and leaves no row -----------------
    for (const [label, key] of NON_STRING_KEYS) {
      const i = NON_STRING_KEYS.findIndex(([l]) => l === label);
      const res = await finance.post("/api/v1/labor/attendance", {
        data: { worker_id: workerId, day: `${period}-0${i + 1}`, ot: OT_HOURS, idempotency_key: key },
      });
      expect(res.status(), `${label} → 400`).toBe(400);
      expect((await res.json()).code, `${label} → VALIDATION`).toBe("VALIDATION");
    }
    // Replaying the number twice is the exact live repro — on the un-patched build
    // this produced two rows; here neither POST may reach the table.
    const day = `${period}-14`;
    for (const _ of [1, 2]) {
      const res = await finance.post("/api/v1/labor/attendance", {
        data: { worker_id: workerId, day, ot: OT_HOURS, idempotency_key: 123 },
      });
      expect(res.status(), "the replayed NUMBER is refused both times").toBe(400);
    }

    // THE assertion: no attendance row exists for this worker at all, so the money
    // that a duplicate would have inflated was never created.
    const listed = await okJson(await finance.get("/api/v1/labor/attendance"), "listAttendance");
    expect(rowsOf(listed).filter((r) => r.worker_id === workerId)).toHaveLength(0);

    // --- the same endpoint still dedups a VALID string key --------------------
    // (a 400-everything guard would also pass the assertions above — this half is
    // what proves the fix gates on TYPE and did not break the B-307 contract.)
    const key = randomUUID();
    const good = { worker_id: workerId, day, ot: OT_HOURS, idempotency_key: key };
    const first = await okJson(await finance.post("/api/v1/labor/attendance", { data: good }), "create");
    const replay = await okJson(await finance.post("/api/v1/labor/attendance", { data: good }), "replay");
    expect(replay.id, "the replay returns the ORIGINAL row").toBe(first.id);

    // and the SERVER-computed payout is ONE day — the figure the defect doubled.
    const payroll = await okJson(
      await finance.post("/api/v1/labor/payroll", { data: { worker_id: workerId, period } }),
      "createPayroll",
    );
    expect(Number(payroll.amount), "one day's pay, not two").toBeCloseTo(ONE_DAY_PAY, 2);
  });

  test("POST /labor/attendance: an EXPLICIT null is ABSENT, not invalid — it still creates (the legitimate no-key path)", async () => {
    // A nullable client field serialised as null means "I minted no key" — nobody is
    // misled, so refusing it would break a legitimate caller. Classified as ABSENT.
    const stamp = Date.now();
    const worker = await okJson(
      await finance.post("/api/v1/labor/workers", {
        data: { name: `B309-null-${stamp}`, day_rate: DAY_RATE },
      }),
      "createWorker",
    );
    const res = await finance.post("/api/v1/labor/attendance", {
      data: { worker_id: String(worker.id), day: "2098-12-01", ot: 0, idempotency_key: null },
    });
    expect(res.status(), "explicit null → a normal create").toBe(201);
  });
});
