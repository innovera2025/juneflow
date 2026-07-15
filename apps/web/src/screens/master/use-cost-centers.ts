/*
 * Data hooks for MasterCC (P1-WEB-11) — the tenant's cost-center catalogue.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 * The prototype held the cost centers in local state (master.jsx CC_SEED + setRows);
 * here the server is the system of record:
 *   GET /cost-centers   -> the catalogue (B-014 paginated envelope `.data`).
 *   POST /cost-centers  -> create a center; the server forces status="draft" (B-059) and
 *     defaults currency THB, so the body omits status/currency_code. The list is
 *     invalidated so the new row appears in the server's order.
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
/** Opaque list-row shape (the contract types /cost-centers rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the cost-center catalogue (list + invalidation). */
const COST_CENTERS_KEY = ["cost-centers"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /cost-centers — the tenant cost-center catalogue for the table. B-014 paginated
 * envelope `{ data, ... }`; the screen consumes the page rows (`data`).
 */
export function useCostCenterList() {
  return useQuery<Row[]>({
    queryKey: COST_CENTERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/cost-centers"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * POST /cost-centers — create a cost center. The caller composes the opaque body
 * ({ code, name, type, link, owner, budget (FULL baht), project_id }); the server forces
 * status="draft" + defaults currency THB (B-059). Invalidates the catalogue on success.
 */
export function useCreateCostCenter(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/cost-centers", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: COST_CENTERS_KEY }),
  });
}
