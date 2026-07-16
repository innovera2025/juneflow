/*
 * Unit tests for po-wo-rows.ts (P2-WEB-10, gate G3) — the pure PO/WO-list helpers
 * that back POList / WOList. Covers the opaque-row narrowing (po / wo / pr /
 * vendor), the tab partitions + C10 counts, the status tone/label mapping
 * (draft/pending/approved/rejected), the id -> display joins (vendor name / pr no /
 * pr->project name), the approved-PR gate, the retention sum, and money formatting.
 */
import { describe, it, expect } from "vitest";
import {
  toPoRow,
  toWoRow,
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
  status: "approved",
  approvalStep: 0,
  value: 0,
  retentionPct: 0,
  retentionAmount: 0,
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
  it("narrows the woWire shape (retention fields, value->amount fallback)", () => {
    expect(
      toWoRow({
        id: "w9",
        no: "WO-2026-0115",
        pr_id: "pr-2",
        vendor_id: "v-2",
        status: "approved",
        value: 2840000,
        retention_pct: 10,
        retention_amount: 284000,
      }),
    ).toEqual({
      id: "w9",
      no: "WO-2026-0115",
      prId: "pr-2",
      vendorId: "v-2",
      status: "approved",
      approvalStep: 0,
      value: 2840000,
      retentionPct: 10,
      retentionAmount: 284000,
    });
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
  it("partitions all / pending / active and leaves installment+closed empty", () => {
    expect(filterWoByTab(rows, "all").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(filterWoByTab(rows, "pending").map((r) => r.id)).toEqual(["a"]);
    expect(filterWoByTab(rows, "active").map((r) => r.id)).toEqual(["b"]);
    expect(filterWoByTab(rows, "installment")).toEqual([]);
    expect(filterWoByTab(rows, "closed")).toEqual([]);
  });
  it("woTabCount returns the filtered length", () => {
    expect(woTabCount(rows, "pending")).toBe(1);
    expect(woTabCount(rows, "installment")).toBe(0);
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
