/*
 * Unit tests for dms-rows.ts (B-221, gate G3) — the pure DMS-list helpers that back
 * DMSCenter. Covers the opaque-row narrowing (resolved names, defaults), the seven
 * category metadata + lookup, the status tone/label mapping (active/review/
 * expiring), the category+query filter, the category/status counts, and the
 * created_at formatting.
 */
import { describe, it, expect } from "vitest";
import {
  toDmsRow,
  DMS_CATS,
  catById,
  statusTone,
  statusLabelKind,
  filterDocs,
  catCount,
  countByStatus,
  formatDocDate,
  type DmsRow,
} from "./dms-rows";

const row = (over: Partial<DmsRow> = {}): DmsRow => ({
  id: "d1",
  name: "a.pdf",
  cat: "contract",
  proj: "",
  ver: 1,
  by: "",
  size: "1.0 MB",
  status: "active",
  expiry: "",
  link: "",
  url: "",
  date: "",
  ...over,
});

describe("toDmsRow", () => {
  it("narrows the wire shape (resolved project_name/by, snake_case link_module/at)", () => {
    expect(
      toDmsRow({
        id: "d9",
        name: "contract.pdf",
        cat: "contract",
        project_name: "Ratchaphruek Project",
        version: 3,
        by: "Teerapong",
        size: "2.4 MB",
        status: "active",
        expiry: null,
        link_module: "subcon.contracts",
        url: "r2://documents/doc-1.pdf",
        at: "2026-08-03T10:00:00.000Z",
      }),
    ).toEqual({
      id: "d9",
      name: "contract.pdf",
      cat: "contract",
      proj: "Ratchaphruek Project",
      ver: 3,
      by: "Teerapong",
      size: "2.4 MB",
      status: "active",
      expiry: "",
      link: "subcon.contracts",
      url: "r2://documents/doc-1.pdf",
      date: "2026-08-03T10:00:00.000Z",
    });
  });

  it("resolves nulls to empty strings (uploader/project em-dash on read) and defaults", () => {
    const r = toDmsRow({ id: "d2", name: "x.zip", cat: "photo", project_name: null, by: null });
    expect(r.proj).toBe("");
    expect(r.by).toBe("");
    expect(r.ver).toBe(0);
    expect(r.link).toBe("");
    expect(r.date).toBe("");
  });

  it("coerces a string version to a number", () => {
    expect(toDmsRow({ id: "d3", version: "5" }).ver).toBe(5);
  });
});

describe("DMS_CATS + catById", () => {
  it("carries the seven prototype categories in order with verbatim colors", () => {
    expect(DMS_CATS.map((c) => c.id)).toEqual([
      "contract",
      "drawing",
      "permit",
      "finance",
      "land",
      "photo",
      "defect",
    ]);
    expect(DMS_CATS.map((c) => c.color)).toEqual([
      "#0B2A4A",
      "#1D4ED8",
      "#B45309",
      "#0F766E",
      "#6D28D9",
      "#B91C1C",
      "#B4453C",
    ]);
  });

  it("resolves a category by id and returns undefined for an unknown id", () => {
    expect(catById("finance")?.icon).toBe("ledger");
    expect(catById("nope")).toBeUndefined();
  });
});

describe("statusTone + statusLabelKind", () => {
  it("active maps to the approved (green) tone", () => {
    expect(statusTone("active")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" });
    expect(statusLabelKind("active")).toBe("active");
  });
  it("review maps to the pending (amber) tone", () => {
    expect(statusTone("review")).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" });
    expect(statusLabelKind("review")).toBe("review");
  });
  it("expiring maps to the rejected (red) tone", () => {
    expect(statusTone("expiring")).toEqual({
      bg: "var(--danger-soft)",
      fg: "var(--danger)",
      dot: "#DC2626",
    });
    expect(statusLabelKind("expiring")).toBe("expiring");
  });
  it("an unknown status falls back to active (approved)", () => {
    expect(statusTone("weird")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" });
    expect(statusLabelKind("weird")).toBe("active");
  });
});

describe("filterDocs", () => {
  const rows = [
    row({ id: "a", cat: "contract", name: "Subcontract WO-012", proj: "Ratchaphruek" }),
    row({ id: "b", cat: "drawing", name: "Block B drawing", proj: "Ratchaphruek" }),
    row({ id: "c", cat: "permit", name: "Building permit", proj: "Bangbuathong" }),
  ];

  it("returns all rows for no category and no query", () => {
    expect(filterDocs(rows, "", "  ")).toHaveLength(3);
  });
  it("filters by category", () => {
    expect(filterDocs(rows, "drawing", "").map((r) => r.id)).toEqual(["b"]);
  });
  it("matches the query over name+proj (case-insensitive)", () => {
    expect(filterDocs(rows, "", "BLOCK").map((r) => r.id)).toEqual(["b"]);
    expect(filterDocs(rows, "", "bangbuathong").map((r) => r.id)).toEqual(["c"]);
  });
  it("applies category and query together", () => {
    expect(filterDocs(rows, "contract", "ratchaphruek").map((r) => r.id)).toEqual(["a"]);
    expect(filterDocs(rows, "contract", "bangbuathong")).toEqual([]);
  });
});

describe("catCount + countByStatus", () => {
  const rows = [
    row({ cat: "contract", status: "active" }),
    row({ cat: "contract", status: "review" }),
    row({ cat: "permit", status: "expiring" }),
    row({ cat: "defect", status: "review" }),
  ];
  it("counts docs per category", () => {
    expect(catCount(rows, "contract")).toBe(2);
    expect(catCount(rows, "permit")).toBe(1);
    expect(catCount(rows, "land")).toBe(0);
  });
  it("counts docs per status (KPI aggregates)", () => {
    expect(countByStatus(rows, "review")).toBe(2);
    expect(countByStatus(rows, "expiring")).toBe(1);
    expect(countByStatus(rows, "active")).toBe(1);
  });
});

describe("formatDocDate", () => {
  it("takes the ISO calendar part of a timestamp", () => {
    expect(formatDocDate("2026-08-03T10:00:00.000Z")).toBe("2026-08-03");
  });
  it("passes a plain ISO date through", () => {
    expect(formatDocDate("2026-08-15")).toBe("2026-08-15");
  });
  it("returns empty for a missing or unparseable value", () => {
    expect(formatDocDate("")).toBe("");
    expect(formatDocDate("not-a-date")).toBe("");
  });
});
