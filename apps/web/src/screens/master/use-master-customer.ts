/*
 * Data hook for MasterCustomer (P2-WEB-40) — the tenant's customer register, READ-ONLY.
 *
 * The read goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype held
 * customers in local state (master-party.jsx CUSTOMER_SEED + setRows); here the server is the
 * system of record:
 *   GET /customers -> the catalogue (B-014 paginated envelope `.data`). The full tenant set is
 *                     fetched; the screen just lists it (LEAN read-only, B-135).
 *
 * There is intentionally NO create/update hook: POST /customers + PUT /customers/{id} are
 * declared in openapi.yaml but have NO handler in customers.ts (GET-only), so a write would be
 * a live 404. The screen surfaces add/edit as honest-disabled instead of wiring a mutation that
 * cannot persist. A future backend round adds the handlers; the create/update hooks land then.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types /customers rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the customer catalogue. */
const CUSTOMERS_KEY = ["customers"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /customers — the tenant customer catalogue for the table. B-014 paginated envelope
 * `{ data, ... }`; the screen consumes the page rows (`data`).
 */
export function useCustomerList() {
  return useQuery<Row[]>({
    queryKey: CUSTOMERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/customers"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}
