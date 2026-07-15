/*
 * Data hooks for MasterModel (P1-WEB-13) — the tenant's house-model catalogue.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 * The prototype held the model list in local state (master.jsx MODELS seed); here the
 * server is the system of record:
 *   GET /models   -> the model catalogue (B-014 envelope `.data`).
 *   POST /models  -> create a model; the server assigns colour + status="draft" (B-050),
 *     so the body omits colour/status/counts. The list is invalidated so the new card
 *     appears in the server's order.
 *
 * The list read REUSES the queryKey ["models"] already used by useModels() in
 * use-project-hierarchy.ts (the block model_id join) — one shared cache, no divergent
 * key. Bodies/responses are the opaque Entity from the contract (additionalProperties).
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
/** Opaque list-row shape (the contract types /models rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the model catalogue — same literal as use-project-hierarchy.ts. */
const MODELS_KEY = ["models"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /models — the tenant model catalogue for the card grid. B-014 paginated
 * envelope `{ data, ... }`; the screen consumes the page rows (`data`).
 */
export function useModelList() {
  return useQuery<Row[]>({
    queryKey: MODELS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/models"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * POST /models — create a house model. The caller composes the opaque body
 * ({ code, type, area, bed, bath, parking, price (FULL baht), currency_code }); the
 * server assigns colour + status="draft" (B-050). Invalidates the catalogue on success.
 */
export function useCreateModel(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/models", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: MODELS_KEY }),
  });
}
