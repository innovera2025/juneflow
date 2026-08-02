/*
 * Data hooks for the inventory read/display screens (inv.items / inv.stock /
 * inv.transfer / inv.issue) — READ-ONLY.
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
 * screens consume `.data`. There is intentionally NO create/update hook — the write
 * forms (ItemAdd / WarehouseAdd / TransferAdd / IssueAdd) are out of this read/display
 * scope; the header actions are honest-disabled instead of wiring a mock modal.
 *
 * Rows are the opaque Entity from the contract (additionalProperties); the pure
 * *-rows.ts modules narrow them.
 */
import { useQuery } from "@tanstack/react-query";
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
