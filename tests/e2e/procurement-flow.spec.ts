import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import {
  API_URL,
  boqItemsByPrice,
  clientFor,
  firstProjectId,
  firstVendorId,
  okJson,
  PR_TIER_MD,
  PR_TIER_PM,
  PO_TIER_PM,
  STATUS,
  uniqueNo,
  USER_PM_L3,
  USER_PROC_L2,
  USER_SITE_L1,
} from "./_api-client.js";

// FLOW-A procurement money-path — the state machine, black-box, against the REAL
// api behind the seeded compose stack (Gate G4 — PLAN.md §9).
//
// Spec source (expected BEHAVIOR + VALUES, never the api implementation —
// tests/CLAUDE.md iron rule):
//   - docs/handoff/flows.html FLOW-A ("BOQ อนุมัติ → เลือกรายการ → สร้าง PR →
//     PR รออนุมัติ (ตาม matrix) → อนุมัติ → เปิด PO → GR รับของ") and its status
//     line "สถานะ PR/PO/PV: draft → pending(ขั้น 1..n) → approved | rejected".
//   - docs/handoff/flows.html "Approval Matrix": PR escalates to ผจก.โครงการ
//     above 500,000 and to MD above 2,000,000; PO/WO to ผจก.โครงการ above
//     1,000,000 and MD above 5,000,000 (strict >). Approval AUTHORITY is the
//     role's approvalLevel (central seed ROLE_DEFS): site 1 / proc 2 / PM 3 / MD 4.
//
// This locks the money path (PR→approve-ladder→PO→GR) as permanent regression
// protection AND independently proves the approval ladder: a lower-tier approver
// is REJECTED (403) on a PR whose amount demands a higher tier, while the correct
// tier advances it.
//
// Gated on E2E_LIVE (mirrors smoke.spec.ts): default runs stay green (the stack
// need not be up); E2E_LIVE=1 runs the full flow against the seeded api. These are
// API-only (no browser/proxy) — each seed user gets its own bearer request context.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

