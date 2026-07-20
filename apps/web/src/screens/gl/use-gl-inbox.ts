/*
 * Data hooks for the GL Posting Inbox screen (gl.inbox).
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md section 5, apps/web/CLAUDE.md). The prototype
 * held the inbox in local state (POST_INBOX); here the server is the system of record:
 *   GET  /gl/posting-inbox -> the source money docs + their resolved posting state
 *                             (apps/api/src/routes/gl.ts postingInbox; B-014 paginated `.data`).
 *   POST /gl/post          -> post the selected pending docs to the GL (gen JV). The op is
 *                             DECLARED in the contract (postGl, body { doc_ids: string[] }) but its
 *                             HANDLER IS NOT LIVE YET (B-122) -> the call 404s until it lands; the
 *                             caller surfaces that honestly (error toast), never a fabricated JV.
 *                             Invalidates the posting-inbox list on success.
 *
 * Bodies/responses are the opaque Entity/ActionOk from the contract.
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

/** Opaque list-row shape (the contract types the posting-inbox rows as Entity). */
type Row = Record<string, unknown>;

const POSTING_INBOX_KEY = ["gl", "posting-inbox"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /gl/posting-inbox — the tenant's source money docs + posting state (B-014 envelope). */
export function useGlInboxList() {
  return useQuery<Row[]>({
    queryKey: POSTING_INBOX_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/gl/posting-inbox"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** Request body of POST /gl/post (the selected pending docs to post). */
export interface GlPostBody {
  doc_ids: string[];
}

/**
 * POST /gl/post — post the selected pending docs to the GL. The op is declared (postGl) but the
 * handler is PENDING (B-122): the call 404s until it lands, so onError must surface the failure
 * honestly (the caller shows an error toast, never a fabricated JV). Invalidates the posting-inbox
 * list on success so the newly-posted rows flip to their real posted/jv_no state.
 */
export function useGlPost(): UseMutationResult<unknown, unknown, GlPostBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GlPostBody) => unwrap(apiClient.POST("/gl/post", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: POSTING_INBOX_KEY }),
  });
}
