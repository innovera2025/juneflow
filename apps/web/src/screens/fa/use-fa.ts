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
 *   PUT  /fa/assets/{id} -> edit a fixed asset (updateFaAsset). Partial-merge: only the body keys
 *                       present are changed. Invalidates the register so the list + the (reopened)
 *                       detail modal show the edited row — there is no separate per-asset detail
 *                       query on the wire. Gated on finance `create` server-side.
 *   POST /fa/import  -> bulk-register client-PARSED rows (importFaAssets), atomic all-or-nothing.
 *                       STAGED wiring: the register import UI has NO file-upload/parse endpoint yet,
 *                       so the confirm only fires with genuinely-parsed rows (never the prototype's
 *                       fabricated mock rows — Section-0 rule 3). Gated on finance `create`.
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

/** The PUT /fa/assets/{id} body (updateFaAsset — opaque Entity, all keys optional / index-signed). */
export interface UpdateFaAssetBody {
  [key: string]: unknown;
  name?: string;
  cost?: number;
  salvage?: number;
  acquired_date?: string;
  life_years?: number;
  cc_id?: string;
  depr_method?: string;
}

/**
 * PUT /fa/assets/{id} — edit a fixed asset (curried by id, mirroring useCreateFaAsset's unwrap
 * pattern). Partial-merge: only the body keys present are changed server-side. Invalidates the
 * register on success — the list refetches and a reopened detail modal reads the fresh row (there
 * is no separate per-asset detail query on the wire).
 */
export function useUpdateFaAsset(id: string): UseMutationResult<Entity, unknown, UpdateFaAssetBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateFaAssetBody) =>
      unwrap(apiClient.PUT("/fa/assets/{id}", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: FA_ASSETS_KEY }),
  });
}

/** One row of the POST /fa/import body (importFaAssets — name required per row; opaque Entity). */
export interface ImportFaAssetRow {
  [key: string]: unknown;
  name: string;
  cost?: number;
  salvage?: number;
  acquired_date?: string;
  life_years?: number;
  cc_id?: string;
  depr_method?: string;
}

/** The POST /fa/import body — the client-PARSED rows to bulk-register (atomic all-or-nothing). */
export interface ImportFaAssetsBody {
  [key: string]: unknown;
  rows: ImportFaAssetRow[];
}

/**
 * POST /fa/import — bulk-register client-parsed fixed-asset rows. STAGED: the import UI has no
 * file-upload / parse endpoint yet, so this only fires with genuinely-parsed rows — never the
 * prototype's fabricated 24 mock rows (Section-0 rule 3). Invalidates the register on success.
 */
export function useImportFaAssets(): UseMutationResult<Entity, unknown, ImportFaAssetsBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportFaAssetsBody) => unwrap(apiClient.POST("/fa/import", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: FA_ASSETS_KEY }),
  });
}
