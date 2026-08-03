/*
 * Data hook for DMSCenter (B-221) — the tenant's DMS file list.
 *
 * The read goes through the generated typed client (api-client.ts) + TanStack Query
 * via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The
 * prototype held its files in a local DMS_SEED array (dms.jsx:14-28); here the server
 * is the system of record:
 *   GET /documents -> the tenant documents (listDocuments, B-014 paginated envelope
 *                     `.data`). The handler resolves project_id/by_user_id to NAMES
 *                     and returns rows newest-first, so the client needs no GET /users
 *                     or GET /projects lookup (unlike GRList's ref resolution).
 *
 * The whole tenant set is fetched once (no ?cat= param): the category rail badges,
 * the KPI totals, and the header count all aggregate over the full list, and the
 * category tabs filter it CLIENT-SIDE (dms.jsx L35, filterDocs) exactly as the
 * prototype does. money=NONE (the DMS list posts no JV/GL).
 *
 * GET-only: POST /documents (upload) and the version history are deferred (no
 * document_version table — B-221), so no mutation hook exists here.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types /documents rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the document catalogue. */
const DMS_KEY = ["documents"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /documents — the tenant DMS files for the table (B-014 envelope `data`). */
export function useDocuments() {
  return useQuery<Row[]>({
    queryKey: DMS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/documents"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}
