/*
 * Data hooks for the PM module — the tenant's PM asset registry (pm.assets), the
 * read-only PM work-order list (pm.dashboard, B-108d), and the PM contract list
 * (pm.schedule, B-108a).
 *
 * Every read/write goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md section 5,
 * apps/web/CLAUDE.md). The prototype held its data in the local PM_ASSETS_BY_TYPE
 * arrays (pm.jsx L7-37); here the server is the system of record:
 *   GET  /pm/assets      -> the tenant PM assets (B-014 paginated envelope `.data`).
 *   POST /pm/assets      -> register a new asset under a PM contract.
 *   GET  /pm/workorders  -> the tenant PM work orders (read-only; the dashboard's
 *                           checklist-compliance derivation, B-108d).
 *   GET  /pm/contracts   -> the tenant PM contracts (read-only; the schedule's
 *                           web-side derivation, B-108a).
 * The create mutation invalidates the assets list so the new state appears.
 *
 * WIRE STATE (updated — the pre-0034 gaps are now closed on dev): assetWire carries
 * { id, contract_id, code, name, kind, site, cycle, next_due } — `code` + `name`
 * gained real columns in migration 0034 (B-110), so they now ride the wire (the
 * pm.assets list/detail still render an em-dash for them pending its re-port; the
 * pm.dashboard consumes them live). GET /pm/contracts is LIVE (registered Wave-2,
 * B-108) and is now consumed by usePmContractList (pm.schedule, B-108a) — no longer a
 * gated source. (The pm.assets create form still collects the contract id as raw text
 * pending its own re-port.)
 *
 * CREATE PATH. POST /pm/assets REQUIRES `contract_id` (400 otherwise) and resolves
 * it THROUGH the tenant scope (a foreign/absent id -> 404, apps/api/src/routes/pm.ts).
 * `kind` is also required; `site` / `cycle` / `next_due` are optional. The server
 * owns `id`; `name`/`code` are not sent by the current form (its re-port is pending).
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

/** Shared cache key for the PM work-order list (read-only). */
const PM_WORKORDERS_KEY = ["pm", "workorders"] as const;

/**
 * GET /pm/workorders — the tenant PM work orders, READ-ONLY for the dashboard's
 * checklist-compliance derivation (B-108d; B-014 envelope `data`). Mirrors
 * usePmAssetList: opaque Entity rows (the contract types /pm/workorders rows as
 * Entity), narrowed in pm-dashboard-rows.ts. No mutation is wired here (read-only).
 */
export function useWorkOrderList() {
  return useQuery<Row[]>({
    queryKey: PM_WORKORDERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/pm/workorders"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** Shared cache key for the PM contract list (read-only). */
const PM_CONTRACTS_KEY = ["pm", "contracts"] as const;

/**
 * GET /pm/contracts — the tenant PM contracts, READ-ONLY for the pm.schedule web-side
 * derivation (B-108a; B-014 envelope `data`). Mirrors usePmAssetList: opaque Entity
 * rows (the contract types /pm/contracts rows as Entity), narrowed by the consumer. No
 * mutation is wired here (read-only). This proves the Wave-2 source (B-108) is live —
 * the schedule fetches it alongside /pm/assets (see pm-schedule.tsx DEFAULT 3).
 */
export function usePmContractList() {
  return useQuery<Row[]>({
    queryKey: PM_CONTRACTS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/pm/contracts"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}
