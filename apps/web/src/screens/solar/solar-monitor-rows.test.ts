/*
 * solar-monitor-rows unit tests (gate G3) — the pure SolarMonitoring display logic
 * narrowed from solar.jsx SolarMonitoring. Guards the opaque-row narrowing (inverter +
 * ticket), the live KPI aggregates, the code-based status mapping (both seed + prototype
 * codes), the perf-bar colour thresholds, and the assignee resolver.
 */
import { describe, it, expect } from "vitest";
import {
  toInverterRow,
  toTicketRow,
  totalOutputKw,
  totalCapacityKw,
  kpiOutputMw,
  kpiInstalledMw,
  inverterStatus,
  perfColor,
  toUserRef,
  userNameById,
  type InverterRow,
} from "./solar-monitor-rows";

describe("toInverterRow", () => {
  it("narrows a snake_case wire row (output_kw) to InverterRow", () => {
    expect(
      toInverterRow({
        id: "inv-1",
        project_id: "p1",
        zone: "Array 1",
        kw: "500.000",
        output_kw: "472.00",
        perf: "94",
        temp: "41",
        status: "normal",
        created_at: "2026-07-01T00:00:00Z",
      }),
    ).toEqual({ id: "inv-1", zone: "Array 1", kw: 500, outputKw: 472, perf: 94, status: "normal" });
  });

  it("accepts a camelCase outputKw fallback and defaults absent fields", () => {
    expect(toInverterRow({ id: "x", outputKw: 100 })).toEqual({
      id: "x",
      zone: "",
      kw: 0,
      outputKw: 100,
      perf: 0,
      status: "",
    });
  });

  it("does not leak temp / created_at (not table fields)", () => {
    const r = toInverterRow({ id: "a", temp: "41", created_at: "x" });
    expect(Object.keys(r)).not.toContain("temp");
    expect(Object.keys(r)).not.toContain("createdAt");
  });
});

describe("toTicketRow", () => {
  it("narrows a snake_case wire row (assignee_user_id) to TicketRow", () => {
    expect(
      toTicketRow({
        id: "t1",
        inverter_id: "inv-1",
        no: "OM-2569-001",
        title: "fix inverter",
        priority: "high",
        assignee_user_id: "u9",
        status: "open",
      }),
    ).toEqual({ id: "t1", no: "OM-2569-001", title: "fix inverter", priority: "high", assigneeUserId: "u9", status: "open" });
  });

  it("defaults absent fields (never fabricates)", () => {
    expect(toTicketRow({ id: "y" })).toEqual({ id: "y", no: "", title: "", priority: "", assigneeUserId: "", status: "" });
  });
});

describe("KPI aggregates", () => {
  const rows: InverterRow[] = [
    { id: "1", zone: "A", kw: 500, outputKw: 420, perf: 92, status: "normal" },
    { id: "2", zone: "B", kw: 500, outputKw: 425, perf: 93, status: "normal" },
    { id: "3", zone: "C", kw: 500, outputKw: 430, perf: 94, status: "normal" },
  ];

  it("sums output + capacity across inverters", () => {
    expect(totalOutputKw(rows)).toBe(1275);
    expect(totalCapacityKw(rows)).toBe(1500);
  });

  it("renders current output in MW to 2dp and installed capacity to 0dp", () => {
    // 1275/1000 -> 1.275; JS toFixed(2) rounds the FP-stored 1.275 down to "1.27"
    // (faithful to the prototype's own .toFixed(2), solar.jsx L50 — never re-rounded).
    expect(kpiOutputMw(rows)).toBe("1.27");
    expect(kpiInstalledMw(rows)).toBe("2"); // 1500/1000 -> "2"
  });

  it("is zero-safe for an empty register", () => {
    expect(kpiOutputMw([])).toBe("0.00");
    expect(kpiInstalledMw([])).toBe("0");
  });
});

describe("inverterStatus", () => {
  it("maps both seed + prototype codes to a tone kind + label kind", () => {
    expect(inverterStatus("normal")).toEqual({ kind: "approved", label: "ok" });
    expect(inverterStatus("ok")).toEqual({ kind: "approved", label: "ok" });
    expect(inverterStatus("warn")).toEqual({ kind: "pending", label: "derating" });
    expect(inverterStatus("derating")).toEqual({ kind: "pending", label: "derating" });
    expect(inverterStatus("down")).toEqual({ kind: "rejected", label: "offline" });
    expect(inverterStatus("offline")).toEqual({ kind: "rejected", label: "offline" });
  });

  it("defaults an unknown status to approved/ok (prototype fallback)", () => {
    expect(inverterStatus("anything")).toEqual({ kind: "approved", label: "ok" });
    expect(inverterStatus("")).toEqual({ kind: "approved", label: "ok" });
  });
});

describe("perfColor", () => {
  it("thresholds >=90 ok, >=70 warn, else danger (solar.jsx L75)", () => {
    expect(perfColor(94)).toBe("var(--ok)");
    expect(perfColor(90)).toBe("var(--ok)");
    expect(perfColor(89)).toBe("var(--warn)");
    expect(perfColor(70)).toBe("var(--warn)");
    expect(perfColor(61)).toBe("var(--danger)");
    expect(perfColor(0)).toBe("var(--danger)");
  });
});

describe("assignee resolver", () => {
  it("builds an id -> name map, skipping blank ids", () => {
    const map = userNameById([toUserRef({ id: "u1", name: "Somchai" }), toUserRef({ id: "", name: "skip" })]);
    expect(map.get("u1")).toBe("Somchai");
    expect(map.has("")).toBe(false);
  });

  it("is empty for undefined input", () => {
    expect(userNameById(undefined).size).toBe(0);
  });
});
