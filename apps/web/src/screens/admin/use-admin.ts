/*
 * Data hooks for the Platform-Admin screens (admin.subs, admin.plans, admin.invoices) —
 * READ-ONLY. All four reads go through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md §5).
 *
 * These are owner-gated endpoints (registry section "platform", shown only when
 * viewMode="platform"; the backend 403s non-owners). unwrap() throws on a non-2xx, so a
 * 403 leaves the query in an error state with `data` undefined — the screens then render a
 * graceful skeleton -> empty state (no crash, no error banner), per the brief.
 *
 * The prototype held these in local arrays (subscription-admin.jsx SUBSCRIBERS + inv,
 * pkg-builder PKG_STORE, COMPANY_USERS). §0 rule 3 drops that mock; the server is the
 * system of record (Phase-6 Wave-0):
 *   GET /admin/packages    -> the S/M/L/Full plan catalog (rich packageWire).
 *   GET /admin/subscribers -> every tenant's subscription + joined company name/status.
 *   GET /admin/users       -> the cross-tenant user list (roster + per-company counts).
 *   GET /admin/invoices    -> every tenant's platform (subscription-billing) invoice.
 *
 * Every write in the prototype (create/edit package, suspend/activate, block, reset-pw,
 * invite, remind, export) has NO merged Phase-6 backend handler — the screens surface those
 * as honest toasts / honest-disabled instead of wiring a mutation that cannot persist.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types these rows as Entity). */
type Row = Record<string, unknown>;

const ADMIN_PACKAGES_KEY = ["admin-packages"] as const;
const ADMIN_SUBSCRIBERS_KEY = ["admin-subscribers"] as const;
const ADMIN_USERS_KEY = ["admin-users"] as const;
const ADMIN_INVOICES_KEY = ["admin-invoices"] as const;

/** True when a bearer token is present — the queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /admin/packages — the S/M/L/Full plan catalog (`.data`). */
export function useAdminPackages() {
  return useQuery<Row[]>({
    queryKey: ADMIN_PACKAGES_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/admin/packages"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /admin/subscribers — every tenant's subscription (`.data`). */
export function useAdminSubscribers() {
  return useQuery<Row[]>({
    queryKey: ADMIN_SUBSCRIBERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/admin/subscribers"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * GET /admin/users — the whole cross-tenant user list (`.data`). Fetched once; the screen
 * groups by company_id for the per-subscriber user count and filters client-side for the
 * CompanyControl roster (avoids a refetch per opened modal).
 */
export function useAdminUsers() {
  return useQuery<Row[]>({
    queryKey: ADMIN_USERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/admin/users"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /admin/invoices — every tenant's platform invoice (`.data`). */
export function useAdminInvoices() {
  return useQuery<Row[]>({
    queryKey: ADMIN_INVOICES_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/admin/invoices"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}
