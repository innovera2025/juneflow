/*
 * Shared pure helpers for the inventory read/display screens (inv.items /
 * inv.stock / inv.transfer / inv.issue), ported from pototype/inventory.jsx.
 * i18n-free, ASCII-only logic — the view layer (inv-ui.tsx + each *.tsx) owns
 * every visible string via i18n keys.
 *
 * The prototype held its rows in local mock arrays (ITEMS / WH / TRANSFERS /
 * ISSUES); §0 rule 3 drops those — the server catalogue (GET /inventory/*) is the
 * system of record and these helpers narrow the opaque Entity rows + derive the
 * client-side status/warehouse/money projections the tables need. Money is
 * SERVER-owned (price x on_hand, transfer/issue value) — these helpers only
 * FORMAT it for display, never compute a persisted amount.
 */

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
export function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
export function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Read a nullable number (keeps null distinct from 0, e.g. low_point). */
export function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Group a value with thousands separators, 0 decimals ("902475" -> "902,475"),
 * matching the prototype's Intl fmt (ds.jsx:4-5, th-TH maximumFractionDigits 0).
 * ASCII digits + comma only; non-finite -> "0". Mirrors gr-rows/land-bank formatMoney.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Group a value with thousands separators + fixed 2 decimals ("7000" -> "7,000.00"),
 * matching the prototype's Intl fmtDec (ds.jsx:6-7, th-TH min/maxFractionDigits 2).
 * ASCII digits/comma/dot only; non-finite -> "0.00".
 */
export function formatDec(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  const sign = n < 0 ? "-" : "";
  const [intPart, frac] = Math.abs(n).toFixed(2).split(".");
  const grouped = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}.${frac}`;
}

/**
 * Build a warehouse_id -> name map from the opaque /inventory/warehouses rows
 * (§0 rule 3, FK-name resolution: itemWire/issueWire emit warehouse_id only, no
 * warehouse_name — the id resolves to the real name here, mirroring gr-rows
 * refNoMap / land-bank projectNameById).
 */
export function warehouseNameById(
  rows: readonly Record<string, unknown>[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows ?? []) {
    const id = str(r.id);
    if (id) map.set(id, str(r.name));
  }
  return map;
}

/** Derived stock-status enum (prototype ok/low/crit -> inv.status.ok/low/out). */
export type StockStatusKind = "ok" | "low" | "out";

/**
 * Derive the stock-status badge CLIENT-side from the real wire (on_hand vs
 * low_point) — the itemWire `status` is a lifecycle value ("active"), NOT a
 * stock-status enum, so it cannot map to the badge (recon divergence). Honest
 * consequence on the UNSEEDED ledger (on_hand=0): every row derives "out".
 */
export function stockStatusKind(onHand: number, lowPoint: number | null): StockStatusKind {
  if (onHand <= 0) return "out";
  if (lowPoint != null && onHand <= lowPoint) return "low";
  return "ok";
}

/** Token bg/fg for a stock-status badge (rule 6, all @juneflow/tokens var()). */
export function stockStatusTone(kind: StockStatusKind): { bg: string; fg: string } {
  switch (kind) {
    case "ok":
      return { bg: "var(--ok-soft)", fg: "var(--ok)" };
    case "low":
      return { bg: "var(--warn-soft)", fg: "var(--warn)" };
    case "out":
      return { bg: "var(--danger-soft)", fg: "var(--danger)" };
  }
}

/** Transfer/issue document status (wire enum: pending | approved). */
export type DocStatusKind = "pending" | "approved" | "draft";

/** Narrow a wire status string to the known document-status kind. */
export function docStatusKind(status: string): DocStatusKind {
  if (status === "pending") return "pending";
  if (status === "approved") return "approved";
  return "draft";
}

/**
 * Status-badge descriptor for the transfer/issue tables. bg/fg are @juneflow/tokens
 * var() references (rule 6); `dot` is prototype-verbatim (ds.jsx STATUS map L84-92,
 * B-037(a)). The label is resolved in the view (fin.statusPending / fin.statusApproved).
 */
export function docStatusTone(status: string): { bg: string; fg: string; dot: string } {
  switch (docStatusKind(status)) {
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}
