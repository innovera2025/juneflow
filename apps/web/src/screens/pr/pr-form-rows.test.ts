/*
 * pr-form-rows unit tests — the pure PRForm detail logic ported from pototype/pr-form.jsx.
 * Guards the opaque detail/line narrowing defaults, the status action gates (submit/approve/
 * reject), the INTEGER remaining-tier arithmetic (never money), the type-tab + status phrase
 * maps, the client-side project-name join, the ISO last-edited date, and the money FORMATTERS
 * (formatMoney/formatDec) that only display server-derived amounts (never compute a total).
 */
import { describe, it, expect } from "vitest";
import {
  toPrDetail,
  toPrItem,
  canSubmit,
  canApprove,
  canReject,
  remainingTiers,
  requiredTierCount,
  typeTabPhraseName,
  statusTone,
  statusPhraseName,
  resolveProjectName,
  lastEditedDate,
  formatMoney,
  formatDec,
} from "./pr-form-rows";

describe("toPrItem", () => {
  it("narrows a wire line (snake_case) with real qty/price/amount", () => {
    const it = toPrItem({ boq_item_id: "b1", qty: 1200, price: 168.5, amount: 202200 });
    expect(it).toEqual({ boqItemId: "b1", qty: 1200, price: 168.5, amount: 202200 });
  });

  it("accepts camelCase and defaults missing fields (null / 0), never invents", () => {
    expect(toPrItem({ boqItemId: "b2", qty: "3" })).toEqual({
      boqItemId: "b2",
      qty: 3,
      price: 0,
      amount: 0,
    });
    expect(toPrItem({})).toEqual({ boqItemId: null, qty: 0, price: 0, amount: 0 });
  });

  it("keeps a blank boq_item_id as null (view em-dashes it)", () => {
    expect(toPrItem({ boq_item_id: "  ", qty: 1 }).boqItemId).toBeNull();
  });
});

describe("toPrDetail", () => {
  it("narrows the full wire doc + its lines", () => {
    const d = toPrDetail({
      id: "p1",
      no: "PR-2026-0418",
      type: "material",
      status: "pending",
      title: "cement",
      project_id: "proj-1",
      need_date: "2026-06-02",
      phase: "phase 2",
      requester: "Vipa",
      vendor: "SCG",
      submitted_at: "2026-05-25T03:48:00.000Z",
      approved_at: "",
      approval_step: 0,
      currency_code: "THB",
      amount: 902475,
      items: [{ boq_item_id: "b1", qty: 10, price: 5, amount: 50 }],
    });
    expect(d.no).toBe("PR-2026-0418");
    expect(d.projectId).toBe("proj-1");
    expect(d.requester).toBe("Vipa");
    expect(d.vendor).toBe("SCG");
    expect(d.amount).toBe(902475);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toEqual({ boqItemId: "b1", qty: 10, price: 5, amount: 50 });
  });

  it("defaults every missing field and yields [] for a non-array items", () => {
    const d = toPrDetail({});
    expect(d).toMatchObject({
      id: "",
      no: "",
      type: "",
      status: "",
      title: "",
      projectId: "",
      needDate: "",
      phase: "",
      requester: "",
      vendor: "",
      submittedAt: "",
      approvedAt: "",
      approvalStep: 0,
      currencyCode: "",
      amount: 0,
    });
    expect(d.items).toEqual([]);
    expect(toPrDetail({ items: "nope" }).items).toEqual([]);
  });
});

describe("status action gates", () => {
  it("submit only on a draft", () => {
    expect(canSubmit("draft")).toBe(true);
    expect(canSubmit("pending")).toBe(false);
    expect(canSubmit("approved")).toBe(false);
  });
  it("approve + reject only on a pending doc", () => {
    for (const s of ["draft", "approved", "rejected", ""]) {
      expect(canApprove(s)).toBe(false);
      expect(canReject(s)).toBe(false);
    }
    expect(canApprove("pending")).toBe(true);
    expect(canReject("pending")).toBe(true);
  });
});

