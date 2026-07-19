/*
 * pm-rows unit tests (gate G3) — the pure PM Asset-Registry logic ported from
 * pototype/pm.jsx PMAssets (toAssetRow / distinctKinds / filterAssets). Guards the
 * opaque-row narrowing (snake_case + camelCase), the distinct-kind extraction, and
 * the search (id/kind/site) + kind filter against regression. ASCII-only test data
 * (B-073) — no Thai lives in source.
 */
import { describe, it, expect } from "vitest";
import {
  toAssetRow,
  distinctKinds,
  filterAssets,
  type AssetRow,
} from "./pm-rows";

const row = (p: Partial<AssetRow> = {}): AssetRow => ({
  id: "LIFT-A01",
  contractId: "c-1",
  kind: "lift",
  site: "Tower A",
  cycle: "monthly",
  nextDue: "2026-08-01",
  ...p,
});

describe("toAssetRow", () => {
  it("maps the snake_case wire fields", () => {
    expect(
      toAssetRow({
        id: "PUMP-01",
        contract_id: "c-9",
        kind: "pump",
        site: "B1",
        cycle: "quarterly",
        next_due: "2026-09-05",
      }),
    ).toEqual({
      id: "PUMP-01",
      contractId: "c-9",
      kind: "pump",
      site: "B1",
      cycle: "quarterly",
      nextDue: "2026-09-05",
    });
  });

  it("accepts camelCase aliases for multi-word fields", () => {
    const r = toAssetRow({ id: "GEN-01", contractId: "c-2", nextDue: "2026-07-10" });
    expect(r.contractId).toBe("c-2");
    expect(r.nextDue).toBe("2026-07-10");
  });

  it("defaults missing fields to empty strings (never undefined)", () => {
    expect(toAssetRow({})).toEqual({
      id: "",
      contractId: "",
      kind: "",
      site: "",
      cycle: "",
      nextDue: "",
    });
  });
});

describe("distinctKinds", () => {
  it("returns unique kinds in first-seen order", () => {
    const rows = [
      row({ kind: "lift" }),
      row({ kind: "pump" }),
      row({ kind: "lift" }),
      row({ kind: "genset" }),
    ];
    expect(distinctKinds(rows)).toEqual(["lift", "pump", "genset"]);
  });

  it("drops blank kinds", () => {
    const rows = [row({ kind: "" }), row({ kind: "pump" }), row({ kind: "" })];
    expect(distinctKinds(rows)).toEqual(["pump"]);
  });

  it("returns an empty array for an empty list", () => {
    expect(distinctKinds([])).toEqual([]);
  });
});

describe("filterAssets", () => {
  const rows = [
    row({ id: "LIFT-A01", kind: "lift", site: "Tower A" }),
    row({ id: "PUMP-01", kind: "pump", site: "Basement B1" }),
    row({ id: "GEN-01", kind: "genset", site: "Yard" }),
  ];

  it("returns every row for an empty query + kind", () => {
    expect(filterAssets(rows, "", "")).toHaveLength(3);
  });

  it("matches the query against id (case-insensitive)", () => {
    const out = filterAssets(rows, "pump-01", "");
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("PUMP-01");
  });

  it("matches the query against kind and site", () => {
    expect(filterAssets(rows, "genset", "")).toHaveLength(1);
    expect(filterAssets(rows, "basement", "")).toHaveLength(1);
  });

  it("restricts to an exact kind when the kind filter is set", () => {
    const out = filterAssets(rows, "", "lift");
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("lift");
  });

  it("combines query and kind (both must pass)", () => {
    expect(filterAssets(rows, "tower", "lift")).toHaveLength(1);
    expect(filterAssets(rows, "tower", "pump")).toHaveLength(0);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterAssets(rows, "zzz", "")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    filterAssets(input, "pump", "pump");
    expect(input).toHaveLength(3);
  });
});
