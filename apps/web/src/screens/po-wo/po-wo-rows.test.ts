/*
 * Unit tests for po-wo-rows.ts (P2-WEB-10, gate G3) — the pure PO/WO-list helpers
 * that back POList / WOList. Covers the opaque-row narrowing (po / wo / pr /
 * vendor), the tab partitions + C10 counts, the status tone/label mapping
 * (draft/pending/approved/rejected), the id -> display joins (vendor name / pr no /
 * pr->project name), the approved-PR gate, the retention sum, and money formatting.
 *
 * B-277 adds the installment plan helpers (installment narrowing, the awaiting-acceptance
 * predicates, the de-duplicated due count and the cumulative contract-% guard).
 */
import { describe, it, expect } from "vitest";
import {
  toPoRow,
  toWoRow,
  toWoInstallment,
  sortInstallments,
  isAwaitingAcceptance,
  hasAwaitingInstallment,
  installmentDisplayKind,
  dueInstallmentCount,
  cumulativeContractPct,
  hasOrdinalSeq,
  toPrRef,
  toVendorRef,
  statusTone,
  statusLabelKind,
  filterPoByTab,
  poTabCount,
  filterWoByTab,
  woTabCount,
  countByStatus,
  sumRetention,
  vendorNameById,
  prNoById,
  prProjectIdById,
  projectNameById,
  resolvePoProjectName,
  approvedPrs,
  formatMoney,
  millionsValue,
  type PoRow,
  type WoRow,
  type WoInstallment,
} from "./po-wo-rows";

const po = (over: Partial<PoRow> = {}): PoRow => ({
  id: "p1",
  no: "PO-2026-0291",
  prId: "",
  vendorId: "",
  status: "approved",
  approvalStep: 0,
  creditTerm: 0,
  vat: 0,
  total: 0,
  ...over,
});

const wo = (over: Partial<WoRow> = {}): WoRow => ({
  id: "w1",
  no: "WO-2026-0117",
  prId: "",
  vendorId: "",
  contractId: "",
  status: "approved",
  approvalStep: 0,
  value: 0,
  retentionPct: 0,
  retentionAmount: 0,
  scope: "",
  progress: null,
  installments: [],
  ...over,
});

/** An installment of a WO's plan (wo.ts installmentWire) — percent basis unless overridden. */
const period = (over: Partial<WoInstallment> = {}): WoInstallment => ({
  id: "wp1",
  seq: 1,
  basis: "percent",
  target: 0,
  pct: 0,
  amount: 0,
  status: "pending",
  ...over,
});

describe("toPoRow", () => {
  it("narrows the poWire shape (snake_case + numeric coercion, amount->total fallback)", () => {
    expect(
      toPoRow({
        id: "p9",
        no: "PO-2026-0290",
        pr_id: "pr-1",
        vendor_id: "v-1",
        status: "pending",
        approval_step: 0,
        credit_term: 30,
        vat: "0",
        amount: 902475,
      }),
    ).toEqual({
      id: "p9",
      no: "PO-2026-0290",
      prId: "pr-1",
      vendorId: "v-1",
      status: "pending",
      approvalStep: 0,
      creditTerm: 30,
      vat: 0,
      total: 902475,
    });
  });

  it("prefers total over amount and defaults missing fields", () => {
    const r = toPoRow({ id: "p2", total: "1268000", amount: 0 });
    expect(r.total).toBe(1268000);
    expect(r.status).toBe("");
    expect(r.creditTerm).toBe(0);
  });
});

