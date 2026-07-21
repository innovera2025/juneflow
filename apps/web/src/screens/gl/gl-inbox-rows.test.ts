/*
 * gl-inbox-rows unit tests (gl.inbox, gate G3) — the pure posting-inbox logic ported from
 * gl.jsx GLPostingInbox + PostingInboxFilter (toInboxRow / deriveStatus / sourceTag / tab
 * filter+count / KPI count+sum / null amount+doc_no -> em-dash path / client filter). Guards the
 * opaque-row narrowing, the honest-empty posted/scheduled/error tabs, and the client filter
 * against regression. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toInboxRow,
  deriveStatus,
  sourceTag,
  filterByTab,
  tabCount,
  countByStatus,
  sumAmountByStatus,
  applyFilter,
  isFilterActive,
  parseMinAmount,
  distinctSources,
  formatMoney,
  formatTime,
  EMPTY_FILTER,
  type InboxRow,
} from "./gl-inbox-rows";

const row = (p: Partial<InboxRow> = {}): InboxRow => ({
  source: "pv",
  id: "id1",
  docNo: "",
  amount: 0,
  currencyCode: "THB",
  posted: false,
  jvNo: "",
  createdAt: "2026-05-25T04:24:00.000Z",
  status: "pending",
  ...p,
});

describe("toInboxRow", () => {
  it("narrows a full opaque /gl/posting-inbox row (snake_case) + derives status", () => {
    expect(
      toInboxRow({
        source: "rv",
        id: "rv1",
        doc_no: null,
        amount: 2148000,
        currency_code: "THB",
        posted: true,
        jv_no: "JV-2026-0418",
        created_at: "2026-05-25T02:42:00.000Z",
      }),
    ).toEqual({
      source: "rv",
      id: "rv1",
      docNo: "",
      amount: 2148000,
      currencyCode: "THB",
      posted: true,
      jvNo: "JV-2026-0418",
      createdAt: "2026-05-25T02:42:00.000Z",
      status: "posted",
    });
  });

  it("keeps a null amount as null (em-dash path) and null doc_no as '' (em-dash path)", () => {
    const r = toInboxRow({ source: "gr", id: "gr1", doc_no: "GR-2026-0148", amount: null, posted: false });
    expect(r.amount).toBeNull();
    expect(r.docNo).toBe("GR-2026-0148");
    const r2 = toInboxRow({ source: "pv", id: "pv1", doc_no: null, amount: 645000 });
    expect(r2.docNo).toBe("");
    expect(r2.amount).toBe(645000);
  });

  it("defaults a missing/non-true posted to pending", () => {
    expect(toInboxRow({ source: "pv", id: "x" }).status).toBe("pending");
    expect(toInboxRow({ source: "pv", id: "x", posted: false }).posted).toBe(false);
  });
});

describe("deriveStatus", () => {
  it("maps posted flag to posted/pending only (scheduled/error are mock-only)", () => {
    expect(deriveStatus(true)).toBe("posted");
    expect(deriveStatus(false)).toBe("pending");
  });
});

describe("sourceTag", () => {
  it("labels + tones the wire kinds, neutral for unknown", () => {
    expect(sourceTag("pv")).toEqual({ label: "PV", bg: "var(--warn-soft)", fg: "var(--warn)" });
    expect(sourceTag("rv").fg).toBe("var(--ok)");
    expect(sourceTag("gr")).toEqual({ label: "GR", bg: "var(--accent-soft)", fg: "var(--accent)" });
    expect(sourceTag("payroll").label).toBe("Payroll");
    expect(sourceTag("fa")).toEqual({ label: "FA", bg: "var(--surface-3)", fg: "var(--text-2)" });
  });
});

describe("tab filter + count", () => {
  const rows = [
    row({ id: "a", posted: false, status: "pending" }),
    row({ id: "b", posted: true, status: "posted" }),
    row({ id: "c", posted: false, status: "pending" }),
  ];

  it("all -> every row; pending/posted -> that status", () => {
    expect(filterByTab(rows, "all")).toHaveLength(3);
    expect(filterByTab(rows, "pending").map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterByTab(rows, "posted").map((r) => r.id)).toEqual(["b"]);
  });

  it("scheduled + error tabs are always empty (no wire status)", () => {
    expect(filterByTab(rows, "scheduled")).toEqual([]);
    expect(filterByTab(rows, "error")).toEqual([]);
    expect(tabCount(rows, "scheduled")).toBe(0);
    expect(tabCount(rows, "error")).toBe(0);
  });

  it("tabCount matches the filtered length", () => {
    expect(tabCount(rows, "all")).toBe(3);
    expect(tabCount(rows, "pending")).toBe(2);
    expect(tabCount(rows, "posted")).toBe(1);
  });
});

describe("KPI count + sum", () => {
  const rows = [
    row({ id: "a", status: "pending", amount: 645000 }),
    row({ id: "b", status: "pending", amount: null }), // gr-style null -> skipped in the sum
    row({ id: "c", status: "posted", amount: 2148000 }),
  ];

  it("counts by status", () => {
    expect(countByStatus(rows, "pending")).toBe(2);
    expect(countByStatus(rows, "posted")).toBe(1);
  });

  it("sums non-null amounts by status (null skipped, honest)", () => {
    expect(sumAmountByStatus(rows, "pending")).toBe(645000);
    expect(sumAmountByStatus(rows, "posted")).toBe(2148000);
  });

  it("posted KPIs are legitimately 0/empty when nothing is posted (C10 seed reality)", () => {
    const allPending = [row({ status: "pending", amount: 100 }), row({ status: "pending", amount: 200 })];
    expect(countByStatus(allPending, "posted")).toBe(0);
    expect(sumAmountByStatus(allPending, "posted")).toBe(0);
  });
});

describe("client filter", () => {
  const rows = [
    row({ id: "a", source: "pv", amount: 645000 }),
    row({ id: "b", source: "rv", amount: 2148000 }),
    row({ id: "c", source: "gr", amount: null }),
  ];

  it("EMPTY_FILTER passes every row and is inactive", () => {
    expect(applyFilter(rows, EMPTY_FILTER)).toHaveLength(3);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it("filters by source kind", () => {
    expect(applyFilter(rows, { source: "pv", minAmount: "" }).map((r) => r.id)).toEqual(["a"]);
    expect(isFilterActive({ source: "pv", minAmount: "" })).toBe(true);
  });

  it("filters by minimum amount and drops null-amount rows when a minimum is set", () => {
    expect(applyFilter(rows, { source: "", minAmount: "1000000" }).map((r) => r.id)).toEqual(["b"]);
    // null-amount (gr) row cannot satisfy a minimum -> dropped
    expect(applyFilter(rows, { source: "", minAmount: "1" }).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("parseMinAmount only accepts a positive number", () => {
    expect(parseMinAmount("100000")).toBe(100000);
    expect(parseMinAmount("")).toBe(0);
    expect(parseMinAmount("0")).toBe(0);
    expect(parseMinAmount("-5")).toBe(0);
    expect(parseMinAmount("abc")).toBe(0);
  });

  it("distinctSources lists wire kinds first-seen, skipping blanks", () => {
    expect(distinctSources(rows)).toEqual(["pv", "rv", "gr"]);
    expect(distinctSources([row({ source: "" }), row({ source: "pv" }), row({ source: "pv" })])).toEqual(["pv"]);
  });
});

describe("formatMoney", () => {
  it("groups thousands with no decimals or baht symbol", () => {
    expect(formatMoney(1_000_000)).toBe("1,000,000");
    expect(formatMoney(645000)).toBe("645,000");
    expect(formatMoney(0)).toBe("0");
  });

  it("returns '0' for non-finite input", () => {
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("formatTime", () => {
  it("formats a valid timestamp to an ISO date-time (UTC)", () => {
    expect(formatTime("2026-05-25T11:24:00.000Z")).toBe("2026-05-25 11:24");
  });

  it("returns '' for empty / invalid input (cell em-dashes)", () => {
    expect(formatTime("")).toBe("");
    expect(formatTime("not-a-date")).toBe("");
  });
});
