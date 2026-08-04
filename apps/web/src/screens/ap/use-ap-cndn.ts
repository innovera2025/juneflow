/*
 * Data hooks for the AP Credit/Debit Note screen (ap.cn-dn).
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype held the
 * register + its pickers in local arrays (the mock CN/DN rows + VENDOR_SEED); here the server is the
 * system of record (apps/api/src/routes/ap-cndn.ts):
 *   GET  /ap/cn                 -> the tenant AP credit notes (listApCn; B-014 paginated `.data`).
 *   GET  /ap/dn                 -> the tenant AP debit notes  (listApDn; B-014 `.data`).
 *   POST /ap/cn | /ap/dn        -> create a note ({ vendor_id, ref_ap_id, amount, reason }). money=
 *                                  SERVER: the server allocates the note `no`, stores THB, owns the
 *                                  status; a bad vendor (400) / foreign ap_billing (404) / amount<=0
 *                                  (400) fails closed. Invalidates the matching list on success.
 *   POST /ap/cn/{id}/approve    -> post the CN's Model-A JV (Dr 2010 AP / Cr 5020, no VAT). IDEMPOTENT
 *   POST /ap/dn/{id}/approve       (DN: Dr 5100 / Cr 2010 AP): a re-approve is a 409 on the reversal
 *                                  JV source_doc (never a double post). Invalidates the list.
 *
 * The pickers reuse the real sibling catalogues — useVendorList (GET /vendors -> vendor_id) and
 * useApBillingList (GET /ap/billing -> ref_ap_id) — imported by the form/register (no new hook).
 *
 * APPROVE-AFFORDANCE NOTE (design fidelity, ap.pv precedent): the prototype APCreditDebit register
 * has NO approve button (ap.jsx L340-378 end in a status badge, no action column). Surfacing an
 * approve button here would violate Juneflow §0 + fail the visual gate, so useApproveApCn/Dn are
 * WIRED + TYPED (idempotent, invalidating) and exported for a future approval flow, but NOT surfaced
 * on this screen — the identical decision use-ap.ts documents for useApprovePv.
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
/** Opaque list-row shape (the contract types the AP CN/DN rows as Entity). */
type Row = Record<string, unknown>;

const CN_KEY = ["ap", "cn"] as const;
const DN_KEY = ["ap", "dn"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /ap/cn — the tenant AP credit notes (B-014 envelope `{ data, ... }`). */
export function useApCnList() {
  return useQuery<Row[]>({
    queryKey: CN_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/ap/cn"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /ap/dn — the tenant AP debit notes (B-014 envelope `{ data, ... }`). */
export function useApDnList() {
  return useQuery<Row[]>({
    queryKey: DN_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/ap/dn"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * POST /ap/cn — create an AP credit note. The caller composes the opaque body ({ vendor_id,
 * ref_ap_id, amount, reason }); money=SERVER (the server allocates the `no`, stores THB, owns
 * status). Invalidates the CN list on success so the new row appears (honest).
 */
export function useCreateApCn(): UseMutationResult<Entity, unknown, Record<string, unknown>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unwrap(apiClient.POST("/ap/cn", { body: body as Entity })),
    onSuccess: () => qc.invalidateQueries({ queryKey: CN_KEY }),
  });
}

/** POST /ap/dn — create an AP debit note (same body contract as CN). Invalidates the DN list. */
export function useCreateApDn(): UseMutationResult<Entity, unknown, Record<string, unknown>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unwrap(apiClient.POST("/ap/dn", { body: body as Entity })),
    onSuccess: () => qc.invalidateQueries({ queryKey: DN_KEY }),
  });
}

/**
 * POST /ap/cn/{id}/approve — post the CN's Model-A JV (Dr 2010 AP / Cr 5020, no VAT) via ap-cndn.ts.
 * IDEMPOTENT: a re-approve is a 409 (never a double post) surfaced honestly by the caller. WIRED +
 * TYPED but NOT surfaced on this screen (design fidelity — see the header). Invalidates the CN list.
 */
export function useApproveApCn(): UseMutationResult<Entity, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/ap/cn/{id}/approve", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: CN_KEY }),
  });
}

/**
 * POST /ap/dn/{id}/approve — post the DN's Model-A JV (Dr 5100 / Cr 2010 AP, no VAT). IDEMPOTENT
 * (409 on a re-approve). WIRED + TYPED but NOT surfaced (design fidelity). Invalidates the DN list.
 */
export function useApproveApDn(): UseMutationResult<Entity, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/ap/dn/{id}/approve", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: DN_KEY }),
  });
}
