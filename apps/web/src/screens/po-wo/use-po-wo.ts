/*
 * Data hooks for POList / WOList (P2-WEB-10) — the tenant's purchase orders +
 * work orders, plus the approved PRs / vendors / projects that back their list
 * resolvers and create forms.
 *
 * Every read/write goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md §5,
 * apps/web/CLAUDE.md). The prototype held its data in local PO_ROWS / WO_ROWS /
 * PR_FOR_PO arrays (po-wo.jsx:3, forms.jsx:142); here the server is the system of
 * record:
 *   GET  /po  -> the tenant purchase orders (B-014 paginated envelope `.data`).
 *   GET  /wo  -> the tenant work orders.
 *   GET  /pr  -> the tenant purchase requests (refPR resolution + create picker;
 *                only "approved" PRs may raise a PO/WO, po.ts/wo.ts).
 *   POST /po|/wo               -> raise a draft doc from an approved PR + vendor.
 *   POST /po|/wo/{id}/submit   -> draft -> pending (the create form does both:
 *                create then submit, matching the prototype's "create + send-for-approval").
 *   POST /po|/wo/{id}/approve  -> pending -> approved (tiered authority: Procurement
 *                head every doc; Project Manager > 1M; MD > 5M — flows.html, B-070).
 *   POST /po|/wo/{id}/reject {reason}   -> pending -> rejected.
 *   POST /po/{id}/variation-order {dir,amount,reason} -> amend a PO's total.
 * Every mutation invalidates the affected list so the new state appears.
 *
 * NOTE (honest wiring): the prototype's po.list / wo.list DETAIL panels do not
 * surface submit/approve/reject buttons (approval is routed through the approvals
 * inbox, P2-BE-07) — so those mutation hooks are the module's public API but are
 * consumed by the create flow (submit) + the WO "approve-installment" action (approve,
 * flagged semantic-approximation), not by fabricated buttons this screen lacks.
 *
 * Vendor + project reads reuse the shared hooks (master/use-vendors,
 * shell/use-shell-data) — the same tenant catalogues, one shared query cache.
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
/** Opaque list-row shape (the contract types /po, /wo, /pr rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache keys (list + invalidation). */
const PO_KEY = ["po"] as const;
const WO_KEY = ["wo"] as const;
const PR_KEY = ["pr"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /po — the tenant purchase orders for the table (B-014 envelope `data`). */
export function usePoList() {
  return useQuery<Row[]>({
    queryKey: PO_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/po"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /wo — the tenant work orders for the table. */
export function useWoList() {
  return useQuery<Row[]>({
    queryKey: WO_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/wo"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /pr — the tenant PRs (refPR resolution + create-form approved-PR picker). */
export function usePrList() {
  return useQuery<Row[]>({
    queryKey: PR_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/pr"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** The POST /po body (createPo requestBody — opaque Entity, so index-signed). */
export interface CreatePoBody {
  [key: string]: unknown;
  pr_id: string;
  vendor_id: string;
  credit_term?: number;
  vat?: number;
}

/** The POST /wo body (createWo requestBody — opaque Entity, so index-signed). */
export interface CreateWoBody {
  [key: string]: unknown;
  pr_id: string;
  vendor_id: string;
  value?: number;
  retention_pct?: number;
}

/**
 * POST /po — raise a draft PO from an approved PR + vendor. Server owns status
 * (draft) + approval_step (0) + the total (seeded from the source PR's lines).
 * Invalidates the PO catalogue on success.
 */
export function useCreatePo(): UseMutationResult<Entity, unknown, CreatePoBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePoBody) => unwrap(apiClient.POST("/po", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PO_KEY }),
  });
}

/** POST /wo — raise a draft WO from an approved PR + vendor + contract value. */
export function useCreateWo(): UseMutationResult<Entity, unknown, CreateWoBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWoBody) => unwrap(apiClient.POST("/wo", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: WO_KEY }),
  });
}

/** POST /po/{id}/submit — draft -> pending. Invalidates the PO list on success. */
export function useSubmitPo(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/po/{id}/submit", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PO_KEY }),
  });
}

/** POST /wo/{id}/submit — draft -> pending. */
export function useSubmitWo(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/wo/{id}/submit", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: WO_KEY }),
  });
}

/** POST /po/{id}/approve — pending -> approved (tiered authority; 403 if under-tier). */
export function useApprovePo(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/po/{id}/approve", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PO_KEY }),
  });
}

/** POST /wo/{id}/approve — pending -> approved (tiered authority). */
export function useApproveWo(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/wo/{id}/approve", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: WO_KEY }),
  });
}

/** Reject args — the doc id plus the contract-required reason. */
export interface RejectArgs {
  id: string;
  reason: string;
}

/** POST /po/{id}/reject {reason} — pending -> rejected. */
export function useRejectPo(): UseMutationResult<unknown, unknown, RejectArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: RejectArgs) =>
      unwrap(apiClient.POST("/po/{id}/reject", { params: { path: { id } }, body: { reason } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PO_KEY }),
  });
}

/** POST /wo/{id}/reject {reason} — pending -> rejected. */
export function useRejectWo(): UseMutationResult<unknown, unknown, RejectArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: RejectArgs) =>
      unwrap(apiClient.POST("/wo/{id}/reject", { params: { path: { id } }, body: { reason } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: WO_KEY }),
  });
}

/** Variation-order args — the PO id plus the add/cut amendment. */
export interface VariationOrderArgs {
  id: string;
  dir: "add" | "cut";
  amount: number;
  reason?: string;
}

/**
 * POST /po/{id}/variation-order {dir,amount,reason} — attach an add/cut amendment
 * and amend the PO's stored total. Invalidates the PO list on success. (WO has no
 * variation-order endpoint on the wire — wo.ts; the WO detail's variation action is
 * therefore presentational, flagged in wo-list.tsx.)
 */
export function useCreatePoVariationOrder(): UseMutationResult<
  unknown,
  unknown,
  VariationOrderArgs
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dir, amount, reason }: VariationOrderArgs) =>
      unwrap(
        apiClient.POST("/po/{id}/variation-order", {
          params: { path: { id } },
          body: { dir, amount, ...(reason ? { reason } : {}) },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: PO_KEY }),
  });
}
