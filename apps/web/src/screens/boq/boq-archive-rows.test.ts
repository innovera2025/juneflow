/*
 * Unit tests for boq-archive-rows.ts (P2-WEB-07, gate G3) — the archive-specific search.
 * The reused boq-rows helpers (toBoqRow / statusTone / versionLabel / formatMoney /
 * projectNameById / sumTotal) are covered by boq-rows.test.ts; this file exercises only the
 * NEW filterArchiveRows logic (project-name-aware free-text search + exact project/status).
 */
import { describe, expect, it } from "vitest";
import type { BoqRow } from "./boq-rows";
import { filterArchiveRows } from "./boq-archive-rows";

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
