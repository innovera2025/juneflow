/*
 * Unit tests for boq-archive-rows.ts (P2-WEB-07, gate G3) — the archive-specific search.
 * The reused boq-rows helpers (toBoqRow / statusTone / versionLabel / formatMoney /
 * projectNameById / sumTotal) are covered by boq-rows.test.ts; this file exercises only the
 * NEW filterArchiveRows logic (project-name-aware free-text search + exact project/status).
 */
import { describe, expect, it } from "vitest";
import type { BoqRow } from "./boq-rows";
import {
  filterArchiveRows,
  toArchiveApproval,
  archiveApprovalById,
  formatApprovedAt,
} from "./boq-archive-rows";

function row(over: Partial<BoqRow>): BoqRow {
  return {
    id: "id",
    no: "BOQ-2026-B-02",
    name: "Block B",
    scope: "B-Type1",
    projectId: "p1",
    version: 3,
    status: "approved",
    currency_code: "THB",
    total: 1000,
    ...over,
  };
}

const names = new Map<string, string>([
  ["p1", "Rachaphruek Park"],
  ["p2", "Bangbuathong"],
]);

describe("filterArchiveRows", () => {
  const rows: BoqRow[] = [
    row({ id: "a", no: "BOQ-2026-B-02", name: "Block B", scope: "townhouse", projectId: "p1", status: "approved" }),
    row({ id: "b", no: "BOQ-2026-C-01", name: "Block C", scope: "townhouse", projectId: "p1", status: "pending" }),
    row({ id: "c", no: "BOQ-2025-X-09", name: "Villa", scope: "detached", projectId: "p2", status: "approved" }),
  ];

  it("returns all rows when every field is empty", () => {
    expect(filterArchiveRows(rows, names, { projectId: "", status: "", q: "" })).toHaveLength(3);
  });

  it("matches the doc no (case-insensitive)", () => {
    const out = filterArchiveRows(rows, names, { projectId: "", status: "", q: "c-01" });
    expect(out.map((r) => r.id)).toEqual(["b"]);
  });

  it("matches the resolved project name (not in BoqRow itself)", () => {
    const out = filterArchiveRows(rows, names, { projectId: "", status: "", q: "bangbua" });
    expect(out.map((r) => r.id)).toEqual(["c"]);
  });

  it("matches the scope/Block", () => {
    const out = filterArchiveRows(rows, names, { projectId: "", status: "", q: "detached" });
    expect(out.map((r) => r.id)).toEqual(["c"]);
  });

  it("applies project as an exact-id filter", () => {
    const out = filterArchiveRows(rows, names, { projectId: "p1", status: "", q: "" });
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("applies status as an exact-code filter", () => {
    const out = filterArchiveRows(rows, names, { projectId: "", status: "approved", q: "" });
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("combines project + status + query (AND semantics)", () => {
    const out = filterArchiveRows(rows, names, { projectId: "p1", status: "approved", q: "block" });
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });

  it("never fabricates a project name for an unmapped project id", () => {
    const orphan = [row({ id: "z", projectId: "missing", no: "N", name: "N", scope: "N" })];
    // A query that would only match a project name must NOT match when the id is unmapped.
    expect(filterArchiveRows(orphan, names, { projectId: "", status: "", q: "rachaphruek" })).toHaveLength(0);
  });
});

/* B-278 — the approver / approve-date columns, narrowed off the real GET /boq payload. */
describe("toArchiveApproval", () => {
  it("narrows the server's snake_case approval fields", () => {
    expect(
      toArchiveApproval({
        id: "d0",
        approved_by: "u-dir",
        approved_by_name: "Wipha Chancharoen",
        approved_at: "2025-10-22T03:15:00.000Z",
      }),
    ).toEqual({
      id: "d0",
      approverName: "Wipha Chancharoen",
      approvedAt: "2025-10-22T03:15:00.000Z",
    });
  });

  it("accepts camelCase for robustness (mirrors toBoqRow)", () => {
    const a = toArchiveApproval({ id: "d0", approvedByName: "Wipha", approvedAt: "2025-10-22T00:00:00Z" });
    expect(a.approverName).toBe("Wipha");
    expect(a.approvedAt).toBe("2025-10-22T00:00:00Z");
  });

  it("reports an unapproved doc as empty, never as a placeholder name", () => {
    expect(toArchiveApproval({ id: "d1", approved_by: null, approved_by_name: null, approved_at: null })).toEqual({
      id: "d1",
      approverName: "",
      approvedAt: "",
    });
  });
});

describe("archiveApprovalById", () => {
  it("keys each served row by its doc id", () => {
    const map = archiveApprovalById([
      { id: "d0", approved_by_name: "Wipha", approved_at: "2025-10-22T00:00:00Z" },
      { id: "d1", approved_by_name: null, approved_at: null },
    ]);
    expect(map.get("d0")?.approverName).toBe("Wipha");
    expect(map.get("d1")?.approverName).toBe("");
  });

  it("skips a row with no id rather than keying it under an empty string", () => {
    expect(archiveApprovalById([{ approved_by_name: "Ghost" }]).size).toBe(0);
  });

  it("tolerates an undefined payload (query not settled)", () => {
    expect(archiveApprovalById(undefined).size).toBe(0);
  });
});

describe("formatApprovedAt", () => {
  it("renders a wire instant as an ISO/UTC calendar date", () => {
    expect(formatApprovedAt("2025-10-22T03:15:00.000Z")).toBe("2025-10-22");
  });

  it("uses UTC, not the runner's local zone", () => {
    // 23:30Z is still the 22nd in UTC even where local time has rolled over.
    expect(formatApprovedAt("2025-10-22T23:30:00.000Z")).toBe("2025-10-22");
  });

  it("returns empty for a missing or unparseable value (the view em-dashes it)", () => {
    expect(formatApprovedAt("")).toBe("");
    expect(formatApprovedAt("not-a-date")).toBe("");
  });
});
