/*
 * pr-rows unit tests (P2-WEB-09, gate G3) — the pure PRList display logic ported from
 * pototype/pr-list.jsx. Guards the opaque-row narrowing defaults, the PR_TYPES chip map,
 * the ds.jsx STATUS badge tone, the B-070 tier-count (mirrored from the backend approve
 * gate), the ApprovalSteps bar/label stepper, the money format, the KPI aggregates
 * (including the approved-this-month cohort + the mean approval duration read off the
 * migration-0022 submitted_at/approved_at stamps) and the status/project/type/requester/
 * search filter.
 */
import { describe, it, expect } from "vitest";
import {
  toPrRow,
  prTypeMeta,
  prTypeStringName,
  statusTone,
  statusStringName,
  requiredTierCount,
  approvalBars,
  approvalStepLabel,
  formatMoney,
  formatDate,
  firstName,
  millionsValue,
  monthKey,
  approvedInMonth,
  avgApprovalDays,
  filterPrRows,
  countByStatus,
  countByRequester,
  sumAmount,
  activeFilterCount,
  type PrRow,
} from "./pr-rows";

/** A pending material PR + an approved subcon PR fixture (real LIST wire shape). */
const PENDING: PrRow = {
  id: "p1",
  no: "PR-2026-0418",
  type: "material",
  projectId: "prj-1",
  needDate: "2026-05-25",
  status: "pending",
  approvalStep: 2,
  currencyCode: "THB",
  amount: 842500,
  title: "cement + rebar phase 2/B",
  phase: "phase 2 B",
  vendor: "SCG Concrete",
  requester: "Wipha Chancharoen",
  requesterId: "u-1",
  submittedAt: "2026-05-25T00:00:00.000Z",
  approvedAt: null,
};
const APPROVED: PrRow = {
  id: "p2",
  no: "PR-2026-0415",
  type: "subcon",
  projectId: "prj-1",
  needDate: null,
  status: "approved",
  approvalStep: 3,
  currencyCode: "THB",
  amount: 425000,
  title: "exterior painting Block A",
  phase: "phase 1 A",
  vendor: "Changthai Pattana",
  requester: "Somsak Rungrueang",
  requesterId: "u-4",
  submittedAt: "2026-05-24T00:00:00.000Z",
  approvedAt: "2026-05-27T00:00:00.000Z",
};
const DRAFT: PrRow = {
  id: "p3",
  no: "PR-2026-0410",
  type: "subcon",
  projectId: "prj-2",
  needDate: null,
  status: "draft",
  approvalStep: 0,
  currencyCode: "THB",
  amount: 985000,
  title: "plumbing install B-1 to B-12",
  phase: null,
  vendor: null,
  requester: null,
  requesterId: null,
  submittedAt: null,
  approvedAt: null,
};

describe("toPrRow", () => {
  it("narrows a full opaque /pr row (snake_case) to the row shape", () => {
    expect(
      toPrRow({
        id: "p1",
        no: "PR-2026-0418",
        type: "material",
        project_id: "prj-1",
        need_date: "2026-05-25",
        status: "pending",
        approval_step: 2,
        currency_code: "THB",
        amount: 842500,
        title: "cement + rebar phase 2/B",
        phase: "phase 2 B",
        vendor: "SCG Concrete",
        requester: "Wipha Chancharoen",
        requester_id: "u-1",
        submitted_at: "2026-05-25T00:00:00.000Z",
        approved_at: null,
        extra: "ignored",
      }),
    ).toEqual(PENDING);
  });

  it("accepts camelCase aliases and parses a numeric-string amount", () => {
    const r = toPrRow({
      projectId: "prj-9",
      approvalStep: 1,
      currencyCode: "USD",
      amount: "1,268,000",
      requesterId: "u-9",
      submittedAt: "2026-05-24T00:00:00.000Z",
      approvedAt: "2026-05-24T00:00:00.000Z",
    });
    expect(r.projectId).toBe("prj-9");
    expect(r.approvalStep).toBe(1);
    expect(r.currencyCode).toBe("USD");
    expect(r.amount).toBe(1268000);
    expect(r.requesterId).toBe("u-9");
    expect(r.submittedAt).toBe("2026-05-24T00:00:00.000Z");
    expect(r.approvedAt).toBe("2026-05-24T00:00:00.000Z");
  });

  it("defaults every field (needDate null, amount 0) when absent — never invented", () => {
    expect(toPrRow({})).toEqual({
      id: "",
      no: "",
      type: "",
      projectId: "",
      needDate: null,
      status: "",
      approvalStep: 0,
      currencyCode: "",
      amount: 0,
      title: null,
      phase: null,
      vendor: null,
      requester: null,
      requesterId: null,
      submittedAt: null,
      approvedAt: null,
    });
  });

  it("keeps an absent vendor/requester name null (the list resolves them, detail-only fields stay null)", () => {
    const r = toPrRow({ id: "p9", vendor: null, requester: "", title: "  " });
    expect(r.vendor).toBeNull();
    expect(r.requester).toBeNull();
    expect(r.title).toBeNull();
  });

  it("treats a blank need_date as null (honest em-dash source)", () => {
    expect(toPrRow({ need_date: "" }).needDate).toBeNull();
    expect(toPrRow({ need_date: "2026-06-01" }).needDate).toBe("2026-06-01");
  });
});

