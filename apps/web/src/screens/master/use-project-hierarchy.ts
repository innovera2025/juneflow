/*
 * Data hooks for MasterProject (P1-WEB-09) — the active project's phase/block/unit
 * tree, the model catalogue (block colour/label join), and the project-type WBS
 * labels.
 *
 * Every read/write goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md §5). The
 * prototype held the block list in local state (BLOCK_SEED); here the server is the
 * system of record:
 *   GET /projects/{id}/hierarchy -> flat pre-order phase/block/unit nodes with REAL
 *     units/sold/built counts (apps/api/src/routes/project-nodes.ts, B-053).
 *   GET /models                  -> model catalogue for the block model_id join.
 *   GET /project-types           -> per-type hierarchy[] WBS labels (project-types.ts).
 *   POST /projects/{id}/nodes    -> create a block + its N empty unit nodes; the
 *     query is invalidated so the grid re-renders in the server's order.
 * All list reads are the B-014 envelope (`.data`).
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

/** Opaque row shapes — the contract types these as HierarchyNode / Entity (opaque). */
type Row = Record<string, unknown>;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /projects/{id}/hierarchy — the flat pre-order tree (phase -> block -> unit).
 * Disabled until a project id is known (the active project resolves from /projects).
 */
export function useProjectHierarchy(projectId: string | undefined) {
  return useQuery<Row[]>({
    queryKey: ["project-hierarchy", projectId],
    queryFn: async () =>
      (
        await unwrap(
          apiClient.GET("/projects/{id}/hierarchy", {
            params: { path: { id: projectId as string } },
          }),
        )
      ).data ?? [],
    enabled: authed() && !!projectId,
    staleTime: 60_000,
  });
}

/** GET /models — the tenant model catalogue (block model_id -> label/colour join). */
export function useModels() {
  return useQuery<Row[]>({
    queryKey: ["models"],
    queryFn: async () => (await unwrap(apiClient.GET("/models"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /project-types — the 4 product types with their hierarchy[] WBS labels. */
export function useProjectTypes() {
  return useQuery<Row[]>({
    queryKey: ["project-types"],
    queryFn: async () => (await unwrap(apiClient.GET("/project-types"))).data ?? [],
    enabled: authed(),
    staleTime: 30 * 60_000,
  });
}

/**
 * POST /projects/{id}/nodes — create a block under the project's first phase (the
 * server auto-generates the N empty unit nodes, max 200). Invalidates the hierarchy.
 */
export function useCreateProjectNode(
  projectId: string | undefined,
): UseMutationResult<Row, unknown, Row> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Row) =>
      unwrap(
        apiClient.POST("/projects/{id}/nodes", {
          params: { path: { id: projectId as string } },
          body: body as never,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-hierarchy", projectId] }),
  });
}
