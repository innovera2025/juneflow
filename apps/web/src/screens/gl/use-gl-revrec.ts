/*
 * Data hooks for the Revenue Recognition & WIP screen (gl.revrec).
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md section 5, apps/web/CLAUDE.md). The prototype
 * (accounting-extra.jsx GLRevenueWIP) held REVREC_SEED + WIP_SEED in local state and mutated them
 * in place; here the server is the system of record and BOTH writes are money posts:
 *   GET  /gl/revrec              -> recognition rows; `unbilled` is SERVER-derived
 *                                   (recognized - billed), not recomputed here.
 *   POST /gl/revrec/{id}/post    -> recognize revenue. The amount is SERVER-computed
 *                                   (contract x pct - already-recognized) and the request body
 *                                   carries NOTHING that could change it — the prototype's
 *                                   `dueRev(r)` is display only. A row with nothing left to
 *                                   recognize 409s (revrec.ts), which the caller surfaces.
 *   GET  /gl/wip                 -> WIP balances; `balance` is SERVER-derived
 *                                   (material + subcon + overhead - transferred).
 *   POST /gl/wip/{id}/transfer   -> transfer WIP to COGS. Here `amount` IS an operator input, so
 *                                   it is sent — and the server re-validates it against the
 *                                   remaining balance (over-balance 409). The client-side bound
 *                                   in the form is a courtesy, never the control.
 *
 * Both posts invalidate BOTH lists: a recognition changes `recognized`, and a transfer changes
 * `transferred`, and each screen tab reads the other's totals in its KPI row.
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

/** Opaque list-row shape (the contract types both lists as Entity). */
type Row = Record<string, unknown>;

const REVREC_KEY = ["gl", "revrec"] as const;
const WIP_KEY = ["gl", "wip"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /gl/revrec — recognition rows (B-014 envelope `{ data, ... }`). */
export function useGlRevRec() {
  return useQuery<Row[]>({
    queryKey: REVREC_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/gl/revrec"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /gl/wip — work-in-progress balances (B-014 envelope `{ data, ... }`). */
export function useGlWip() {
  return useQuery<Row[]>({
    queryKey: WIP_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/gl/wip"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * POST /gl/revrec/{id}/post — recognize revenue for one row.
 *
 * The body is deliberately empty: the server computes the amount from the row it re-reads under
 * the transaction, so anything sent here would be ignored at best and misleading at worst. A 409
 * means there was nothing left to recognize (or a concurrent post won the compare-and-swap) and
 * must reach the operator as an error, never as a silent success.
 */
export function useGlRevRecPost(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/gl/revrec/{id}/post", { params: { path: { id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REVREC_KEY });
      void qc.invalidateQueries({ queryKey: WIP_KEY });
    },
  });
}

/** Arguments of a WIP -> COGS transfer: the row and the operator's amount. */
export interface TransferWipArgs {
  id: string;
  amount: number;
}

/**
 * POST /gl/wip/{id}/transfer — move `amount` of WIP into cost of sales.
 *
 * Unlike the recognition post, the amount here is a real operator input (how much of the balance
 * to move this time), so it is sent. The server validates it against the remaining balance and
 * 409s an over-transfer; the form's own bound exists to explain the limit, not to enforce it.
 */
export function useTransferGlWip(): UseMutationResult<unknown, unknown, TransferWipArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount }: TransferWipArgs) =>
      unwrap(
        apiClient.POST("/gl/wip/{id}/transfer", {
          params: { path: { id } },
          body: { amount } as Record<string, unknown>,
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: WIP_KEY });
      void qc.invalidateQueries({ queryKey: REVREC_KEY });
    },
  });
}
