/*
 * cc-rows unit tests (P1-WEB-11, gate G3) — the pure cost-center logic ported from
 * master.jsx MasterCC + the ds.jsx STATUS map (toCostCenterRow / typeBadgeTone /
 * statusTone / formatMoney). Guards the opaque-row narrowing defaults, the FULL-baht
 * comma grouping (no ×1e6 scaling, no baht symbol), and the type/status tone mapping
 * against regression.
 */
import { describe, it, expect } from "vitest";
import {
  toCostCenterRow,
  typeBadgeTone,
  statusTone,
  formatMoney,
  type CostCenterRow,
} from "./cc-rows";

describe("toCostCenterRow", () => {
  it("narrows a full opaque /cost-centers row to the row shape", () => {
    expect(
      toCostCenterRow({
        id: "cc1",
        code: "CC-CONS-RJP-01",
        name: "โครงการ ราชพฤกษ์ เฟส 1",
        type: "Project",
        link: "เฟส 1 / Block A",
        owner: "สมชาย",
        budget: 84_400_000,
        currency_code: "THB",
        status: "approved",
        extra: "ignored",
      }),
    ).toEqual({
      id: "cc1",
      code: "CC-CONS-RJP-01",
      name: "โครงการ ราชพฤกษ์ เฟส 1",
      type: "Project",
      link: "เฟส 1 / Block A",
      owner: "สมชาย",
      budget: 84_400_000,
      currency_code: "THB",
      status: "approved",
    });
  });

  it("defaults missing fields (numbers -> 0, strings -> \"\")", () => {
    expect(toCostCenterRow({})).toEqual({
      id: "",
      code: "",
      name: "",
      type: "",
      link: "",
      owner: "",
      budget: 0,
      currency_code: "",
      status: "",
    });
  });

  it("accepts a camelCase currency field as a fallback", () => {
    expect(toCostCenterRow({ currencyCode: "THB" }).currency_code).toBe("THB");
  });

  it("coerces a numeric-string budget and drops invalid ones to 0", () => {
    expect(toCostCenterRow({ budget: "1200000" }).budget).toBe(1_200_000);
    expect(toCostCenterRow({ budget: "x" }).budget).toBe(0);
  });
});

describe("typeBadgeTone", () => {
  it("maps Project -> brand, Overhead -> warn, Dept/other -> surface-3", () => {
    expect(typeBadgeTone("Project")).toEqual({ bg: "var(--brand-soft)", fg: "var(--brand)" });
    expect(typeBadgeTone("Overhead")).toEqual({ bg: "var(--warn-soft)", fg: "var(--warn)" });
    expect(typeBadgeTone("Dept")).toEqual({ bg: "var(--surface-3)", fg: "var(--text-2)" });
    expect(typeBadgeTone("")).toEqual({ bg: "var(--surface-3)", fg: "var(--text-2)" });
  });
});

describe("statusTone", () => {
  it("maps approved -> ok, and any other status -> the draft fallback", () => {
    expect(statusTone("approved")).toEqual({
      bg: "var(--ok-soft)",
      fg: "var(--ok)",
      dot: "#16A34A",
    });
    expect(statusTone("draft")).toEqual({
      bg: "var(--draft-soft)",
      fg: "var(--draft)",
      dot: "#94A3B8",
    });
    expect(statusTone("pending")).toEqual({
      bg: "var(--draft-soft)",
      fg: "var(--draft)",
      dot: "#94A3B8",
    });
  });
});

describe("formatMoney", () => {
  it("comma-groups a FULL-baht amount with no decimals / baht symbol", () => {
    expect(formatMoney(1_000_000)).toBe("1,000,000");
    expect(formatMoney(84_400_000)).toBe("84,400,000");
    expect(formatMoney(800_000)).toBe("800,000");
    expect(formatMoney(0)).toBe("0");
  });

  it("rounds fractional input and keeps a leading minus", () => {
    expect(formatMoney(1_234.6)).toBe("1,235");
    expect(formatMoney(-1_000_000)).toBe("-1,000,000");
  });

  it("returns \"0\" for non-finite input (guarded boundary)", () => {
    expect(formatMoney(Number.NaN)).toBe("0");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

// Compile-time: CostCenterRow is the exported shape the table consumes.
const _sample: CostCenterRow = {
  id: "cc",
  code: "CC-FIN",
  name: "",
  type: "Dept",
  link: "—",
  owner: "",
  budget: 0,
  currency_code: "THB",
  status: "draft",
};
void _sample;
