/*
 * Unit tests for audit-rows.ts (gate G3) — the thin-row narrowing + the Wei-ruled
 * honest divergences: action->label/icon (known + unknown), opaque entity,
 * absolute-date grouping, UTC HH:mm, and the null-user_name signal.
 */
import { describe, expect, it } from "vitest";
import {
  AUDIT_ACT,
  AUDIT_ACTIONS,
  DASH,
  actionMeta,
  dayKeyOf,
  groupByDay,
  hhmmOf,
  toAuditRow,
  type AuditServerRow,
} from "./audit-rows";

describe("actionMeta", () => {
  it("maps the 6 known actions to their label key + icon", () => {
    expect(actionMeta("create")).toEqual({ labelKey: "audit.actCreate", icon: "plus" });
    expect(actionMeta("edit")).toEqual({ labelKey: "common.edit", icon: "edit" });
    expect(actionMeta("approve")).toEqual({ labelKey: "common.approve", icon: "check" });
    expect(actionMeta("delete")).toEqual({ labelKey: "common.delete", icon: "x" });
    expect(actionMeta("post")).toEqual({ labelKey: "audit.actPost", icon: "ledger" });
    expect(actionMeta("sync")).toEqual({ labelKey: "audit.actSync", icon: "sync" });
  });

  it("falls back to a neutral doc icon + null label for an unknown action", () => {
    expect(actionMeta("teleport")).toEqual({ labelKey: null, icon: "doc" });
  });

  it("exposes the known actions in prototype order", () => {
    expect(AUDIT_ACTIONS).toEqual(["create", "edit", "approve", "delete", "post", "sync"]);
    expect(Object.keys(AUDIT_ACT)).toEqual(AUDIT_ACTIONS);
  });
});

describe("timestamp helpers", () => {
  it("derives an absolute day key (YYYY-MM-DD, UTC)", () => {
    expect(dayKeyOf("2026-07-19T15:10:00.000Z")).toBe("2026-07-19");
  });

  it("derives HH:mm in UTC (deterministic across host TZ)", () => {
    expect(hhmmOf("2026-07-19T15:10:00.000Z")).toBe("15:10");
    expect(hhmmOf("2026-07-19T04:02:00.000Z")).toBe("04:02");
  });

  it("returns DASH for a missing/invalid timestamp — never fabricated", () => {
    expect(dayKeyOf(undefined)).toBe(DASH);
    expect(dayKeyOf("not-a-date")).toBe(DASH);
    expect(hhmmOf(null)).toBe(DASH);
  });
});

describe("toAuditRow", () => {
  const base: AuditServerRow = {
    id: "a1",
    user_id: "u1",
    user_name: "Somchai W.",
    action: "post",
    entity: "AP-2026-0291",
    at: "2026-07-19T14:02:00.000Z",
  };

  it("narrows a thin row, keeping entity opaque + action mapped", () => {
    expect(toAuditRow(base, 0)).toEqual({
      id: "a1",
      userName: "Somchai W.",
      action: "post",
      actionLabelKey: "audit.actPost",
      actionIcon: "ledger",
      entity: "AP-2026-0291",
      time: "14:02",
      dayKey: "2026-07-19",
    });
  });

  it("signals a null user_name so the view falls back (not hardcoded here)", () => {
    const row = toAuditRow({ ...base, user_name: null }, 0);
    expect(row.userName).toBeNull();
  });

  it("renders an unknown action's raw code with a neutral icon", () => {
    const row = toAuditRow({ ...base, action: "teleport" }, 0);
    expect(row.actionLabelKey).toBeNull();
    expect(row.action).toBe("teleport");
    expect(row.actionIcon).toBe("doc");
  });

  it("tolerates missing fields without crashing", () => {
    const row = toAuditRow({}, 3);
    expect(row.id).toBe("3");
    expect(row.userName).toBeNull();
    expect(row.entity).toBe("");
    expect(row.time).toBe(DASH);
    expect(row.dayKey).toBe(DASH);
  });
});

describe("groupByDay", () => {
  it("buckets rows by absolute day, preserving server order", () => {
    const rows = [
      toAuditRow({ id: "1", action: "edit", at: "2026-07-19T15:10:00.000Z" }, 0),
      toAuditRow({ id: "2", action: "post", at: "2026-07-19T14:02:00.000Z" }, 1),
      toAuditRow({ id: "3", action: "sync", at: "2026-07-17T17:45:00.000Z" }, 2),
    ];
    const groups = groupByDay(rows);
    expect(groups.map((g) => g.day)).toEqual(["2026-07-19", "2026-07-17"]);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["1", "2"]);
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(["3"]);
  });
});
