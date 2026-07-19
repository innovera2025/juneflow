/*
 * Data hooks for PMAssets (pm.assets) — the tenant's PM asset registry.
 *
 * Every read/write goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md section 5,
 * apps/web/CLAUDE.md). The prototype held its data in the local PM_ASSETS_BY_TYPE
 * arrays (pm.jsx L7-37); here the server is the system of record:
 *   GET  /pm/assets  -> the tenant PM assets (B-014 paginated envelope `.data`).
 *   POST /pm/assets  -> register a new asset under a PM contract.
 * The mutation invalidates the assets list so the new state appears.
 *
 * CREATE PATH — partially Wave-2-blocked (reported honestly). POST /pm/assets
 * REQUIRES `contract_id` (400 otherwise) and resolves it THROUGH the tenant scope
 * (a foreign/absent id -> 404, apps/api/src/routes/pm.ts). The contract picker
 * source, GET /pm/contracts, is Wave-2 GATED (unregistered / 404), so this screen
 * cannot offer a contract picker — the create form collects a contract identifier
 * as raw text (no browse). `kind` is also required; `site` / `cycle` / `next_due`
 * are optional. The wire has NO `id` (server-generated) and NO `name` column
 * (backend gap) — those are not sent. See pm-asset-form.tsx for the flagged form.
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
/** Opaque list-row shape (the contract types the /pm/assets rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key (list + invalidation). */
const PM_ASSETS_KEY = ["pm", "assets"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /pm/assets — the tenant PM assets for the table (B-014 envelope `data`). */
export function usePmAssetList() {
  return useQuery<Row[]>({
    queryKey: PM_ASSETS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/pm/assets"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** The POST /pm/assets body (opaque Entity, so index-signed). `contract_id` +
 *  `kind` are required by the handler; the rest are optional real columns. */
export interface CreatePmAssetBody {
  [key: string]: unknown;
  contract_id: string;
  kind: string;
  site?: string;
  cycle?: string;
  next_due?: string;
}

/**
 * POST /pm/assets — register an asset under a PM contract. The server owns the id;
 * the asset is anchored on the contract's tenant-owned project (fail-closed).
 * Invalidates the asset catalogue on success.
 */
export function useCreatePmAsset(): UseMutationResult<
  Entity,
  unknown,
  CreatePmAssetBody
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePmAssetBody) =>
      unwrap(apiClient.POST("/pm/assets", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PM_ASSETS_KEY }),
  });
}
