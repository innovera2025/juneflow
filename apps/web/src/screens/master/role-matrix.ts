/*
 * Permission-matrix + role helpers for UsersPermissions (P1-WEB-14) — pure,
 * i18n-free, ASCII-only logic ported 1:1 from pototype/master.jsx
 * UsersPermissions / RoleAddForm (L895-1116).
 *
 * The prototype held roles in a local ROLE_PRESETS map (master.jsx:895-904) whose
 * `authLimit` was a pre-formatted display STRING ("1,000,000 baht" / "unlimited" / "—")
 * and whose `c` (member count) was a hardcoded number. §0 rule 3: those mock
 * mechanics are dropped. Here the roles come from GET /roles (apps/api/src/routes/
 * roles.ts, B-051) as opaque Entity rows carrying the REAL wire shape
 *   { id, name, approval_limit: number|null, currency_code, approval_level: 0..4,
 *     perms: number[][] (11×5), user_count }
 * and the member count is derived from the real GET /users list (countMembersByRole,
 * C10) — never the mock `c`. The auth-limit DISPLAY is re-synthesised in the view
 * from (approval_limit, approval_level) via formatAuthLimit, so no Thai/currency text
 * leaks into this module (the baht symbol + the "unlimited" word live in the view / i18n).
 *
 * The 11 module labels ("Dashboard".."Master") and "Permission Matrix" are English
 * ASCII literals in the prototype (master.jsx:908/961) — kept verbatim here (they are
 * not translated strings, so they are not i18n keys, §0 rule 2 N/A).
 */

/**
 * The 11 permission modules, in matrix-row order (master.jsx MODULES_LBL:908 ==
 * apps/api MODULE_IDS). English ASCII literals, verbatim from the prototype.
 */
export const MODULE_LABELS = [
  "Dashboard",
  "BOQ",
  "PR",
  "PO",
  "WO",
  "GR",
  "Subcon",
  "Inventory",
  "Petty Cash",
  "Finance",
  "Master",
] as const;

/** The permission-matrix title suffix (master.jsx:961) — English ASCII, verbatim. */
export const PERMISSION_MATRIX_LABEL = "Permission Matrix";

/** Matrix dimensions: 11 modules × 5 permissions (view/create/edit/approve/cancel). */
export const MODULE_COUNT = MODULE_LABELS.length; // 11
export const PERM_COUNT = 5;

/** A tenant role, narrowed from the opaque GET /roles Entity row (roles.ts toWire). */
export interface Role {
  id: string;
  name: string;
  /** Single blanket approval ceiling in REAL baht, or null (unlimited / none). */
  approval_limit: number | null;
  currency_code: string;
  /** Approval tier 0..4 (0 = no approval rights). */
  approval_level: number;
  /** 11×5 permission matrix, each cell 0|1, in MODULE_LABELS × perm order. */
  perms: number[][];
  /** Members of this role — server-derived (C10); superseded by the /users count. */
  user_count: number;
}

/** Read a string field off an opaque row; "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Read a money amount as number|null (null when absent/blank/invalid). */
function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v.replace(/[, ]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Normalise an arbitrary perms input to the canonical 11×5 matrix of 0|1 cells:
 * pad missing rows/cells with 0, clamp extras (master.jsx renders exactly 11×5).
 * Accepts the wire's number[][] (roles.ts matrixFromPerms) or anything array-ish.
 */
export function buildPermMatrix(input: unknown): number[][] {
  const rows = Array.isArray(input) ? input : [];
  const out: number[][] = [];
  for (let m = 0; m < MODULE_COUNT; m++) {
    const row = Array.isArray(rows[m]) ? (rows[m] as unknown[]) : [];
    const cells: number[] = [];
    for (let p = 0; p < PERM_COUNT; p++) cells.push(row[p] ? 1 : 0);
    out.push(cells);
  }
  return out;
}

/**
 * Serialise a matrix back to the number[][] wire shape for POST/PUT /roles
 * (apps/api permsFromInput accepts number[][]). Round-trips through buildPermMatrix:
 * buildPermMatrix(serializePermMatrix(m)) === m for any canonical 11×5 matrix.
 */
export function serializePermMatrix(
  matrix: readonly (readonly number[])[],
): number[][] {
  return buildPermMatrix(matrix);
}

/**
 * Immutably flip one cell (master.jsx RoleAddForm.toggle:1063). Returns a fresh
 * matrix (new rows) with cell (moduleIdx, permIdx) toggled; every cell is
 * normalised to 0|1. Out-of-range indices leave the matrix logically unchanged.
 */
export function togglePerm(
  matrix: readonly (readonly number[])[],
  moduleIdx: number,
  permIdx: number,
): number[][] {
  return matrix.map((row, m) =>
    row.map((v, p) =>
      m === moduleIdx && p === permIdx ? (v ? 0 : 1) : v ? 1 : 0,
    ),
  );
}

/**
 * Map an approval level (0..4) to its i18n dict-key suffix
 * ("role.level0".."role.level4", master.jsx:1073-1077). ASCII key only — the
 * view resolves it via t(). Non-integer / out-of-range clamps into 0..4.
 */
export function approvalLevelLabel(level: number): string {
  const clamped = Number.isFinite(level)
    ? Math.min(4, Math.max(0, Math.trunc(level)))
    : 0;
  return `role.level${clamped}`;
}

/**
 * Group an integer amount with thousands separators ("1000000" -> "1,000,000"),
 * matching the prototype's Intl fmt (ds.jsx:4, maximumFractionDigits 0). ASCII
 * digits + comma only — the baht unit is appended in the view (no baht literal here).
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The tri-state approval-limit display discriminator (master.jsx:897/900 semantics):
 *   - amount   : a real ceiling -> grouped digits (the view appends " baht").
 *   - unlimited: no ceiling but the role CAN approve (limit null, level > 0) ->
 *                the view renders t("role.limitUnlimited") in var(--ok) (the seed's
 *                Director role: approval_limit null + approval_level 4).
 *   - none     : no ceiling and no approval rights (limit null, level 0) -> the view
 *                renders a language-neutral em-dash "—".
 */
export type AuthLimitDisplay =
  | { kind: "amount"; amount: string }
  | { kind: "unlimited" }
  | { kind: "none" };

export function formatAuthLimit(
  limit: number | null | undefined,
  level: number,
): AuthLimitDisplay {
  if (typeof limit === "number" && Number.isFinite(limit)) {
    return { kind: "amount", amount: formatMoney(limit) };
  }
  return level > 0 ? { kind: "unlimited" } : { kind: "none" };
}

/** Narrow an opaque GET /roles Entity row to the Role the screen consumes. */
export function toRole(e: Record<string, unknown>): Role {
  return {
    id: str(e.id),
    name: str(e.name),
    approval_limit: numOrNull(e.approval_limit ?? e.approvalLimit),
    currency_code: str(e.currency_code ?? e.currencyCode),
    approval_level: num(e.approval_level ?? e.approvalLevel),
    perms: buildPermMatrix(e.perms),
    user_count: num(e.user_count ?? e.userCount),
  };
}

/**
 * Count real members of a role from the GET /users list (C10 — replaces the mock
 * `c`). Reads role_id (snake_case wire) with a camelCase fallback. Empty roleId -> 0.
 */
export function countMembersByRole(
  users: readonly Record<string, unknown>[],
  roleId: string,
): number {
  if (!roleId) return 0;
  let n = 0;
  for (const u of users) {
    const rid = u.role_id ?? u.roleId;
    if (typeof rid === "string" && rid === roleId) n++;
  }
  return n;
}
