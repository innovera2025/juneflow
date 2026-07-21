/*
 * Data hooks for the GL Period Close screen (gl.close).
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md section 5, apps/web/CLAUDE.md). The prototype
 * held the periods + close-history in local mock state (gl.jsx GLPeriodClose); here the server is
 * the system of record:
 *   GET  /gl/periods       -> the tenant accounting periods (locked + open), used BOTH to derive
 *                             the current open close-target AND to list the closed-period history
 *                             (apps/api/src/routes/gl.ts listPeriods; B-014 paginated `.data`).
 *   POST /gl/close-period  -> lock a period (LOCK-ONLY, Wei C-176). Body is { period } — a STRICT
 *                             CE 'YYYY-MM' key; the server re-validates it, requires the finance
 *                             `approve` permission (403 otherwise), and 409s a period already
 *                             locked. The caller surfaces those honestly (error toast), never a
 *                             fabricated close. Invalidates the periods query on success so the
 *                             newly-locked period moves from the open target into the history.
 *
 * Bodies/responses are the opaque Entity/ActionOk from the contract.
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

/** Opaque list-row shape (the contract types the period rows as Entity). */
type Row = Record<string, unknown>;

const PERIODS_KEY = ["gl", "periods"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /gl/periods — the tenant accounting periods (B-014 envelope `{ data, ... }`). */
export function useGlPeriods() {
  return useQuery<Row[]>({
    queryKey: PERIODS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/gl/periods"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** Request body of POST /gl/close-period (the CE 'YYYY-MM' period to lock). */
export interface CloseGlPeriodBody {
  period: string;
}

/**
 * POST /gl/close-period — lock the given period (LOCK-ONLY). The server re-validates the CE key,
 * gates on the finance `approve` permission (403), and 409s an already-locked period; onError must
 * surface those honestly (never a fabricated close). Invalidates the periods query on success so
 * the locked period flips into the close history.
 */
export function useCloseGlPeriod(): UseMutationResult<unknown, unknown, CloseGlPeriodBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CloseGlPeriodBody) => unwrap(apiClient.POST("/gl/close-period", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PERIODS_KEY }),
  });
}
