/*
 * Data hook for AuditLog — the tenant activity feed over the append-only
 * audit_log table (GET /audit-log, apps/api/src/routes/audit-log.ts).
 *
 * Read goes through the generated typed client (api-client.ts) + TanStack Query
 * via unwrap() — no hand-written model/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 * The prototype held AUDIT_ENTRIES locally (exec-audit.jsx); here the server is
 * the system of record. The only backed filter is ?action= (listAuditLog also
 * accepts ?entity=&user= but the screen exposes only the action filter — the
 * module filter is dropped: the thin row has no module field). An empty action
 * means "all"; it is sent as undefined so no filter param is serialized.
 *
 * The response is the B-014 list envelope; rows are the opaque Entity, narrowed
 * to AuditServerRow at the call site (audit-rows.ts).
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";
import type { AuditServerRow } from "./audit-rows";

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /audit-log?action= — the activity feed, filtered server-side by action. */
export function useAuditLog(action?: string) {
  const filter = action && action.length > 0 ? action : undefined;
  return useQuery<AuditServerRow[]>({
    queryKey: ["audit-log", filter ?? ""],
    queryFn: async () =>
      ((await unwrap(apiClient.GET("/audit-log", { params: { query: { action: filter } } })))
        .data ?? []) as AuditServerRow[],
    enabled: authed(),
    staleTime: 60_000,
  });
}
