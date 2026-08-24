/*
 * Data hooks for the Sales Dashboard (sales.dashboard).
 *
 * Every read goes through the generated typed client + TanStack Query via unwrap() —
 * no hand-written models/fetch (PLAN.md section 5, apps/web/CLAUDE.md). There is no
 * sales-aggregate endpoint (B-222 recorded that, and it is still true), so the screen
 * composes the three reads that DO exist rather than waiting for one that does not:
 *   GET /sales/contracts          -> contract value, down, stage, transfer_at
 *   GET /sales/leads              -> the funnel's stage counts
 *   GET /projects                 -> the projects whose inventory the donut covers
 *   GET /projects/{id}/hierarchy  -> every unit node, carrying its real sale status
 *
 * WHY THE HIERARCHY IS READ PER PROJECT AND COMBINED. The donut's own title says "all
 * projects", and hierarchy is a per-project read. Reading only the first project would
 * report one project's inventory under a heading that claims the portfolio's — a wrong
 * number is worse than a missing one. The reads run concurrently and each is
 * best-effort: one project failing costs that project's units, not the whole card.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types these rows as Entity). */
type Row = Record<string, unknown>;

const CONTRACTS_KEY = ["sales", "contracts"] as const;
const LEADS_KEY = ["sales", "leads"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /sales/contracts — every contracted/booked unit (B-014 envelope `.data`). */
export function useSalesContractRows() {
  return useQuery<Row[]>({
    queryKey: CONTRACTS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/sales/contracts"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /sales/leads — the CRM pipeline behind the funnel. */
export function useSalesLeadRows() {
  return useQuery<Row[]>({
    queryKey: LEADS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/sales/leads"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /projects — the projects whose unit inventory the donut aggregates. */
export function useSalesProjects() {
  return useQuery<Row[]>({
    queryKey: ["projects", "for-sales-dashboard"],
    queryFn: async () => (await unwrap(apiClient.GET("/projects"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * Every unit node across every project, flattened.
 *
 * One query per project so a slow or failing project does not block the others, and
 * so React Query caches them individually. A project whose hierarchy fails yields no
 * nodes — the donut then reports fewer units, which is the honest outcome, rather
 * than the card disappearing.
 */
export function useAllProjectUnits(projectIds: readonly string[]) {
  const results = useQueries({
    queries: projectIds.map((id) => ({
      queryKey: ["projects", id, "hierarchy"] as const,
      queryFn: async () => {
        const body = (await unwrap(apiClient.GET("/projects/{id}/hierarchy", {
          params: { path: { id } },
        }))) as unknown;
        return flattenNodes(body);
      },
      enabled: authed() && id !== "",
      staleTime: 5 * 60_000,
    })),
  });
  return {
    nodes: results.flatMap((r) => r.data ?? []),
    isLoading: results.some((r) => r.isLoading),
    /** How many project reads actually answered — the donut's honesty about coverage. */
    loaded: results.filter((r) => r.data != null).length,
  };
}

/**
 * Flatten the hierarchy payload into a node list.
 *
 * Shape-agnostic on purpose: the endpoint returns a tree and the contract types it as
 * an opaque Entity, so this walks whatever nesting arrives rather than hard-coding a
 * path that a future contract change would silently break. Only objects carrying a
 * `kind` are collected; the caller filters to units.
 */
export function flattenNodes(value: unknown, out: Row[] = []): Row[] {
  if (Array.isArray(value)) {
    for (const v of value) flattenNodes(v, out);
    return out;
  }
  if (value != null && typeof value === "object") {
    const obj = value as Row;
    if (typeof obj.kind === "string") out.push(obj);
    for (const v of Object.values(obj)) {
      if (v != null && typeof v === "object") flattenNodes(v, out);
    }
  }
  return out;
}
