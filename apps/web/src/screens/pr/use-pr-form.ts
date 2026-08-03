/*
 * Data hooks for PRForm (pr.form) — the DETAIL view of an EXISTING PR plus its
 * submit/approve/reject state machine (apps/api/src/routes/pr.ts).
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The
 * prototype held the doc + its lines + approvers in local mock arrays (pr-form.jsx ITEMS /
 * APPROVERS); here the server is the system of record:
 *   GET  /pr/{id}         -> the doc + its priced lines (getPr; `amount` is the real Σ of
 *                            the lines priced from the referenced BOQ items — C10).
 *   POST /pr/{id}/submit  -> draft -> pending.
 *   POST /pr/{id}/approve -> pending -> approved (TIERED authority, B-070: Procurement head
 *                            every PR; Project Manager > 500,000; MD > 2,000,000 — a caller below the
 *                            tier the amount demands gets 403 FORBIDDEN; a bad transition or
 *                            the B-149 optimistic-lock race gets 409 INVALID_STATE).
 *   POST /pr/{id}/reject  -> pending -> rejected, body {reason} REQUIRED (same tiered 403 +
 *                            409). The reason is validated server-side (400 when blank).
 * Every mutation invalidates the PR catalogue (["pr"]) + this doc's detail (["pr", id]) so
 * the refreshed status re-gates the action buttons. openapi-fetch never throws on an HTTP
 * error — unwrap() rethrows the flat Error envelope ({code, message}), which the screen
 * surfaces as an honest danger toast (it NEVER fabricates a success).
 *
 * The project-name join (the detail wire returns project_id only — WIRE GAP) reuses the
 * shared useProjects hook (shell/use-shell-data) — the same tenant catalogue, one cache.
 * Bodies/responses are the opaque Entity from the contract (additionalProperties).
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

/** Opaque detail shape (the contract types /pr/{id} as Entity). */
type Row = Record<string, unknown>;

/** Shared cache keys — the PR list + this doc's detail. */
const PR_KEY = ["pr"] as const;
const prDetailKey = (id: string) => ["pr", id] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /pr/{id} — the doc + its priced lines for the detail view. Disabled until an id is
 * present (the no-id "no PR selected" state never fires a request) and until authed.
 */
export function usePr(id: string) {
  return useQuery<Row>({
    queryKey: prDetailKey(id),
    queryFn: () => unwrap(apiClient.GET("/pr/{id}", { params: { path: { id } } })),
    enabled: authed() && id !== "",
    staleTime: 60_000,
  });
}

/** Invalidate the list + this doc's detail after a state-machine mutation. */
function useInvalidatePr(id: string): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: PR_KEY });
    void qc.invalidateQueries({ queryKey: prDetailKey(id) });
  };
}

/** POST /pr/{id}/submit — draft -> pending. */
export function useSubmitPr(id: string): UseMutationResult<unknown, unknown, void> {
  const invalidate = useInvalidatePr(id);
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST("/pr/{id}/submit", { params: { path: { id } } })),
    onSuccess: invalidate,
  });
}

/** POST /pr/{id}/approve — pending -> approved (tiered authority; 403 under-tier, 409 bad state). */
export function useApprovePr(id: string): UseMutationResult<unknown, unknown, void> {
  const invalidate = useInvalidatePr(id);
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST("/pr/{id}/approve", { params: { path: { id } } })),
    onSuccess: invalidate,
  });
}

/** POST /pr/{id}/reject {reason} — pending -> rejected (reason REQUIRED; same tiered 403 + 409). */
export function useRejectPr(id: string): UseMutationResult<unknown, unknown, string> {
  const invalidate = useInvalidatePr(id);
  return useMutation({
    mutationFn: (reason: string) =>
      unwrap(apiClient.POST("/pr/{id}/reject", { params: { path: { id } }, body: { reason } })),
    onSuccess: invalidate,
  });
}

/** Extract a server/browser error's message string (mirrors wo-detail / ap-pv errMessage). */
export function errMessage(err: unknown): string {
  return typeof err === "object" && err !== null && "message" in err
    ? String((err as { message?: unknown }).message ?? "")
    : "";
}
