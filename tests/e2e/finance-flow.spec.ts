import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import {
  API_URL,
  clientFor,
  isRateLimited,
  expectedNet,
  expectedWht,
  firstGrId,
  firstPoId,
  firstVendorId,
  glAccountIds,
  okJson,
  pvById,
  PV_TIER_FINMGR,
  PV_TIER_MD,
  STATUS,
  uniqueNo,
  USER_ACC_TIER1,
  USER_FINMGR_TIER2,
  USER_MD_L4,
  USER_PROC_L2,
  WHT_PCT_SERVICE,
} from "./_api-client.js";

// Wave-2 FINANCE money-path — the AP→PV→GL→Bank chain, black-box, against the
// REAL api behind the seeded stack on a live Postgres (Gate G4 — PLAN.md §9).
//
// Spec source (expected BEHAVIOR + VALUES, never the api implementation —
// tests/CLAUDE.md iron rule):
//   - docs/handoff/flows.html finance flow + "Approval Matrix": the PV ladder is
//     บัญชี (accountant) → ผจก.การเงิน (Finance Manager) above 500,000 → MD above
//     2,000,000 (strict >). Approval AUTHORITY is the role's approvalLevel
//     (central seed): accountant `acc` = level 0 (has finance.approve, tier-1),
//     Finance Manager `finmgr` = level 3 (seed migration 0026), MD `dir` = level 4.
//   - PV net formula (ap.jsx PVCreateForm): net = gross − WHT − retention, and the
//     WHT leg is the withholding tax at the Thai construction/service rate (3%).
//     The net is SERVER-authoritative: the api computes it and ignores any client
//     value (so a tampered `net` in the request never persists).
//   - GL double-entry (accounting-extra.jsx / gl.jsx JVCreateForm): a JV must be
//     BALANCED — Σdebit === Σcredit (per-line rounded) and Σdebit > 0.
//   - Bank reconciliation (bank.jsx): a statement's UNMATCHED line auto-SUGGESTS a
//     candidate doc by exact amount + a ±7-day date window; the user then manually
//     CONFIRMS the link (POST /bank/lines/:id/match). A re-match is rejected.
//
// Bank surface: `registerBankRoute` IS mounted in apps/api/src/app.ts on the dev
// build under test (GET/POST /bank/*), so the bank test runs. It self-skips if a
// build ever ships without the bank handlers (probe → 404), per task guidance.
//
// Gated on E2E_LIVE (mirrors procurement-flow.spec.ts): default runs stay green
// (the stack need not be up); E2E_LIVE=1 runs the full chain against the seeded
// api. API-only (no browser/proxy) — each approval tier gets its own bearer ctx.

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;

const BOGUS_UUID = "00000000-0000-0000-0000-000000000000";

