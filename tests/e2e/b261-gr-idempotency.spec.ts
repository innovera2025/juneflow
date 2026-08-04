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

// B-261 — POST /gr idempotency contract, the money=SERVER LIVE replay proof (REAL-PG).
// The invariant a stub can only FABRICATE (the 23505 throw is faked in gr.test.ts): on
// real Postgres a 2nd POST /gr carrying the SAME client idempotency_key returns the
// ORIGINAL receipt (201, same gr id) with NO duplicate row — so the mobile offline
// SyncProcessor's at-least-once retry of a create it never heard back on can never
// double-post a goods receipt (the B-217/B-165-class double-write that a CREATE money-
// write otherwise has, since a fresh id is generated per replay). Mirrors B-167.
//
// Setup builds a real approved PO through the FLOW-A ladder (mirrors procurement-flow),
// then:
//   1. POST /gr {po_id, idempotency_key: K, lines} → 201 (the ORIGINAL receipt).
//   2. POST /gr {po_id, idempotency_key: K, SAME lines} → 201 and the SAME gr id
//      (the replay returns the original, byte-for-byte received/money — not a 409,
//      not a recomputed row), and GET /gr shows EXACTLY ONE receipt with that id.
//   3. CONTROL: POST /gr {po_id, idempotency_key: K2 (a NEW key), lines} → a DISTINCT
//      2nd receipt — proving a fresh key still creates, only a REPLAY dedupes.
// K is generated per-run (the gr_idempotency_uq index is global) so re-runs never
// collide with a prior run's receipt. E2E_LIVE-gated + F4-safe (login 429 → skip).

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

liveDescribe("B-261 POST /gr idempotency replay (G4, live seeded stack, money=SERVER)", () => {
  let requester: APIRequestContext; // site, level 1 — raises the PR
  let pmApprover: APIRequestContext; // PM, level 3 — approves + creates PO/GR
  // Set when the F4 login throttle (429) blocks setup — every test then skips
  // gracefully instead of failing while F4 tuning (B-099) is pending.
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

  test("a replayed POST /gr (same idempotency_key) returns the ORIGINAL receipt — no duplicate; a new key still creates", async () => {
    const projectId = await firstProjectId(requester);
    const vendorId = await firstVendorId(pmApprover);
    const items = await boqItemsByPrice(requester);
    const item = items[0]!;
    // ≈1.2M lands the PR in the > 500K PM band and the PO in the > 1M PM band
    // (mirror procurement-flow), so the PM tier can approve both in one step.
    const qty = Math.round(1_200_000 / item.price);

    // --- Build a real approved PO through the ladder -----------------------
    let prId = "";
    await test.step("create + submit + approve PR (PM tier)", async () => {
      const pr = await okJson(
        await requester.post("/api/v1/pr", {
          data: { no: uniqueNo("E2E-PR-B261"), type: "material", project_id: projectId, items: [{ boq_item_id: item.id, qty }] },
        }),
        "createPr",
      );
      prId = String(pr.id);
      expect(pr.status).toBe(STATUS.draft);
      await okJson(await requester.post(`/api/v1/pr/${prId}/submit`, { data: {} }), "submitPr");
      const approved = await okJson(await pmApprover.post(`/api/v1/pr/${prId}/approve`, { data: {} }), "approvePr");
      expect(approved.status).toBe(STATUS.approved);
    });

    let poId = "";
    await test.step("raise + submit + approve PO", async () => {
      const po = await okJson(
        await pmApprover.post("/api/v1/po", { data: { no: uniqueNo("E2E-PO-B261"), pr_id: prId, vendor_id: vendorId } }),
        "createPo",
      );
      poId = String(po.id);
      await okJson(await pmApprover.post(`/api/v1/po/${poId}/submit`, { data: {} }), "submitPo");
      const approved = await okJson(await pmApprover.post(`/api/v1/po/${poId}/approve`, { data: {} }), "approvePo");
      expect(approved.status).toBe(STATUS.approved);
    });

    // --- The idempotency proof --------------------------------------------
    const key = randomUUID(); // fixed for the run's two POSTs; fresh per run (index is global)
    const recv = Math.max(1, Math.floor(qty / 4)); // small → the PO stays open across receipts
    const grBody = {
      no: uniqueNo("E2E-GR-B261"),
      po_id: poId,
      idempotency_key: key,
      lines: [{ name: "b261 receipt", qty_ok: recv, qty_rejected: 0, price: item.price, ordered_qty: qty }],
    };

    let grId = "";
    let originalMoney = 0;
    await test.step("first POST /gr → 201, the ORIGINAL receipt", async () => {
      const res = await pmApprover.post("/api/v1/gr", { data: grBody });
      if (res.status() !== 201) console.error("DIAG gr create1 →", res.status(), await res.text());
      expect(res.status(), "first create → 201").toBe(201);
      const gr = (await res.json()) as Record<string, unknown>;
      grId = String(gr.id);
      expect(gr.status).toBe("received");
      expect(num(gr.received), "server aggregates qty_ok into received").toBe(recv);
      originalMoney = num(gr.money);
    });

    await test.step("REPLAY: same key → 201, the SAME gr id, byte-for-byte the original (not a 409, not a duplicate)", async () => {
      const res = await pmApprover.post("/api/v1/gr", { data: grBody });
      if (res.status() !== 201) console.error("DIAG gr replay →", res.status(), await res.text());
      // The replay is idempotent — the client sees its OWN receipt, never a 409.
      expect(res.status(), "replay → 201 (idempotent, not 409/500)").toBe(201);
      const gr = (await res.json()) as Record<string, unknown>;
      expect(String(gr.id), "the replay returns the ORIGINAL gr id").toBe(grId);
      expect(gr.status, "same server-owned status").toBe("received");
      expect(num(gr.received), "same server-owned received (money=SERVER, never recomputed)").toBe(recv);
      expect(num(gr.money), "same server-owned money").toBe(originalMoney);
    });

    await test.step("GET /gr shows EXACTLY ONE receipt with that id (the replay created no duplicate)", async () => {
      const body = await okJson(await pmApprover.get("/api/v1/gr"), "GET /gr");
      const mine = rowsOf(body).filter((g) => String(g.id) === grId);
      expect(mine.length, "the replayed receipt exists exactly once").toBe(1);
    });

    await test.step("CONTROL: a NEW key still creates a DISTINCT 2nd receipt (only a replay dedupes)", async () => {
      const res = await pmApprover.post("/api/v1/gr", {
        data: { ...grBody, no: uniqueNo("E2E-GR-B261-CTL"), idempotency_key: randomUUID() },
      });
      if (res.status() !== 201) console.error("DIAG gr control →", res.status(), await res.text());
      expect(res.status(), "a fresh key → 201").toBe(201);
      const gr = (await res.json()) as Record<string, unknown>;
      expect(String(gr.id), "a new key creates a genuinely NEW receipt").not.toBe(grId);
      // both receipts are now visible — the replay is the only one that did NOT add a row.
      const body = await okJson(await pmApprover.get("/api/v1/gr"), "GET /gr after control");
      const againstPo = rowsOf(body).filter((g) => String(g.po_id) === poId);
      const ids = new Set(againstPo.map((g) => String(g.id)));
      expect(ids.has(grId), "the original replayed receipt").toBe(true);
      expect(ids.has(String(gr.id)), "the control receipt").toBe(true);
    });
  });
});
