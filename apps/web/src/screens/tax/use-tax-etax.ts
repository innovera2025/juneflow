/*
 * Data hooks for the e-Tax Invoice register screen (tax.etax).
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md section 5, apps/web/CLAUDE.md). The prototype
 * held the register in local state (ETAX_SEED); here the server is the system of record:
 *   GET  /etax/status  -> the HONEST per-status aggregate (apps/api/src/routes/etax.ts
 *                         getEtaxStatus): one { etax_status, count } row per enum value. Typed
 *                         EntityOk (a single opaque Entity that wraps the list envelope), so the
 *                         rows are read defensively off `.data`. Drives the KPI counts (B-124:
 *                         real status counts only, never a fabricated RD receipt).
 *   GET  /ar/invoices  -> the invoice register rows (ar.ts listInvoices, B-014 paginated `.data`):
 *                         { id, no, customer_id, amount, vat, etax_status, created_at, ... }. The
 *                         table body + the total-amount KPI + the queued batch-send set.
 *   GET  /customers    -> customer_id -> { name, tax_id } for the register's customer column
 *                         (customers.ts listCustomers; both fields are REAL columns). Joined
 *                         client-side rather than em-dashing a customer name that IS wired.
 *   POST /etax/send    -> flip a queued/rejected batch to sent (etax.ts sendEtax — the ONLY real
 *                         mutation; FakeTaxEngine stub, NO fabricated RD ack). Invalidates the
 *                         status + invoices queries on success so the badges + KPIs surface the
 *                         real resulting state.
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

/** Opaque row shape (the contract types these register rows as Entity). */
type Row = Record<string, unknown>;

const ETAX_STATUS_KEY = ["etax", "status"] as const;
const AR_INVOICES_KEY = ["ar", "invoices"] as const;
const CUSTOMERS_KEY = ["customers"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** Read the envelope rows off an opaque response `.data` (EntityOk wraps the list envelope). */
function envelopeRows(env: unknown): Row[] {
  const data = (env as { data?: unknown }).data;
  return Array.isArray(data) ? (data as Row[]) : [];
}

/** GET /etax/status — the honest per-status aggregate (queued | sent | rejected | void). */
export function useEtaxStatus() {
  return useQuery<Row[]>({
    queryKey: ETAX_STATUS_KEY,
    queryFn: async () => envelopeRows(await unwrap(apiClient.GET("/etax/status"))),
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /ar/invoices — the invoice register rows (table body + queued send set). */
export function useArInvoices() {
  return useQuery<Row[]>({
    queryKey: AR_INVOICES_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/ar/invoices"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /customers — customer_id -> { name, tax_id } source for the register's customer column. */
export function useCustomers() {
  return useQuery<Row[]>({
    queryKey: CUSTOMERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/customers"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** Request body of POST /etax/send (the queued/rejected invoice ids to send). */
export interface SendEtaxBody {
  invoice_ids: string[];
}

/**
 * POST /etax/send — flip the given queued/rejected invoices to sent (the ONLY real mutation on
 * this screen; FakeTaxEngine stub — NO fabricated RD acknowledgement, Wei B-124). On
 * success it invalidates the status + invoices queries so the KPI counts and status badges
 * surface the real resulting state (the honest feedback; there is no ack toast to fabricate).
 */
export function useSendEtax(): UseMutationResult<unknown, unknown, SendEtaxBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SendEtaxBody) => unwrap(apiClient.POST("/etax/send", { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ETAX_STATUS_KEY });
      qc.invalidateQueries({ queryKey: AR_INVOICES_KEY });
    },
  });
}
