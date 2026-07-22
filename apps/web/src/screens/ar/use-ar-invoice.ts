/*
 * Data hooks for the AR Invoice / Billing screen (ar.invoice).
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 * The prototype held the list + customers in local state (AR_INV / window.CUSTOMER_SEED);
 * here the server is the system of record:
 *   GET  /ar/invoices  -> the tenant's AR invoices + their outstanding balance
 *                         (apps/api/src/routes/ar.ts listInvoices; B-014 envelope `.data`).
 *   POST /ar/invoices  -> create an invoice from customer + line items. MONEY AUTHORITY
 *                         (B-107a · Wei C-176): the server computes amount = Σ(qty × price)
 *                         and vat = 7% from the LINE ITEMS — the client sends only the
 *                         lines (never a client total) and reads the authoritative
 *                         amount/vat off the response. etax_status defaults 'queued'
 *                         server-side. Invalidates the invoice list on success.
 *   GET  /customers    -> the customer dropdown source (customers.ts; B-014 envelope).
 *
 * Bodies/responses are the opaque Entity from the contract.
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
/** Opaque list-row shape (the contract types /ar/invoices + /customers rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache keys (list + invalidation). */
const AR_INVOICES_KEY = ["ar", "invoices"] as const;
const CUSTOMERS_KEY = ["customers"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /ar/invoices — the tenant's AR invoices (B-014 envelope `.data`). */
export function useArInvoiceList() {
  return useQuery<Row[]>({
    queryKey: AR_INVOICES_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/ar/invoices"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /customers — the customer catalogue for the create-form dropdown. */
export function useCustomerList() {
  return useQuery<Row[]>({
    queryKey: CUSTOMERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/customers"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * The POST /ar/invoices body. `no` + `project_id` are handler-honoured fields that the
 * generated contract type omits (the openapi requestBody declares only customer_id /
 * lines / credit_term); this interface is a structural WIDTH-supertype of that type, so
 * it stays assignable to the client's body param while still carrying `no` at runtime.
 * MONEY AUTHORITY: the client NEVER sends amount/vat — only the line items.
 */
export interface CreateArInvoiceBody {
  customer_id: string;
  /** The invoice number — required by the handler (ar_invoice.no NOT NULL). */
  no: string;
  /** Owning project id (optional). */
  project_id?: string;
  /** Line items — the server computes amount = Σ(qty × price) + vat from these. */
  lines: { qty: number; price: number; description?: string }[];
}

/**
 * POST /ar/invoices — create an AR invoice from the customer + line items. The server
 * owns amount/vat (from the lines) + status ('open') + etax_status ('queued'); the
 * caller reads the authoritative figures off the response. Invalidates the list.
 */
export function useCreateArInvoice(): UseMutationResult<Entity, unknown, CreateArInvoiceBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateArInvoiceBody) =>
      unwrap(apiClient.POST("/ar/invoices", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: AR_INVOICES_KEY }),
  });
}
