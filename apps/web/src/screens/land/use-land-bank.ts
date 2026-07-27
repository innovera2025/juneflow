/*
 * Data hook for LandBank (P3-WEB) — the tenant's land-plot register, READ-ONLY.
 *
 * The read goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype
 * held plots in a local array (land.jsx LAND_PLOTS); here the server is the system of
 * record:
 *   GET /land/plots -> the plot register (B-014 paginated envelope `.data`). The full
 *                      tenant set is fetched; the screen lists it (read-only register).
 *
 * There is intentionally NO create/update hook: no POST/PUT /land/plots handler is
 * registered (land-sales.ts is GET-only), so a write would be a live 404. The screen
 * surfaces add/export as honest-disabled instead of wiring a mutation that cannot
 * persist. A future backend round (write bundle + the LA-2 columns) adds the handlers;
 * the create/update hooks land then.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types /land/plots rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the land-plot register. */
const LAND_PLOTS_KEY = ["land-plots"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /land/plots — the tenant land-plot register for the table. B-014 paginated
 * envelope `{ data, ... }`; the screen consumes the page rows (`data`).
 */
export function useLandPlots() {
  return useQuery<Row[]>({
    queryKey: LAND_PLOTS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/land/plots"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}
