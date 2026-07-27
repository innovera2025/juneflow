/*
 * Data hooks for the Down-Payment register screen (sales.down) — the tenant's down
 * instalments (the register), the contracted-unit picker for the receive modal, and
 * the receive-instalment write.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 * The prototype held the register + receive form in local mocks; here the server is the
 * system of record:
 *   GET  /sales/downs      -> every sales_unit's down instalments flattened to one row
 *                             per instalment (land-sales.ts listDowns; B-014 `.data`).
 *                             aggregateByUnit folds these into the per-unit register.
 *   GET  /sales/contracts  -> contracted sales units for the receive-modal unit picker
 *                             (land-sales.ts listContracts; B-014 `.data`). Carries
 *                             customer_id (resolved via GET /customers) + the
 *                             sales_unit_id the POST targets.
 *   POST /sales/downs      -> record one down instalment (money=SERVER). The client
 *                             sends ONLY { sales_unit_id, amount, paid_at? }; the server
 *                             auto-assigns the seq (existing + 1), posts + balances the
 *                             receipt JV (Dr 1020 / Cr 2040 = amount), and returns
 *                             jv_no. A duplicate seq answers 409 (idempotent replay).
 *                             Invalidates BOTH the downs register (a new instalment) and
 *                             the contracts list (the unit's `down` array changed).
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
/** Opaque list-row shape (the contract types the sales rows as Entity). */
type Row = Record<string, unknown>;

const DOWNS_KEY = ["sales", "downs"] as const;
const CONTRACTS_KEY = ["sales", "contracts"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /sales/downs — the tenant down-payment instalments (B-014 envelope `{ data, ... }`),
 * one row per instalment. aggregateByUnit (sales-down-rows.ts) folds them into the
 * per-unit register the table renders.
 */
export function useSalesDowns() {
  return useQuery<Row[]>({
    queryKey: DOWNS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/sales/downs"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * GET /sales/contracts — the contracted sales units for the receive-modal unit picker
 * (B-014 envelope `{ data, ... }`). Each row carries the sales_unit_id (the POST target)
 * + a customer_id resolved to a name via GET /customers (useCustomerList).
 */
export function useSalesContracts() {
  return useQuery<Row[]>({
    queryKey: CONTRACTS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/sales/contracts"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * POST /sales/downs — record one down instalment against a single sales unit. The caller
 * composes the opaque body ({ sales_unit_id, amount, paid_at? } — money=SERVER, never a
 * seq/Dr/Cr/jv). The server assigns the seq, posts + balances the receipt JV, and owns
 * jv_no; a duplicate seq answers 409. Invalidates both lists on success (the register
 * gains an instalment; the contract unit's `down` array changed).
 */
export function useCreateSalesDown(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/sales/downs", { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DOWNS_KEY });
      qc.invalidateQueries({ queryKey: CONTRACTS_KEY });
    },
  });
}