liveDescribe("FLOW-A procurement money-path state machine (G4, live seeded stack)", () => {
  // One bearer context per approval tier + a plain (tokenless) context to prove
  // the endpoints are genuinely auth-gated. Logged in ONCE for the file.
  let requester: APIRequestContext; // site, level 1 — raises the PR
  let procApprover: APIRequestContext; // proc, level 2 — the LOWER tier (must 403)
  let pmApprover: APIRequestContext; // PM, level 3 — the correct tier (must advance)
  let anon: APIRequestContext; // no bearer — must be rejected everywhere

  test.beforeAll(async () => {
    requester = await clientFor(USER_SITE_L1);
    procApprover = await clientFor(USER_PROC_L2);
    pmApprover = await clientFor(USER_PM_L3);
    anon = await pwRequest.newContext({ baseURL: API_URL });
  });

  test.afterAll(async () => {
    await Promise.all([
      requester.dispose(),
      procApprover.dispose(),
      pmApprover.dispose(),
      anon.dispose(),
    ]);
  });

  test("PR → approval-ladder → PO → GR drives each spec state transition", async () => {
    const projectId = await firstProjectId(requester);
    const vendorId = await firstVendorId(pmApprover);
    const items = await boqItemsByPrice(requester);

    // A PR value that lands in the PR "ผจก.โครงการ" tier: > 500,000 and ≤ 2,000,000
    // (flows.html PR row). Priced from the cheapest BOQ item, so the ordered qty
    // is large enough that a partial GR is meaningful. qty × price is computed
    // from the LIVE price the api will sum, and the resulting amount is asserted
    // back into the tier band below.
    const item = items[0]!;
    const qty = Math.round(1_200_000 / item.price); // target ≈ 1.2M, inside the PM band
    let prId = "";

    await test.step("unauthenticated caller is rejected (auth gate)", async () => {
      const res = await anon.get("/api/v1/pr");
      expect(res.status(), "no bearer → 401").toBe(401);
    });

    await test.step("create PR (draft) with a PM-tier BOQ-linked value", async () => {
      const res = await requester.post("/api/v1/pr", {
        data: {
          no: uniqueNo("E2E-PR"),
          type: "material",
          project_id: projectId,
          items: [{ boq_item_id: item.id, qty }],
        },
      });
      expect(res.status(), "createPr → 201").toBe(201);
      const pr = (await res.json()) as Record<string, unknown>;
      prId = String(pr.id);

      // A freshly created PR is a draft with no approval progress (flows.html
      // "draft → …"; server owns status + step).
      expect(pr.status).toBe(STATUS.draft);
      expect(pr.approval_step).toBe(0);

      // amount = Σ qty × BOQ price, and it must land in the PR ผจก.โครงการ tier
      // band (> 500K, ≤ 2M) — this asserts the flows.html threshold AND the api's
      // real amount computation at once.
      const amount = Number(pr.amount);
      expect(amount).toBeGreaterThan(PR_TIER_PM);
      expect(amount).toBeLessThanOrEqual(PR_TIER_MD);
      expect(pr.currency_code, "every money field carries a currency (root CLAUDE.md)").toBe("THB");
    });

    await test.step("submit PR: draft → pending (awaiting the matrix tiers)", async () => {
      const body = await okJson(
        await requester.post(`/api/v1/pr/${prId}/submit`, { data: {} }),
        "submitPr",
      );
      expect(body.status).toBe(STATUS.pending);
      // Pending = mid-ladder: the terminal tier count has NOT yet been reached
      // (flows.html "pending(ขั้น 1..n)" — not the final n). n for this band = 2.
      expect(Number(body.approval_step)).toBeLessThan(2);
    });

    await test.step("approval ladder: LOWER tier (proc, level 2) is REJECTED 403", async () => {
      // The PR's amount (> 500K) demands the ผจก.โครงการ tier; หน.จัดซื้อ alone
      // (level 2) cannot give the terminal approval (flows.html PR row). This is
      // the approve-ladder proof.
      const res = await procApprover.post(`/api/v1/pr/${prId}/approve`, { data: {} });
      expect(res.status(), "under-tier approver → 403").toBe(403);

      // The rejection must NOT have advanced the PR — it is still pending.
      const still = await okJson(await pmApprover.get(`/api/v1/pr/${prId}`), "GET /pr/:id");
      expect(still.status).toBe(STATUS.pending);
    });

    await test.step("approval ladder: CORRECT tier (PM, level 3) advances → approved", async () => {
      const body = await okJson(
        await pmApprover.post(`/api/v1/pr/${prId}/approve`, { data: {} }),
        "approvePr",
      );
      expect(body.status).toBe(STATUS.approved);
      // approval_step now reflects the tiers the amount engaged: หน.จัดซื้อ +
      // ผจก.โครงการ = 2 (flows.html PR MATRIX, the > 500K band).
      expect(body.approval_step).toBe(2);
    });

    let poId = "";
    await test.step("raise PO from the approved PR (draft), total = PR value", async () => {
      const res = await pmApprover.post("/api/v1/po", {
        data: { no: uniqueNo("E2E-PO"), pr_id: prId, vendor_id: vendorId },
      });
      expect(res.status(), "createPo from approved PR → 201").toBe(201);
      const po = (await res.json()) as Record<string, unknown>;
      poId = String(po.id);
      expect(po.status).toBe(STATUS.draft);
      // The PO total is seeded from the source PR's priced lines — same value,
      // and (> 1M) it sits in the PO ผจก.โครงการ tier band (flows.html PO/WO row).
      expect(Number(po.total)).toBeGreaterThan(PO_TIER_PM);
      expect(Number(po.amount)).toBe(Number(po.total));
    });

    await test.step("submit + approve PO (PM tier, level 3) → approved", async () => {
      const submitted = await okJson(
        await pmApprover.post(`/api/v1/po/${poId}/submit`, { data: {} }),
        "submitPo",
      );
      expect(submitted.status).toBe(STATUS.pending);

      const approved = await okJson(
        await pmApprover.post(`/api/v1/po/${poId}/approve`, { data: {} }),
        "approvePo",
      );
      expect(approved.status).toBe(STATUS.approved);
      // PO total > 1M engages หน.จัดซื้อ + ผจก.โครงการ = 2 tiers (flows.html PO row).
      expect(approved.approval_step).toBe(2);
    });

    await test.step("receive a partial GR against the approved PO", async () => {
      const recv = Math.max(1, Math.floor(qty / 2)); // strictly less than the ordered qty
      const gr = await okJson(
        await pmApprover.post("/api/v1/gr", {
          data: {
            no: uniqueNo("E2E-GR"),
            po_id: poId,
            lines: [
              {
                name: "partial receipt",
                qty_ok: recv,
                qty_rejected: 0,
                price: item.price,
                ordered_qty: qty,
              },
            ],
          },
        }),
        "createGr",
      );
      // A goods receipt records at status `received` (gr.jsx; flows.html "GR
      // รับของ (เต็ม/บางส่วน/ตีกลับ)").
      expect(gr.status).toBe("received");
      expect(Number(gr.received)).toBe(recv);
      // Partial: received < ordered → the PO stays open (not auto-closed).
      expect(gr.partial).toBe(true);
      expect(Number(gr.received_total)).toBe(recv);
      expect(Number(gr.ordered_total)).toBe(qty);

      const po = await okJson(await pmApprover.get(`/api/v1/po/${poId}`), "GET /po/:id");
      expect(po.status, "partial receipt leaves the PO open (approved, not closed)").toBe(
        STATUS.approved,
      );
    });
  });
});
