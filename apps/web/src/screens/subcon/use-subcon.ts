/*
 * Data hooks for SubconContracts (subcon.contracts port) — the tenant's subcon
 * contracts register.
 *
 * Every read/write goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md §5,
 * apps/web/CLAUDE.md). The prototype held its data in the local SUBC_CONTRACTS
 * array (subcon-accept.jsx:8-43); here the server is the system of record:
 *   GET  /subcon-contracts  -> the tenant subcon contracts (B-014 paginated
 *                              envelope `.data`; opaque Entity rows).
 *   POST /subcon-contracts  -> create a subcon contract, anchored on the active
 *                              project (project_id). The server owns the created
 *                              row; the create invalidates the list on success.
 *
 * The vendor + project catalogues the list/create pickers read reuse the shared
 * hooks (master/use-vendors, shell/use-shell-data) — the same tenant catalogues,
 * one shared query cache. Bodies/responses are the opaque Entity from the contract
 * (additionalProperties).
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
/** Opaque list-row shape (the contract types /subcon-contracts rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the subcon-contract register (list + invalidation). */
const SUBCON_CONTRACTS_KEY = ["subcon-contracts"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /subcon-contracts — the tenant's subcon contracts for the table. B-014
 * paginated envelope `{ data, ... }`; the screen consumes the page rows (`data`).
 */
export function useSubconContractList() {
  return useQuery<Row[]>({
    queryKey: SUBCON_CONTRACTS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/subcon-contracts"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * The POST /subcon-contracts body (createSubconContract requestBody — opaque
 * Entity, so index-signed). project_id/vendor_id/no are the server-required fields
 * (subcon.ts 400s without them); value/retention_pct/currency_code are the real
 * optional money fields. The distance/method autosplit is Wave-2 and NOT sent.
 */
export interface CreateSubconContractBody {
  [key: string]: unknown;
  project_id: string;
  vendor_id: string;
  no: string;
  value?: number;
  retention_pct?: number;
  currency_code?: string;
}

/**
 * POST /subcon-contracts — create a subcon contract anchored on the active
 * project. Invalidates the register on success so the new row appears.
 */
export function useCreateSubconContract(): UseMutationResult<
  Entity,
  unknown,
  CreateSubconContractBody
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSubconContractBody) =>
      unwrap(apiClient.POST("/subcon-contracts", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: SUBCON_CONTRACTS_KEY }),
  });
}

/* ---------------------------------------------------------------------------- *
 * SubconAccept (subcon.accept port, Wave-2 acceptance money-flow) hooks.
 *
 * The period register + the two chained accept ops (inspect-pass -> approve-payment)
 * and the reject op, all through the generated typed client (subcon-accept2.jsx
 * SubconAccept + AcceptForm). Every mutation invalidates the owning contract's
 * periods query so the acceptance table re-derives its badges/KPIs from the server.
 * ---------------------------------------------------------------------------- */

/** Cache key for one contract's work periods (list + invalidation). */
const periodsKey = (contractId: string) =>
  [...SUBCON_CONTRACTS_KEY, contractId, "periods"] as const;

/**
 * GET /subcon-contracts/{id}/periods — one contract's work periods (the acceptance
 * table). B-014 paginated envelope `{ data, ... }`; disabled until a contract id is
 * resolved (and a token is present). The screen sorts/derives from the page rows.
 */
export function useContractPeriods(contractId: string) {
  return useQuery<Row[]>({
    queryKey: periodsKey(contractId),
    queryFn: async () =>
      (
        await unwrap(
          apiClient.GET("/subcon-contracts/{id}/periods", {
            params: { path: { id: contractId } },
          }),
        )
      ).data ?? [],
    enabled: authed() && contractId !== "",
    staleTime: 60_000,
  });
}

/** Deliver variables — the period + its contract (for invalidation). */
export interface DeliverPeriodVars {
  periodId: string;
  contractId: string;
}

/**
 * POST /periods/{id}/deliver — hand a work period to the foreman: status
 * `pending | rejected` → `delivered`. 409 from any other status. Invalidates the
 * owning contract's periods on success, so the row's badge and its action
 * control both re-derive from the wire rather than from local state.
 *
 * THE `rejected` SOURCE IS THE POINT (B-371). A period the foreman turned back
 * used to have no door: `rejected` was written by inspect and left by nothing,
 * so fixed work could not be re-submitted and its money never reached AP. The
 * API opened THIS door rather than a new `/reinspect` one — deliver already
 * means "the contractor submits the period + its docs/photos", which is exactly
 * what a post-fix resubmission is, and it needed no contract or enum change
 * (see the long note at apps/api/src/routes/subcon.ts:912).
 *
 * The contract requires the body ENVELOPE but both of its fields are optional,
 * and the handler reads them through `strArray(pick(body, …))`, so `{}` is a
 * complete request. A re-delivery from the acceptance table sends exactly that:
 * the screen has no upload control, and sending `docs: []` / `photos: []` would
 * assert "the contractor attached nothing" where the truth is "this screen
 * cannot say". A first delivery, once a screen owns one, is the caller with
 * real arrays to send.
 */
