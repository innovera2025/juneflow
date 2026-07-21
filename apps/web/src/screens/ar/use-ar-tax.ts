/*
 * Data hooks for the AR Tax Invoice / Receipt screen (ar.tax).
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack Query
 * via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype
 * held the register in a local array (ar.jsx L195-200); here the server is the system of
 * record:
 *   GET  /ar/tax-register            -> the DERIVED tax register (one row per ar_invoice =
 *                                       one tax invoice · Wei B-121 Q6; apps/api/src/routes/
 *                                       ar.ts listTaxRegister, B-014 paginated `.data`).
 *   POST /ar/tax-register/{id}/cancel -> void an invoice's e-Tax (etax_status = 'void',
 *                                       finance.approve gated · ar.ts cancelTaxRegister).
 *                                       This op EXISTS + is WIRED + TYPED here, but the
 *                                       ar.jsx ARTaxInvoice prototype has NO per-row cancel
 *                                       affordance (only a status badge, ar.jsx L216), so
 *                                       surfacing a button would violate design fidelity
 *                                       (Juneflow §0) — the same as ap.ts useApprovePv. It is
 *                                       exported for a future void flow and invalidates the
 *                                       register list on success.
 *
 * Bodies/responses are the opaque Entity/ActionOk from the contract (additionalProperties).
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

/** Opaque list-row shape (the contract types the tax-register rows as Entity). */
type Row = Record<string, unknown>;

const TAX_REGISTER_KEY = ["ar", "tax-register"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /ar/tax-register — the tenant's DERIVED tax register (B-014 envelope `{ data, ... }`). */
export function useArTaxRegister() {
  return useQuery<Row[]>({
    queryKey: TAX_REGISTER_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/ar/tax-register"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * POST /ar/tax-register/{id}/cancel — void an invoice's e-Tax (see header). WIRED + TYPED but
 * NOT surfaced on the ar.tax screen (the prototype list has no cancel affordance — design
 * fidelity). Invalidates the register list on success so the voided row flips to its real
 * cancelled state.
 */
export function useCancelTaxRegister(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/ar/tax-register/{id}/cancel", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: TAX_REGISTER_KEY }),
  });
}
