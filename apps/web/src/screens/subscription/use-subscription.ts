/*
 * Data hooks for the tenant Subscription screens (sub.plans, sub.billing) — READ-ONLY.
 *
 * Both reads go through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype
 * held plans/invoices in local arrays (subscription.jsx SUB_PACKAGES / SUB_INVOICES); here
 * the server is the system of record (Phase-6 Wave-0, B-179 standalone status-only billing):
 *   GET /subscription/plans    -> the plan catalogue every tenant compares/upgrades against
 *                                 (B-014 paginated envelope `.data`). C1: the card grid is
 *                                 data-driven over this list (S/M/L/Full).
 *   GET /subscription/invoices -> the tenant's own billing history (minimal wire: amount,
 *                                 status, created_at — NO invoice-no / desc; see sub-rows.ts).
 *
 * There is intentionally NO plan-change / signup mutation hook: Phase-6 exposes only these
 * two GETs (no PUT/POST subscribe on merged routes), so the plan-change CTA + signup button
 * are honest toast / honest-disabled in the screen instead of wiring a write that cannot
 * persist (see sub-plans.tsx).
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types these rows as Entity). */
type Row = Record<string, unknown>;

const SUB_PLANS_KEY = ["subscription-plans"] as const;
const SUB_INVOICES_KEY = ["subscription-invoices"] as const;

/** True when a bearer token is present — the queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /subscription/plans — the plan catalogue (B-014 paginated envelope `.data`). */
export function useSubscriptionPlans() {
  return useQuery<Row[]>({
    queryKey: SUB_PLANS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/subscription/plans"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /subscription/invoices — the tenant's own billing history (`.data`). */
export function useSubscriptionInvoices() {
  return useQuery<Row[]>({
    queryKey: SUB_INVOICES_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/subscription/invoices"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}
