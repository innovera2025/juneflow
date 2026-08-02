/*
 * Unit tests for issue-rows.ts (gate G3) — the pure Material-Issue narrowing:
 * opaque /inventory/issues rows (snake_case, server-resolved project_name,
 * unresolved from_warehouse_id + by_user_id, numeric value, DATE-only issue_date).
 */
import { describe, it, expect } from "vitest";
import { toIssueRow, type IssueRow } from "./issue-rows";

const wire = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  no: "IS-2026-0218",
  project_id: "p1",
  project_name: "Phase 2 B-12",
  from_warehouse_id: "w2",
  value: 24000,
  currency_code: "THB",
  issue_date: "2026-05-25",
  by_user_id: "u1",
  status: "approved",
  ...over,
});

describe("toIssueRow", () => {
  it("narrows the issueWire shape", () => {
    expect(toIssueRow(wire())).toEqual<IssueRow>({
      id: "s1",
      no: "IS-2026-0218",
      projectId: "p1",
      projectName: "Phase 2 B-12",
      fromWarehouseId: "w2",
      value: 24000,
      currencyCode: "THB",
      issueDate: "2026-05-25",
      byUserId: "u1",
      status: "approved",
    });
  });

  it("keeps an unresolved project name empty (view renders em-dash)", () => {
    expect(toIssueRow(wire({ project_name: null })).projectName).toBe("");
  });

  it("defaults missing fields", () => {
    const r = toIssueRow({});
    expect(r.no).toBe("");
    expect(r.value).toBe(0);
    expect(r.fromWarehouseId).toBe("");
    expect(r.status).toBe("");
  });
});
