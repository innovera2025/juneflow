/*
 * Unit tests for po-form-rows.ts (P2-WEB-72, gate G3) — the pure create-body helpers
 * behind the POForm (po.form) "create PO from an approved PR" page.
 *
 * The load-bearing assertion is money=SERVER: buildCreatePoBody must emit EXACTLY the two
 * tenant ids and NOTHING resembling money (no amount/total/deposit/vat/price). This test
 * fails the moment a client money field leaks into the POST /po body.
 */
import { describe, it, expect } from "vitest";
import { buildCreatePoBody, canCreatePo } from "./po-form-rows";

describe("buildCreatePoBody (money=SERVER)", () => {
  it("emits exactly { pr_id, vendor_id }", () => {
    const body = buildCreatePoBody("pr-1", "ven-9");
    expect(body).toEqual({ pr_id: "pr-1", vendor_id: "ven-9" });
    expect(Object.keys(body).sort()).toEqual(["pr_id", "vendor_id"]);
  });

  it("never leaks a money/total field into the create body", () => {
    const body = buildCreatePoBody("pr-1", "ven-9") as Record<string, unknown>;
    for (const forbidden of ["amount", "total", "deposit", "vat", "price", "down_pmt", "credit_term"]) {
      expect(body[forbidden]).toBeUndefined();
    }
  });

  it("passes the ids through verbatim (no derivation)", () => {
    const body = buildCreatePoBody("PR-2026-0418", "vendor-uuid");
    expect(body.pr_id).toBe("PR-2026-0418");
    expect(body.vendor_id).toBe("vendor-uuid");
  });
});

describe("canCreatePo", () => {
  it("requires both a PR id and a vendor id", () => {
    expect(canCreatePo("pr-1", "ven-1", false)).toBe(true);
    expect(canCreatePo("", "ven-1", false)).toBe(false);
    expect(canCreatePo("pr-1", "", false)).toBe(false);
    expect(canCreatePo("", "", false)).toBe(false);
  });

  it("is false while a mutation is in flight (busy)", () => {
    expect(canCreatePo("pr-1", "ven-1", true)).toBe(false);
  });
});
