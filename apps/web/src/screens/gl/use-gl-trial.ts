/*
 * Data hook for GLTrialBalance (gl.trial) — the tenant trial balance.
 *
 * GET /gl/reports/trial-balance (apps/api/src/routes/gl.ts trialBalance) returns the opaque
 * EntityOk OBJECT { rows, totals, currency_code } — NOT the B-014 paginated list envelope. So
 * this hook unwraps the WHOLE entity (no `.data` unpack) and hands it to toTrialBalance for
 * narrowing. The read goes through the generated typed client (api-client.ts) + TanStack Query
 * via unwrap() — no hand-written model/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 *
 * The `?period=` query param is intentionally NOT sent: the backend does not yet filter by
 * period (C-180 deferred), so the response is the whole-catalogue trial balance. The screen
 * renders that honestly (no fixed-period claim).
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

type Entity = components["schemas"]["Entity"];

const TRIAL_BALANCE_KEY = ["gl", "reports", "trial-balance"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /gl/reports/trial-balance — the tenant trial balance (opaque EntityOk object). */
export function useTrialBalance(): UseQueryResult<Entity> {
  return useQuery<Entity>({
    queryKey: TRIAL_BALANCE_KEY,
    queryFn: () => unwrap(apiClient.GET("/gl/reports/trial-balance")),
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}
