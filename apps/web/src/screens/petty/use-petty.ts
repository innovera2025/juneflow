/*
 * Data hooks for the PettyCash screen (P2-WEB-75) — the tenant's petty-cash
 * transactions + the create-claim action.
 *
 * Every read/write goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md §5,
 * apps/web/CLAUDE.md). The prototype held the list in a local array (PETTY_TX); here
 * the server is the system of record:
 *   GET  /petty  -> petty-cash transactions (listPettyCash; B-014 paginated `.data`).
 *   POST /petty  -> create a petty-cash CLAIM. Typed body { category, amount,
 *                   description, txn_date?, project_id? }. money=SERVER: the server
 *                   owns the running number (PT-YYYY-NNNN), forces THB, enforces the
 *                   <= 10,000 per-claim cap (400 else), attributes by_user_id to the
 *                   caller, lands the claim `pending`, and posts the balanced JV later
 *                   through the GL inbox (Dr 5100 / Cr 1010) — NOT on create. The web
 *                   sends only the value the user typed and does ZERO money math.
 *                   Invalidates the petty list on success.
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
/** Opaque list-row shape (the contract types the petty rows as Entity). */
type Row = Record<string, unknown>;

/** The typed POST /petty request body (generated createPettyClaim contract). */
export type PettyClaimBody = {
  category: string;
  amount: number;
  description: string;
  txn_date?: string;
  project_id?: string;
};

const PETTY_KEY = ["petty"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /petty — the tenant petty-cash transactions (B-014 envelope `{ data, ... }`). */
export function usePettyList() {
  return useQuery<Row[]>({
    queryKey: PETTY_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/petty"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * POST /petty — create a petty-cash claim. The caller composes the typed body; the
 * server re-validates category/amount/description, enforces the cap, and owns the
 * number/currency/status/GL posting. Invalidates the list on success.
 */
export function useCreatePettyClaim(): UseMutationResult<Entity, unknown, PettyClaimBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PettyClaimBody) => unwrap(apiClient.POST("/petty", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PETTY_KEY }),
  });
}
