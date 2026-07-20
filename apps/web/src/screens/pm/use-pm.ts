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

/** The POST /pm/workorders body (opaque Entity, index-signed). `asset_id` is
 *  required by the handler; `tech` is the one other real stored column the create
 *  form collects (type/date have no column — dropped, not fabricated). */
export interface CreateWorkorderBody {
  [key: string]: unknown;
  asset_id: string;
  tech?: string;
}

/**
 * POST /pm/workorders — open a work order on an asset (pm3.jsx PMWOForm). The server
 * owns the id; with no template the checklist snapshot starts empty (honest — the
 * mock's `open` WO also starts empty). Invalidates the WO list on success.
 */
export function useCreateWorkorder(): UseMutationResult<
  Entity,
  unknown,
  CreateWorkorderBody
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkorderBody) =>
      unwrap(apiClient.POST("/pm/workorders", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PM_WORKORDERS_KEY }),
  });
}

/** Check-in args — the WO id plus a REAL captured GPS fix ("lat,lng"). */
export interface CheckinArgs {
  id: string;
  gps: string;
}

/**
 * POST /pm/workorders/{id}/checkin {gps} — the tech records their on-site GPS fix
 * (pm3.jsx check-in action). The gps is captured live from the browser (DEFAULT 2,
 * never fabricated). Invalidates the WO list so the checked-in state appears.
 */
export function useCheckinWorkorder(): UseMutationResult<unknown, unknown, CheckinArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, gps }: CheckinArgs) =>
      unwrap(apiClient.POST("/pm/workorders/{id}/checkin", { params: { path: { id } }, body: { gps } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PM_WORKORDERS_KEY }),
  });
}

/** Update-checklist args — the WO id plus the FULL positional item list (result per
 *  line; the server preserves the snapshot labels by position, pm.ts mergeChecklistRow). */
export interface UpdateChecklistArgs {
  id: string;
  items: { result: string }[];
}

/**
 * PUT /pm/workorders/{id}/checklist {items} — autosave the checklist results
 * (DEFAULT 3: no explicit Save button; each tap persists). The body carries the full
 * item list positionally (result "" for an unfilled line -> the server omits it,
 * preserving the captured label). Invalidates the WO list on success.
 */
export function useUpdateChecklist(): UseMutationResult<unknown, unknown, UpdateChecklistArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: UpdateChecklistArgs) =>
      unwrap(apiClient.PUT("/pm/workorders/{id}/checklist", { params: { path: { id } }, body: { items } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PM_WORKORDERS_KEY }),
  });
}

/** Close args — the WO id plus the REAL maintenance-log columns (cause/fix/advice).
 *  No `signature` is sent: the prototype's pad is decorative and captures nothing, so
 *  customer_sign is never fabricated (DEFAULT 5, FLAG — close records the log only). */
export interface CloseWorkorderArgs {
  id: string;
  cause: string;
  fix: string;
  advice: string;
}

/**
 * POST /pm/workorders/{id}/close — close a work order, persisting the real cause/fix/
 * advice maintenance log (pm3.jsx closeWO). The customer signature is NOT sent (the
 * pad is decorative — sending a fabricated signature would violate PLAN.md §0). The
 * server's LINE cert-push is a no-op stub (B-108b). Invalidates the WO list on success.
 */
export function useCloseWorkorder(): UseMutationResult<unknown, unknown, CloseWorkorderArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cause, fix, advice }: CloseWorkorderArgs) =>
      unwrap(
        apiClient.POST("/pm/workorders/{id}/close", {
          params: { path: { id } },
          body: { cause, fix, advice },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: PM_WORKORDERS_KEY }),
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
