/*
 * Data hooks for the CAD/BIM AI take-off screen (boq.aiqto, P2-WEB-08).
 *
 * Every call goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The AI-QTO
 * backend (apps/api/src/routes/ai-qto.ts) is an explicit STUB (B-070 / PLAN.md §12): it
 * runs NO real IFC/CAD parse and every payload is stamped `stub:true`. These hooks wire the
 * three real endpoints; the screen surfaces the stub result honestly (DEMO badge + subtitle
 * disclaimer) and never renders the canned quantities as a real take-off.
 *
 *   POST /ai-qto/upload        -> mint a job handle; the `ai_per_month` quota gates it, so an
 *                                 over-quota tenant gets a real 402 (uploadAiQto).
 *   GET  /ai-qto/{job}         -> the stub job status (getAiQtoJob). The screen reads only
 *                                 `status`/`stub` to confirm completion — NOT the canned
 *                                 elements/items (§0 rule 3 / C10).
 *   POST /ai-qto/{job}/create-boq -> turn the reviewed mappings into a real draft BOQ
 *                                 (createBoqFromAiQto). See the WIRE GAP note below.
 *
 * WIRE GAP (project_id) — reported honestly, never worked around: the backend
 * create-boq REQUIRES a top-level `project_id` (ai-qto.ts L206-211, 400 without it), but the
 * SACRED contract's requestBody models ONLY `{ mappings? }` (openapi.yaml
 * createBoqFromAiQto L1209-1220), so the generated body type cannot carry project_id and a
 * typed call cannot send it. The mutation is therefore wired exactly to the contract; until
 * the contract adds project_id (a sacred patch — flagged to Wei), the create resolves to the
 * backend's honest 400 rather than a fabricated success.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

type Job = components["schemas"]["Job"];
type Entity = components["schemas"]["Entity"];
/** Opaque job/result shape (the contract types the GET as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the BOQ catalogue (invalidated when a take-off creates a doc). */
const BOQ_KEY = ["boq"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * POST /ai-qto/upload — mint a stub job handle for the selected model file. `file` is
 * multipart binary: openapi-typescript types the field as `string`, but a real upload
 * sends a Blob, so the value is cast at that single binary boundary (the standard
 * openapi-fetch multipart pattern) and a FormData is built by the bodySerializer. The
 * backend stub does not read the file content — it only checks the `ai_per_month` quota and
 * returns a `job_id` (or a real 402 when the tenant is over quota).
 */
export function useUploadAiQto(): UseMutationResult<Job, unknown, Blob> {
  return useMutation<Job, unknown, Blob>({
    mutationFn: (file: Blob) =>
      unwrap(
        apiClient.POST("/ai-qto/upload", {
          body: { file: file as unknown as string },
          bodySerializer: (body) => {
            const fd = new FormData();
            fd.append("file", body.file as unknown as Blob);
            return fd;
          },
        }),
      ),
  });
}

/**
 * GET /ai-qto/{job} — the stub job status. Enabled only once an upload has minted a job
 * handle. The stub job is stateless + immutable, so the result never goes stale.
 */
export function useAiQtoJob(jobId: string | null): UseQueryResult<Row> {
  return useQuery<Row>({
    queryKey: ["ai-qto", jobId],
    queryFn: () =>
      unwrap(apiClient.GET("/ai-qto/{job}", { params: { path: { job: jobId as string } } })),
    enabled: authed() && jobId != null,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * POST /ai-qto/{job}/create-boq — turn the reviewed mappings into a real draft BOQ. Wired
 * exactly to the contract body ({ mappings }); see the WIRE GAP (project_id) note above.
 * Invalidates the BOQ catalogue on success so the new draft appears in boq.list.
 */
export function useCreateBoqFromAiQto(
  jobId: string | null,
): UseMutationResult<Entity, unknown, Row[]> {
  const qc = useQueryClient();
  return useMutation<Entity, unknown, Row[]>({
    mutationFn: (mappings: Row[]) =>
      unwrap(
        apiClient.POST("/ai-qto/{job}/create-boq", {
          params: { path: { job: jobId ?? "" } },
          body: { mappings },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: BOQ_KEY }),
  });
}
