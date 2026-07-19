/*
 * Data hooks for SubconContracts (subcon.contracts port) — the tenant's subcon
 * contracts register.
 *
 * Every read/write goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md §5,
 * apps/web/CLAUDE.md). The prototype held its data in the local SUBC_CONTRACTS
 * array (subcon-accept.jsx:8-43); here the server is the system of record:
 *   GET  /subcon-contracts  -> the tenant subcon contracts (B-014 paginated
 *                              envelope `.data`; opaque Entity rows).
 *   POST /subcon-contracts  -> create a subcon contract, anchored on the active
 *                              project (project_id). The server owns the created
 *                              row; the create invalidates the list on success.
 *
 * The vendor + project catalogues the list/create pickers read reuse the shared
 * hooks (master/use-vendors, shell/use-shell-data) — the same tenant catalogues,
 * one shared query cache. Bodies/responses are the opaque Entity from the contract
 * (additionalProperties).
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
/** Opaque list-row shape (the contract types /subcon-contracts rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the subcon-contract register (list + invalidation). */
const SUBCON_CONTRACTS_KEY = ["subcon-contracts"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /subcon-contracts — the tenant's subcon contracts for the table. B-014
 * paginated envelope `{ data, ... }`; the screen consumes the page rows (`data`).
 */
export function useSubconContractList() {
  return useQuery<Row[]>({
    queryKey: SUBCON_CONTRACTS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/subcon-contracts"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * The POST /subcon-contracts body (createSubconContract requestBody — opaque
 * Entity, so index-signed). project_id/vendor_id/no are the server-required fields
 * (subcon.ts 400s without them); value/retention_pct/currency_code are the real
 * optional money fields. The distance/method autosplit is Wave-2 and NOT sent.
 */
export interface CreateSubconContractBody {
  [key: string]: unknown;
  project_id: string;
  vendor_id: string;
  no: string;
  value?: number;
  retention_pct?: number;
  currency_code?: string;
}

/**
 * POST /subcon-contracts — create a subcon contract anchored on the active
 * project. Invalidates the register on success so the new row appears.
 */
export function useCreateSubconContract(): UseMutationResult<
  Entity,
  unknown,
  CreateSubconContractBody
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSubconContractBody) =>
      unwrap(apiClient.POST("/subcon-contracts", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUBCON_CONTRACTS_KEY }),
  });
}
