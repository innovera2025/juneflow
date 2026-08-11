/*
 * Unit tests for subcon-accept-rows.ts (subcon.accept port, gate G3) — the pure
 * SubconAccept helpers. Covers opaque-period narrowing, method derivation, the 6
 * status -> badge/action states, the KPI aggregates (accepted value/count, pending
 * review, retention held), the cumulative-percent markers, and the re-exported
 * money format, including the empty-list case for every aggregate.
 */
import { describe, it, expect } from "vitest";
import {
  toPeriodRow,
  deriveMethod,
  mapPeriodStatus,
  statusTone,
  acceptedPeriods,
  acceptedValue,
  acceptedCount,
  pendingReviewCount,
  retentionHeld,
  cumMap,
  hasOrdinalSeq,
  formatMoney,
  millionsValue,
  type PeriodRow,
} from "./subcon-accept-rows";

const period = (over: Partial<PeriodRow> = {}): PeriodRow => ({
  id: "p1",
  contractId: "c1",
  seq: 1,
  basis: "percent",
  target: 0,
  pct: 0,
  amount: 0,
  currencyCode: "THB",
  status: "pending",
  defect: null,
  ...over,
});

describe("toPeriodRow", () => {
  it("narrows the periodWire shape (snake_case + numeric coercion)", () => {
    expect(
      toPeriodRow({
        id: "wp9",
        contract_id: "c9",
        seq: 3,
        basis: "percent",
        target: 0,
        pct: 25,
        amount: 537500,
        currency_code: "THB",
        status: "delivered",
      }),
    ).toEqual({
      id: "wp9",
      contractId: "c9",
      seq: 3,
      basis: "percent",
      target: 0,
      pct: 25,
      amount: 537500,
      currencyCode: "THB",
      status: "delivered",
      defect: null,
    });
  });

  it("narrows the enriched `defect` items (string[]) to one joined line, else null", () => {
    expect(
      toPeriodRow({ id: "wp5", status: "rejected", defect: ["crack at C3", "uneven floor"] }).defect,
    ).toBe("crack at C3, uneven floor");
    expect(toPeriodRow({ id: "wp6", defect: ["only one"] }).defect).toBe("only one");
    expect(toPeriodRow({ id: "wp7", defect: [] }).defect).toBeNull();
    expect(toPeriodRow({ id: "wp8" }).defect).toBeNull();
    // defensive: a plain string / blank entries collapse honestly
    expect(toPeriodRow({ id: "wp10", defect: "single" }).defect).toBe("single");
    expect(toPeriodRow({ id: "wp11", defect: ["  ", "real"] }).defect).toBe("real");
  });

  it("accepts camelCase aliases and defaults missing fields", () => {
    const r = toPeriodRow({ id: "wp2", contractId: "c2", seq: "2", basis: "distance", target: "100", amount: "100000" });
    expect(r.contractId).toBe("c2");
    expect(r.seq).toBe(2);
    expect(r.target).toBe(100);
    expect(r.amount).toBe(100000);
    expect(r.pct).toBe(0);
    expect(r.currencyCode).toBe("");
    expect(r.status).toBe("");
  });

  it("coerces a non-finite / absent amount to 0 (never NaN)", () => {
    expect(toPeriodRow({ id: "wp3", amount: "oops" }).amount).toBe(0);
    expect(toPeriodRow({ id: "wp4" }).amount).toBe(0);
  });
});

/*
 * deriveMethod names the CONTRACT's method — the title chip, the tracker gate, the
 * acceptance column header, the handover certificate's method row all read it as a fact
 * about the whole plan. B-290: it used to return the FIRST period's non-empty basis.
 */
describe("deriveMethod", () => {
  it("returns the basis every period shares", () => {
    expect(deriveMethod([period({ basis: "distance" }), period({ basis: "distance" })])).toBe("distance");
    expect(deriveMethod([period({ basis: "milestone" })])).toBe("milestone");
    expect(deriveMethod([period({ basis: "percent" }), period({ basis: "percent" })])).toBe("percent");
  });
  it("withholds ('') when the periods DISAGREE — a mixed plan has no contract method", () => {
    // work_period.basis is a per-ROW column and there is no contract-level basis anywhere
    // in the schema or on the wire, so a mixed plan is contract-legal. The first-element
    // form answered "percent" here and lit the percent tracker over metres.
    expect(deriveMethod([period({ basis: "percent" }), period({ basis: "distance" })])).toBe("");
    expect(deriveMethod([period({ basis: "distance" }), period({ basis: "percent" })])).toBe("");
    expect(
      deriveMethod([period({ basis: "milestone" }), period({ basis: "milestone" }), period({ basis: "unit" })]),
    ).toBe("");
  });
  it("withholds ('') when ANY period's basis is missing, and for no periods", () => {
    // Previously this returned "unit" — a plan holding a row whose basis nobody recorded
    // still licensed a contract-wide method claim.
    expect(deriveMethod([period({ basis: "" }), period({ basis: "unit" })])).toBe("");
    expect(deriveMethod([period({ basis: "unit" }), period({ basis: "" })])).toBe("");
    expect(deriveMethod([period({ basis: "" })])).toBe("");
    expect(deriveMethod([])).toBe("");
  });
});

