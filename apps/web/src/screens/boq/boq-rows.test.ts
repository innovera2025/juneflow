/*
 * Unit tests for boq-rows.ts (P2-WEB-02, gate G3) — the pure BOQ-list helpers that back
 * BOQList. Covers the opaque-row narrowing, the ds.jsx STATUS tone/label mapping, the
 * money/version/millions formatting, the toolbar filter + KPI aggregates, the create-form
 * cascade helpers (hierarchy names, scope compose, next-no), and the project name map.
 */
import { describe, it, expect } from "vitest";
import {
  toBoqRow,
  statusTone,
  statusStringName,
  versionLabel,
  formatMoney,
  millionsValue,
  filterBoqRows,
  sumTotal,
  countByStatuses,
  projectNameById,
  hierarchyNames,
  composeScope,
  nextBoqNo,
  type BoqRow,
} from "./boq-rows";

const row = (over: Partial<BoqRow> = {}): BoqRow => ({
  id: "b1",
  no: "BOQ-2026-001",
  name: "Block B",
  scope: "B-Type1",
  projectId: "p1",
  version: 1,
  status: "draft",
  currency_code: "THB",
  total: 0,
  ...over,
});

describe("toBoqRow", () => {
  it("narrows the docWire shape (snake_case project_id/currency_code)", () => {
    const r = toBoqRow({
      id: "b1",
      no: "BOQ-2026-B-02",
      name: "Townhome B",
      scope: "B-Type1 · 84",
      project_id: "p9",
      version: 3,
      status: "approved",
      currency_code: "THB",
      total: 12_400_000,
    });
    expect(r).toEqual({
      id: "b1",
      no: "BOQ-2026-B-02",
      name: "Townhome B",
      scope: "B-Type1 · 84",
      projectId: "p9",
      version: 3,
      status: "approved",
      currency_code: "THB",
      total: 12_400_000,
    });
  });

  it("accepts camelCase fallbacks and defaults missing fields", () => {
    const r = toBoqRow({ id: "b2", projectId: "p2", currencyCode: "USD" });
    expect(r.projectId).toBe("p2");
    expect(r.currency_code).toBe("USD");
    expect(r.no).toBe("");
    expect(r.version).toBe(0);
    expect(r.total).toBe(0);
  });

  it("coerces numeric strings for version/total", () => {
    const r = toBoqRow({ version: "4", total: "642000" });
    expect(r.version).toBe(4);
    expect(r.total).toBe(642000);
  });
});

