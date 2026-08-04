/*
 * Data hook for GLProjectPL (gl.projectpl) — the per-project profit & loss report
 * (revenue / cogs / gross-profit / sga / interest / tax / net-income + margins per project).
 *
 * GET /gl/reports/project-pl (apps/api/src/routes/gl.ts glProjectPl) returns the opaque EntityOk
 * OBJECT { projects: [...], totals: {...}, currency_code } — NOT the B-014 paginated list envelope.
 * So this hook unwraps the WHOLE entity (no `.data` unpack) and hands it to toProjectPl for
 * narrowing. The read goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written model/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 *
 * The `?period=` query param is intentionally NOT sent: the backend accepts it but does not filter
 * by period (jv.period_id NULL across the seed — C-180 deferred), so the response is the whole
 * per-project set. The screen renders that honestly (no fixed-period claim). money=NONE — the P&L
 * is SERVER-computed; this hook only READS it.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

type Entity = components["schemas"]["Entity"];

const PROJECT_PL_KEY = ["gl", "reports", "project-pl"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /gl/reports/project-pl — the tenant per-project P&L report (opaque EntityOk object). */
export function useGlProjectPl(): UseQueryResult<Entity> {
  return useQuery<Entity>({
    queryKey: PROJECT_PL_KEY,
    queryFn: () => unwrap(apiClient.GET("/gl/reports/project-pl")),
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}