describe("requiredTierCount + remainingTiers (integer, B-070 thresholds)", () => {
  it("mirrors the backend tier count (>2M -> 3, >500k -> 2, else 1)", () => {
    expect(requiredTierCount(2_000_001)).toBe(3);
    expect(requiredTierCount(500_001)).toBe(2);
    expect(requiredTierCount(500_000)).toBe(1);
    expect(requiredTierCount(0)).toBe(1);
  });

  it("remaining = total tiers minus cleared steps, clamped at 0", () => {
    // pending mid-flight: approval_step is 0 on the wire -> full tier count remains.
    expect(remainingTiers(902_475, 0, "pending")).toBe(2);
    // a partly-cleared doc.
    expect(remainingTiers(3_000_000, 1, "pending")).toBe(2);
    // over-cleared / terminal -> 0, never negative.
    expect(remainingTiers(400_000, 5, "pending")).toBe(0);
    expect(remainingTiers(902_475, 0, "approved")).toBe(0);
    expect(remainingTiers(902_475, 0, "rejected")).toBe(0);
  });
});

describe("typeTabPhraseName", () => {
  it("maps each enum to its tab key; subcon -> the WO-typed label; unknown -> material", () => {
    expect(typeTabPhraseName("material")).toBe("typeMaterial");
    expect(typeTabPhraseName("subcon")).toBe("typeSubconWo");
    expect(typeTabPhraseName("expense")).toBe("typeExpense");
    expect(typeTabPhraseName("advance")).toBe("typeAdvance");
    expect(typeTabPhraseName("clear")).toBe("typeClear");
    expect(typeTabPhraseName("weird")).toBe("typeMaterial");
  });
});

describe("statusTone + statusPhraseName", () => {
  it("uses token bg/fg + a verbatim dot hex; unknown -> draft", () => {
    expect(statusTone("pending")).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" });
    expect(statusTone("approved").dot).toBe("#16A34A");
    expect(statusTone("rejected").dot).toBe("#DC2626");
    expect(statusTone("whatever").fg).toBe("var(--draft)");
  });
  it("maps status -> its phrase key; unknown -> draft", () => {
    expect(statusPhraseName("pending")).toBe("statusPending");
    expect(statusPhraseName("approved")).toBe("statusApproved");
    expect(statusPhraseName("rejected")).toBe("statusRejected");
    expect(statusPhraseName("draft")).toBe("statusDraft");
    expect(statusPhraseName("")).toBe("statusDraft");
  });
});

describe("resolveProjectName (client-join, never a raw uuid)", () => {
  const projects = [
    { id: "p1", name: "Ratchaphruek" },
    { id: "p2", name: "Bangna" },
  ];
  it("returns the joined name", () => {
    expect(resolveProjectName("p2", projects)).toBe("Bangna");
  });
  it("returns '' when the id is blank, absent, or the catalogue is missing (view em-dashes)", () => {
    expect(resolveProjectName("", projects)).toBe("");
    expect(resolveProjectName("nope", projects)).toBe("");
    expect(resolveProjectName("p1", undefined)).toBe("");
  });
});

describe("lastEditedDate", () => {
  it("prefers approved_at, falls back to submitted_at, as an ISO date", () => {
    expect(lastEditedDate("2026-05-25T03:48:00.000Z", "2026-05-26T04:00:00.000Z")).toBe("2026-05-26");
    expect(lastEditedDate("2026-05-25T03:48:00.000Z", "")).toBe("2026-05-25");
  });
  it("returns '' when both are blank or unparseable (view em-dashes)", () => {
    expect(lastEditedDate("", "")).toBe("");
    expect(lastEditedDate("not-a-date", "")).toBe("");
  });
});

describe("money formatters (display only — never compute a total)", () => {
  it("formatMoney groups integers", () => {
    expect(formatMoney(902475)).toBe("902,475");
    expect(formatMoney(1200)).toBe("1,200");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
  it("formatDec keeps 2 decimals + thousands separators", () => {
    expect(formatDec(168.5)).toBe("168.50");
    expect(formatDec(902475)).toBe("902,475.00");
    expect(formatDec(-1234.5)).toBe("-1,234.50");
    expect(formatDec(Number.POSITIVE_INFINITY)).toBe("0.00");
  });
});