describe("statusTone", () => {
  it("maps each known status to its ds.jsx STATUS tone", () => {
    expect(statusTone("approved")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" });
    expect(statusTone("pending")).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" });
    expect(statusTone("revise")).toEqual({ bg: "var(--info-soft)", fg: "var(--info)", dot: "#1D4ED8" });
    expect(statusTone("draft")).toEqual({ bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" });
  });

  it("falls back to the draft tone for unknown statuses", () => {
    expect(statusTone("weird")).toEqual(statusTone("draft"));
  });
});

describe("statusStringName", () => {
  it("maps status to its boq-strings.json phrase key name", () => {
    expect(statusStringName("approved")).toBe("statusApproved");
    expect(statusStringName("pending")).toBe("statusPending");
    expect(statusStringName("revise")).toBe("statusRevise");
    expect(statusStringName("draft")).toBe("statusDraft");
    expect(statusStringName("anything")).toBe("statusDraft");
  });
});

describe("versionLabel", () => {
  it("prefixes with v and clamps non-positive to 1", () => {
    expect(versionLabel(3)).toBe("v3");
    expect(versionLabel(1)).toBe("v1");
    expect(versionLabel(0)).toBe("v1");
  });
});

describe("formatMoney", () => {
  it("groups thousands with no decimals or symbol", () => {
    expect(formatMoney(12_400_000)).toBe("12,400,000");
    expect(formatMoney(642_000)).toBe("642,000");
    expect(formatMoney(0)).toBe("0");
  });

  it("rounds and handles non-finite", () => {
    expect(formatMoney(1234.6)).toBe("1,235");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("millionsValue", () => {
  it("divides by 1e6 to two decimals", () => {
    expect(millionsValue(12_400_000)).toBe("12.40");
    expect(millionsValue(0)).toBe("0.00");
  });
});

describe("filterBoqRows", () => {
  const rows = [
    row({ id: "1", no: "BOQ-2026-B-02", name: "Townhome B", scope: "B-Type1", projectId: "p1", status: "approved" }),
    row({ id: "2", no: "BOQ-2026-C-01", name: "Townhome C", scope: "C-Type1", projectId: "p1", status: "pending" }),
    row({ id: "3", no: "BOQ-2026-A-01", name: "Detached A", scope: "A-Type1", projectId: "p2", status: "approved" }),
  ];

  it("filters by project id", () => {
    expect(filterBoqRows(rows, { projectId: "p2", status: "", q: "" }).map((r) => r.id)).toEqual(["3"]);
  });

  it("filters by status", () => {
    expect(filterBoqRows(rows, { projectId: "", status: "approved", q: "" }).map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("searches no + name + scope, case-insensitive", () => {
    expect(filterBoqRows(rows, { projectId: "", status: "", q: "c-01" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterBoqRows(rows, { projectId: "", status: "", q: "detached" }).map((r) => r.id)).toEqual(["3"]);
  });

  it("returns all rows when every field is blank", () => {
    expect(filterBoqRows(rows, { projectId: "", status: "", q: "  " })).toHaveLength(3);
  });
});

describe("sumTotal / countByStatuses", () => {
  const rows = [
    row({ total: 100, status: "approved" }),
    row({ total: 50, status: "draft" }),
    row({ total: 25, status: "revise" }),
    row({ total: 0, status: "pending" }),
  ];

  it("sums totals", () => {
    expect(sumTotal(rows)).toBe(175);
  });

  it("counts docs across a status set", () => {
    expect(countByStatuses(rows, ["approved"])).toBe(1);
    expect(countByStatuses(rows, ["draft", "pending", "revise"])).toBe(3);
  });
});

describe("projectNameById", () => {
  it("indexes projects by id, skipping empty ids", () => {
    const m = projectNameById([
      { id: "p1", name: "Rachaphruek" },
      { id: "", name: "ghost" },
    ]);
    expect(m.get("p1")).toBe("Rachaphruek");
    expect(m.has("")).toBe(false);
  });

  it("tolerates undefined input", () => {
    expect(projectNameById(undefined).size).toBe(0);
  });
});

describe("hierarchyNames", () => {
  const nodes = [
    { kind: "phase", name: "Phase 2" },
    { kind: "block", name: "Block B" },
    { kind: "block", name: "Block B" },
    { kind: "block", name: "Block C" },
    { kind: "unit", name: "B-Type1" },
  ];

  it("returns distinct names of one kind in order", () => {
    expect(hierarchyNames(nodes, "block")).toEqual(["Block B", "Block C"]);
    expect(hierarchyNames(nodes, "phase")).toEqual(["Phase 2"]);
  });

  it("returns [] when the kind is absent", () => {
    expect(hierarchyNames(nodes, "floor")).toEqual([]);
  });
});

describe("composeScope", () => {
  it("emits '{block} · {total}' when the whole block is selected", () => {
    expect(composeScope("Block B", "ALL", "ALL", "total")).toBe("Block B · total");
  });

  it("emits the unit itself otherwise", () => {
    expect(composeScope("Block B", "B-Type1", "ALL", "total")).toBe("B-Type1");
  });
});

describe("nextBoqNo", () => {
  it("suggests the next running number for the year", () => {
    expect(nextBoqNo(["BOQ-2026-001", "BOQ-2026-002"], 2026)).toBe("BOQ-2026-003");
  });

  it("ignores non-running codes when counting", () => {
    expect(nextBoqNo(["BOQ-2026-B-02", "BOQ-2026-C-01"], 2026)).toBe("BOQ-2026-001");
  });

  it("skips collisions (count-then-increment, like BOQStore.nextNo)", () => {
    // 2 running codes -> starts at 003; 003 is taken -> increments to 004.
    expect(nextBoqNo(["BOQ-2026-001", "BOQ-2026-003"], 2026)).toBe("BOQ-2026-004");
    expect(nextBoqNo(["BOQ-2026-001", "BOQ-2026-002", "BOQ-2026-003"], 2026)).toBe("BOQ-2026-004");
  });
});
