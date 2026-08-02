/*
 * Data hooks for LandBank (P3-WEB) — the tenant's land-plot register (read + create).
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The
 * prototype held plots in a local array (land.jsx LAND_PLOTS); here the server is the
 * system of record:
 *   GET  /land/plots -> the plot register (B-014 paginated envelope `.data`). The full
 *                       tenant set is fetched; the screen lists it (read-only register).
 *   POST /land/plots -> create a plot (the add-plot form, land.jsx LandPlotForm). The
 *                       caller composes the opaque body from the form draft; the SERVER
 *                       generates the plot id (the prototype's editable client "L-" code is
 *                       a dropped mock, §0 rule 3) and defaults currency_code=THB. Money=
 *                       SERVER: price_per_rai is a plain stored attribute and area_sqm is a
 *                       rai->sqm UNIT conversion (rai*1600 + ngan*400 + wa*4) — neither is a
 *                       JV amount, so the create composes no Dr/Cr line. Invalidates the
 *                       register on success (the new plot appears in the table).
 *
 * Bodies/responses are the opaque Entity from the contract (additionalProperties).
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
/** Opaque list-row shape (the contract types /land/plots rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the land-plot register (list + invalidation). */
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

/**
 * POST /land/plots — create a land plot from the add-plot form draft. The caller composes
 * the opaque body ({ title, deed_no?, tenure, tambon?, amphoe?, prov?, gps?, price_per_rai,
 * area_sqm, project_id? }); the server generates the plot id and defaults currency_code=THB.
 * Invalidates the register on success (the new row surfaces on the next read).
 */
export function useCreatePlot(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/land/plots", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: LAND_PLOTS_KEY }),
  });
}
