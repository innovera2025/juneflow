/*
 * Data hook for the Sales CRM module — the tenant's sales-lead register (sales.crm),
 * READ-ONLY. The P3 write bundle (add lead / advance stage / convert) is not filed
 * yet, so no mutation is wired here; the screen honest-disables those actions.
 *
 * Every read goes through the generated typed client (api-client.ts) + TanStack Query
 * via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The
 * prototype held its pipeline in the local LEADS_BY_STAGE mock (sales-crm.jsx
 * L191-212); here the server is the system of record:
 *   GET /sales/leads -> the tenant CRM leads (B-014 paginated envelope `.data`),
 *                       ordered newest-first (land-sales.ts listLeads).
 *
 * Owner resolution (owner_user_id -> name) reuses the master users list hook
 * (useUserList, GET /users) exactly as wo-list.tsx reuses useVendorList for its
 * subcontractor column — sharing the ["users"] cache instead of issuing a second
 * /users query. The board em-dashes any owner the map cannot resolve (never the uuid).
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types /sales/leads rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache key for the sales-lead register (read-only). */
const SALES_LEADS_KEY = ["sales", "leads"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /sales/leads — the tenant CRM leads for the kanban board (B-014 envelope
 * `.data`). Opaque Entity rows narrowed by toLeadRow (sales-crm-rows.ts). Read-only:
 * no mutation is wired (the P3 write bundle is not filed yet).
 */
export function useSalesLeads() {
  return useQuery<Row[]>({
    queryKey: SALES_LEADS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/sales/leads"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}
