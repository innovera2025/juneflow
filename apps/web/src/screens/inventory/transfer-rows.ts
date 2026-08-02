/*
 * Stock-transfer row helpers for InventoryTransfer (route inv.transfer), pure/
 * i18n-free/ASCII-only logic derived from pototype/inventory.jsx InventoryTransfer
 * (L213-260). GOTCHA: the component ends at L260 — `const ISSUES` (L262) +
 * InventoryIssue (L269) are the adjacent swallowed material, EXCLUDED here.
 *
 * §0 rule 3: the prototype's TRANSFERS mock (L206-211) is dropped — the list is the
 * real server catalogue (GET /inventory/transfers, transferWire, inventory.ts
 * L371-390): { id, no, from_warehouse_id, to_warehouse_id, from_warehouse_name,
 * to_warehouse_name, qty, value, currency_code, transfer_date, by_user_id, status,
 * created_at }. Server sorts newest-first (created_at desc).
 *
 * WIRE GAPS (reported, never fabricated): the list wire carries NO line items
 * (transfer_line is detail-only), NO by_user_name (by_user_id uuid only), a single
 * numeric qty (not the prototype's "240+120 <unit>" composite string), and a DATE-only
 * transfer_date (no time-of-day). Those cells render an em-dash / the raw value.
 */
import { num, str } from "./inv-shared";

/** A stock-transfer row as the table consumes it (narrowed from the opaque wire). */
export interface TransferRow {
  id: string;
  no: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  /** Server-resolved warehouse names (null -> em-dash). */
  fromWarehouseName: string;
  toWarehouseName: string;
  /** Single numeric total (the prototype's per-line composite is not reconstructable). */
  qty: number;
  /** Transfer value (money, SERVER-owned; may be 0 -> em-dash, e.g. a tool transfer). */
  value: number;
  currencyCode: string;
  /** DATE only (no time-of-day) — rendered as the raw wire value (SERVER DATA). */
  transferDate: string;
  /** FK to the initiating user (uuid, NOT name-resolved -> em-dash). */
  byUserId: string;
  /** Lifecycle status (pending | approved). */
  status: string;
}

/** Narrow an opaque /inventory/transfers Entity row to a TransferRow. */
export function toTransferRow(e: Record<string, unknown>): TransferRow {
  return {
    id: str(e.id),
    no: str(e.no),
    fromWarehouseId: str(e.from_warehouse_id ?? e.fromWarehouseId),
    toWarehouseId: str(e.to_warehouse_id ?? e.toWarehouseId),
    fromWarehouseName: str(e.from_warehouse_name ?? e.fromWarehouseName),
    toWarehouseName: str(e.to_warehouse_name ?? e.toWarehouseName),
    qty: num(e.qty),
    value: num(e.value),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    transferDate: str(e.transfer_date ?? e.transferDate),
    byUserId: str(e.by_user_id ?? e.byUserId),
    status: str(e.status),
  };
}
