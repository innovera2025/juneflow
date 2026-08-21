/*
 * Data hooks for the inventory screens (inv.items / inv.stock / inv.transfer /
 * inv.issue). Reads, plus the writes whose forms have been ported.
 *
 * Every read goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 * The prototype held its data in local ITEMS / WH / TRANSFERS / ISSUES arrays
 * (inventory.jsx); here the server is the system of record:
 *   GET /inventory/items       -> the material/tool catalogue (listInventoryItems).
 *   GET /inventory/warehouses  -> warehouses (listWarehouses) — the id->name resolve
 *                                 for the item/issue warehouse column + the stock cards.
 *   GET /inventory/stock       -> per-(item,warehouse) balances (listStockBalances).
 *   GET /inventory/transfers   -> stock transfers (listStockTransfers).
 *   GET /inventory/issues      -> material issues (listMaterialIssues).
 * All return the B-014 paginated envelope `{ data, page, page_size, total }`; the
 * screens consume `.data`.
 *
 * WRITES: WarehouseAdd is ported and wired (useCreateWarehouse, bottom of this file).
 * ItemAdd / TransferAdd / IssueAdd are not yet, so their header actions stay
 * honest-disabled rather than opening a modal that cannot save. Note the earlier
 * claim here — that no create endpoint existed — was about this file, not the API:
 * the server has had all four write routes merged the whole time.
 *
 * Rows are the opaque Entity from the contract (additionalProperties); the pure
 * *-rows.ts modules narrow them.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types /inventory/* rows as Entity). */
type Row = Record<string, unknown>;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /inventory/items — the tenant material/tool catalogue (B-014 `.data`). */
export function useInventoryItems() {
  return useQuery<Row[]>({
    queryKey: ["inventory-items"],
    queryFn: async () => (await unwrap(apiClient.GET("/inventory/items"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /inventory/warehouses — the tenant warehouses (name resolve + stock cards). */
export function useWarehouses() {
  return useQuery<Row[]>({
    queryKey: ["inventory-warehouses"],
    queryFn: async () => (await unwrap(apiClient.GET("/inventory/warehouses"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /inventory/stock — per-(item,warehouse) balances (honest-empty when unseeded). */
export function useStock() {
  return useQuery<Row[]>({
    queryKey: ["inventory-stock"],
    queryFn: async () => (await unwrap(apiClient.GET("/inventory/stock"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /inventory/transfers — the tenant stock transfers (newest-first, server). */
export function useTransfers() {
  return useQuery<Row[]>({
    queryKey: ["inventory-transfers"],
    queryFn: async () => (await unwrap(apiClient.GET("/inventory/transfers"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /inventory/issues — the tenant material issues (newest-first, server). */
export function useIssues() {
  return useQuery<Row[]>({
    queryKey: ["inventory-issues"],
    queryFn: async () => (await unwrap(apiClient.GET("/inventory/issues"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------------------- */
/* WRITES — added when the read-only note above stopped being true.            */
/*                                                                            */
/* The header actions were honest-disabled because this file had no create     */
/* hook, and the file said so. That reading was correct about the CLIENT and    */
/* wrong about the server: POST /inventory/warehouses (inventory.ts:1474),      */
/* /items (:1469), /transfers (:1479) and /transfers/{id}/approve (:1491) are   */
/* all merged. Each write hook lands here as its screen's form is ported —      */
/* never before, so a hook is never a promise the UI cannot keep.               */
/* ------------------------------------------------------------------------- */

/** The fields POST /inventory/warehouses reads (inventory.ts:741-749). */
export interface WarehouseDraft {
  /** Required by the handler — 400 "code is required" when blank. */
  code: string;
  /** Required by the handler — 400 "name is required" when blank. */
  name: string;
  /** Stable code, not a label: "site" | "central" | "temp" (see WH_TYPE_OPTIONS). */
  type: string;
  owner: string;
  /** Item capacity; omitted from the body when blank (the column is nullable). */
  capacity?: number;
}

/**
 * POST /inventory/warehouses — create a warehouse. 201 with the created row.
 *
 * Invalidates the warehouses read AND the stock read: the stock screen draws one
 * card per warehouse, so a new warehouse that does not appear until a manual
 * refresh looks like the create silently failed.
 */
export function useCreateWarehouse(): UseMutationResult<Row, unknown, WarehouseDraft> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: WarehouseDraft) =>
      unwrap(
        apiClient.POST("/inventory/warehouses", {
          body: {
            code: draft.code,
            name: draft.name,
            type: draft.type,
            owner: draft.owner,
            ...(draft.capacity != null ? { capacity: draft.capacity } : {}),
          },
        }),
      ) as Promise<Row>,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory-warehouses"] });
      void qc.invalidateQueries({ queryKey: ["inventory-stock"] });
    },
  });
}