describe("mapPeriodStatus (all 6 wire statuses)", () => {
  it("pending -> notReached / draft / none (not delivered yet)", () => {
    expect(mapPeriodStatus("pending")).toEqual({ badge: "notReached", tone: "draft", action: "none", rowWarn: false });
  });
  it("delivered + inspecting -> requested / pending / accept (warn-soft row)", () => {
    const req = { badge: "requested", tone: "pending", action: "accept", rowWarn: true };
    expect(mapPeriodStatus("delivered")).toEqual(req);
    expect(mapPeriodStatus("inspecting")).toEqual(req);
  });
  it("passed + paid -> accepted / approved / cert", () => {
    const acc = { badge: "accepted", tone: "approved", action: "cert", rowWarn: false };
    expect(mapPeriodStatus("passed")).toEqual(acc);
    expect(mapPeriodStatus("paid")).toEqual(acc);
  });
  it("rejected -> rejected / rejected / reinspect", () => {
    expect(mapPeriodStatus("rejected")).toEqual({ badge: "rejected", tone: "rejected", action: "reinspect", rowWarn: false });
  });
  it("an unknown status falls back to notReached (like STATUS.draft)", () => {
    expect(mapPeriodStatus("weird")).toEqual({ badge: "notReached", tone: "draft", action: "none", rowWarn: false });
  });
});