liveDescribe("Wave-2 finance money-path (G4, live seeded stack)", () => {
  // One bearer context per finance tier, plus a plain (tokenless) context proving
  // the endpoints are genuinely auth-gated. Logged in ONCE for the file.
  let accountant: APIRequestContext; // acc, level 0 — tier-1 (≤500K only)
  let finMgr: APIRequestContext; // finmgr, level 3 — tier-2 (>500K…≤2M)
  let md: APIRequestContext; // dir, level 4 — tier-3 (>2M)
  let procNoPerm: APIRequestContext; // proc, level 2 — NO finance.approve (perm gate)
  let anon: APIRequestContext; // no bearer — must be rejected everywhere
  // Set when the F4 login throttle (429) blocks setup — every test then skips
  // gracefully instead of failing while F4 tuning (B-099) is pending.
  let rateLimited = false;

  test.beforeAll(async () => {
    try {
      accountant = await clientFor(USER_ACC_TIER1);
      finMgr = await clientFor(USER_FINMGR_TIER2);
      md = await clientFor(USER_MD_L4);
      procNoPerm = await clientFor(USER_PROC_L2);
      anon = await pwRequest.newContext({ baseURL: API_URL });
    } catch (e) {
      if (isRateLimited(e)) {
        rateLimited = true; // graceful skip — see beforeEach
        return;
      }
      throw e; // a real setup failure still fails loud
    }
  });

  test.beforeEach(() => {
    test.skip(
      rateLimited,
      "B-082 F4 login rate-limiter (429): the per-IP throttle blocks the money-path's multi-tier setup logins. Skipping until F4 is tuned (per-user / higher threshold / test-mode bypass) — B-099.",
    );
  });

  test.afterAll(async () => {
    await Promise.all(
      [accountant, finMgr, md, procNoPerm, anon]
        .filter(Boolean)
        .map((c) => c.dispose()),
    );
  });

  // Create an AP billing and return its wire body (helper for the PV/adversarial
  // tests that just need a tenant billing to draw a PV from).
  async function makeBilling(
    client: APIRequestContext,
    vendorId: string,
    amount: number,
  ): Promise<Record<string, unknown>> {
    return okJson(
      await client.post("/api/v1/ap/billing", {
        data: { vendor_id: vendorId, amount, invoice_no: uniqueNo("INV") },
      }),
      "createBilling",
    );
  }

  test("auth gate — finance endpoints reject an unauthenticated caller", async () => {
    expect((await anon.get("/api/v1/ap/pv")).status(), "no bearer → 401").toBe(401);
    expect((await anon.get("/api/v1/gl/coa")).status(), "no bearer → 401").toBe(401);
    expect(
      (await anon.post("/api/v1/gl/jv", { data: {} })).status(),
      "no bearer → 401",
    ).toBe(401);
    expect(
      (await anon.get("/api/v1/bank/statements")).status(),
      "no bearer → 401",
    ).toBe(401);
  });

  test("AP billing (3-way match context) honours explicit WHT + retention and derives WHT at 3%", async () => {
    const vendorId = await firstVendorId(finMgr);
    const poId = await firstPoId(finMgr);
    const grId = await firstGrId(finMgr);

    // (a) explicit WHT + retention, linked to a PO + GR + invoice (3-way context).
    const gross = 800_000;
    const explicitWht = 24_000;
    const retention = 40_000;
    const billing = await okJson(
      await finMgr.post("/api/v1/ap/billing", {
        data: {
          po_id: poId,
          gr_id: grId,
          vendor_id: vendorId,
          invoice_no: uniqueNo("INV"),
          amount: gross,
          vat: 53_200,
          wht: explicitWht,
          retention,
        },
      }),
      "createBilling (3-way)",
    );
    expect(billing.status, "a new AP billing starts draft (server-owned)").toBe(
      STATUS.draft,
    );
    // The 3-way linkage persisted (PO + GR legs of the match context).
    expect(billing.po_id).toBe(poId);
    expect(billing.gr_id).toBe(grId);
    expect(billing.vendor_id).toBe(vendorId);
    expect(Number(billing.amount)).toBe(gross);
    // An explicit WHT is honoured verbatim; retention is stored as sent.
    expect(Number(billing.wht)).toBe(explicitWht);
    expect(Number(billing.retention)).toBe(retention);
    expect(billing.currency_code, "every money doc carries a currency (root CLAUDE.md)").toBe(
      "THB",
    );

    // (b) WHT is DERIVED via the tax engine at the 3% service rate when omitted
    // (flows.html / ap.jsx WHT 3%). 268,000 × 3% = 8,040 (the seed's own example).
    const derivedGross = 268_000;
    const derived = await makeBilling(finMgr, vendorId, derivedGross);
    expect(Number(derived.wht), "omitted WHT → tax-engine 3% of gross").toBe(
      expectedWht(derivedGross, WHT_PCT_SERVICE),
    );
  });

  test("PV net is server-authoritative and the approval ladder enforces the amount tiers", async () => {
    const vendorId = await firstVendorId(finMgr);
    const billing = await makeBilling(finMgr, vendorId, 800_000);
    const billingId = String(billing.id);

    // Gross in the tier-2 band (>500K, ≤2M) so the ladder proof is meaningful.
    const gross = 800_000;
    const retention = 40_000;
    let pvId = "";

    await test.step("create PV — server computes net, ignoring a tampered client net", async () => {
      const pv = await okJson(
        await finMgr.post("/api/v1/ap/pv", {
          data: {
            billing_ids: [billingId],
            amount: gross,
            wht_pct: WHT_PCT_SERVICE,
            retention,
            method: "transfer",
            // A tampered net the server MUST ignore (net is server-authoritative).
            net: 1,
          },
        }),
        "createPv",
      );
      pvId = String(pv.id);
      expect(pv.status, "a new PV awaits approval (server-owned)").toBe(STATUS.pending);
      expect(Number(pv.amount)).toBe(gross);
      // WHT via the tax engine (3% of gross); net = gross − WHT − retention.
      const wht = expectedWht(gross, WHT_PCT_SERVICE);
      expect(Number(pv.wht)).toBe(wht);
      expect(Number(pv.retention)).toBe(retention);
      expect(Number(pv.net), "net is server-computed, NOT the tampered client value").toBe(
        expectedNet(gross, wht, retention),
      );
      expect(Number(pv.net)).not.toBe(1);
      expect(pv.currency_code).toBe("THB");
      // The amount sits in the ผจก.การเงิน band (flows.html PV row).
      expect(gross).toBeGreaterThan(PV_TIER_FINMGR);
      expect(gross).toBeLessThanOrEqual(PV_TIER_MD);
    });

    await test.step("perm gate: a caller without finance.approve is denied (any amount)", async () => {
      // proc (level 2) has no finance.approve — denied regardless of the tier.
      const res = await procNoPerm.post(`/api/v1/pv/${pvId}/approve`, { data: {} });
      expect(res.status(), "no finance.approve perm → 403").toBe(403);
    });

    await test.step("ladder: the under-tier approver (accountant, level 0) is REJECTED 403", async () => {
      // บัญชี holds finance.approve but only tier-1 authority; a PV > 500K demands
      // ผจก.การเงิน (flows.html PV row). This is the approve-ladder proof.
      const res = await accountant.post(`/api/v1/pv/${pvId}/approve`, { data: {} });
      expect(res.status(), "under-tier approver → 403").toBe(403);
      // The rejection must NOT have advanced the PV — it is still pending.
      const still = await pvById(finMgr, pvId);
      expect(still?.status, "a rejected approval leaves the PV pending").toBe(STATUS.pending);
    });

    await test.step("ladder: the correct tier (Finance Manager, level 3) advances → approved", async () => {
      const body = await okJson(
        await finMgr.post(`/api/v1/pv/${pvId}/approve`, { data: {} }),
        "approvePv (finmgr)",
      );
      expect(body.status).toBe(STATUS.approved);
    });

    await test.step("idempotency guard: approving an already-approved PV → 409", async () => {
      const res = await finMgr.post(`/api/v1/pv/${pvId}/approve`, { data: {} });
      expect(res.status(), "re-approve of a settled PV → 409").toBe(409);
    });
  });

  test("PV above 2,000,000 escalates past the Finance Manager to MD", async () => {
    const vendorId = await firstVendorId(md);
    const billing = await makeBilling(md, vendorId, 2_500_000);

    const gross = 2_500_000;
    const pv = await okJson(
      await md.post("/api/v1/ap/pv", {
        data: {
          billing_ids: [String(billing.id)],
          amount: gross,
          wht_pct: WHT_PCT_SERVICE,
          method: "transfer",
        },
      }),
      "createPv (>2M)",
    );
    const pvId = String(pv.id);
    expect(gross, "amount is in the MD tier band").toBeGreaterThan(PV_TIER_MD);

    // Finance Manager (level 3) cannot sign off a > 2M PV — MD (level 4) is required.
    const denied = await finMgr.post(`/api/v1/pv/${pvId}/approve`, { data: {} });
    expect(denied.status(), "finmgr under the MD tier → 403").toBe(403);

    const approved = await okJson(
      await md.post(`/api/v1/pv/${pvId}/approve`, { data: {} }),
      "approvePv (md)",
    );
    expect(approved.status).toBe(STATUS.approved);
  });

  test("GL JV enforces the Σdebit === Σcredit double-entry guard", async () => {
    const [a0, a1] = await glAccountIds(finMgr);

    await test.step("a balanced JV posts (Σdr === Σcr)", async () => {
      const jv = await okJson(
        await finMgr.post("/api/v1/gl/jv", {
          data: {
            no: uniqueNo("E2E-JV"),
            memo: "E2E balanced double-entry",
            lines: [
              { account_id: a0, dr: 100_000, cr: 0 },
              { account_id: a1, dr: 0, cr: 100_000 },
            ],
          },
        }),
        "createJv (balanced)",
      );
      expect(Number(jv.amount), "posted total = Σdr = Σcr").toBe(100_000);
      expect(Number(jv.line_count)).toBe(2);
    });

    await test.step("an UNBALANCED JV is rejected (Σdr ≠ Σcr → 400)", async () => {
      const res = await finMgr.post("/api/v1/gl/jv", {
        data: {
          no: uniqueNo("E2E-JV"),
          lines: [
            { account_id: a0, dr: 100_000, cr: 0 },
            { account_id: a1, dr: 0, cr: 90_000 },
          ],
        },
      });
      expect(res.status(), "unbalanced JV → 400").toBe(400);
      expect((await res.json()).code).toBe("VALIDATION");
    });

    await test.step("a zero-total JV is rejected (Σdr must be > 0 → 400)", async () => {
      const res = await finMgr.post("/api/v1/gl/jv", {
        data: {
          no: uniqueNo("E2E-JV"),
          lines: [
            { account_id: a0, dr: 0, cr: 0 },
            { account_id: a1, dr: 0, cr: 0 },
          ],
        },
      });
      expect(res.status(), "empty/zero JV → 400").toBe(400);
    });

    await test.step("a JV with a negative leg is rejected (→ 400)", async () => {
      const res = await finMgr.post("/api/v1/gl/jv", {
        data: {
          no: uniqueNo("E2E-JV"),
          lines: [
            { account_id: a0, dr: -5, cr: 0 },
            { account_id: a1, dr: 0, cr: 5 },
          ],
        },
      });
      expect(res.status(), "negative dr/cr → 400").toBe(400);
    });
  });

  test("negative amounts are rejected across the finance mutations", async () => {
    const vendorId = await firstVendorId(finMgr);

    const billingRes = await finMgr.post("/api/v1/ap/billing", {
      data: { vendor_id: vendorId, amount: -100, invoice_no: uniqueNo("INV") },
    });
    expect(billingRes.status(), "negative AP billing amount → 400").toBe(400);

    // A valid billing to draw a (negative-amount) PV from.
    const billing = await makeBilling(finMgr, vendorId, 100_000);
    const pvRes = await finMgr.post("/api/v1/ap/pv", {
      data: { billing_ids: [String(billing.id)], amount: -100, method: "transfer" },
    });
    expect(pvRes.status(), "negative PV amount → 400").toBe(400);
  });

  test("bank reconciliation — statements, auto-match SUGGEST, manual CONFIRM, re-match guard", async () => {
    // Self-skip if a build ever ships without the bank handlers (task guidance).
    const probe = await finMgr.get("/api/v1/bank/statements");
    test.skip(probe.status() === 404, "bank handlers not mounted on this build");

    const statementsBody = await okJson(probe, "GET /bank/statements");
    const statements = statementsBody.data as Array<Record<string, unknown>>;
    expect(statements.length, "the seed carries bank statements").toBeGreaterThan(0);
    for (const s of statements) {
      expect(typeof s.line_count).toBe("number");
      expect(typeof s.matched_count).toBe("number");
      expect(typeof s.bank_balance, "bank_balance = Σ(signed line amounts)").toBe("number");
      expect(s.currency_code).toBe("THB");
    }

    // Find any UNMATCHED line (the seed has reconcile lines the mock left open).
    let target:
      | { statementId: string; lineId: string; amount: number; lineDate: string }
      | null = null;
    for (const s of statements) {
      const linesBody = await okJson(
        await finMgr.get(`/api/v1/bank/statements/${s.id}/lines`),
        `GET /bank/statements/${s.id}/lines`,
      );
      const lines = linesBody.data as Array<Record<string, unknown>>;
      for (const ln of lines) {
        // An unmatched line always exposes a `suggestions` array (F-BANK1).
        expect(Array.isArray(ln.matched ? [] : ln.suggestions)).toBe(true);
        if (!ln.matched && !target && Math.abs(Number(ln.amount)) > 0) {
          target = {
            statementId: String(s.id),
            lineId: String(ln.id),
            amount: Number(ln.amount),
            lineDate: String(ln.line_date),
          };
        }
      }
    }
    expect(target, "the seed has at least one unmatched bank line").not.toBeNull();
    const line = target!;

    await test.step("a foreign/absent doc cannot be matched (fail closed → 400)", async () => {
      const res = await finMgr.post(`/api/v1/bank/lines/${line.lineId}/match`, {
        data: { pv_id: BOGUS_UUID },
      });
      expect(res.status(), "match to a non-tenant doc → 400").toBe(400);
    });

    await test.step("a match with no target is rejected (→ 400)", async () => {
      const res = await finMgr.post(`/api/v1/bank/lines/${line.lineId}/match`, {
        data: {},
      });
      expect(res.status(), "no pv_id/cheque_id/rv_id → 400").toBe(400);
    });

    // Build a genuine match candidate: a PV of the EXACT line amount, dated in the
    // ±7-day window, so the auto-suggest MUST surface it (F-BANK1).
    const magnitude = Math.abs(line.amount);
    const vendorId = await firstVendorId(finMgr);
    const billing = await makeBilling(finMgr, vendorId, magnitude);
    const candidatePv = await okJson(
      await finMgr.post("/api/v1/ap/pv", {
        data: {
          billing_ids: [String(billing.id)],
          amount: magnitude,
          wht_pct: 0,
          method: "cheque",
          cheque_date: line.lineDate, // inside the ±7-day match window
        },
      }),
      "createPv (bank match candidate)",
    );
    const candidatePvId = String(candidatePv.id);

    await test.step("auto-match SUGGEST surfaces the exact-amount, in-window candidate", async () => {
      const linesBody = await okJson(
        await finMgr.get(`/api/v1/bank/statements/${line.statementId}/lines`),
        "GET lines (post-candidate)",
      );
      const lines = linesBody.data as Array<Record<string, unknown>>;
      const ln = lines.find((l) => l.id === line.lineId)!;
      expect(ln.matched, "the target line is still unmatched").toBe(false);
      const suggestions = ln.suggestions as Array<{ type: string; id: string }>;
      expect(
        suggestions.some((s) => s.type === "pv" && s.id === candidatePvId),
        "the exact-amount + in-window PV is auto-suggested",
      ).toBe(true);
    });

    await test.step("manual CONFIRM links the line (matched = true)", async () => {
      const body = await okJson(
        await finMgr.post(`/api/v1/bank/lines/${line.lineId}/match`, {
          data: { pv_id: candidatePvId },
        }),
        "matchBankLine",
      );
      expect(body.matched).toBe(true);
      expect(body.pv_id).toBe(candidatePvId);
    });

    await test.step("re-matching an already-matched line → 409", async () => {
      const res = await finMgr.post(`/api/v1/bank/lines/${line.lineId}/match`, {
        data: { pv_id: candidatePvId },
      });
      expect(res.status(), "a line matches only once → 409").toBe(409);
    });
  });
});
