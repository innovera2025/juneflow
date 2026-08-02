/*
 * Unit tests for accept-rows.ts (gate G3) — the pure narrowing/derivation behind
 * AcceptanceCenter (route `accept`, read-only). Exercises the heterogeneous per-feed
 * field mapping, the rejected derivation, the free-text filter, the defect join, and
 * the money formatter.
 */
import { describe, expect, it } from "vitest";
import {
  toAcceptRow,
  isRejected,
  rejectedCount,
  filterByQuery,
  defectText,
  formatMoney,
  type AcceptRow,
} from "./accept-rows";

describe("toAcceptRow", () => {
  it("maps a period (subcon) row: title is the doc number, amount is money", () => {
    const r = toAcceptRow(
      {
        id: "p1",
        title: "WO-2569-012",
        project_name: "Rajapruek",
        amount: 420000,
        currency_code: "THB",
        owner: null,
        status: "inspecting",
        defect: null,
      },
      "subcon",
    );
    expect(r).toMatchObject({
      id: "p1",
      kind: "subcon",
      doc: "WO-2569-012",
      descr: "",
      project: "Rajapruek",
      value: 420000,
      hasValue: true,
      owner: "",
      status: "inspecting",
      defect: [],
    });
  });

  it("maps a house (handover) row: doc number from title, money from amount", () => {
    const r = toAcceptRow(
      { id: "h1", title: "SC-2026-0007", project_name: "Bangbuathong", amount: 3850000, status: "delivered" },
      "handover",
    );
    expect(r.kind).toBe("handover");
    expect(r.doc).toBe("SC-2026-0007");
    expect(r.hasValue).toBe(true);
    expect(r.value).toBe(3850000);
    expect(r.owner).toBe("");
  });

  it("maps a pm row: NO doc number, title becomes the descriptive line, owner is the tech", () => {
    const r = toAcceptRow(
      { id: "pm1", type: "pm", title: "Fire pump · pump", owner: "Wirat", project_name: "Rajapruek" },
      "pm",
    );
    expect(r.doc).toBe("");
    expect(r.descr).toBe("Fire pump · pump");
    expect(r.owner).toBe("Wirat");
    expect(r.hasValue).toBe(false);
    expect(r.value).toBe(0);
  });

  it("maps a gr row: doc number from title, no money, keeps status", () => {
    const r = toAcceptRow(
      { id: "g1", type: "gr", title: "GR-2569-0448", received: 100, rejected: 8, status: "received", project_name: "Bangbuathong" },
      "gr",
    );
    expect(r.doc).toBe("GR-2569-0448");
    expect(r.hasValue).toBe(false);
    expect(r.value).toBe(0);
    expect(r.status).toBe("received");
  });

  it("reads defect items when present (rejected period row)", () => {
    const r = toAcceptRow({ id: "p2", title: "WO-2026-0055", status: "rejected", defect: ["wavy wall", "rough frame"] }, "subcon");
    expect(r.defect).toEqual(["wavy wall", "rough frame"]);
  });

  it("defaults missing/absent fields (never throws on a sparse row)", () => {
    const r = toAcceptRow({}, "subcon");
    expect(r).toMatchObject({ id: "", doc: "", descr: "", project: "", value: 0, owner: "", status: "", defect: [] });
  });

  it("accepts camelCase project name for robustness", () => {
    const r = toAcceptRow({ id: "p3", title: "X", projectName: "CamelProj" }, "subcon");
    expect(r.project).toBe("CamelProj");
  });
});

describe("isRejected / rejectedCount", () => {
  const mk = (kind: AcceptRow["kind"], status = ""): AcceptRow =>
    toAcceptRow({ id: kind + status, title: "D", status }, kind);

  it("every gr row is in the return/defect queue", () => {
    expect(isRejected(mk("gr", "received"))).toBe(true);
  });

  it("a subcon row is rejected only when its status is 'rejected'", () => {
    expect(isRejected(mk("subcon", "rejected"))).toBe(true);
    expect(isRejected(mk("subcon", "inspecting"))).toBe(false);
    expect(isRejected(mk("subcon", "delivered"))).toBe(false);
  });

  it("pm and handover rows are never rejected", () => {
    expect(isRejected(mk("pm"))).toBe(false);
    expect(isRejected(mk("handover", "rejected"))).toBe(false);
  });

  it("counts rejected rows across a mixed set (subcon-rejected + every gr)", () => {
    const rows = [
      mk("subcon", "rejected"),
      mk("subcon", "delivered"),
      mk("gr", "received"),
      mk("gr", "received"),
      mk("pm"),
      mk("handover", "delivered"),
    ];
    expect(rejectedCount(rows)).toBe(3);
  });
});

describe("filterByQuery", () => {
  const rows: AcceptRow[] = [
    toAcceptRow({ id: "a", title: "WO-100", project_name: "Rajapruek" }, "subcon"),
    toAcceptRow({ id: "b", title: "Elevator · pm", owner: "Somphong", project_name: "Rajapruek" }, "pm"),
    toAcceptRow({ id: "c", title: "GR-9", project_name: "Bangbuathong" }, "gr"),
  ];

  it("returns all rows for an empty/whitespace query", () => {
    expect(filterByQuery(rows, "")).toHaveLength(3);
    expect(filterByQuery(rows, "   ")).toHaveLength(3);
  });

  it("matches on the doc number (case-insensitive)", () => {
    expect(filterByQuery(rows, "wo-100").map((r) => r.id)).toEqual(["a"]);
  });

  it("matches on the pm descriptive line and owner", () => {
    expect(filterByQuery(rows, "elevator").map((r) => r.id)).toEqual(["b"]);
    expect(filterByQuery(rows, "somphong").map((r) => r.id)).toEqual(["b"]);
  });

  it("matches on the project name", () => {
    expect(filterByQuery(rows, "bangbua").map((r) => r.id)).toEqual(["c"]);
  });
});

describe("defectText", () => {
  it("joins defect items and is empty when there are none", () => {
    expect(defectText(toAcceptRow({ id: "d", defect: ["a", "b"] }, "subcon"))).toBe("a, b");
    expect(defectText(toAcceptRow({ id: "e" }, "gr"))).toBe("");
  });
});

describe("formatMoney", () => {
  it("groups thousands, handles zero, negatives, and non-finite", () => {
    expect(formatMoney(420000)).toBe("420,000");
    expect(formatMoney(0)).toBe("0");
    expect(formatMoney(-1234567)).toBe("-1,234,567");
    expect(formatMoney(Number.NaN)).toBe("0");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("0");
  });
});
