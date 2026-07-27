/*
 * Data hook for the Sales loan & transfer module — the tenant's loan-application
 * register (sales.loan), READ-ONLY.
 *
 * Every read goes through the generated typed client (api-client.ts) + TanStack Query
 * via unwrap() — no hand-written models/fetch (PLAN.md section 5, apps/web/CLAUDE.md).
 * The prototype held its register in a local mock array (sales-process.jsx SalesLoan
 * L542-548); here the server is the system of record:
 *   GET /sales/loans -> the tenant loan applications (B-014 paginated envelope `.data`),
 *                       ordered newest-first (land-sales.ts listLoans).
 *
 * WRITE (honest-disabled — reported, never fabricated): the screen's two prototype
 * actions have no wireable home here, so no mutation is exposed:
 *   - "record transfer" (btnRecordTransfer) targets the deferred sales.transfer screen
 *     (its GL-posting transfer endpoint is not in scope) -> the button is disabled.
 *   - POST /sales/loans (record a loan application) DOES exist on the API, but the
 *     prototype's SalesLoan screen has no create-loan form and B-153 minted no
 *     create-form i18n keys; consume-only forbids minting, fidelity forbids inventing a
 *     form, so no create mutation is wired here (see sales-loan.tsx header + the port
 *     report). If a create form is later approved, add a useMutation + queryClient
 *     invalidate(SALES_LOANS_KEY) here (po-wo precedent).
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types /sales/loans rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the loan-application register (read-only). */
const SALES_LOANS_KEY = ["sales", "loans"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /sales/loans — the tenant loan applications for the register (B-014 envelope
 * `.data`). Opaque Entity rows narrowed by toLoanRow (sales-loan-rows.ts). Read-only:
 * no mutation is wired (see the module header for the honest-disabled write rationale).
 */
export function useSalesLoans() {
  return useQuery<Row[]>({
    queryKey: SALES_LOANS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/sales/loans"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}
