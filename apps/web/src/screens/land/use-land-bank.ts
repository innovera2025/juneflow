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

/**
 * POST /land/plots/{id}/advance-stage — the plot-detail modal's "next stage" action
 * (land.jsx openPlotDetail L311 -> LandPipeline advance L69-75).
 *
 * The contract declares NO request body for this op (generated types
 * `advanceLandPlotStage.requestBody?: never`), so the call carries the plot id in the
 * PATH and NOTHING else. That is deliberate, not an omission: the SERVER owns which stage
 * comes next (apps/api land-sales.ts walks its own LAND_STAGES) and answers 409 at the
 * terminal stage. The browser never names a target stage, exactly as it never names a
 * money amount — the prototype's client-side `next = LAND_STAGES[idx + 1]` is a dropped
 * mock (§0 rule 3). The 200 body is `{ id, stage }`: the stage the server MOVED the plot
 * to, which is what the toast labels.
 *
 * Exported as a plain function (not only as a hook) so G3 can assert the exact call shape
 * — path, params, and the ABSENCE of a body — without a React tree.
 */
export async function advancePlotStageRequest(id: string): Promise<Record<string, unknown>> {
  const res = await unwrap(
    apiClient.POST("/land/plots/{id}/advance-stage", { params: { path: { id } } }),
  );
  return (res ?? {}) as Record<string, unknown>;
}

/**
 * The advance-stage mutation. Invalidates the plot register on success — the kanban IS
 * the stage axis, so a card that did not move columns would leave the control claiming a
 * change the screen never shows: the same lie-shaped defect this round closes.
 */
export function useAdvancePlotStage(): UseMutationResult<Record<string, unknown>, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: advancePlotStageRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: LAND_PLOTS_KEY }),
  });
}
