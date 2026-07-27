/*
 * Sales-process unit-grid + status-overlay + count helpers for SalesProcess
 * (sales.process, the money=SERVER booking/contract port) — pure, i18n-free,
 * ASCII-only logic (PLAN.md sec.0 rule 2/B-073) derived from
 * pototype/sales-process.jsx SalesProcess (L21-217).
 *
 * The prototype fabricated its 84-cell Block-B grid from a local `units` array
 * (index -> hardcoded status buckets: soldBuilt|sold|booked|built|empty) and a mock
 * CUSTOMER_SEED. PLAN.md sec.0 rule 3: both mocks are dropped as data — the grid is
 * derived from the REAL project hierarchy (GET /projects/{id}/hierarchy,
 * apps/api/src/routes/project-nodes.ts buildHierarchy), whose flat pre-order nodes
 * carry a unit's sale status (empty|built|sold|soldBuilt), and the "booked" /
 * contract("sold") overlays come from GET /sales/bookings + /sales/contracts
 * (land-sales.ts unitWire) matched by node id.
 *
 * WIRE / HONEST NOTES (never fabricated):
 *  - The hierarchy unit status enum is {empty|built|sold|soldBuilt} — it has NO
 *    "booked" value. "booked" is an OVERLAY: a unit whose node id appears in the
 *    /sales/bookings register (booking != null) but not yet in /sales/contracts.
 *  - A signed contract overlays as "sold" (contract precedence over booked); a
 *    hierarchy "soldBuilt" (delivered) is never downgraded by an overlay.
 *  - Count-line numerals RECOMPUTE from the real cells (C10 — never the mock
 *    84/57/5/22): sold = {sold,soldBuilt}, booked = booked, available = the rest.
 *  - Only "built" or "empty" cells are selectable (mirrors the prototype canClick).
 *  - The contract action needs the sales_unit ROW id (which exists only after a
 *    booking); salesUnitIdByUnitId maps a node id -> that row id from /sales/bookings.
 *  All ASCII (B-073) — no Thai / baht lives here.
 */

/** The 5 unit display states (prototype legend order). "booked" is overlay-only. */
export type UnitStatus = "empty" | "built" | "sold" | "soldBuilt" | "booked";

/** The 4 hierarchy-native sale statuses a unit node can carry (no "booked"). */
const BASE_STATUSES = new Set(["empty", "built", "sold", "soldBuilt"]);

/** A hierarchy node narrowed to what the grid needs (GET /projects/{id}/hierarchy). */
export interface HierNode {
  id: string;
  kind: string;
  name: string;
  code: string;
  /** Unit sale status (empty|built|sold|soldBuilt); "" for non-units / absent. */
  status: string;
}

/** A grid cell derived from a unit node + the booking/contract overlays. */
export interface UnitCell {
  /** Stable project_node id (the POST /sales/bookings unit_id). */
  id: string;
  code: string;
  name: string;
  status: UnitStatus;
  /** True only for built/empty cells (mirrors the prototype canClick). */
  selectable: boolean;
}

/** The recomputed count-line figures (C10). */
export interface UnitCounts {
  total: number;
  sold: number;
  booked: number;
  available: number;
}

