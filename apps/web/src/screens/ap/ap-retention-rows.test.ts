/*
 * ap-retention-rows unit tests (ap.retention, gate G3) — the pure register logic ported from
 * accounting-extra2.jsx APRetention (toRetentionRow narrowing / money+due format / KPI sums /
 * status tone map / releasable + settled predicates / SERVER release-amount reader). ASCII-only
 * (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toRetentionRow,
  formatMoney,
  formatDueDate,
  sumRemaining,
  sumWithheld,
  sumReturned,
  contractCount,
  dueCount,
  statusMeta,
  isReleasable,
  isSettled,
  releaseAmount,
  type RetentionRow,
} from "./ap-retention-rows";

const row = (p: Partial<RetentionRow> = {}): RetentionRow => ({
  id: "ret1",
  woId: "wo-uuid-1",
  vendorId: "v1",
  vendorName: "Somchai Team",
  contractValue: 8400000,
  rate: 5,
  withheld: 420000,
  returned: 0,
  remaining: 420000,
  currencyCode: "THB",
  dueDate: "2026-09-01",
  status: "holding",
  ...p,
});

describe("toRetentionRow", () => {
  it("narrows a full opaque /retention row (snake_case) incl SERVER remaining + DERIVED due/status", () => {
    expect(
      toRetentionRow({
        id: "ret9",
        wo_id: "wo-uuid-9",
        vendor_id: "v9",
        vendor_name: "MEP Engineering",
        contract_value: 12600000,
        rate: 5,
        withheld: 630000,
        returned: 315000,
        remaining: 315000,
        currency_code: "THB",
        due_date: "2026-07-15",
        status: "partial",
      }),
    ).toEqual({
      id: "ret9",
      woId: "wo-uuid-9",
      vendorId: "v9",
      vendorName: "MEP Engineering",
      contractValue: 12600000,
      rate: 5,
      withheld: 630000,
      returned: 315000,
      remaining: 315000,
      currencyCode: "THB",
      dueDate: "2026-07-15",
      status: "partial",
    });
  });

  it("keeps a null vendor_name/contract_value/rate honest (em-dash path) and coerces numeric strings", () => {
    const r = toRetentionRow({
      id: "ret2",
      wo_id: "wo-uuid-2",
      vendor_id: "v2",
      vendor_name: null,
      contract_value: null,
      rate: null,
      withheld: "260000.00",
      returned: "0",
      remaining: "260000.00",
      due_date: null,
      status: "due",
    });
    expect(r.vendorName).toBe("");
    expect(r.contractValue).toBeNull();
    expect(r.rate).toBeNull();
    expect(r.withheld).toBe(260000);
    expect(r.remaining).toBe(260000);
    expect(r.dueDate).toBe("");
  });
});

describe("formatMoney + formatDueDate", () => {
  it("groups thousands, signs negatives, no baht symbol", () => {
    expect(formatMoney(420000)).toBe("420,000");
    expect(formatMoney(-315000)).toBe("-315,000");
    expect(formatMoney(0)).toBe("0");
  });

  it("passes a valid ISO due date through, '' on missing/invalid (cell em-dashes)", () => {
    expect(formatDueDate("2026-09-01")).toBe("2026-09-01");
    expect(formatDueDate("")).toBe("");
    expect(formatDueDate("not-a-date")).toBe("");
  });
});

describe("KPI aggregates (all real from the register)", () => {
  const rows = [
    row({ id: "a", withheld: 420000, returned: 0, remaining: 420000, status: "holding" }),
    row({ id: "b", withheld: 630000, returned: 315000, remaining: 315000, status: "partial" }),
    row({ id: "c", withheld: 260000, returned: 0, remaining: 260000, status: "due" }),
  ];

  it("sums remaining / withheld / returned across rows", () => {
    expect(sumRemaining(rows)).toBe(995000);
    expect(sumWithheld(rows)).toBe(1310000);
    expect(sumReturned(rows)).toBe(315000);
  });

  it("counts contracts (row count) + due rows (status 'due')", () => {
    expect(contractCount(rows)).toBe(3);
    expect(dueCount(rows)).toBe(1);
  });

  it("an empty register aggregates to 0 everywhere", () => {
    expect(sumRemaining([])).toBe(0);
    expect(contractCount([])).toBe(0);
    expect(dueCount([])).toBe(0);
  });
});

describe("statusMeta (prototype RET_ST tone map)", () => {
  it("maps each derived status to its badge + tone; unknown -> neutral surface", () => {
    expect(statusMeta("withholding")).toEqual({ badge: "withholding", tone: "pending" });
    expect(statusMeta("holding")).toEqual({ badge: "holding", tone: "draft" });
    expect(statusMeta("due")).toEqual({ badge: "due", tone: "rejected" });
    expect(statusMeta("partial")).toEqual({ badge: "partial", tone: "pending" });
    expect(statusMeta("done")).toEqual({ badge: "done", tone: "approved" });
    expect(statusMeta("mystery")).toEqual({ badge: "other", tone: "neutral" });
  });
});

describe("release predicates (mirror the prototype button visibility)", () => {
  it("releasable iff outstanding > 0 AND status is 'due' or 'partial'", () => {
    expect(isReleasable(row({ remaining: 260000, status: "due" }))).toBe(true);
    expect(isReleasable(row({ remaining: 315000, status: "partial" }))).toBe(true);
    // holding (still in warranty) is not releasable from the UI even with a balance.
    expect(isReleasable(row({ remaining: 420000, status: "holding" }))).toBe(false);
    // no outstanding -> never releasable.
    expect(isReleasable(row({ remaining: 0, status: "due" }))).toBe(false);
  });

  it("settled iff outstanding <= 0 (the 'complete' indicator)", () => {
    expect(isSettled(row({ remaining: 0 }))).toBe(true);
    expect(isSettled(row({ remaining: 420000 }))).toBe(false);
  });
});

describe("releaseAmount (SERVER money authority)", () => {
  it("reads the response amount (number or numeric string), tolerating a data envelope", () => {
    expect(releaseAmount({ id: "ret1", jv_no: "JV-1", amount: 260000, status: "released" })).toBe(260000);
    expect(releaseAmount({ amount: "315000.00" })).toBe(315000);
    expect(releaseAmount({ data: { amount: 420000 } })).toBe(420000);
  });

  it("returns null for an absent/non-finite amount (caller em-dashes, never fabricates)", () => {
    expect(releaseAmount({ id: "ret1", status: "released" })).toBeNull();
    expect(releaseAmount({ amount: "" })).toBeNull();
    expect(releaseAmount(null)).toBeNull();
    expect(releaseAmount("nope")).toBeNull();
  });
});
