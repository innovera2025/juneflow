/*
 * Data hooks for the AP screens (P2-WEB-14) — the tenant's AP billings + payment
 * vouchers (PV), and the PV approval action.
 *
 * Every read/write goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md §5,
 * apps/web/CLAUDE.md). The prototype held all of this in local arrays (AP_BILL,
 * PV_LIST); here the server is the system of record:
 *   GET  /ap/billing        -> AP billings (listBilling; B-014 paginated `.data`).
 *   POST /ap/billing        -> create a billing (widened body: vendor_id + amount
 *                              required, gr/wo/po ref + invoice_no + vat + wht +
 *                              retention + due_date optional). The server derives
 *                              the WHT leg via @juneflow/tax-engine when omitted and
 *                              answers 400 on a bad vendor/amount/ref (fail closed).
 *                              Invalidates the billing list on success.
 *   GET  /ap/pv             -> payment vouchers (listPv; B-014 `.data`).
 *   POST /ap/pv             -> create a PV (billing_ids + amount required; method +
 *                              wht_pct + retention + cheque_* optional). net = gross
 *                              - WHT - retention is the server's tax-engine result.
 *                              Invalidates the PV list on success.
 *   POST /pv/{id}/approve   -> the server-enforced PV approval ladder (finance
 *                              approve perm + the 500K/2M approvalLevel tiers). This
 *                              hook is WIRED + TYPED but the ap.pv prototype list has
 *                              NO approve affordance (only a status badge, ap.jsx
 *                              L226), so surfacing a button here would violate design
 *                              fidelity (Juneflow §0). It is exported for a future
 *                              approval flow/screen and invalidates the PV list.
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
/** Opaque list-row shape (the contract types the AP rows as Entity). */
type Row = Record<string, unknown>;

const BILLING_KEY = ["ap", "billing"] as const;
const PV_KEY = ["ap", "pv"] as const;
const DEPOSIT_KEY = ["ap", "deposit"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /ap/billing — the tenant AP billings (B-014 envelope `{ data, ... }`). */
export function useApBillingList() {
  return useQuery<Row[]>({
    queryKey: BILLING_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/ap/billing"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /ap/pv — the tenant payment vouchers (B-014 envelope `{ data, ... }`). */
export function useApPvList() {
  return useQuery<Row[]>({
    queryKey: PV_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/ap/pv"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /ap/deposit — the tenant vendor-deposit register (B-014 envelope `{ data, ... }`). */
export function useApDepositList() {
  return useQuery<Row[]>({
    queryKey: DEPOSIT_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/ap/deposit"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * POST /ap/billing — create an AP billing. The caller composes the opaque body
 * ({ vendor_id, amount, gr_id?, invoice_no?, due_date?, vat?, wht? }); the server
 * re-validates the vendor/amount/refs and derives the WHT leg. Invalidates on success.
 */
export function useCreateApBilling(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/ap/billing", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: BILLING_KEY }),
  });
}

/**
 * POST /ap/pv — create a payment voucher. The caller composes the opaque body
 * ({ billing_ids, amount, wht_pct?, retention?, method?, cheque_* }); the server
 * re-computes net via the tax-engine + owns status ("pending"). Invalidates on success.
 */
export function useCreateApPv(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/ap/pv", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PV_KEY }),
  });
}

/**
 * POST /ap/deposit — create a vendor deposit. The caller composes the opaque body
 * ({ vendor_id, amount, po_id?, wo_id?, pct? }); the server re-validates the
 * vendor/amount/refs, allocates the DP-no, computes the balance/status, and posts the
 * balanced JV (Dr 1160 / Cr 1010) from the STORED amount (money=SERVER). Invalidates on
 * success.
 */
export function useCreateApDeposit(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/ap/deposit", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: DEPOSIT_KEY }),
  });
}

/**
 * POST /pv/{id}/approve — the server-enforced PV approval ladder (see header). Wired
 * + typed; not surfaced on the ap.pv screen (the prototype list has no approve
 * affordance — design fidelity). Invalidates the PV list on success.
 */
export function useApprovePv(): UseMutationResult<Entity, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/pv/{id}/approve", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PV_KEY }),
  });
}
