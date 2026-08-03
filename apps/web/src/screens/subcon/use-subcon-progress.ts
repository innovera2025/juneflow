/*
 * Data hooks for SubconProgress (subcon.progress port, THIN-HONEST read — Wei B-229
 * thin-honest ruling) — the three live feeds the progress screen renders.
 *
 * Every read goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 * The prototype held its data in the local SUBCONS / PROGRESS_PAYMENTS / VARIATIONS
 * arrays (subcon.jsx:3-25); here the server is the system of record:
 *   GET /vendors?kind=subcon           -> the subcon list for the left panel (the
 *                                         contract enum kind is server-honoured,
 *                                         vendors.ts). B-014 paginated envelope `.data`.
 *   GET /subcon-contracts              -> the whole subcon-contract register, grouped
 *                                         client-side by vendor_id for the per-vendor
 *                                         COUNT + Σ VALUE + active contract.
 *   GET /subcon-contracts/{id}/periods -> the selected contract's payment timeline
 *                                         (disabled until a contract id resolves).
 *
 * This screen is read-only: it never mutates, so no create/approve mutation lives
 * here (the report + add + approve/close affordances are honest-disabled in the view).
 * Bodies/responses are the opaque Entity from the contract (additionalProperties).
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types these rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache keys (aligned with use-subcon.ts so the caches are reused). */
const SUBCON_VENDORS_KEY = ["vendors", "subcon"] as const;
const SUBCON_CONTRACTS_KEY = ["subcon-contracts"] as const;
const periodsKey = (contractId: string) =>
  [...SUBCON_CONTRACTS_KEY, contractId, "periods"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /vendors?kind=subcon — the tenant's subcontractor vendors for the left list.
 * The `kind` filter is applied server-side (vendors.ts honours the contract enum);
 * the screen still guards with subconVendors() defensively. B-014 envelope `.data`.
 */
export function useSubconVendors() {
  return useQuery<Row[]>({
    queryKey: SUBCON_VENDORS_KEY,
    queryFn: async () =>
      (await unwrap(apiClient.GET("/vendors", { params: { query: { kind: "subcon" } } }))).data ??
      [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * GET /subcon-contracts — the tenant's whole subcon-contract register. The screen
 * groups it by vendor_id (subcon-progress-rows) for the per-vendor count/Σ value and
 * to pick the active contract. B-014 paginated envelope `.data`.
 */
export function useSubconContracts() {
  return useQuery<Row[]>({
    queryKey: SUBCON_CONTRACTS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/subcon-contracts"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * GET /subcon-contracts/{id}/periods — the selected contract's work periods (the
 * payment-timeline table). Disabled until a contract id is resolved (and a token is
 * present). The screen sorts/derives from the page rows. B-014 envelope `.data`.
 */
export function useProgressPeriods(contractId: string) {
  return useQuery<Row[]>({
    queryKey: periodsKey(contractId),
    queryFn: async () =>
      (
        await unwrap(
          apiClient.GET("/subcon-contracts/{id}/periods", {
            params: { path: { id: contractId } },
          }),
        )
      ).data ?? [],
    enabled: authed() && contractId !== "",
    staleTime: 60_000,
  });
}
