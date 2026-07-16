/*
 * Data hook for PRList (P2-WEB-09) — the tenant's purchase requisitions.
 *
 * The read goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written model/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype
 * held the docs in a local PR_ROWS array (pr-list.jsx:11-22); here the server is the
 * system of record:
 *   GET /pr -> the tenant PRs (listPr, B-014 paginated envelope `.data`). Each doc's
 *              `amount` is the real Σ of its lines priced from the referenced BOQ item
 *              (apps/api/src/routes/pr.ts), never the mock's hardcoded value.
 *
 * Creating a PR (the "สร้าง PR" action) opens the PR form screen (pr.form, not yet ported)
 * rather than posting from the list, so no create mutation lives here.
 *
 * Rows are the opaque Entity from the contract (additionalProperties).
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types /pr rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the PR catalogue. */
const PR_KEY = ["pr"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /pr — the tenant PRs for the table. B-014 paginated envelope `{ data, ... }`; the
 * screen consumes the page rows (`data`).
 */
export function usePrList() {
  return useQuery<Row[]>({
    queryKey: PR_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/pr"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}
