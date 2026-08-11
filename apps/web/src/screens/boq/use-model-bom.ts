/*
 * Data hook for BOMTemplates (boq.bom) — the BOM template lines of one house model.
 *
 * The read goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written model/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 *
 *   GET /models/{id}/bom  -> the model's BOM template lines (boms.items jsonb)
 *
 * Contract: packages/contracts/openapi.yaml `/models/{id}/bom` operationId getModelBom
 * (200 EntityList | 401 Unauthorized). Handler: apps/api/src/routes/models.ts — it resolves
 * the model inside the tenant scope (404 for a foreign/absent id), then returns the `items`
 * of the `bom` row whose unit_type equals the model's `code`, wrapped in the B-014 paginated
 * envelope. A model with no matching BOM row returns `data: []` honestly, never fabricated
 * lines (proven by apps/api/src/routes/models.test.ts "GET /api/v1/models/:id/bom").
 *
 * Rows are the opaque Entity (additionalProperties) — the element shape stored in the jsonb;
 * boq-bom-agg.parseBomLines() narrows them into the typed BomLine[] the screen aggregates.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types the BOM lines as Entity). */
type Row = Record<string, unknown>;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /models/{id}/bom — one house model's BOM template lines. Disabled until a model id
 * is resolved, so the caller can pass `undefined` for a model that has no BOM (the screen
 * renders its empty state from the server-derived bom_item_count and never fires the read).
 */
export function useModelBom(modelId: string | undefined) {
  return useQuery<Row[]>({
    queryKey: ["model-bom", modelId],
    queryFn: async () =>
      (
        await unwrap(
          apiClient.GET("/models/{id}/bom", {
            params: { path: { id: modelId as string } },
          }),
        )
      ).data ?? [],
    enabled: authed() && !!modelId,
    staleTime: 5 * 60_000,
  });
}
