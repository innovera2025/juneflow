/*
 * Data hooks for BOQList (P2-WEB-02) — the tenant's BOQ documents.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The
 * prototype held the docs in a local BOQStore (boq-list.jsx:6-31); here the server is the
 * system of record:
 *   GET  /boq  -> the tenant BOQ docs (listBoq, B-014 paginated envelope `.data`); each
 *                 doc's `total` is the real SUM of its items (never the mock's hardcoded
 *                 value).
 *   POST /boq  -> create a BOQ doc (createBoq). The server owns status (always "draft") and
 *                 version (1), so the body carries only { no, name, scope, project_id }
 *                 (apps/api/src/routes/boq.ts:292). The list is invalidated so the new doc
 *                 appears in the server's order.
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
/** Opaque list-row shape (the contract types /boq rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the BOQ catalogue (list + invalidation). */
const BOQ_KEY = ["boq"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /boq — the tenant BOQ docs for the table. B-014 paginated envelope `{ data, ... }`;
 * the screen consumes the page rows (`data`).
 */
export function useBoqList() {
  return useQuery<Row[]>({
    queryKey: BOQ_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/boq"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * POST /boq — create a BOQ doc. The caller composes the opaque body
 * ({ no, name, scope, project_id }); the server forces status="draft" + version=1. The
 * catalogue is invalidated on success so the new draft appears.
 */
export function useCreateBoq(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/boq", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: BOQ_KEY }),
  });
}
