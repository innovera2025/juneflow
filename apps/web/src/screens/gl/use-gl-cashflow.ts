/*
 * Data hook for GLCashFlow (gl.cashflow) — the tenant DIRECT-method cash-flow statement
 * (operating / investing / financing activities · opening / net-change / closing cash).
 *
 * GET /gl/reports/cashflow (apps/api/src/routes/gl.ts cashFlow) returns the opaque EntityOk
 * OBJECT { method, operating, investing, financing, opening_cash, net_change, closing_cash,
 * prior, currency_code } — NOT the B-014 paginated list envelope. So this hook unwraps the WHOLE
 * entity (no `.data` unpack) and hands it to toCashFlow for narrowing. The read goes through the
 * generated typed client (api-client.ts) + TanStack Query via unwrap() — no hand-written
 * model/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 *
 * The `?period=` query param is intentionally NOT sent: the backend accepts it but does not filter
 * by period (jv.period_id NULL across the seed — C-180 deferred), so the response is the whole
 * cash-movement set. The screen renders that honestly (no fixed-period claim).
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

type Entity = components["schemas"]["Entity"];

const CASHFLOW_KEY = ["gl", "reports", "cashflow"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /gl/reports/cashflow — the tenant DIRECT-method cash-flow statement (opaque EntityOk object). */
export function useCashFlow(): UseQueryResult<Entity> {
  return useQuery<Entity>({
    queryKey: CASHFLOW_KEY,
    queryFn: () => unwrap(apiClient.GET("/gl/reports/cashflow")),
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}