describe("prTypeMeta / prTypeStringName (pr-list.jsx PR_TYPES)", () => {
  it("maps each type to its verbatim chip colour", () => {
    expect(prTypeMeta("material")).toEqual({ color: "#0F766E", soft: "#E6F4F2" });
    expect(prTypeMeta("subcon")).toEqual({ color: "#1D4ED8", soft: "#E5ECFB" });
    expect(prTypeMeta("expense")).toEqual({ color: "#7C3AED", soft: "#F1E9FE" });
    expect(prTypeMeta("advance")).toEqual({ color: "#B45309", soft: "#FEF3C7" });
    expect(prTypeMeta("clear")).toEqual({ color: "#475569", soft: "#EEF1F4" });
  });

  it("falls back to material for an unknown type", () => {
    expect(prTypeMeta("bogus")).toEqual(prTypeMeta("material"));
    expect(prTypeStringName("bogus")).toBe("typeMaterial");
  });

  it("maps each type to its phrase-key name", () => {
    expect(prTypeStringName("subcon")).toBe("typeSubcon");
    expect(prTypeStringName("expense")).toBe("typeExpense");
    expect(prTypeStringName("advance")).toBe("typeAdvance");
    expect(prTypeStringName("clear")).toBe("typeClear");
  });
});

describe("statusTone / statusStringName (ds.jsx STATUS)", () => {
  it("uses the verbatim dot hex per status", () => {
    expect(statusTone("pending").dot).toBe("#D97706");
    expect(statusTone("approved").dot).toBe("#16A34A");
    expect(statusTone("rejected").dot).toBe("#DC2626");
    expect(statusTone("revise").dot).toBe("#1D4ED8");
    expect(statusTone("draft").dot).toBe("#94A3B8");
  });

  it("falls back to the draft tone for an unknown status", () => {
    expect(statusTone("bogus")).toEqual(statusTone("draft"));
    expect(statusStringName("bogus")).toBe("statusDraft");
  });

  it("maps each status to its phrase-key name", () => {
    expect(statusStringName("pending")).toBe("statusPending");
    expect(statusStringName("approved")).toBe("statusApproved");
    expect(statusStringName("rejected")).toBe("statusRejected");
    expect(statusStringName("revise")).toBe("statusRevise");
  });
});

describe("requiredTierCount (B-070, mirrors pr.ts approve gate)", () => {
  it("engages 1 tier at or below 500k, 2 above 500k, 3 above 2M (strict >)", () => {
    expect(requiredTierCount(0)).toBe(1);
    expect(requiredTierCount(500_000)).toBe(1);
    expect(requiredTierCount(500_001)).toBe(2);
    expect(requiredTierCount(2_000_000)).toBe(2);
    expect(requiredTierCount(2_000_001)).toBe(3);
  });
});

