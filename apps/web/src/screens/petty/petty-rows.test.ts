/*
 * petty-rows unit tests (P2-WEB-75, gate G3) — the pure petty-cash logic ported from
 * petty-alloc.jsx PettyCash + PettyClaimForm (toPettyRow / formatMoney / pettyTypeKind
 * / pettyTypeTone / pettyAmountCell / statusTone / statusLabelKind / pettyDateCell /
 * pettyTabCounts / pettyKpis / parseMoney / pettyClaimSubmittable / isOverCap /
 * buildPettyClaimBody). Guards the opaque-row narrowing, the type-derived amount sign
 * (server stores a positive magnitude), the derived KPI / tab counts (deterministic
 * `now`), and the typed POST-body shaping. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  PETTY_CAP,
  toPettyRow,
  formatMoney,
  pettyTypeKind,
  pettyTypeTone,
  pettyAmountCell,
  statusTone,
  statusLabelKind,
  pettyDateCell,
  pettyTabCounts,
  pettyKpis,
  parseMoney,
  pettyClaimSubmittable,
  isOverCap,
  buildPettyClaimBody,
  emptyPettyClaimDraft,
  type PettyRow,
  type PettyClaimDraft,
} from "./petty-rows";

const row = (p: Partial<PettyRow> = {}): PettyRow => ({
  id: "p1",
  no: "PT-2026-0148",
  type: "claim",
  label: "line",
  value: 3200,
  currencyCode: "THB",
  byUserId: "u1",
  by: "Wipha",
  projectId: "",
  projectName: "",
  ccId: "",
  ccName: "",
  cat: "Welfare",
  ref: "",
  status: "pending",
  txnDate: "",
  createdAt: "2026-05-25T10:30:00.000Z",
  ...p,
});

const draft = (p: Partial<PettyClaimDraft> = {}): PettyClaimDraft => ({
  ...emptyPettyClaimDraft(),
  ...p,
});

describe("toPettyRow — opaque wire narrowing", () => {
  it("reads snake_case wire fields incl. FK-resolved display names", () => {
    const r = toPettyRow({
      id: "x",
      no: "PT-2026-0001",
      type: "claim",
      label: "water",
      value: "3200.00",
      currency_code: "THB",
      by_user_id: "u9",
      by: "Napat",
      project_id: "pr1",
      project_name: "Phase 2",
      cc_id: "c1",
      cc_name: "CC-A",
      cat: "Welfare",
      ref: "PR-2026-0417",
      status: "pending",
      txn_date: "2026-05-25",
      created_at: "2026-05-25T10:30:00.000Z",
    });
    expect(r.value).toBe(3200);
    expect(r.by).toBe("Napat");
    expect(r.projectName).toBe("Phase 2");
    expect(r.ref).toBe("PR-2026-0417");
    expect(r.txnDate).toBe("2026-05-25");
  });

  it("coerces missing/null fields to empty string / zero (honest em-dash source)", () => {
    const r = toPettyRow({ id: "y", type: "topup" });
    expect(r.no).toBe("");
    expect(r.by).toBe("");
    expect(r.ref).toBe("");
    expect(r.value).toBe(0);
  });
});

describe("formatMoney — thousands, magnitude only", () => {
  it("groups full baht with no decimals or sign", () => {
    expect(formatMoney(3200)).toBe("3,200");
    expect(formatMoney(50000)).toBe("50,000");
    expect(formatMoney(-8400)).toBe("8,400"); // magnitude; sign is the caller's job
    expect(formatMoney(680)).toBe("680");
  });
  it("non-finite -> 0", () => {
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("pettyTypeKind / pettyTypeTone", () => {
  it("classifies claim/clear/topup, unknown -> claim", () => {
    expect(pettyTypeKind("claim")).toBe("claim");
    expect(pettyTypeKind("clear")).toBe("clear");
    expect(pettyTypeKind("topup")).toBe("topup");
    expect(pettyTypeKind("weird")).toBe("claim");
  });
  it("tone tokens per kind (petty-alloc.jsx L95-97)", () => {
    expect(pettyTypeTone("claim")).toEqual({ bg: "var(--brand-soft)", fg: "var(--brand)" });
    expect(pettyTypeTone("clear")).toEqual({ bg: "var(--info-soft)", fg: "var(--info)" });
    expect(pettyTypeTone("topup")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)" });
  });
});

describe("pettyAmountCell — sign + tone derived from type (money=SERVER)", () => {
  it("topup is an inflow (+, ok tone)", () => {
    expect(pettyAmountCell({ type: "topup", value: 50000 })).toEqual({
      text: "+50,000",
      color: "var(--ok)",
    });
  });
  it("claim/clear are outflows (-, danger tone) even though value is positive", () => {
    expect(pettyAmountCell({ type: "claim", value: 3200 })).toEqual({
      text: "-3,200",
      color: "var(--danger)",
    });
    expect(pettyAmountCell({ type: "clear", value: 22200 })).toEqual({
      text: "-22,200",
      color: "var(--danger)",
    });
  });
});

describe("statusTone / statusLabelKind", () => {
  it("maps known statuses, unknown -> draft (ds.jsx STATUS[s] || draft)", () => {
    expect(statusTone("approved").fg).toBe("var(--ok)");
    expect(statusTone("pending").fg).toBe("var(--warn)");
    expect(statusTone("posted").fg).toBe("var(--draft)");
    expect(statusLabelKind("pending")).toBe("pending");
    expect(statusLabelKind("approved")).toBe("approved");
    expect(statusLabelKind("posted")).toBe("draft");
  });
});

describe("pettyDateCell — honest date render", () => {
  it("prefers a raw txn_date string", () => {
    expect(pettyDateCell({ txnDate: "2026-05-25", createdAt: "2026-05-25T10:30:00Z" })).toBe(
      "2026-05-25",
    );
  });
  it("falls back to UTC 'YYYY-MM-DD HH:mm' of created_at", () => {
    expect(pettyDateCell({ txnDate: "", createdAt: "2026-05-25T10:30:00.000Z" })).toBe(
      "2026-05-25 10:30",
    );
  });
  it("empty when neither is present", () => {
    expect(pettyDateCell({ txnDate: "", createdAt: "" })).toBe("");
  });
});

describe("pettyTabCounts — real counts off loaded rows", () => {
  it("counts all/claim/clear/topup/pending", () => {
    const rows = [
      row({ type: "claim", status: "pending" }),
      row({ type: "claim", status: "approved" }),
      row({ type: "clear", status: "approved" }),
      row({ type: "topup", status: "approved" }),
    ];
    expect(pettyTabCounts(rows)).toEqual({ all: 4, claim: 2, clear: 1, topup: 1, pending: 1 });
  });
});

describe("pettyKpis — claims-this-month + pending, deterministic now", () => {
  const now = new Date("2026-05-15T00:00:00.000Z");
  it("sums only claim rows in now's month, and pending rows", () => {
    const rows = [
      row({ type: "claim", value: 3200, status: "pending", createdAt: "2026-05-25T10:30:00Z" }),
      row({ type: "claim", value: 1850, status: "approved", createdAt: "2026-05-24T09:15:00Z" }),
      row({ type: "claim", value: 999, status: "approved", createdAt: "2026-04-01T09:15:00Z" }), // other month
      row({ type: "topup", value: 50000, status: "approved", createdAt: "2026-05-23T09:00:00Z" }), // not a claim
    ];
    const k = pettyKpis(rows, now);
    expect(k.claimMonthCount).toBe(2);
    expect(k.claimMonthSum).toBe(3200 + 1850);
    expect(k.pendingCount).toBe(1);
    expect(k.pendingSum).toBe(3200);
  });
  it("empty rows -> all zero (honest-empty)", () => {
    expect(pettyKpis([], now)).toEqual({
      claimMonthCount: 0,
      claimMonthSum: 0,
      pendingCount: 0,
      pendingSum: 0,
    });
  });
});

describe("claim-form helpers — parse / submittable / cap / body", () => {
  it("parseMoney rejects blank/negative/NaN", () => {
    expect(parseMoney("3200")).toBe(3200);
    expect(parseMoney("")).toBe(0);
    expect(parseMoney("-5")).toBe(0);
    expect(parseMoney("x")).toBe(0);
  });
  it("submittable needs category + amount>0 + description (by/date drop out)", () => {
    expect(pettyClaimSubmittable(draft({ amount: "500", description: "d" }))).toBe(true);
    expect(pettyClaimSubmittable(draft({ amount: "0", description: "d" }))).toBe(false);
    expect(pettyClaimSubmittable(draft({ amount: "500", description: "" }))).toBe(false);
    expect(pettyClaimSubmittable(draft({ amount: "500", description: "d", category: "" }))).toBe(
      false,
    );
  });
  it("isOverCap flags a spend past the per-claim cap (server still enforces)", () => {
    expect(PETTY_CAP).toBe(10_000);
    expect(isOverCap(draft({ amount: "10001" }))).toBe(true);
    expect(isOverCap(draft({ amount: "10000" }))).toBe(false);
  });
  it("buildPettyClaimBody sends the typed fields; omits absent optionals", () => {
    expect(buildPettyClaimBody(draft({ category: "Welfare", amount: "3200", description: "water" })))
      .toEqual({ category: "Welfare", amount: 3200, description: "water" });
    expect(
      buildPettyClaimBody(
        draft({
          category: "Transport",
          amount: "500",
          description: "fuel",
          txnDate: "2026-05-25",
          projectId: "pr1",
        }),
      ),
    ).toEqual({
      category: "Transport",
      amount: 500,
      description: "fuel",
      txn_date: "2026-05-25",
      project_id: "pr1",
    });
  });
});
