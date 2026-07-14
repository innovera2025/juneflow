/*
 * Data hooks for MasterCompany (P1-WEB-08) — the tenant's company/org-structure tree.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 * The prototype held everything in local state (master.jsx ORG_SEED + setRows); here
 * the server is the system of record: GET /org-units returns the flat pre-order tree
 * (envelope .data, B-014) and each mutation invalidates it so the list re-renders in
 * the server's canonical order (apps/api/src/routes/org-units.ts). Body/response
 * bodies are the opaque Entity from the contract (fields locked by B-052).
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

/** Shared cache key for the org tree (list + invalidation). */
const ORG_UNITS_KEY = ["org-units"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /org-units — the flat pre-order org tree (lvl 0-2). B-014: paginated envelope
 * `{ data, ... }`; the screen consumes the page rows (`data`).
 */
export function useOrgUnits() {
  return useQuery<Entity[]>({
    queryKey: ORG_UNITS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/org-units"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** POST /org-units — create a company (lvl0) or department/sub-unit (lvl 1-2). */
export function useCreateOrgUnit(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/org-units", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ORG_UNITS_KEY }),
  });
}

/** PUT /org-units/{id} — partial merge (omitted fields keep current values). */
export function useUpdateOrgUnit(): UseMutationResult<
  Entity,
  unknown,
  { id: string; body: Entity }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Entity }) =>
      unwrap(apiClient.PUT("/org-units/{id}", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ORG_UNITS_KEY }),
  });
}

/** DELETE /org-units/{id} — cascades the whole subtree (server-side). */
export function useDeleteOrgUnit(): UseMutationResult<Entity, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.DELETE("/org-units/{id}", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ORG_UNITS_KEY }),
  });
}
