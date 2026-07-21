/*
 * Data hooks for FARegister (fa.register) — the tenant's fixed-asset register + the create
 * (register-an-asset) mutation.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md section 5, apps/web/CLAUDE.md). The prototype
 * held its data in a local ASSETS array (fa.jsx L3-12); here the server is the system of record:
 *   GET  /fa/assets  -> the tenant fixed assets (B-014 paginated envelope `.data`; apps/api/src/
 *                       routes/fa.ts listFaAssets -> assetWire, migration-0035 superset).
 *   POST /fa/assets  -> register a fixed asset. The server owns id + status ("active") and derives
 *                       book_value; the body carries { name (required), cost?, salvage?,
 *                       acquired_date?, life_years?, cc_id?, depr_method? }. Gated on the finance
 *                       `create` permission server-side (fa.ts / B-082). Invalidates the register.
 *
 * Bodies/responses are the opaque Entity from the contract (additionalProperties). The write is
 * finance-staff work behind the tenant door — a 403 (missing perm) / 400 (validation) surfaces
 * honestly to the caller.
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
/** Opaque list-row shape (the contract types /fa/assets rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the fixed-asset register (list + invalidation). */
const FA_ASSETS_KEY = ["fa", "assets"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /fa/assets — the tenant fixed-asset register for the table. B-014 paginated envelope
 * `{ data, ... }`; the screen consumes the page rows (`data`).
 */
export function useFaAssetList() {
  return useQuery<Row[]>({
    queryKey: FA_ASSETS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/fa/assets"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** The POST /fa/assets body (createFaAsset requestBody — opaque Entity, so index-signed). */
export interface CreateFaAssetBody {
  [key: string]: unknown;
  name: string;
  cost?: number;
  salvage?: number;
  acquired_date?: string;
  life_years?: number;
  cc_id?: string;
  depr_method?: string;
}

/**
 * POST /fa/assets — register a fixed asset. Server owns id + status ("active") + the derived
 * book_value. Invalidates the register catalogue on success so the new asset appears.
 */
export function useCreateFaAsset(): UseMutationResult<Entity, unknown, CreateFaAssetBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFaAssetBody) => unwrap(apiClient.POST("/fa/assets", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: FA_ASSETS_KEY }),
  });
}