describe("approvalBars / approvalStepLabel (pr-list.jsx ApprovalSteps)", () => {
  it("colours done tiers ok and the current tier warn (pending mid-chain)", () => {
    // step 2 of 3, pending: tiers 0,1 done (ok), tier 2 current (warn).
    expect(approvalBars(2, 3, "pending")).toEqual([
      "var(--ok)",
      "var(--ok)",
      "var(--warn)",
    ]);
  });

  it("colours all tiers ok when fully approved", () => {
    expect(approvalBars(3, 3, "approved")).toEqual([
      "var(--ok)",
      "var(--ok)",
      "var(--ok)",
    ]);
  });

  it("marks the failed tier danger on reject and info on revise", () => {
    // rejected at step 1: tier 0 is the failed tier (danger), no done bars.
    expect(approvalBars(1, 2, "rejected")).toEqual(["var(--danger)", "var(--surface-3)"]);
    // revise at step 2 of 3: tier 1 failed (info), tier 2 current (warn).
    expect(approvalBars(2, 3, "revise")).toEqual([
      "var(--surface-3)",
      "var(--info)",
      "var(--warn)",
    ]);
  });

  it("labels a draft '—' and everything else '{step}/{total}'", () => {
    expect(approvalStepLabel(0, 3, "draft")).toBe("—");
    expect(approvalStepLabel(2, 3, "pending")).toBe("2/3");
  });
});

describe("formatMoney / millionsValue", () => {
  it("groups thousands and never renders decimals", () => {
    expect(formatMoney(842500)).toBe("842,500");
    expect(formatMoney(1268000)).toBe("1,268,000");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(Number.NaN)).toBe("0");
  });

  it("renders the KPI value in millions to 2 dp", () => {
    expect(millionsValue(6_840_000)).toBe("6.84");
    expect(millionsValue(0)).toBe("0.00");
  });
});

describe("formatDate / firstName / monthKey", () => {
  it("renders a wire instant as a deterministic UTC ISO date", () => {
    expect(formatDate("2026-05-25T00:00:00.000Z")).toBe("2026-05-25");
    expect(formatDate("2026-05-25")).toBe("2026-05-25");
  });

  it("returns '' for a null/blank/invalid stamp so the view can em-dash it", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });

  it("prints only the first name token, like the prototype requester cell", () => {
    expect(firstName("Wipha Chancharoen")).toBe("Wipha");
    expect(firstName("Somsak")).toBe("Somsak");
    expect(firstName("")).toBe("");
  });

  it("keys a stamp to its UTC calendar month", () => {
    expect(monthKey("2026-05-25T23:59:59.000Z")).toBe("2026-05");
    expect(monthKey(null)).toBe("");
  });
});

describe("approvedInMonth (KPI 'approved this month')", () => {
  const rows = [PENDING, APPROVED, DRAFT];

  it("keeps only the docs whose real approved_at falls in the month", () => {
    expect(approvedInMonth(rows, "2026-05").map((r) => r.id)).toEqual(["p2"]);
    expect(approvedInMonth(rows, "2026-06")).toHaveLength(0);
  });

  it("selects nothing for an empty month key (fail-closed, never the whole catalogue)", () => {
    expect(approvedInMonth(rows, "")).toHaveLength(0);
  });

  it("ignores an approved doc that carries no approved_at stamp (never inferred)", () => {
    const unstamped: PrRow = { ...APPROVED, id: "p9", approvedAt: null };
    expect(approvedInMonth([unstamped], "2026-05")).toHaveLength(0);
  });
});

describe("avgApprovalDays (KPI 'average approval time')", () => {
  it("means the submitted_at -> approved_at span over docs with both stamps", () => {
    expect(avgApprovalDays([PENDING, APPROVED, DRAFT])).toBe(3);
  });

  it("means across several complete cycles", () => {
    const oneDay: PrRow = {
      ...APPROVED,
      id: "p4",
      submittedAt: "2026-05-20T00:00:00.000Z",
      approvedAt: "2026-05-21T00:00:00.000Z",
    };
    expect(avgApprovalDays([APPROVED, oneDay])).toBe(2);
  });

  it("returns null (-> em-dash) when no doc has a complete approval cycle", () => {
    expect(avgApprovalDays([PENDING, DRAFT])).toBeNull();
    expect(avgApprovalDays([])).toBeNull();
  });

  it("skips an inverted (approved before submitted) span rather than averaging a negative", () => {
    const inverted: PrRow = {
      ...APPROVED,
      id: "p5",
      submittedAt: "2026-05-27T00:00:00.000Z",
      approvedAt: "2026-05-24T00:00:00.000Z",
    };
    expect(avgApprovalDays([inverted])).toBeNull();
    expect(avgApprovalDays([APPROVED, inverted])).toBe(3);
  });
});

