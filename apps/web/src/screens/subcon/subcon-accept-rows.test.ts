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
  acceptedValue,
  acceptedCount,
  pendingReviewCount,
  retentionHeld,
  cumMap,
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

describe("deriveMethod", () => {
  it("returns the first period's non-empty basis", () => {
    expect(deriveMethod([period({ basis: "distance" }), period({ basis: "distance" })])).toBe("distance");
    expect(deriveMethod([period({ basis: "milestone" })])).toBe("milestone");
  });
  it("skips an empty basis and falls back to '' for no periods", () => {
    expect(deriveMethod([period({ basis: "" }), period({ basis: "unit" })])).toBe("unit");
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
  it("is empty for no periods", () => {
    expect(cumMap([])).toEqual([]);
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
