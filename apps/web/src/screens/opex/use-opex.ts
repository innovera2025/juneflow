/*
 * Data hooks for OpexBudget (opex web port, THIN-HONEST — Wei B-246 thin-honest) — the one live
 * feed the screen reads and the one write it fires.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The
 * prototype held its data in the local OPEX_SEED / OPEX_MONTHLY / OPEX_HISTORY arrays
 * (opex-budget.jsx); here the server is the system of record:
 *   GET  /opex/budgets -> the tenant's dept+year budgets (B-014 paginated envelope `.data`),
 *                         each row the opaque { id, dept, year, months, currency_code }.
 *   POST /opex/budgets -> create a dept+year budget from the add-budget form. money =
 *                         SERVER: the caller sends ONLY { dept, year, months[12] }; the
 *                         server forces currency_code = THB and rejects a duplicate
 *                         (dept, year) with a 409 (never a silent overwrite). Invalidates
 *                         the register on success (the new budget surfaces on the next read).
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

/** Opaque POST body / list row (the contract types /opex/budgets rows as Entity). */
type Entity = components["schemas"]["Entity"];
type Row = Record<string, unknown>;

/** Shared cache key for the opex-budget register (list + invalidation). */
const OPEX_BUDGETS_KEY = ["opex-budgets"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /opex/budgets — the tenant's dept+year budget register for the grid. B-014
 * paginated envelope `{ data, ... }`; the screen consumes the page rows (`data`).
 */
export function useOpexBudgets() {
  return useQuery<Row[]>({
    queryKey: OPEX_BUDGETS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/opex/budgets"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * POST /opex/budgets — create a dept+year budget from the add-budget form draft. The
 * caller composes the opaque body ({ dept, year, months[12] }); the server forces
 * currency_code = THB and 409s a duplicate (dept, year). Invalidates the register.
 */
export function useCreateOpexBudget(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/opex/budgets", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: OPEX_BUDGETS_KEY }),
  });
}
