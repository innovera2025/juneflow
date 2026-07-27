/*
 * Data hooks for the Sales Process screen (sales.process) — the unit-grid + booking /
 * contract write surface (money=SERVER). Every read/write goes through the generated
 * typed client (api-client.ts) + TanStack Query via unwrap() — no hand-written
 * models/fetch (PLAN.md sec.5, apps/web/CLAUDE.md).
 *
 * The prototype held its 84-cell grid + CUSTOMER_SEED in local mocks; here the server
 * is the system of record:
 *   GET  /projects/{id}/hierarchy -> the active project's phase/block/unit tree, the
 *        SA-3 unit-grid derive source (reused via useProjectHierarchy, master module).
 *   GET  /sales/bookings          -> booked units (overlay + sales_unit-id source).
 *   GET  /sales/contracts         -> contracted units (overlay).
 *   GET  /customers               -> the CustomerPicker options (replaces CUSTOMER_SEED).
 *   POST /sales/bookings          -> book a unit + post its receipt JV. MONEY AUTHORITY
 *        (land-sales.ts createSalesBooking): the client sends ONLY {unit_id, amount,
 *        customer_id}; the SERVER posts Dr 1020 / Cr 2040 = amount and returns jv_no.
 *        Requires the finance.create permission (B-082 F1 -> 403 without it).
 *   POST /sales/contracts         -> sign a contract for an already-booked unit. The
 *        client sends {sales_unit_id, amount}; NO JV (contract = unit metadata).
 *
 * Bodies/responses are the opaque Entity from the contract (openapi declares the
 * booking/contract bodies as Entity), so the POST bodies are cast to the client's
 * opaque param (mirrors master useCreateProjectNode). The client NEVER sends Dr/Cr,
 * account codes, or a JV/RV number.
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

/** Opaque list-row / response shape (the contract types these as Entity). */
type Row = Record<string, unknown>;

/** Shared cache keys (reads + invalidation). */
const SALES_BOOKINGS_KEY = ["sales", "bookings"] as const;
const SALES_CONTRACTS_KEY = ["sales", "contracts"] as const;
const CUSTOMERS_KEY = ["customers"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

// Re-export the shared hierarchy hook so the screen has a single sales import surface
// (the grid derive source; identical query key so it dedupes with MasterProject).
export { useProjectHierarchy } from "../master/use-project-hierarchy";

/** GET /sales/bookings — the tenant's booked units (B-014 envelope `.data`). */
export function useSalesBookings() {
  return useQuery<Row[]>({
    queryKey: SALES_BOOKINGS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/sales/bookings"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /sales/contracts — the tenant's contracted units (B-014 envelope `.data`). */
export function useSalesContracts() {
  return useQuery<Row[]>({
    queryKey: SALES_CONTRACTS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/sales/contracts"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /customers — the CustomerPicker options (replaces the mock CUSTOMER_SEED). */
export function useSalesCustomers() {
  return useQuery<Row[]>({
    queryKey: CUSTOMERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/customers"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * The POST /sales/bookings body. MONEY AUTHORITY: only the trigger fields — the
 * server computes + posts the JV (Dr 1020 / Cr 2040 = amount) and returns jv_no.
 */
export interface CreateBookingBody {
  /** The STABLE project_node id of the unit to book (required). */
  unit_id: string;
  /** The received booking amount (required, finite > 0) — the server validates it. */
  amount: number;
  /** The buyer customer id (optional). */
  customer_id?: string;
}

/**
 * POST /sales/bookings — book a unit + post its receipt JV. On success the response
 * carries the server-posted jv_no (never sent by the client). Invalidates the
 * bookings register so the grid re-derives with the new "booked" overlay.
 */
export function useCreateSalesBooking(): UseMutationResult<Row, unknown, CreateBookingBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBookingBody) =>
      unwrap(apiClient.POST("/sales/bookings", { body: body as never })),
    onSuccess: () => qc.invalidateQueries({ queryKey: SALES_BOOKINGS_KEY }),
  });
}

/**
 * The POST /sales/contracts body. NO JV — the server records contract = amount +
 * stage = "contract" on the (already-booked) sales_unit ROW.
 */
export interface CreateContractBody {
  /** The sales_unit ROW id (exists only after a booking) — required. */
  sales_unit_id: string;
  /** The agreed contract price (required, > 0). */
  amount: number;
}

/**
 * POST /sales/contracts — sign the contract for an already-booked unit. Invalidates
 * the contracts (+ bookings) registers so the grid re-derives with the "sold" overlay.
 */
export function useCreateSalesContract(): UseMutationResult<Row, unknown, CreateContractBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateContractBody) =>
      unwrap(apiClient.POST("/sales/contracts", { body: body as never })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SALES_CONTRACTS_KEY });
      qc.invalidateQueries({ queryKey: SALES_BOOKINGS_KEY });
    },
  });
}
