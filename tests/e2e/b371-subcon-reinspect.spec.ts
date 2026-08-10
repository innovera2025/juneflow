// B-371 (G4, live seeded stack) — a REJECTED work period is no longer stranded.
//
// WHAT THIS CLOSES, measured on the seeded stack before the change: every
// `work_period.status` write in apps/api lives in subcon.ts's deliver /
// inspect(pass) / inspect(reject) / approve-payment handlers. Exactly one wrote
// `rejected` and NOTHING left it — deliver required `pending`, inspect required
// `delivered|inspecting`, approve-payment required `passed`. So a period the
// foreman turned back could never be re-inspected, its money never reached AP,
// and the seed's own `rejected` row was permanently immovable.
//
// The fix is a widened SOURCE on the existing door rather than a new endpoint —
// the prototype's own "ขอตรวจซ้ำ" button sets `state: "requested"`
// (pototype/subcon-accept2.jsx:106), which maps to the wire's delivered/inspecting,
// and `grep reinspect packages/contracts/openapi.yaml` is 0 hits. So no SACRED
// contract edit and no new enum value were needed.
//
// This spec drives the WHOLE loop against the real api, because the unit tests
// exercise one handler each and the thing that was broken is the CYCLE:
//   pending → deliver → inspect(reject) → deliver AGAIN → inspect(pass)
//
// E2E_LIVE-gated + F4-safe (login 429 → graceful skip), mirroring b340/b342/b368.
import { test, expect, type APIRequestContext } from "@playwright/test";
import { clientFor, isRateLimited, okJson, USER_MD_L4 } from "./_api-client.js";

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

const rowsOf = (b: Record<string, unknown>): Array<Record<string, unknown>> => {
  const d = (b.data ?? b) as unknown;
  return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
};

liveDescribe("B-371 — a rejected work period can be re-inspected", () => {
  let md: APIRequestContext;
  let rateLimited = false;

  /**
   * Every work period of the tenant. There is no tenant-wide /periods list — the
   * only read door is GET /subcon-contracts/{id}/periods — so this walks the
   * contracts, which is also what the acceptance screen does.
   */
  const periods = async (): Promise<Array<Record<string, unknown>>> => {
    const contracts = rowsOf(
      await okJson(await md.get("/api/v1/subcon-contracts"), "GET /subcon-contracts"),
    );
    const all: Array<Record<string, unknown>> = [];
    for (const c of contracts) {
      all.push(
        ...rowsOf(
          await okJson(
            await md.get(`/api/v1/subcon-contracts/${String(c.id)}/periods`),
            `GET /subcon-contracts/${String(c.id)}/periods`,
          ),
        ),
      );
    }
    return all;
  };

  const statusOf = async (id: string): Promise<string> => {
    const row = (await periods()).find((p) => p.id === id);
    expect(row, `period ${id} must still be readable`).toBeDefined();
    return String(row!.status);
  };

  /** A period in `status`, resolved FRESH — this suite moves them as it runs. */
  const oneIn = async (status: string): Promise<string> => {
    const row = (await periods()).find((p) => p.status === status);
    expect(row, `the seeded stack must carry a work period in '${status}'`).toBeDefined();
    return String(row!.id);
  };

  test.beforeAll(async () => {
    try {
      md = await clientFor(USER_MD_L4);
    } catch (e) {
      if (isRateLimited(e)) {
        rateLimited = true;
        return;
      }
      throw e;
    }
  });

  test.beforeEach(() => {
    test.skip(rateLimited, "login rate-limited (B-082 F4 / B-099) — skipping, not failing");
  });

  test("the FULL loop: deliver → reject → RE-deliver → pass", async () => {
    const id = await oneIn("pending");

    // 1. the contractor delivers.
    const delivered = await md.post(`/api/v1/periods/${id}/deliver`, {
      data: { docs: ["b371-round1.pdf"], photos: ["before.jpg"] },
    });
    expect(delivered.status()).toBe(200);
    expect((await delivered.json()).status).toBe("delivered");

    // 2. the foreman turns it back with a Defect List.
    const rejected = await md.post(`/api/v1/periods/${id}/inspect`, {
      data: {
        result: "reject",
        defects: [{ item: "ผนังก่ออิฐไม่ได้ดิ่ง", severity: "major", photo_before: "before.jpg" }],
      },
    });
    expect(rejected.status()).toBe(200);
    expect((await rejected.json()).status).toBe("rejected");

    // 3. THE STEP THAT DID NOT EXIST: the contractor resubmits after the fix.
    const redelivered = await md.post(`/api/v1/periods/${id}/deliver`, {
      data: { docs: ["b371-round2.pdf"], photos: ["after.jpg"] },
    });
    expect(redelivered.status()).toBe(200);
    const body = await redelivered.json();
    expect(body.status).toBe("delivered");
    // The acceptance is REFRESHED, not duplicated — a rejected period always has
    // one already (the reject handler ensures it so the defects have a parent).
    expect(body.acceptance).toBeTruthy();
    expect(body.acceptance.docs).toEqual(["b371-round2.pdf"]);

    // 4. …and the re-inspection can now pass, so the period reaches AP at last.
    const passed = await md.post(`/api/v1/periods/${id}/inspect`, { data: { result: "pass" } });
    expect(passed.status()).toBe(200);
    expect((await passed.json()).status).toBe("passed");
    expect(await statusOf(id)).toBe("passed");
  });

  test("the SEEDED rejected period — immovable before this change — re-delivers", async () => {
    const id = await oneIn("rejected");
    const res = await md.post(`/api/v1/periods/${id}/deliver`, {
      data: { docs: ["b371-seeded-fix.pdf"], photos: [] },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe("delivered");
  });

  test("the other states stay shut: delivered and passed both 409, never 500", async () => {
    // 409 not 500 matters on every door a phone can reach: sync_processor.dart
    // dead-letters a 4xx but DEFERS a 5xx and stops the drain, so a 500 would
    // wedge a field worker's whole offline queue.
    for (const status of ["delivered", "passed"]) {
      const id = await oneIn(status);
      const res = await md.post(`/api/v1/periods/${id}/deliver`, {
        data: { docs: [], photos: [] },
      });
      expect(res.status(), `deliver from ${status}`).toBe(409);
      expect((await res.json()).code).toBe("INVALID_STATE");
      expect(await statusOf(id)).toBe(status); // untouched
    }
  });

  test("a period outside the tenant is 404, not a 409 that admits it exists", async () => {
    const res = await md.post(
      "/api/v1/periods/00000000-0000-4000-8000-000000000351/deliver",
      { data: { docs: [], photos: [] } },
    );
    expect(res.status()).toBe(404);
  });
});
