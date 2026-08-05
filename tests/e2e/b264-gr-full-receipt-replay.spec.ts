import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  boqItemsByPrice,
  clientFor,
  firstProjectId,
  firstVendorId,
  isRateLimited,
  okJson,
  STATUS,
  uniqueNo,
  USER_PM_L3,
  USER_SITE_L1,
} from "./_api-client.js";

// B-264 — the ORDER-CLOSING replay, the LIVE proof (REAL-PG) that B-261's live
// spec could not give.
//
// b261-gr-idempotency.spec.ts deliberately receives only `qty / 4` — its own
// comment says "small → the PO stays open across receipts". Every gr.test.ts
// B-261 case likewise seeds a PARTIAL receipt (qty_ok 300 of 1000). So the case
// the client key actually exists for was never exercised anywhere: st-receive
// defaults to recv = ordered (mobile-field.jsx:44), a FULL receipt CLOSES the PO
// inside POST /gr, and the replay used to live only in the insert's 23505 catch
// BELOW the anchor gate `po.status !== "approved" → 409 INVALID_STATE`.
// Result on the happy path: commit succeeded → response lost → SyncProcessor
// replays → 409 for goods that WERE received. sync_processor.dart dead-letters
// every 4xx permanently, so the storekeeper saw FAILED with no in-app recovery.
//
// This spec receives the WHOLE order, asserts the PO really is `closed`, and only
// THEN replays the same key. Against real Postgres (not a stubbed 23505):
//   1. full POST /gr → 201; GET /po shows the PO closed.
//   2. REPLAY same key → 201 with the ORIGINAL id/received/money (was 409).
//   3. exactly ONE gr row, ONE gr_item set and ONE defect_report for that key.
//   4. CONTROL: a FRESH key against the now-closed PO → still 409 (the pre-check
//      only excuses a key that resolves; it does not reopen a closed order).
// Key generated per-run (gr_idempotency_uq is a global partial index).
// E2E_LIVE-gated + F4-safe (login 429 → skip).

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

