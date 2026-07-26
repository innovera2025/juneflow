/*
 * Data hook for GLStatements (gl.statements) — the tenant financial statements (Balance Sheet +
 * P&L).
 *
 * GET /gl/reports/statements (apps/api/src/routes/gl.ts glStatements) returns the opaque
 * EntityOk OBJECT { balance_sheet, income_statement, currency_code } — NOT the B-014 paginated
 * list envelope. So this hook unwraps the WHOLE entity (no `.data` unpack) and hands it to
 * toStatements for narrowing. The read goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written model/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 *
 * The `?period=` query param is intentionally NOT sent: the backend does not yet filter by
 * period (C-180 deferred), so the response is the whole-catalogue statement set. The screen
 * renders that honestly (no fixed-period claim).
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

type Entity = components["schemas"]["Entity"];

const STATEMENTS_KEY = ["gl", "reports", "statements"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /gl/reports/statements — the tenant financial statements (opaque EntityOk object). */
export function useStatements(): UseQueryResult<Entity> {
  return useQuery<Entity>({
    queryKey: STATEMENTS_KEY,
    queryFn: () => unwrap(apiClient.GET("/gl/reports/statements")),
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}
