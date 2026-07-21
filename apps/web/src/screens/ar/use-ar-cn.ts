/*
 * Data hooks for the AR Credit Note screen (ar.cn).
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype held the
 * register + its pickers in local arrays (ARCN_SEED / CUSTOMERS); here the server is the system of
 * record:
 *   GET  /ar/cn               -> the tenant credit notes (ar.ts listCn; B-014 paginated `.data`).
 *   POST /ar/cn               -> create a draft CN ({ no, customer_id, ref_invoice_id, amount,
 *                                reason }). The server IGNORES any client VAT and derives it from
 *                                amount; a bad customer/invoice/dup-no is a 400/404/409 (fail
 *                                closed). Invalidates the CN list on success.
 *   POST /ar/cn/{id}/approve  -> post the reversal JV via the posting-inbox (Dr revenue + Dr vat /
 *                                Cr AR, source_doc 'cn:<id>'). IDEMPOTENT: a re-approve is a 409 the
 *                                caller surfaces honestly (never a double post). Invalidates the CN
 *                                list on success.
 *   GET  /customers           -> the customer picker + table name resolution (customers.ts).
 *   GET  /ar/invoices         -> the invoice-to-credit picker + table ref resolution (ar.ts).
 *
 * Bodies/responses are the opaque Entity/ActionOk from the contract (additionalProperties).
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

const CN_KEY = ["ar", "cn"] as const;
const CUSTOMERS_KEY = ["customers"] as const;
const AR_INVOICES_KEY = ["ar", "invoices"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /ar/cn — the tenant credit notes (B-014 envelope `{ data, ... }`). */
export function useArCnList() {
  return useQuery<Row[]>({
    queryKey: CN_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/ar/cn"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /customers — the customer picker source + table name resolution. */
export function useCustomersList() {
  return useQuery<Row[]>({
    queryKey: CUSTOMERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/customers"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /ar/invoices — the invoice-to-credit picker source + table ref resolution. */
export function useArInvoicesList() {
  return useQuery<Row[]>({
    queryKey: AR_INVOICES_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/ar/invoices"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * POST /ar/cn — create a draft credit note. The caller composes the opaque body ({ no, customer_id,
 * ref_invoice_id, amount, reason }); the server re-validates the refs + owns the VAT/total.
 * Invalidates the CN list on success so the new row appears (honest).
 */
export function useCreateArCn(): UseMutationResult<Entity, unknown, Record<string, unknown>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unwrap(apiClient.POST("/ar/cn", { body: body as Entity })),
    onSuccess: () => qc.invalidateQueries({ queryKey: CN_KEY }),
  });
}

/**
 * POST /ar/cn/{id}/approve — post the CN's reversal JV through the posting-inbox. IDEMPOTENT: a
 * second approve is a 409 (never a double post) surfaced honestly by the caller. Invalidates the CN
 * list on success. NOTE: ar.ts does NOT flip the CN status column on approve (the approve marker is
 * the JV source_doc), so the row's badge will not change here — an honest backend gap the screen
 * reports (not a client fabrication).
 */
export function useApproveArCn(): UseMutationResult<Entity, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/ar/cn/{id}/approve", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: CN_KEY }),
  });
}
