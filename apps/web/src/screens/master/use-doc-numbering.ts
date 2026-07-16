/*
 * Data hook for MasterDocNum (P1-WEB-12) — the tenant's document running-number counters.
 *
 * Read goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype
 * held the counters in local state (master.jsx DOCNUM_SEED + setRows); here the server is
 * the system of record:
 *   GET /doc-numbering -> the counters (B-014 paginated envelope `.data`).
 *
 * The create/edit write path is intentionally NOT wired here (B-066): POST/PUT
 * /doc-numbering are typed in the contract but the API registers only GET
 * (doc-numbering.ts), so both the add button and the per-row edit are render-only stubs on
 * the screen (mirroring the B-050/B-065 deferred-write precedent). Bodies/responses are the
 * opaque Entity from the contract (additionalProperties).
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types /doc-numbering rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the doc-numbering catalogue. */
const DOC_NUMBERING_KEY = ["doc-numbering"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /doc-numbering — the tenant's running-number counters for the table. B-014 paginated
 * envelope `{ data, ... }`; the screen consumes the page rows (`data`).
 */
export function useDocNumberingList() {
  return useQuery<Row[]>({
    queryKey: DOC_NUMBERING_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/doc-numbering"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}