describe("statusTone", () => {
  it("maps each badge tone to bg/fg/dot (draft fallback)", () => {
    expect(statusTone("approved")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" });
    expect(statusTone("pending")).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" });
    expect(statusTone("rejected")).toEqual({ bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" });
    expect(statusTone("draft")).toEqual({ bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" });
  });
});

describe("KPI aggregates", () => {
  const periods = [
    period({ id: "a", status: "paid", amount: 430000 }),
    period({ id: "b", status: "passed", amount: 645000 }),
    period({ id: "c", status: "delivered", amount: 537500 }),
    period({ id: "d", status: "inspecting", amount: 200000 }),
    period({ id: "e", status: "pending", amount: 537500 }),
    period({ id: "f", status: "rejected", amount: 360000 }),
  ];

  it("acceptedPeriods returns only passed|paid rows in wire order (handover body)", () => {
    expect(acceptedPeriods(periods).map((p) => p.id)).toEqual(["a", "b"]);
    expect(acceptedPeriods([])).toEqual([]);
    // acceptedValue/acceptedCount derive from the SAME predicate — they can't disagree
    expect(acceptedPeriods(periods).reduce((s, p) => s + p.amount, 0)).toBe(acceptedValue(periods));
    expect(acceptedPeriods(periods).length).toBe(acceptedCount(periods));
  });
  it("acceptedValue sums only passed|paid amounts (KPI-2)", () => {
    expect(acceptedValue(periods)).toBe(1_075_000);
    expect(acceptedValue([])).toBe(0);
  });
  it("acceptedCount counts only passed|paid periods (KPI-2 sub)", () => {
    expect(acceptedCount(periods)).toBe(2);
    expect(acceptedCount([])).toBe(0);
  });
  it("pendingReviewCount counts only delivered|inspecting periods (KPI-4)", () => {
    expect(pendingReviewCount(periods)).toBe(2);
    expect(pendingReviewCount([])).toBe(0);
  });
  it("retentionHeld rounds acceptedVal x pct / 100 (KPI-3) and guards non-finite pct", () => {
    expect(retentionHeld(1_075_000, 10)).toBe(107_500);
    expect(retentionHeld(1_075_000, 5)).toBe(53_750);
    expect(retentionHeld(96805, 10)).toBe(9681); // rounds 9680.5
    expect(retentionHeld(1_075_000, Number.NaN)).toBe(0);
    expect(retentionHeld(0, 10)).toBe(0);
  });
});

/*
 * cumMap — every marker is a claim about ONE period ("period {seq} completes {cum}% of the
 * contract"), so B-290 makes all of its preconditions per-element. It previously had NO
 * precondition at all: it summed whatever `pct` arrived in whatever order `seq` imposed,
 * admitted only by a render gate (deriveMethod) that looked at the FIRST period.
 */
describe("cumMap (percent-method markers)", () => {
  it("accumulates pct in seq order (real plan target, not project progress)", () => {
    const periods = [
      period({ seq: 2, pct: 30 }),
      period({ seq: 1, pct: 20 }),
      period({ seq: 4, pct: 25 }),
      period({ seq: 3, pct: 25 }),
    ];
    expect(cumMap(periods)).toEqual([
      { seq: 1, cum: 20 },
      { seq: 2, cum: 50 },
      { seq: 3, cum: 75 },
      { seq: 4, cum: 100 },
    ]);
  });

  it("keeps the SEED plan's markers (20/30/25/25 percent, seq 1-4) — pixel-stable", () => {
    // packages/db/src/seed/index.ts SUBC_CONTRACTS[0] WO-2026-0042, the contract the
    // subcon.accept G5 baseline renders. Every guard passes, so the gate is additive.
    const seed = [
      period({ id: "s1", seq: 1, pct: 20 }),
      period({ id: "s2", seq: 2, pct: 30 }),
      period({ id: "s3", seq: 3, pct: 25 }),
      period({ id: "s4", seq: 4, pct: 25 }),
    ];
    expect(cumMap(seed)).toEqual([
      { seq: 1, cum: 20 },
      { seq: 2, cum: 50 },
      { seq: 3, cum: 75 },
      { seq: 4, cum: 100 },
    ]);
  });

  it("rounds to the pct column's own numeric(6,3) precision", () => {
    const plan = [period({ id: "a", seq: 1, pct: 0.1 }), period({ id: "b", seq: 2, pct: 0.2 })];
    expect(cumMap(plan)).toEqual([
      { seq: 1, cum: 0.1 },
      { seq: 2, cum: 0.3 }, // not 0.30000000000000004
    ]);
  });

  it("withholds (null) for an empty plan", () => {
    expect(cumMap([])).toBe(null);
  });

  it("withholds when the plan is not ENTIRELY percent-basis (the mixed-plan escape)", () => {
    // The old render gate (deriveMethod = the FIRST period's basis) let exactly this
    // through: period 1 percent -> tracker renders -> the non-percent rows still emit
    // markers, silently mixing two populations.
    //
    // The non-percent rows carry a NONZERO pct deliberately. `pct` is
    // numeric(6,3) NOT NULL DEFAULT '0' written unvalidated by POST /subcon/contracts, so
    // basis "distance" + pct 40 is contract-legal — and a fixture that sets pct 0 on the
    // mixed row is caught by the per-element `pct > 0` guard INSTEAD, which means the
    // `basis === "percent"` line becomes deletable with the whole suite green while this
    // test's name still claims to cover it. Every other precondition is satisfied here
    // (seqs distinct, all pcts > 0, Sigma <= 100) so the basis guard is the ONLY line that
    // can return null. This is the discipline po-wo-rows.test.ts already applies to the
    // twin guard in cumulativeContractPct; the subcon port had lost it.
    const mixed = [
      period({ id: "a", seq: 1, basis: "percent", pct: 40 }),
      period({ id: "b", seq: 2, basis: "distance", pct: 40, target: 100 }),
    ];
    expect(cumMap(mixed)).toBe(null);
    const mixedTail = [
      period({ id: "a", seq: 1, basis: "percent", pct: 30 }),
      period({ id: "b", seq: 2, basis: "percent", pct: 30 }),
      period({ id: "c", seq: 3, basis: "milestone", pct: 30 }),
    ];
    expect(cumMap(mixedTail)).toBe(null);
    // Positive control: the same plans minus the mixed basis ARE computed, proving the
    // nulls above are the basis guard's doing and not another precondition tripping.
    expect(
      cumMap([
        period({ id: "a", seq: 1, basis: "percent", pct: 40 }),
        period({ id: "b", seq: 2, basis: "percent", pct: 40 }),
      ]),
    ).toEqual([
      { seq: 1, cum: 40 },
      { seq: 2, cum: 80 },
    ]);
  });

  it("withholds when ANY single period has no share recorded (not a Sigma gate)", () => {
    // pct is numeric(6,3) NOT NULL DEFAULT '0', written unvalidated by POST
    // /subcon/contracts, so 30 / 0 / 40 is contract-legal. A "Sigma pct > 0" gate passes it
    // and period 2's marker lands byte-identically on period 1's line while nothing about
    // period 2's own share is known.
    const gap = [
      period({ id: "a", seq: 1, pct: 30 }),
      period({ id: "b", seq: 2, pct: 0 }),
      period({ id: "c", seq: 3, pct: 40 }),
    ];
    expect(cumMap(gap)).toBe(null);
    // the all-zero plan is subsumed
    expect(cumMap([period({ id: "a", seq: 1, pct: 0 }), period({ id: "b", seq: 2, pct: 0 })])).toBe(null);
    // and a negative share is not a share
    expect(cumMap([period({ id: "a", seq: 1, pct: -10 }), period({ id: "b", seq: 2, pct: 60 })])).toBe(null);
  });

  it("withholds when `seq` is not a usable ordinal (defaulted / duplicated / negative)", () => {
    // work_period.seq is `integer NOT NULL DEFAULT 0` with no unique(contract_id, seq):
    // an all-zero plan emitted N markers all claiming to be period 0, in arrival order.
    const allZero = [period({ id: "a", seq: 0, pct: 50 }), period({ id: "b", seq: 0, pct: 50 })];
    expect(cumMap(allZero)).toBe(null);
    const dup = [
      period({ id: "a", seq: 1, pct: 30 }),
      period({ id: "b", seq: 1, pct: 30 }),
      period({ id: "c", seq: 2, pct: 40 }),
    ];
    expect(cumMap(dup)).toBe(null);
    expect(cumMap([period({ id: "a", seq: -1, pct: 50 }), period({ id: "b", seq: 1, pct: 50 })])).toBe(null);
    expect(cumMap([period({ id: "a", seq: 1.5, pct: 50 }), period({ id: "b", seq: 2, pct: 50 })])).toBe(null);
  });

  it("withholds when the plan's shares total MORE than the whole contract", () => {
    // The one Sigma-shaped test left: it gates a Sigma-shaped fact and disqualifies the
    // WHOLE series uniformly. Without it a marker sits at left:140% and is silently
    // clipped by the bar's overflow:hidden — a period simply missing from a full bar.
    const over = [
      period({ id: "a", seq: 1, pct: 70 }),
      period({ id: "b", seq: 2, pct: 70 }),
    ];
    expect(cumMap(over)).toBe(null);
  });

  it("does NOT reject an incomplete plan totalling less than 100", () => {
    // Each period's cumulative is still its true share of the contract.
    const partial = [period({ id: "a", seq: 1, pct: 20 }), period({ id: "b", seq: 2, pct: 30 })];
    expect(cumMap(partial)).toEqual([
      { seq: 1, cum: 20 },
      { seq: 2, cum: 50 },
    ]);
  });
});

/*
 * hasOrdinalSeq is re-exported from po-wo-rows so WOList and the three subcon screens
 * share ONE implementation of the period-ordinal predicate (same work_period.seq column).
 * These assertions pin the contract the subcon callers rely on.
 */
describe("hasOrdinalSeq (re-exported, shared with WOList)", () => {
  it("accepts distinct non-negative integer seqs (gaps and a seq-0 DP row are fine)", () => {
    expect(hasOrdinalSeq([period({ id: "a", seq: 1 }), period({ id: "b", seq: 2 })])).toBe(true);
    expect(hasOrdinalSeq([period({ id: "dp", seq: 0 }), period({ id: "a", seq: 1 })])).toBe(true);
    expect(hasOrdinalSeq([period({ id: "a", seq: 7 })])).toBe(true);
    // the seeded plan shape (seq = index + 1)
    expect(
      hasOrdinalSeq([1, 2, 3, 4].map((n) => period({ id: `s${n}`, seq: n }))),
    ).toBe(true);
  });
  it("rejects the defaulted all-zero plan, duplicates, negatives and non-integers", () => {
    expect(hasOrdinalSeq([period({ id: "a", seq: 0 }), period({ id: "b", seq: 0 })])).toBe(false);
    expect(hasOrdinalSeq([period({ id: "a", seq: 2 }), period({ id: "b", seq: 2 })])).toBe(false);
    expect(hasOrdinalSeq([period({ id: "a", seq: -1 })])).toBe(false);
    expect(hasOrdinalSeq([period({ id: "a", seq: 1.5 })])).toBe(false);
    expect(hasOrdinalSeq([])).toBe(false);
  });
});

describe("re-exported money format", () => {
  it("formatMoney groups thousands and guards non-finite", () => {
    expect(formatMoney(2_150_000)).toBe("2,150,000");
    expect(formatMoney(537500)).toBe("537,500");
    expect(formatMoney(Number.NaN)).toBe("0");
    expect(formatMoney(0)).toBe("0");
  });
  it("millionsValue divides by 1e6 to 2 dp", () => {
    expect(millionsValue(2_150_000)).toBe("2.15");
    expect(millionsValue(0)).toBe("0.00");
  });
});
