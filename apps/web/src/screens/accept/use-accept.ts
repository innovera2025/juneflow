/*
 * Data hook for AcceptanceCenter (route `accept`, read-only) — the tenant's
 * acceptance-center queues.
 *
 * The read goes through the generated typed client (api-client.ts) + TanStack Query
 * via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The
 * prototype held every queue item in one local ACCEPT_ITEMS array (company-accept.jsx
 * L108-119); here the server is the system of record via GET /acceptance-center
 * (apps/api/src/routes/subcon.ts listAcceptanceCenter). There is NO merged "all"
 * endpoint and the wire is HETEROGENEOUS per ?type, so the screen fans in FOUR typed
 * GETs (one per feed) and unions them client-side for the "all"/"rejected" tabs:
 *   ?type=period (default) -> the subcon work-period queue {delivered|inspecting|rejected}.
 *   ?type=house            -> the handover queue (final awaiting work period per contract).
 *   ?type=pm               -> the PM work orders awaiting close (unsigned).
 *   ?type=gr               -> the goods-receipt return/defect queue (rejected > 0).
 * Each returns the B-014 paginated envelope `{ data, ... }`; the screen consumes the
 * page rows (`data`). The four queries have distinct cache keys (by ?type) so a switch
 * between tabs never refetches.
 *
 * READ-ONLY (§0 rule 3): this endpoint is display-only (money=SERVER, `amount` is
 * pre-computed) and exposes no write path — every row/modal action is honest read-only
 * navigation to the source module, so there is intentionally no mutation hook here.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types /acceptance-center rows as Entity). */
type Row = Record<string, unknown>;

/** The four acceptance-center feeds selected by ?type (contract enum). */
export type AcceptType = "period" | "house" | "pm" | "gr";

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /acceptance-center?type=<feed> — one acceptance-center feed for the table.
 * B-014 paginated envelope `{ data, ... }`; the screen consumes the page rows (`data`).
 * Call once per feed (the component calls this hook for all four types).
 */
export function useAcceptCenter(type: AcceptType) {
  return useQuery<Row[]>({
    queryKey: ["acceptance-center", type],
    queryFn: async () =>
      (await unwrap(apiClient.GET("/acceptance-center", { params: { query: { type } } }))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}