describe("toWoRow", () => {
  /*
   * The served row is the api's own fixture for the exact-key assertion in
   * apps/api/src/routes/wo.test.ts ("returns the envelope with retention_amount +
   * scope/progress/installments (F3)"): plan 645k passed + 645k pending + 860k
   * pending = 2,150k, so the SERVER's progress is 30.
   */
  it("narrows the full woWire shape (B-277: contract_id, scope, progress, installments)", () => {
    expect(
      toWoRow({
        id: "w9",
        no: "WO-2026-0117",
        pr_id: "pr-2",
        vendor_id: "v-2",
        contract_id: "c0",
        status: "pending",
        approval_step: 0,
        currency_code: "THB",
        value: 2_150_000,
        retention_pct: 10,
        retention_amount: 215000,
        amount: 2_150_000,
        scope: "exterior paint block A",
        progress: 30,
        installments: [
          { id: "wp0", seq: 1, basis: "percent", target: 0, pct: 30, amount: 645000, status: "passed", currency_code: "THB" },
          { id: "wp1", seq: 2, basis: "percent", target: 0, pct: 30, amount: 645000, status: "pending", currency_code: "THB" },
        ],
      }),
    ).toEqual({
      id: "w9",
      no: "WO-2026-0117",
      prId: "pr-2",
      vendorId: "v-2",
      contractId: "c0",
      status: "pending",
      approvalStep: 0,
      value: 2_150_000,
      retentionPct: 10,
      retentionAmount: 215000,
      scope: "exterior paint block A",
      progress: 30,
      installments: [
        { id: "wp0", seq: 1, basis: "percent", target: 0, pct: 30, amount: 645000, status: "passed" },
        { id: "wp1", seq: 2, basis: "percent", target: 0, pct: 30, amount: 645000, status: "pending" },
      ],
    });
  });

  it("keeps the retention fields + the value->amount fallback", () => {
    const r = toWoRow({
      id: "w8",
      no: "WO-2026-0115",
      amount: 2840000,
      retention_pct: 10,
      retention_amount: 284000,
    });
    expect(r.value).toBe(2840000);
    expect(r.retentionAmount).toBe(284000);
  });

  it("keeps a null progress null (never a fabricated 0%) but preserves a real 0", () => {
    // wo.ts sends null for "no plan, not computable" and 0 for "plan with nothing done".
    expect(toWoRow({ id: "w0", contract_id: null, progress: null, installments: [] }).progress).toBe(null);
    expect(toWoRow({ id: "w0", progress: 0 }).progress).toBe(0);
    // A row that predates the field at all is also "unknown", not 0%.
    expect(toWoRow({ id: "w0" }).progress).toBe(null);
  });

  it("sorts the plan by seq and survives a non-array installments field", () => {
    const r = toWoRow({
      id: "w0",
      installments: [{ id: "b", seq: 3 }, { id: "a", seq: 1 }, { id: "c", seq: 2 }],
    });
    expect(r.installments.map((p) => p.id)).toEqual(["a", "c", "b"]);
    expect(toWoRow({ id: "w0", installments: "nope" }).installments).toEqual([]);
  });
});

describe("toWoInstallment", () => {
  it("narrows one work_period row, coercing the numeric-as-string columns", () => {
    expect(
      toWoInstallment({
        id: "wp0",
        seq: 1,
        basis: "percent",
        target: "0",
        pct: "10.000",
        amount: "215000.00",
        status: "passed",
        currency_code: "THB",
      }),
    ).toEqual({ id: "wp0", seq: 1, basis: "percent", target: 0, pct: 10, amount: 215000, status: "passed" });
  });
});