/** A customer dropdown option (GET /customers row). */
export interface CustomerOption {
  id: string;
  label: string;
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
export function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * Narrow an opaque hierarchy Entity row to a HierNode. Accepts snake_case (server
 * convention) or camelCase for robustness (mirrors toLeadRow). Missing fields -> "".
 */
export function toHierNode(e: Record<string, unknown>): HierNode {
  return {
    id: str(e.id),
    kind: str(e.kind),
    name: str(e.name),
    code: str(e.code),
    status: str(e.status),
  };
}

/**
 * The set of node ids that appear in a /sales/bookings or /sales/contracts register
 * (each row's `unit_id` is the project_node id). Blank ids are skipped.
 */
export function unitIdSet(rows: readonly Record<string, unknown>[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const r of rows ?? []) {
    const id = str(r.unit_id ?? r.unitId);
    if (id) set.add(id);
  }
  return set;
}

/**
 * Map a unit node id -> its sales_unit ROW id from the /sales/bookings register.
 * The contract action requires the ROW id (POST /sales/contracts sales_unit_id),
 * which only exists once a unit has been booked. Later bookings win (register is
 * newest-first, so the first seen is kept).
 */
export function salesUnitIdByUnitId(
  bookingRows: readonly Record<string, unknown>[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of bookingRows ?? []) {
    const unitId = str(r.unit_id ?? r.unitId);
    const rowId = str(r.id);
    if (unitId && rowId && !map.has(unitId)) map.set(unitId, rowId);
  }
  return map;
}

/** Resolve the final display status for a base status + the two overlays. */
function overlayStatus(
  base: string,
  booked: boolean,
  contract: boolean,
): UnitStatus {
  // Delivered (soldBuilt) is terminal — never downgraded by an overlay.
  if (base === "soldBuilt") return "soldBuilt";
  // A signed contract, or a hierarchy-native sold, shows as "sold" (contract > booked).
  if (contract || base === "sold") return "sold";
  // A booking (no contract yet) shows as "booked".
  if (booked) return "booked";
  // Otherwise the hierarchy status (built / empty); an unknown value falls to empty.
  return base === "built" ? "built" : "empty";
}

/**
 * Build the ordered unit grid from the hierarchy nodes + the booking/contract
 * overlays. Non-unit nodes (phase/block) are dropped; pre-order input order is kept
 * (the server already ordered the tree). Each cell's selectable flag = built|empty.
 */
export function unitCells(
  nodes: readonly HierNode[],
  bookedUnitIds: ReadonlySet<string>,
  contractUnitIds: ReadonlySet<string>,
): UnitCell[] {
  const cells: UnitCell[] = [];
  for (const n of nodes) {
    if (n.kind !== "unit") continue;
    const base = BASE_STATUSES.has(n.status) ? n.status : "empty";
    const status = overlayStatus(base, bookedUnitIds.has(n.id), contractUnitIds.has(n.id));
    cells.push({
      id: n.id,
      code: n.code || n.name,
      name: n.name,
      status,
      selectable: status === "built" || status === "empty",
    });
  }
  return cells;
}

/**
 * Recompute the count-line figures from the real cells (C10 — never the mock
 * 84/57/5/22). sold counts {sold,soldBuilt}; booked counts booked; available is the
 * remainder (built + empty).
 */
export function unitCounts(cells: readonly UnitCell[]): UnitCounts {
  let sold = 0;
  let booked = 0;
  for (const c of cells) {
    if (c.status === "sold" || c.status === "soldBuilt") sold += 1;
    else if (c.status === "booked") booked += 1;
  }
  const total = cells.length;
  return { total, sold, booked, available: total - sold - booked };
}

/** Find a cell by node id (the selection anchor); undefined when absent. */
export function findCell(cells: readonly UnitCell[], id: string): UnitCell | undefined {
  return cells.find((c) => c.id === id);
}

/**
 * The default selected node id: the first selectable (built|empty) cell, else the
 * first cell, else "" (no units). Mirrors the prototype's fixed default but derived
 * from the real grid.
 */
export function defaultSelectedId(cells: readonly UnitCell[]): string {
  const firstSelectable = cells.find((c) => c.selectable);
  return firstSelectable?.id ?? cells[0]?.id ?? "";
}

/**
 * The short grid-cell label — the segment after the last "-" (prototype
 * `code.replace("B-", "")`, generalised so any block prefix is stripped), else the
 * whole code.
 */
export function cellShortLabel(code: string): string {
  const idx = code.lastIndexOf("-");
  return idx >= 0 && idx < code.length - 1 ? code.slice(idx + 1) : code;
}

/** Narrow an opaque /customers Entity row to a CustomerOption (label = name). */
export function toCustomerOption(e: Record<string, unknown>): CustomerOption {
  return { id: str(e.id), label: str(e.name) };
}

/** round-half-up to 2 dp (mirror ar-invoice-rows round2). */
export function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Thousands-separated integer money (mirror ar-invoice-rows formatMoney / proto fmt). */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Parse a user-typed amount (strip commas); 0 for a non-finite / negative input. */
export function parseAmount(raw: string): number {
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