liveDescribe("B-264 POST /gr order-closing replay (G4, live seeded stack, money=SERVER)", () => {
  let requester: APIRequestContext; // site, level 1 — raises the PR
  let pmApprover: APIRequestContext; // PM, level 3 — approves + creates PO/GR
  let rateLimited = false;

  test.beforeAll(async () => {
    try {
      requester = await clientFor(USER_SITE_L1);
      pmApprover = await clientFor(USER_PM_L3);
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
      "B-082 F4 login rate-limiter (429): the throttle blocks the multi-tier setup logins. Skipping until F4 is tuned — B-099.",
    );
  });

  test.afterAll(async () => {
    await Promise.all([requester, pmApprover].filter(Boolean).map((c) => c.dispose()));
  });

  test("a FULL receipt closes the PO — and the replay STILL returns the original receipt, not 409", async () => {
    const projectId = await firstProjectId(requester);
    const vendorId = await firstVendorId(pmApprover);
    const items = await boqItemsByPrice(requester);
    const item = items[0]!;
    // ≈1.2M lands the PR in the > 500K PM band and the PO in the > 1M PM band,
    // so the PM tier can approve both in one step (mirrors b261/procurement-flow).
    const qty = Math.round(1_200_000 / item.price);

    // --- Build a real approved PO through the ladder -----------------------
    let prId = "";
    await test.step("create + submit + approve PR (PM tier)", async () => {
      const pr = await okJson(
        await requester.post("/api/v1/pr", {
          data: {
            no: uniqueNo("E2E-PR-B264"),
            type: "material",
            project_id: projectId,
            items: [{ boq_item_id: item.id, qty }],
          },
        }),
        "createPr",
      );
      prId = String(pr.id);
      expect(pr.status).toBe(STATUS.draft);
      await okJson(await requester.post(`/api/v1/pr/${prId}/submit`, { data: {} }), "submitPr");
      const approved = await okJson(
        await pmApprover.post(`/api/v1/pr/${prId}/approve`, { data: {} }),
        "approvePr",
      );
      expect(approved.status).toBe(STATUS.approved);
    });

    let poId = "";
    await test.step("raise + submit + approve PO", async () => {
      const po = await okJson(
        await pmApprover.post("/api/v1/po", {
          data: { no: uniqueNo("E2E-PO-B264"), pr_id: prId, vendor_id: vendorId },
        }),
        "createPo",
      );
      poId = String(po.id);
      await okJson(await pmApprover.post(`/api/v1/po/${poId}/submit`, { data: {} }), "submitPo");
      const approved = await okJson(
        await pmApprover.post(`/api/v1/po/${poId}/approve`, { data: {} }),
        "approvePo",
      );
      expect(approved.status).toBe(STATUS.approved);
    });

    // --- The order-closing receipt ----------------------------------------
    const key = randomUUID(); // fixed for the run's two POSTs; fresh per run
    // THE WHOLE ORDER — st-receive's default (recv = ordered). This is what B-261's
    // live spec avoided by receiving only qty/4.
    const grBody = {
      no: uniqueNo("E2E-GR-B264"),
      po_id: poId,
      idempotency_key: key,
      lines: [
        {
          name: "b264 full receipt",
          qty_ok: qty,
          qty_rejected: 1, // → a defect_report, so the child-write count is provable too
          price: item.price,
          ordered_qty: qty,
        },
      ],
    };

    let grId = "";
    let originalBody: Record<string, unknown> = {};
    await test.step("first POST /gr (FULL qty) → 201, and it CLOSES the PO", async () => {
      const res = await pmApprover.post("/api/v1/gr", { data: grBody });
      if (res.status() !== 201) console.error("DIAG gr create1 →", res.status(), await res.text());
      expect(res.status(), "first create → 201").toBe(201);
      originalBody = (await res.json()) as Record<string, unknown>;
      grId = String(originalBody.id);
      expect(originalBody.status).toBe("received");
      expect(num(originalBody.received), "server aggregates qty_ok into received").toBe(qty);
      expect(originalBody.partial, "the whole order was received → not partial").toBe(false);

      // The state that used to strand the replay, read back from the server.
      const po = await okJson(await pmApprover.get(`/api/v1/po/${poId}`), "GET /po/:id");
      expect(po.status, "a full receipt closes the PO in this same handler").toBe("closed");
    });

    await test.step("REPLAY the same key against the now-CLOSED PO → 201, the ORIGINAL receipt (B-264: was 409)", async () => {
      const res = await pmApprover.post("/api/v1/gr", { data: grBody });
      if (res.status() !== 201) console.error("DIAG gr replay →", res.status(), await res.text());
      expect(
        res.status(),
        "the SyncProcessor's replay of a landed receipt must not be a 4xx dead-letter",
      ).toBe(201);
      const gr = (await res.json()) as Record<string, unknown>;
      expect(String(gr.id), "the replay returns the ORIGINAL gr id").toBe(grId);
      expect(num(gr.received), "same server-owned received (money=SERVER)").toBe(qty);
      expect(num(gr.rejected), "same server-owned rejected").toBe(1);
      expect(num(gr.money), "same server-owned money").toBe(num(originalBody.money));
      expect(gr.partial, "same derived partial/full").toBe(originalBody.partial);
      // byte-identical: both 201s come from the one envelope builder.
      expect(gr).toEqual(originalBody);
    });

    await test.step("EXACTLY ONE receipt and ONE defect exist for that key (the replay wrote nothing)", async () => {
      const body = await okJson(await pmApprover.get("/api/v1/gr"), "GET /gr");
      const againstPo = rowsOf(body).filter((g) => String(g.po_id) === poId);
      expect(againstPo.length, "one PO-anchored receipt, not two").toBe(1);
      expect(String(againstPo[0]!.id)).toBe(grId);
      expect(
        (againstPo[0]!.items as unknown[]).length,
        "one gr_item line, not two (the replay re-read it)",
      ).toBe(1);
      expect(num(againstPo[0]!.received), "received was never doubled").toBe(qty);
    });

    await test.step("CONTROL: a FRESH key against the CLOSED PO is still 409 (the pre-check does not reopen an order)", async () => {
      const res = await pmApprover.post("/api/v1/gr", {
        data: { ...grBody, no: uniqueNo("E2E-GR-B264-CTL"), idempotency_key: randomUUID() },
      });
      expect(res.status(), "a genuinely new receipt against a closed PO → 409").toBe(409);
      const err = (await res.json()) as Record<string, unknown>;
      expect(err.code).toBe("INVALID_STATE");
      expect(String(err.message)).toContain("approved (open) PO");
      expect(err.id, "no receipt was handed back").toBeUndefined();
    });
  });
});
