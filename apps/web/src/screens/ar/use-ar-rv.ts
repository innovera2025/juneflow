/*
 * Data hooks for the AR Receive-Voucher screen (ar.rv) — the tenant's receipt
 * vouchers, the unpaid-invoice picker, and the create-RV action.
 *
 * Every read/write goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md §5,
 * apps/web/CLAUDE.md). The prototype held the RVs + invoices in local arrays;
 * here the server is the system of record:
 *   GET  /ar/rv       -> receipt vouchers (ar.ts listRv; B-014 paginated `.data`).
 *                        Empty on the current seed by design (AR Phase-5-deferred);
 *                        a real rv is minted via the create form below.
 *   GET  /ar/invoices -> AR invoices, each row carrying the server-computed
 *                        `outstanding` (ar.ts listInvoices; B-014 `.data`). The
 *                        create form filters these to the unpaid picker options.
 *   POST /ar/rv       -> record a receipt (B-121 frozen contract: { invoice_id,
 *                        amount, method? } — SINGLE invoice). The server validates
 *                        amount <= outstanding and REJECTS an over-payment with a
 *                        409 (never clamped); on success it flips the invoice to
 *                        `paid` when Σ rv >= amount + vat. Invalidates BOTH the rv
 *                        list and the invoice list (the paid-flip + outstanding
 *                        change the invoices too).
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
/** Opaque list-row shape (the contract types the AR rows as Entity). */
type Row = Record<string, unknown>;

const RV_KEY = ["ar", "rv"] as const;
const INVOICE_KEY = ["ar", "invoices"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /ar/rv — the tenant receipt vouchers (B-014 envelope `{ data, ... }`). */
export function useArRvList() {
  return useQuery<Row[]>({
    queryKey: RV_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/ar/rv"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * GET /ar/invoices — the tenant AR invoices (each row carrying `outstanding`). Used
 * to build the create form's unpaid-invoice picker (B-014 envelope `{ data, ... }`).
 */
export function useArInvoiceList() {
  return useQuery<Row[]>({
    queryKey: INVOICE_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/ar/invoices"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * POST /ar/rv — record a receipt voucher against a single invoice. The caller
 * composes the opaque body ({ invoice_id, amount, method? }); the server validates
 * the amount against the invoice outstanding (409 on over-payment, never clamped) +
 * owns status/currency/source. Invalidates both lists on success (the paid-flip +
 * outstanding change the invoices too).
 */
export function useCreateArRv(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/ar/rv", { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RV_KEY });
      qc.invalidateQueries({ queryKey: INVOICE_KEY });
    },
  });
}