export function useDeliverPeriod(): UseMutationResult<Entity, unknown, DeliverPeriodVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ periodId }: DeliverPeriodVars) =>
      unwrap(
        apiClient.POST("/periods/{id}/deliver", {
          params: { path: { id: periodId } },
          body: {},
        }),
      ),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: periodsKey(vars.contractId) }),
  });
}

/** One defect line sent with an inspect-REJECT (the failed checklist item). */
export interface InspectDefect {
  item: string;
  severity?: string;
  photo_before?: string;
}

/** Inspect variables — the period + its contract (for invalidation) + the decision. */
export interface InspectPeriodVars {
  periodId: string;
  contractId: string;
  result: "pass" | "reject";
  /** Defect list — only sent on a REJECT (a PASS never carries defects). */
  defects?: InspectDefect[];
}

/**
 * POST /periods/{id}/inspect — the foreman's inspect decision (pass|reject). A
 * REJECT sends the failed-checklist defects; a PASS sends none (the server ignores
 * defects on a pass). 409 when the period is not delivered|inspecting. Invalidates
 * the owning contract's periods on success.
 */
export function useInspectPeriod(): UseMutationResult<Entity, unknown, InspectPeriodVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ periodId, result, defects }: InspectPeriodVars) =>
      unwrap(
        apiClient.POST("/periods/{id}/inspect", {
          params: { path: { id: periodId } },
          body: { result, ...(defects && defects.length ? { defects } : {}) },
        }),
      ),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: periodsKey(vars.contractId) }),
  });
}

/** Approve-payment variables — the passed period + its contract (for invalidation). */
export interface ApprovePaymentVars {
  periodId: string;
  contractId: string;
}

/**
 * POST /periods/{id}/approve-payment — approve the payment of an inspected-PASS
 * period. B-107a: the request carries NO amount (the server is the money authority);
 * the response is the server-computed { gross, retention, net, ap_billing_id,
 * warning }. 409 when the period is not `passed`. Invalidates the periods on success.
 */
export function useApprovePayment(): UseMutationResult<Entity, unknown, ApprovePaymentVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ periodId }: ApprovePaymentVars) =>
      unwrap(
        apiClient.POST("/periods/{id}/approve-payment", {
          params: { path: { id: periodId } },
        }),
      ),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: periodsKey(vars.contractId) }),
  });
}

/** The chained accept helper the AcceptForm drives (accept = 2 server ops; reject = 1). */
export interface UseAcceptPeriod {
  /**
   * ACCEPT = inspect(pass) THEN approve-payment (empty body). Resolves to the
   * approve-payment response (the server money authority: net/retention/warning),
   * which the caller reads for the toast + the advisory flag.
   */
  accept: (periodId: string, contractId: string) => Promise<Entity>;
  /** REJECT = inspect(reject) with the failed-checklist defects. */
  reject: (vars: { periodId: string; contractId: string; defects: InspectDefect[] }) => Promise<Entity>;
  /** True while either op is in flight (disables the form buttons). */
  isPending: boolean;
}

/**
 * The AcceptForm's decision helper: ACCEPT chains inspect-pass -> approve-payment
 * (the client sends the trigger only — the money is the approve-payment response),
 * REJECT is a single inspect(reject). Each underlying mutation invalidates the
 * periods query, so the acceptance table refreshes after either decision.
 */
export function useAcceptPeriod(): UseAcceptPeriod {
  const inspect = useInspectPeriod();
  const approve = useApprovePayment();

  const accept = async (periodId: string, contractId: string): Promise<Entity> => {
    await inspect.mutateAsync({ periodId, contractId, result: "pass" });
    return approve.mutateAsync({ periodId, contractId });
  };

  const reject = (vars: { periodId: string; contractId: string; defects: InspectDefect[] }): Promise<Entity> =>
    inspect.mutateAsync({
      periodId: vars.periodId,
      contractId: vars.contractId,
      result: "reject",
      defects: vars.defects,
    });

  return { accept, reject, isPending: inspect.isPending || approve.isPending };
}
