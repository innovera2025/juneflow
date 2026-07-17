/*
 * Data hooks for MasterVendor (P2-WEB-01) — the tenant's supplier / subcon master.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack Query
 * via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype
 * held vendors in local state (master-party.jsx VENDOR_SEED + setRows); here the server is the
 * system of record:
 *   GET  /vendors        -> the catalogue (B-014 paginated envelope `.data`). The full
 *                           tenant set is fetched and the type/search filtering happens in the
 *                           screen (vendor-rows.filterVendors), matching the prototype's
 *                           client-side filter posture; the ?kind param is not used.
 *   POST /vendors        -> create a vendor. The caller composes the opaque body with `kind`
 *                           already mapped from the 4-way form type (B-070); the server
 *                           defaults status="active". Invalidates the list on success.
 *   PUT  /vendors/{id}   -> partial-merge update an existing vendor. Invalidates the list.
 *
 * Bodies/responses are the opaque Entity from the contract (additionalProperties).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

type Entity = components["schemas"]["Entity"];
/** Opaque list-row shape (the contract types /vendors rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the vendor catalogue (list + invalidation). */
const VENDORS_KEY = ["vendors"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /vendors — the tenant vendor catalogue for the table. B-014 paginated envelope
 * `{ data, ... }`; the screen consumes the page rows (`data`).
 */
export function useVendorList() {
  return useQuery<Row[]>({
    queryKey: VENDORS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/vendors"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * POST /vendors — create a vendor. The caller composes the opaque body
 * ({ code?, name, kind, tax_id?, credit_term?, addr?, bank?, status }); the server defaults
 * status="active" + kind="supplier" when omitted (B-071). Invalidates the catalogue on success.
 */
export function useCreateVendor(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/vendors", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: VENDORS_KEY }),
  });
}

/** PUT /vendors/{id} args — the vendor id plus the opaque partial-merge body. */
export interface UpdateVendorArgs {
  id: string;
  body: Entity;
}

/**
 * PUT /vendors/{id} — partial-merge update an existing vendor (only body keys present are
 * changed, vendors.ts). Invalidates the catalogue on success.
 */
export function useUpdateVendor(): UseMutationResult<Entity, unknown, UpdateVendorArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: UpdateVendorArgs) =>
      unwrap(apiClient.PUT("/vendors/{id}", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: VENDORS_KEY }),
  });
}
