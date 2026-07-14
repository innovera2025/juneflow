/*
 * role-matrix unit tests (P1-WEB-14, gate G3) — the pure permission-matrix / role
 * logic ported from master.jsx UsersPermissions / RoleAddForm. Guards the 11×5
 * pad/clamp, the serialise round-trip, togglePerm immutability, the tri-state
 * auth-limit discriminator (the seed Director's unlimited case), and the real
 * member count (the mock `c` is forbidden) against regression.
 */
import { describe, it, expect } from "vitest";
import {
  MODULE_COUNT,
  PERM_COUNT,
  MODULE_LABELS,
  PERMISSION_MATRIX_LABEL,
  buildPermMatrix,
  serializePermMatrix,
  togglePerm,
  approvalLevelLabel,
  formatMoney,
  formatAuthLimit,
  toRole,
  countMembersByRole,
  type Role,
} from "./role-matrix";

describe("constants", () => {
  it("is an 11×5 matrix with the prototype's module labels", () => {
    expect(MODULE_COUNT).toBe(11);
    expect(PERM_COUNT).toBe(5);
    expect(MODULE_LABELS).toHaveLength(11);
    expect(MODULE_LABELS[0]).toBe("Dashboard");
    expect(MODULE_LABELS[10]).toBe("Master");
    expect(PERMISSION_MATRIX_LABEL).toBe("Permission Matrix");
  });
});

describe("buildPermMatrix", () => {
  it("pads a short/empty input to an 11×5 zero matrix", () => {
    const m = buildPermMatrix([]);
    expect(m).toHaveLength(11);
    expect(m.every((row) => row.length === 5)).toBe(true);
    expect(m.every((row) => row.every((c) => c === 0))).toBe(true);
  });

  it("normalises truthy cells to 1 and keeps position", () => {
    const m = buildPermMatrix([[1, 0, 1, 0, 0]]);
    expect(m[0]).toEqual([1, 0, 1, 0, 0]);
    expect(m[1]).toEqual([0, 0, 0, 0, 0]);
  });

  it("clamps extra rows and extra cells to 11×5", () => {
    const wide = Array.from({ length: 14 }, () => [1, 1, 1, 1, 1, 1, 1]);
    const m = buildPermMatrix(wide);
    expect(m).toHaveLength(11);
    expect(m.every((row) => row.length === 5)).toBe(true);
    expect(m[0]).toEqual([1, 1, 1, 1, 1]);
  });

  it("treats non-array / missing rows as all-zero", () => {
    const m = buildPermMatrix(undefined);
    expect(m).toHaveLength(11);
    expect(m[5]).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("serializePermMatrix", () => {
  it("round-trips through buildPermMatrix", () => {
    const canonical = buildPermMatrix([
      [1, 1, 0, 0, 0],
      [1, 0, 0, 0, 0],
    ]);
    expect(serializePermMatrix(canonical)).toEqual(canonical);
    expect(buildPermMatrix(serializePermMatrix(canonical))).toEqual(canonical);
  });
});

describe("togglePerm", () => {
  it("flips exactly one cell and returns a fresh matrix (immutable)", () => {
    const m = buildPermMatrix([]);
    const m2 = togglePerm(m, 0, 0);
    expect(m[0][0]).toBe(0); // original untouched
    expect(m2[0][0]).toBe(1); // toggled on
    expect(m2).not.toBe(m);
    expect(m2[0]).not.toBe(m[0]);
    // toggling the same cell again clears it
    expect(togglePerm(m2, 0, 0)[0][0]).toBe(0);
  });

  it("leaves the matrix unchanged for out-of-range indices", () => {
    const m = buildPermMatrix([[1, 0, 0, 0, 0]]);
    expect(togglePerm(m, 99, 99)).toEqual(m);
  });
});

describe("approvalLevelLabel", () => {
  it("maps 0..4 to the role.levelN dict key", () => {
    expect(approvalLevelLabel(0)).toBe("role.level0");
    expect(approvalLevelLabel(4)).toBe("role.level4");
  });

  it("clamps out-of-range / non-integer levels into 0..4", () => {
    expect(approvalLevelLabel(-2)).toBe("role.level0");
    expect(approvalLevelLabel(9)).toBe("role.level4");
    expect(approvalLevelLabel(Number.NaN)).toBe("role.level0");
    expect(approvalLevelLabel(2.7)).toBe("role.level2");
  });
});

describe("formatMoney", () => {
  it("groups integers with thousands separators", () => {
    expect(formatMoney(1_000_000)).toBe("1,000,000");
    expect(formatMoney(500_000)).toBe("500,000");
    expect(formatMoney(200_000)).toBe("200,000");
    expect(formatMoney(0)).toBe("0");
  });

  it("guards non-finite input", () => {
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("formatAuthLimit (tri-state)", () => {
  it("renders a numeric ceiling as a grouped amount", () => {
    expect(formatAuthLimit(1_000_000, 3)).toEqual({
      kind: "amount",
      amount: "1,000,000",
    });
  });

  it("renders unlimited when limit is null but the role can approve (level>0)", () => {
    // The seed Director role: approval_limit null + approval_level 4.
    expect(formatAuthLimit(null, 4)).toEqual({ kind: "unlimited" });
  });

  it("renders none when limit is null and there are no approval rights (level 0)", () => {
    expect(formatAuthLimit(null, 0)).toEqual({ kind: "none" });
    expect(formatAuthLimit(undefined, 0)).toEqual({ kind: "none" });
  });
});

describe("toRole", () => {
  it("narrows a full opaque /roles row (Director unlimited case)", () => {
    const r = toRole({
      id: "role-dir",
      name: "Director · CONS",
      approval_limit: null,
      currency_code: "THB",
      approval_level: 4,
      perms: [[1, 1, 1, 1, 1]],
      user_count: 2,
      extra: "ignored",
    });
    expect(r.id).toBe("role-dir");
    expect(r.name).toBe("Director · CONS");
    expect(r.approval_limit).toBeNull();
    expect(r.currency_code).toBe("THB");
    expect(r.approval_level).toBe(4);
    expect(r.perms).toHaveLength(11);
    expect(r.perms[0]).toEqual([1, 1, 1, 1, 1]);
    expect(r.user_count).toBe(2);
  });

  it("defaults missing fields and coerces a numeric-string limit", () => {
    const bare = toRole({});
    expect(bare).toEqual<Role>({
      id: "",
      name: "",
      approval_limit: null,
      currency_code: "",
      approval_level: 0,
      perms: buildPermMatrix([]),
      user_count: 0,
    });
    expect(toRole({ approval_limit: "1,000,000" }).approval_limit).toBe(1_000_000);
  });
});

describe("countMembersByRole", () => {
  it("counts users whose role_id matches (real query, not the mock c)", () => {
    const users = [
      { role_id: "r1" },
      { role_id: "r1" },
      { role_id: "r2" },
      { roleId: "r1" }, // camelCase fallback
      {},
    ];
    expect(countMembersByRole(users, "r1")).toBe(3);
    expect(countMembersByRole(users, "r2")).toBe(1);
    expect(countMembersByRole(users, "r3")).toBe(0);
    expect(countMembersByRole(users, "")).toBe(0);
  });
});
