/*
 * solar.warranty list-row helpers (read-only) — pure, i18n-free, ASCII-only logic narrowed
 * from pototype/solar.jsx SolarWarranty (L269-310). The prototype held the warranty register
 * in a local array (L270-275); §0 rule 3 drops that mock — the real server rows are
 *   /solar/warranties : { id, project_id, item, brand, qty, perf, prod_date, expiry_date, status, created_at }
 * (apps/api/src/routes/solar.ts). This screen is table-only (no KPIs).
 *
 * The prototype's product-warranty column maps to the wire's prod_date and its expiry
 * column to expiry_date (both nullable -> the screen em-dashes a null). perf is a raw
 * backend value rendered as returned (may already be an em-dash). STATUS is code-based
 * (never a Thai-literal compare, B-073): warrantyStatus maps the seed code ("active") and
 * the prototype codes (active / expiring / expired) to a ds.jsx tone + which
 * solar.warranty.status* label the screen renders.
 */
import { str, num, type StatusKind } from "./solar-shared";

/** A warranty register entry as the table consumes it (GET /solar/warranties row). */
export interface WarrantyRow {
  id: string;
  /** Equipment name (free text). */
  item: string;
  /** Brand / model (free text; "" when absent). */
  brand: string;
  /** Quantity (server stored; 0 when absent). */
  qty: number;
  /** Performance-warranty text — a raw backend value (may be "" / an em-dash). */
  perf: string;
  /** Product-warranty / production date (free text; "" when absent -> em-dash). */
  prodDate: string;
  /** Expiry date (free text; "" when absent -> em-dash). */
  expiryDate: string;
  /** Status code (active|expiring|expired|..., not enumerated). */
  status: string;
}

/** Narrow an opaque /solar/warranties row to WarrantyRow (snake_case wire / camelCase fallback). */
export function toWarrantyRow(e: Record<string, unknown>): WarrantyRow {
  return {
    id: str(e.id),
    item: str(e.item),
    brand: str(e.brand),
    qty: num(e.qty),
    perf: str(e.perf),
    prodDate: str(e.prod_date ?? e.prodDate),
    expiryDate: str(e.expiry_date ?? e.expiryDate),
    status: str(e.status),
  };
}

/**
 * Warranty status -> { badge tone kind, which solar.warranty.status* label to render }
 * (solar.jsx L302). Both the seed code ("active") and the prototype codes resolve:
 *   active            -> approved + "active"   (t solar.warranty.statusActive)
 *   expiring | expired -> pending + "expiring" (t solar.warranty.statusExpiring)
 *   (default)         -> approved + "active"
 * Returns a label kind (never Thai) so the .tsx picks the t() key with no literal compare.
 */
export function warrantyStatus(status: string): { kind: StatusKind; label: "active" | "expiring" } {
  switch (status) {
    case "expiring":
    case "expired":
      return { kind: "pending", label: "expiring" };
    case "active":
    default:
      return { kind: "approved", label: "active" };
  }
}
