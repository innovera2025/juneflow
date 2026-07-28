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
 *   GET /subscription/me       -> the tenant's OWN current subscription (sub.mine). A SINGLE
 *                                 object (EntityOk, NOT a list envelope), enriched with its
 *                                 package (planWire) + live usage. A 404 (tenant has no
 *                                 subscription) resolves to null so the screen renders a
 *                                 graceful empty state instead of throwing.
 *
 * There is intentionally NO plan-change / signup / renew / cancel mutation hook: Phase-6
 * exposes only these three GETs (no PUT/POST subscribe on merged routes), so the plan-change
 * CTA + signup button + sub.mine renew/cancel are honest toast / honest-disabled in the
 * screens instead of wiring a write that cannot persist (see sub-plans.tsx / sub-mine.tsx).
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types these rows as Entity). */
type Row = Record<string, unknown>;

const SUB_PLANS_KEY = ["subscription-plans"] as const;
const SUB_INVOICES_KEY = ["subscription-invoices"] as const;
const SUB_ME_KEY = ["subscription-me"] as const;

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

/**
 * GET /subscription/me — the tenant's OWN current subscription (sub.mine). The handler
 * returns the row directly (`reply.send(me)`, EntityOk), so there is NO `.data` envelope —
 * this resolves to the object itself, or null. A 404 (this tenant has no subscription) is
 * NOT an error: it is checked BEFORE unwrap's throw and mapped to null so the screen shows a
 * graceful empty state. Every other error still rejects the query (isError).
 */
export function useSubscriptionMe() {
  return useQuery<Row | null>({
    queryKey: SUB_ME_KEY,
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET("/subscription/me");
      if (response.status === 404) return null;
      if (error !== undefined) throw error;
      return (data ?? null) as Row | null;
    },
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}