describe("sortInstallments", () => {
  it("orders by seq without mutating the input", () => {
    const input = [period({ id: "b", seq: 2 }), period({ id: "a", seq: 0 })];
    expect(sortInstallments(input).map((p) => p.id)).toEqual(["a", "b"]);
    expect(input.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("isAwaitingAcceptance + installmentDisplayKind", () => {
  it("treats delivered/inspecting as awaiting acceptance and nothing else", () => {
    expect(["delivered", "inspecting"].map(isAwaitingAcceptance)).toEqual([true, true]);
    expect(["pending", "passed", "paid", "rejected", ""].map(isAwaitingAcceptance)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("collapses the 6 work_period statuses onto the prototype's 3 visual states", () => {
    expect(installmentDisplayKind("passed")).toBe("done");
    expect(installmentDisplayKind("paid")).toBe("done"); // same pair wo.ts calls done
    expect(installmentDisplayKind("delivered")).toBe("current");
    expect(installmentDisplayKind("inspecting")).toBe("current");
    expect(installmentDisplayKind("pending")).toBe("pending");
    // B-277 flagged: rejected has no prototype state -> the neutral not-done one.
    expect(installmentDisplayKind("rejected")).toBe("pending");
    expect(installmentDisplayKind("something-new")).toBe("pending");
  });
});

describe("hasAwaitingInstallment (WO/header population)", () => {
  it("is true for a WO with any installment handed over, false for a plan-less WO", () => {
    expect(
      hasAwaitingInstallment(
        wo({ installments: [period({ id: "a", status: "passed" }), period({ id: "b", status: "delivered" })] }),
      ),
    ).toBe(true);
    expect(hasAwaitingInstallment(wo({ installments: [period({ status: "passed" })] }))).toBe(false);
    expect(hasAwaitingInstallment(wo())).toBe(false);
  });
});

describe("dueInstallmentCount (installment / line population)", () => {
  it("counts only the installments awaiting acceptance, across every WO", () => {
    const rows = [
      wo({ id: "w1", installments: [period({ id: "a", status: "delivered" }), period({ id: "b", status: "passed" })] }),
      wo({ id: "w2", installments: [period({ id: "c", status: "inspecting" })] }),
      wo({ id: "w3" }),
    ];
    expect(dueInstallmentCount(rows)).toBe(2);
  });

  /*
   * THE POPULATION TRAP this helper exists for: wo.contract_id has no unique
   * constraint, so two WOs can point at one subcon_contract and GET /wo then hands
   * BOTH the very same work_period rows (wo.ts periodsByContract). A naive
   * SUM(per-WO count) reports 4 installments where the tenant has 2.
   */
  it("de-duplicates installments shared by two WOs on the same subcon contract", () => {
    const shared = [period({ id: "wp1", status: "delivered" }), period({ id: "wp2", seq: 2, status: "inspecting" })];
    const rows = [
      wo({ id: "w1", contractId: "c0", installments: shared }),
      wo({ id: "w2", contractId: "c0", installments: shared }),
    ];
    expect(dueInstallmentCount(rows)).toBe(2);
    // ...while the TAB counts headers, so the same data legitimately gives 2 WOs.
    expect(woTabCount(rows, "installment")).toBe(2);
  });

  it("is 0 — not em-dash-worthy — when no plan has an installment awaiting acceptance", () => {
    expect(dueInstallmentCount([wo(), wo({ installments: [period({ status: "paid" })] })])).toBe(0);
  });
});

describe("cumulativeContractPct", () => {
  const percentPlan = [
    period({ id: "a", seq: 1, pct: 10 }),
    period({ id: "b", seq: 2, pct: 20 }),
    period({ id: "c", seq: 3, pct: 70 }),
  ];

  it("accumulates every earlier installment's share, not just this one's", () => {
    expect(cumulativeContractPct(percentPlan, 1)).toBe(10);
    expect(cumulativeContractPct(percentPlan, 2)).toBe(30);
    expect(cumulativeContractPct(percentPlan, 3)).toBe(100);
  });

  it("rounds the float sum back to the numeric(6,3) column precision", () => {
    const plan = [period({ id: "a", seq: 1, pct: 0.1 }), period({ id: "b", seq: 2, pct: 0.2 })];
    expect(cumulativeContractPct(plan, 2)).toBe(0.3); // not 0.30000000000000004
  });

  /*
   * `pct` only carries a contract share on the "percent" basis (schema: milestone
   * uses the fixed amount, distance/unit use perPeriodQty x ratePerUnit and leave pct
   * 0). Accumulating across a mixed plan would add two different populations and
   * silently omit the non-percent installments, so it em-dashes instead.
   *
   * FIXTURE DISCIPLINE — do NOT "tidy" the milestone row's pct back to 0. The column is
   * `numeric(6,3) NOT NULL DEFAULT '0'` and POST /subcon/contracts writes
   * `pct: String(toNum(pick(p,"pct")) ?? 0)` for EVERY basis with no per-basis check
   * (apps/api/src/routes/subcon.ts), so a milestone row carrying a stray pct=40 is
   * contract-legal — and it is the only fixture that reaches the basis guard. With pct 0
   * the per-element `pct > 0` guard on the line BELOW short-circuits first, the basis
   * guard becomes deletable with the suite green, and this test's name asserts more than
   * its data supports. Every other precondition is deliberately satisfied here (seqs 1/2
   * distinct, both pcts > 0, Sigma 80 <= 100) so `basis === "percent"` is the ONLY line
   * that can return null.
   */
  it("returns null for a plan that is not entirely percent-basis", () => {
    const mixed = [
      period({ id: "a", seq: 1, pct: 40 }),
      period({ id: "b", seq: 2, basis: "milestone", pct: 40, amount: 500 }),
    ];
    expect(cumulativeContractPct(mixed, 1)).toBe(null);
    expect(cumulativeContractPct(mixed, 2)).toBe(null);
    // The same plan minus the mixed basis IS computed — proving the null above is the
    // basis guard's doing and not some other precondition this fixture happens to trip.
    const allPercent = [period({ id: "a", seq: 1, pct: 40 }), period({ id: "b", seq: 2, pct: 40 })];
    expect(cumulativeContractPct(allPercent, 2)).toBe(80);
  });

  it("returns null for an empty plan and for a percent plan with no pct data", () => {
    expect(cumulativeContractPct([], 1)).toBe(null);
    expect(cumulativeContractPct([period({ pct: 0 }), period({ id: "b", seq: 2, pct: 0 })], 2)).toBe(null);
  });

  /*
   * The Sigma-then-assert the review caught. The basis guard was per-element (.every) but the
   * pct-availability guard directly under it was a SUM, and a sum that one unrecorded row
   * hides inside licenses nothing about that row. work_period.pct is
   * numeric(6,3) NOT NULL DEFAULT '0' (packages/db/src/schema/subcon.ts) and
   * POST /subcon/contracts writes `pct: String(toNum(pick(p,"pct")) ?? 0)` with neither a
   * per-period > 0 nor a Sigma = 100 check (apps/api/src/routes/subcon.ts), so this plan is
   * contract-legal. Under the Sigma guard it printed 30 / 30 / 70: installment 2's caption was
   * byte-identical to installment 1's while its own share was unknown.
   */
  it("returns null for the whole plan when ANY single percent installment has no share recorded", () => {
    const gap = [
      period({ id: "a", seq: 1, pct: 30 }),
      period({ id: "b", seq: 2, pct: 0 }), // share NOT recorded
      period({ id: "c", seq: 3, pct: 40 }),
    ];
    expect(cumulativeContractPct(gap, 1)).toBe(null);
    expect(cumulativeContractPct(gap, 2)).toBe(null); // never installment 1's 30 again
    expect(cumulativeContractPct(gap, 3)).toBe(null);
  });

  /*
   * The one Sigma-shaped test that stays, because it gates a Sigma-shaped fact and
   * disqualifies the whole series uniformly rather than licensing any single row: shares
   * that total more than the contract are not shares, and "at 250% of the contract" is not
   * a number to print. A plan totalling LESS than 100 is still honest per row.
   */
  it("returns null when the plan's shares total more than the whole contract", () => {
    const over = [period({ id: "a", seq: 1, pct: 150 }), period({ id: "b", seq: 2, pct: 100 })];
    expect(cumulativeContractPct(over, 1)).toBe(null);
    expect(cumulativeContractPct(over, 2)).toBe(null);
    // ...but an incomplete plan is NOT rejected: 30 + 20 of a contract is still 50 of it.
    const partial = [period({ id: "a", seq: 1, pct: 30 }), period({ id: "b", seq: 2, pct: 20 })];
    expect(cumulativeContractPct(partial, 2)).toBe(50);
  });

  /*
   * `seq <= seq` is only a prefix selector while seq is a real ordinal. work_period.seq is
   * integer NOT NULL DEFAULT 0 with no unique(contract_id, seq) (the index list is
   * (contract_id, status) only) and subcon.ts writes `seq: toNum(pick(p,"seq")) ?? 0`, so a
   * client that omits seq persists an all-zero plan on which every row selected the WHOLE
   * plan and claimed 100% of the contract.
   */
  it("returns null when seq is not a usable ordinal (defaulted, duplicated or negative)", () => {
    const allZero = [
      period({ id: "a", seq: 0, pct: 30 }),
      period({ id: "b", seq: 0, pct: 30 }),
      period({ id: "c", seq: 0, pct: 40 }),
    ];
    expect(cumulativeContractPct(allZero, 0)).toBe(null); // was 100 for every row

    const dup = [period({ id: "a", seq: 1, pct: 30 }), period({ id: "b", seq: 1, pct: 30 })];
    expect(cumulativeContractPct(dup, 1)).toBe(null); // was 60, double-counted

    const negative = [period({ id: "a", seq: -1, pct: 30 }), period({ id: "b", seq: 1, pct: 30 })];
    expect(cumulativeContractPct(negative, 1)).toBe(null);
  });

  /* A DP-anchored plan (seq 0,1,2) IS a distinct ordinal — still computed, not withheld. */
  it("still accumulates a down-payment-anchored plan whose seqs start at 0", () => {
    const dpPlan = [
      period({ id: "dp", seq: 0, pct: 10 }),
      period({ id: "a", seq: 1, pct: 40 }),
      period({ id: "b", seq: 2, pct: 50 }),
    ];
    expect(cumulativeContractPct(dpPlan, 0)).toBe(10);
    expect(cumulativeContractPct(dpPlan, 2)).toBe(100);
  });
});

/*
 * hasOrdinalSeq — the per-element precondition BOTH seq renders share (the cumulative
 * prefix above, and the DP / period row label in wo-list.tsx).
 */
describe("hasOrdinalSeq", () => {
  it("accepts a distinct non-negative ordinal, including one anchored at the DP row", () => {
    expect(hasOrdinalSeq([period({ id: "a", seq: 1 }), period({ id: "b", seq: 2 })])).toBe(true);
    expect(hasOrdinalSeq([period({ id: "dp", seq: 0 }), period({ id: "a", seq: 1 })])).toBe(true);
    expect(hasOrdinalSeq([period({ id: "a", seq: 7 })])).toBe(true); // gaps are fine
  });

  it("rejects the defaulted all-zero plan, duplicates, negatives and the empty plan", () => {
    expect(hasOrdinalSeq([period({ id: "a", seq: 0 }), period({ id: "b", seq: 0 })])).toBe(false);
    expect(hasOrdinalSeq([period({ id: "a", seq: 2 }), period({ id: "b", seq: 2 })])).toBe(false);
    expect(hasOrdinalSeq([period({ id: "a", seq: -1 })])).toBe(false);
    expect(hasOrdinalSeq([period({ id: "a", seq: 1.5 })])).toBe(false);
    expect(hasOrdinalSeq([])).toBe(false);
  });
});

describe("toPrRef + toVendorRef", () => {
  it("narrows a /pr row (project_id + amount)", () => {
    expect(toPrRef({ id: "pr1", no: "PR-2026-0414", project_id: "proj1", status: "approved", amount: 1268000 })).toEqual({
      id: "pr1",
      no: "PR-2026-0414",
      projectId: "proj1",
      status: "approved",
      amount: 1268000,
    });
  });
  it("narrows a /vendors row (id + name)", () => {
    expect(toVendorRef({ id: "v1", name: "Sosuco Ceramic Co." })).toEqual({
      id: "v1",
      name: "Sosuco Ceramic Co.",
    });
  });
});

describe("statusTone + statusLabelKind", () => {
  it("maps the four state-machine statuses to the ds.jsx STATUS tones", () => {
    expect(statusTone("approved")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" });
    expect(statusTone("pending")).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" });
    expect(statusTone("rejected")).toEqual({ bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" });
    expect(statusTone("draft")).toEqual({ bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" });
  });
  it("falls back to draft for an unknown status (STATUS[status] || STATUS.draft)", () => {
    expect(statusTone("weird")).toEqual({ bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" });
    expect(statusLabelKind("weird")).toBe("draft");
    expect(statusLabelKind("pending")).toBe("pending");
    expect(statusLabelKind("approved")).toBe("approved");
    expect(statusLabelKind("rejected")).toBe("rejected");
  });
});

describe("filterPoByTab + poTabCount", () => {
  const rows: PoRow[] = [
    po({ id: "a", status: "pending" }),
    po({ id: "b", status: "approved" }),
    po({ id: "c", status: "approved" }),
    po({ id: "d", status: "draft" }),
  ];
  it("all = every row", () => {
    expect(filterPoByTab(rows, "all").map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("pending = awaiting approval", () => {
    expect(filterPoByTab(rows, "pending").map((r) => r.id)).toEqual(["a"]);
  });
  it("open = approved", () => {
    expect(filterPoByTab(rows, "open").map((r) => r.id)).toEqual(["b", "c"]);
  });
  it("deposit / wait / closed have no wire source (empty)", () => {
    expect(filterPoByTab(rows, "deposit")).toEqual([]);
    expect(filterPoByTab(rows, "wait")).toEqual([]);
    expect(filterPoByTab(rows, "closed")).toEqual([]);
  });
  it("poTabCount returns the filtered length (C10)", () => {
    expect(poTabCount(rows, "all")).toBe(4);
    expect(poTabCount(rows, "open")).toBe(2);
    expect(poTabCount(rows, "closed")).toBe(0);
  });
});

describe("filterWoByTab + woTabCount", () => {
  const rows: WoRow[] = [
    wo({ id: "a", status: "pending" }),
    wo({ id: "b", status: "approved" }),
    wo({ id: "c", status: "draft" }),
  ];
  it("partitions all / pending / active and leaves closed empty (no closed status on the wire)", () => {
    expect(filterWoByTab(rows, "all").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(filterWoByTab(rows, "pending").map((r) => r.id)).toEqual(["a"]);
    expect(filterWoByTab(rows, "active").map((r) => r.id)).toEqual(["b"]);
    expect(filterWoByTab(rows, "closed")).toEqual([]);
  });
  it("woTabCount returns the filtered length", () => {
    expect(woTabCount(rows, "pending")).toBe(1);
    expect(woTabCount(rows, "closed")).toBe(0);
  });
  it("B-277: the installment tab now selects the WOs with an installment awaiting acceptance", () => {
    const planned: WoRow[] = [
      ...rows,
      wo({ id: "d", installments: [period({ id: "p1", status: "delivered" })] }),
      wo({ id: "e", installments: [period({ id: "p2", status: "passed" })] }),
    ];
    expect(filterWoByTab(planned, "installment").map((r) => r.id)).toEqual(["d"]);
    expect(woTabCount(planned, "installment")).toBe(1);
    // The plan-less rows a/b/c contribute nothing rather than being counted as due.
    expect(filterWoByTab(rows, "installment")).toEqual([]);
  });
});

describe("countByStatus + sumRetention", () => {
  it("counts rows of a given status", () => {
    const rows = [po({ status: "approved" }), po({ status: "approved" }), po({ status: "pending" })];
    expect(countByStatus(rows, "approved")).toBe(2);
    expect(countByStatus(rows, "pending")).toBe(1);
    expect(countByStatus(rows, "rejected")).toBe(0);
  });
  it("sums the WOs' held retention", () => {
    expect(sumRetention([wo({ retentionAmount: 215000 }), wo({ retentionAmount: 284000 }), wo({ retentionAmount: 0 })])).toBe(499000);
  });
});

describe("id -> display resolvers", () => {
  const prs = [
    toPrRef({ id: "pr1", no: "PR-2026-0414", project_id: "proj1", status: "approved", amount: 100 }),
    toPrRef({ id: "pr2", no: "PR-2026-0418", project_id: "proj2", status: "pending", amount: 200 }),
  ];
  const vendors = [toVendorRef({ id: "v1", name: "Acme" }), toVendorRef({ id: "v2", name: "Beta" })];

  it("vendorNameById maps id -> name", () => {
    const map = vendorNameById(vendors);
    expect(map.get("v1")).toBe("Acme");
    expect(map.get("missing")).toBeUndefined();
  });
  it("prNoById maps pr id -> pr no", () => {
    expect(prNoById(prs).get("pr1")).toBe("PR-2026-0414");
  });
  it("resolvePoProjectName walks pr_id -> project_id -> project name", () => {
    const prProject = prProjectIdById(prs);
    const projectNames = projectNameById([
      { id: "proj1", name: "Phase 2 - C" },
      { id: "proj2", name: "Phase 2 - B" },
    ]);
    expect(resolvePoProjectName("pr1", prProject, projectNames)).toBe("Phase 2 - C");
    // missing pr -> "" (never a UUID)
    expect(resolvePoProjectName("missing", prProject, projectNames)).toBe("");
    // pr present but project not in the fetched page -> ""
    const partial = projectNameById([{ id: "proj1", name: "Phase 2 - C" }]);
    expect(resolvePoProjectName("pr2", prProject, partial)).toBe("");
  });
  it("approvedPrs keeps only approved PRs (POST /po|/wo gate)", () => {
    expect(approvedPrs(prs).map((p) => p.id)).toEqual(["pr1"]);
    expect(approvedPrs(undefined)).toEqual([]);
  });
});

describe("formatMoney + millionsValue", () => {
  it("groups thousands, rounds, and guards non-finite", () => {
    expect(formatMoney(902475)).toBe("902,475");
    expect(formatMoney(1268000)).toBe("1,268,000");
    expect(formatMoney(96800.4)).toBe("96,800");
    expect(formatMoney(-380400)).toBe("-380,400");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
  it("millionsValue divides by 1e6 to 2 dp", () => {
    expect(millionsValue(4820000)).toBe("4.82");
    expect(millionsValue(0)).toBe("0.00");
  });
});
