/*
 * Unit tests for boq-approval-agg (P2-WEB-06, gate G3). Cover the queue-shaping
 * (pending filter, selection fallback) + the version arithmetic that is the only
 * per-doc figure derivable from the /boq wire.
 */
import { describe, expect, it } from "vitest";
import {
  isFirstEdition,
  pendingDocs,
  prevVersionLabel,
  selectedDoc,
  toBoqRows,
  versionTransition,
  type BoqRow,
} from "./boq-approval-agg";

/** Build a BoqRow with sensible defaults for the field under test. */
function row(over: Partial<BoqRow>): BoqRow {
  return {
    id: over.id ?? "id-" + (over.no ?? "x"),
    no: over.no ?? "BOQ-2026-A-01",
    name: over.name ?? "Block A",
    scope: over.scope ?? "",
    projectId: over.projectId ?? "p1",
    version: over.version ?? 1,
    status: over.status ?? "draft",
    currency_code: over.currency_code ?? "THB",
    total: over.total ?? 0,
  };
}

describe("toBoqRows", () => {
  it("narrows opaque /boq rows (snake_case) to BoqRow", () => {
    const rows = toBoqRows([
      { id: "d1", no: "BOQ-1", name: "N", project_id: "p9", version: 3, status: "pending", total: 100 },
    ]);
    expect(rows[0]).toMatchObject({ id: "d1", no: "BOQ-1", projectId: "p9", version: 3, status: "pending", total: 100 });
  });
});

describe("pendingDocs", () => {
  it("keeps only status=pending, in server order", () => {
    const rows = [
      row({ no: "A", status: "draft" }),
      row({ no: "B", status: "pending" }),
      row({ no: "C", status: "approved" }),
      row({ no: "D", status: "pending" }),
      row({ no: "E", status: "revise" }),
    ];
    expect(pendingDocs(rows).map((d) => d.no)).toEqual(["B", "D"]);
  });

  it("returns an empty queue when nothing is pending", () => {
    expect(pendingDocs([row({ status: "draft" }), row({ status: "approved" })])).toEqual([]);
  });
});

describe("selectedDoc", () => {
  const docs = [row({ no: "B" }), row({ no: "D" })];
  it("resolves the doc by no", () => {
    expect(selectedDoc(docs, "D")?.no).toBe("D");
  });
  it("falls back to the first doc when no is unknown", () => {
    expect(selectedDoc(docs, "ZZZ")?.no).toBe("B");
  });
  it("is undefined for an empty queue", () => {
    expect(selectedDoc([], "B")).toBeUndefined();
  });
});

describe("isFirstEdition / prevVersionLabel", () => {
  it("treats version <= 1 as first edition (no prior version)", () => {
    expect(isFirstEdition(1)).toBe(true);
    expect(isFirstEdition(0)).toBe(true);
    expect(isFirstEdition(2)).toBe(false);
    expect(prevVersionLabel(1)).toBe("");
    expect(prevVersionLabel(0)).toBe("");
  });
  it("labels the prior version for a revise", () => {
    expect(prevVersionLabel(4)).toBe("v3");
    expect(prevVersionLabel(2)).toBe("v1");
  });
});

describe("versionTransition", () => {
  it("renders v{n-1} -> v{n} for a revise (arrow is U+2192)", () => {
    expect(versionTransition(4)).toBe("v3 → v4");
    expect(versionTransition(2)).toBe("v1 → v2");
  });
  it("collapses to the single current label for a first edition", () => {
    expect(versionTransition(1)).toBe("v1");
    expect(versionTransition(0)).toBe("v1");
  });
});