describe("filterPrRows / countByStatus / sumAmount", () => {
  const rows = [PENDING, APPROVED, DRAFT];

  it("keeps all rows for the empty (all-tab) filter", () => {
    expect(filterPrRows(rows, { status: "", projectId: "", type: "", q: "" })).toHaveLength(3);
  });

  it("filters by the active tab's status", () => {
    expect(
      filterPrRows(rows, { status: "pending", projectId: "", type: "", q: "" }).map((r) => r.id),
    ).toEqual(["p1"]);
    expect(
      filterPrRows(rows, { status: "draft", projectId: "", type: "", q: "" }).map((r) => r.id),
    ).toEqual(["p3"]);
  });

  it("filters by project id and PR type", () => {
    expect(
      filterPrRows(rows, { status: "", projectId: "prj-2", type: "", q: "" }).map((r) => r.id),
    ).toEqual(["p3"]);
    expect(
      filterPrRows(rows, { status: "", projectId: "", type: "subcon", q: "" }).map((r) => r.id),
    ).toEqual(["p2", "p3"]);
  });

  it("searches over the PR no and the real title / requester / vendor text", () => {
    expect(
      filterPrRows(rows, { status: "", projectId: "", type: "", q: "0415" }).map((r) => r.id),
    ).toEqual(["p2"]);
    expect(
      filterPrRows(rows, { status: "", projectId: "", type: "", q: "rebar" }).map((r) => r.id),
    ).toEqual(["p1"]);
    expect(
      filterPrRows(rows, { status: "", projectId: "", type: "", q: "somsak" }).map((r) => r.id),
    ).toEqual(["p2"]);
    expect(
      filterPrRows(rows, { status: "", projectId: "", type: "", q: "scg" }).map((r) => r.id),
    ).toEqual(["p1"]);
    expect(filterPrRows(rows, { status: "", projectId: "", type: "", q: "zzz" })).toHaveLength(0);
  });

  it("filters by requester id for the 'mine' tab", () => {
    expect(
      filterPrRows(rows, { status: "", projectId: "", type: "", q: "", requesterId: "u-4" }).map(
        (r) => r.id,
      ),
    ).toEqual(["p2"]);
    // an unattributed doc (requester_id null) is never claimed by anyone
    expect(
      filterPrRows(rows, { status: "", projectId: "", type: "", q: "", requesterId: "u-nobody" }),
    ).toHaveLength(0);
  });

  it("counts by status and sums amounts for the KPI strip", () => {
    expect(countByStatus(rows, "pending")).toBe(1);
    expect(countByStatus(rows, "approved")).toBe(1);
    expect(countByStatus(rows, "rejected")).toBe(0);
    expect(sumAmount(rows)).toBe(842500 + 425000 + 985000);
  });

  it("counts the docs a given user requested (the 'mine' tab badge)", () => {
    expect(countByRequester(rows, "u-1")).toBe(1);
    expect(countByRequester(rows, "u-nobody")).toBe(0);
    // no signed-in user id resolved -> 0, never the whole catalogue
    expect(countByRequester(rows, "")).toBe(0);
  });
});

describe("activeFilterCount", () => {
  it("counts each non-empty filter select for the filter-count button badge", () => {
    expect(activeFilterCount({ projectId: "", type: "", q: "" })).toBe(0);
    expect(activeFilterCount({ projectId: "prj-1", type: "", q: "" })).toBe(1);
    expect(activeFilterCount({ projectId: "prj-1", type: "material", q: " " })).toBe(2);
    expect(activeFilterCount({ projectId: "prj-1", type: "material", q: "PR" })).toBe(3);
  });
});
