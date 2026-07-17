/*
 * Data hooks for the GL screens (P2-WEB-13) — the tenant's chart of accounts, the
 * journal-voucher list + create, and the cost centres the JV form binds lines to.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 * The prototype held all of this in local state (COA_SEED, JV_LIST); here the server is
 * the system of record:
 *   GET  /gl/coa       -> the chart of accounts (apps/api/src/routes/gl.ts getCoa).
 *   GET  /gl/jv        -> the journal-voucher list (listJv; B-014 paginated `.data`).
 *   POST /gl/jv        -> create a balanced JV (createJv enforces Σ dr === Σ cr > 0 and
 *                         tenant ownership of every account/cc; a 400 is surfaced by the
 *                         caller). Invalidates the JV list on success.
 *   GET  /cost-centers -> the cost-centre catalogue for the JV form's optional cc picker.
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
/** Opaque list-row shape (the contract types the GL rows as Entity). */
type Row = Record<string, unknown>;

const COA_KEY = ["gl", "coa"] as const;
const JV_KEY = ["gl", "jv"] as const;
const COST_CENTERS_KEY = ["cost-centers"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /gl/coa — the tenant chart of accounts (B-014 envelope `{ data, ... }`). */
export function useCoaList() {
  return useQuery<Row[]>({
    queryKey: COA_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/gl/coa"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /gl/jv — the tenant journal-voucher list (B-014 envelope `{ data, ... }`). */
export function useJvList() {
  return useQuery<Row[]>({
    queryKey: JV_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/gl/jv"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /cost-centers — cost centres for the JV form's optional per-line cc picker. */
export function useCostCenters() {
  return useQuery<Row[]>({
    queryKey: COST_CENTERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/cost-centers"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * POST /gl/jv — create a balanced journal voucher. The caller composes the opaque body
 * ({ no, memo?, lines: [{ account_id, dr, cr, cc_id? }] }); the server re-validates the
 * Σ dr === Σ cr > 0 balance + tenant ownership and answers 400 on a violation (surfaced
 * by onError). Invalidates the JV list on success.
 */
export function useCreateJv(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/gl/jv", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: JV_KEY }),
  });
}
