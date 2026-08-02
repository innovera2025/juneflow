/*
 * Unit tests for transfer-rows.ts (gate G3) — the pure Stock-Transfer narrowing:
 * opaque /inventory/transfers rows (snake_case, server-resolved warehouse names,
 * numeric qty/value, DATE-only transfer_date, uuid by_user_id, status).
 */
import { describe, it, expect } from "vitest";
import { toTransferRow, type TransferRow } from "./transfer-rows";

const wire = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  no: "TR-2026-0084",
  from_warehouse_id: "w1",
  to_warehouse_id: "w2",
  from_warehouse_name: "WH Central",
  to_warehouse_name: "WH Block B",
  qty: 360,
  value: 184500,
  currency_code: "THB",
  transfer_date: "2026-05-25",
  by_user_id: "u1",
  status: "approved",
  ...over,
});

describe("toTransferRow", () => {
  it("narrows the transferWire shape", () => {
    expect(toTransferRow(wire())).toEqual<TransferRow>({
      id: "t1",
      no: "TR-2026-0084",
      fromWarehouseId: "w1",
      toWarehouseId: "w2",
      fromWarehouseName: "WH Central",
      toWarehouseName: "WH Block B",
      qty: 360,
      value: 184500,
      currencyCode: "THB",
      transferDate: "2026-05-25",
      byUserId: "u1",
      status: "approved",
    });
  });

  it("keeps an unresolved warehouse name empty (view renders em-dash)", () => {
    const r = toTransferRow(wire({ from_warehouse_name: null, to_warehouse_name: undefined }));
    expect(r.fromWarehouseName).toBe("");
    expect(r.toWarehouseName).toBe("");
  });

  it("keeps a 0 value (view renders em-dash for a tool transfer)", () => {
    expect(toTransferRow(wire({ value: 0 })).value).toBe(0);
  });

  it("defaults missing fields", () => {
    const r = toTransferRow({});
    expect(r.no).toBe("");
    expect(r.qty).toBe(0);
    expect(r.status).toBe("");
  });
});
