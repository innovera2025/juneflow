/*
 * Data hook for the Executive Dashboard screen (group-C Wave-2b) — the one real
 * GET /analytics/portfolio read (apps/api/src/routes/analytics.ts, B-101). The call
 * goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written model / raw fetch (PLAN.md section 5, apps/web/CLAUDE.md).
 * The opaque Entity body is parsed to typed rows by exec-agg.ts (gate G3).
 *
 * Unlike the /dashboard/* reads this rollup is NOT project-scoped: it is a tenant-wide
 * cross-project aggregate (company-scope is enforced server-side through request.db).
 * The query is gated on a present bearer token (like use-dashboard / use-shell-data)
 * so the login screen never fires a 401. staleTime mirrors the dashboard hooks (30s).
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";
import { parsePortfolio, type Ent, type Portfolio } from "./exec-agg";

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /analytics/portfolio — executive per-project rollup + totals + type-mix. */
export function useAnalyticsPortfolio() {
  return useQuery<Portfolio | null>({
    queryKey: ["analytics", "portfolio"],
    queryFn: async () =>
      parsePortfolio((await unwrap(apiClient.GET("/analytics/portfolio"))) as Ent),
    enabled: authed(),
    staleTime: 30_000,
  });
}
