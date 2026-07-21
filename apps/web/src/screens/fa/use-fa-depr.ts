/*
 * Data hooks for the FA Depreciation (fa.depr) + FA Adjustment (fa.adjust) screens.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md section 5, apps/web/CLAUDE.md). The prototype
 * held assets + adjustments in local state (ASSETS / ADJ_ROWS); here the server is the system of
 * record:
 *   GET  /fa/assets           -> the depreciable-asset catalogue (fa.ts listAssets; B-014 `.data`).
 *   POST /fa/run-depreciation -> post one month of straight-line depreciation per eligible asset
 *                                (fa.ts runDepreciation). The SERVER computes the amount
 *                                (cost - salvage)/life/12 and posts the JV; the client only sends
 *                                the period. The contract types the body { month? }, but the
 *                                handler reads `period` and defaults to the current CE month when
 *                                absent, so we send {} and let the server own the period. Idempotent
 *                                per (asset, period): a re-run skips already-posted assets (honest).
 *   GET  /fa/adjustments      -> the revalue / write-off history (fa.ts listAdjustments).
 *   POST /fa/revalue          -> revalue one asset { asset_id, new_value } (fa.ts revalue). Creates
 *                                the adjustment (status 'approved'); its GL posting is DEFERRED
 *                                server-side (no revaluation-surplus account in COA_SEED).
 *   POST /fa/write-off        -> dispose one asset { asset_id } (fa.ts writeOff). The SERVER derives
 *                                book_value = cost - accumulated_depr and posts the JV; the client
 *                                sends only the asset id.
 *
 * NOTE (honest wiring, reported): the task brief described a single POST /fa/adjustments draft ->
 * approve flow. The LIVE contract + handlers expose DEDICATED endpoints (POST /fa/revalue,
 * POST /fa/write-off) that create the adjustment AND post in one call (status 'approved'
 * immediately — there is no draft state and no separate approve op). These hooks wire the real
 * endpoints; a create-draft/approve pair would 404 against a route that does not exist.
 *
 * Bodies/responses are the opaque Entity/ActionOk from the contract.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types the fa rows as Entity). */
type Row = Record<string, unknown>;

const ASSETS_KEY = ["fa", "assets"] as const;
const ADJUSTMENTS_KEY = ["fa", "adjustments"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /fa/assets — the tenant's fixed-asset catalogue (B-014 envelope). */
export function useFaAssetList() {
  return useQuery<Row[]>({
    queryKey: ASSETS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/fa/assets"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /fa/adjustments — the tenant's revalue / write-off history (B-014 envelope). */
export function useFaAdjustments() {
  return useQuery<Row[]>({
    queryKey: ADJUSTMENTS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/fa/adjustments"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * POST /fa/run-depreciation — post one month of straight-line depreciation per eligible asset.
 * The SERVER computes the amount and posts the JV; we send an empty body so the handler uses the
 * current CE month (the contract's `month` field is a no-op the handler ignores — it reads
 * `period`). On success the asset list invalidates so the advanced accumulated depreciation
 * (and the shrunken book value) refresh.
 */
export function useRunDepreciation(): UseMutationResult<unknown, unknown, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST("/fa/run-depreciation", { body: {} })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ASSETS_KEY }),
  });
}

/** Request body of POST /fa/revalue (revalue one asset to a new carrying value). */
export interface RevalueBody {
  asset_id: string;
  new_value: number;
}

/**
 * POST /fa/revalue — revalue one asset. Creates the (approved) adjustment; its GL posting is
 * DEFERRED server-side. Invalidates both the asset list (its cost changes) and the adjustment
 * history (a new row appears).
 */
export function useRevalue(): UseMutationResult<unknown, unknown, RevalueBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RevalueBody) => unwrap(apiClient.POST("/fa/revalue", { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ASSETS_KEY });
      void qc.invalidateQueries({ queryKey: ADJUSTMENTS_KEY });
    },
  });
}

/** Request body of POST /fa/write-off (dispose one asset). */
export interface WriteOffBody {
  asset_id: string;
}

/**
 * POST /fa/write-off — dispose one asset. The SERVER derives the removed carrying amount and
 * posts the JV (deferred only when there is no carrying amount / a required COA account is
 * missing). Invalidates both the asset list (the asset flips to written_off) and the adjustment
 * history.
 */
export function useWriteOff(): UseMutationResult<unknown, unknown, WriteOffBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WriteOffBody) => unwrap(apiClient.POST("/fa/write-off", { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ASSETS_KEY });
      void qc.invalidateQueries({ queryKey: ADJUSTMENTS_KEY });
    },
  });
}
