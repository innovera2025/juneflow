/*
 * Data hooks for the Platform-Admin screens (admin.subs, admin.plans, admin.invoices) —
 * four reads plus the four owner-gated subscriber/user state mutations (suspend/resume a
 * subscriber, block/unblock a user). Everything goes through the generated typed client
 * (api-client.ts) + TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md §5).
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
 * The four owner-gated state writes below (POST /admin/subscribers/{id}/suspend|resume,
 * POST /admin/users/{id}/block|unblock) are merged handlers and wired for real — each mutates
 * server state (companies.status / users.status) and invalidates its own read key. The
 * remaining prototype writes (create/edit package, save-settings, reset-pw, invite, remind,
 * export) have NO merged handler and stay honest toasts / honest-disabled in the screen.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
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

/* ---------------------------------------------------------------------------------------- */
/* Owner-gated state mutations (no request body; the id is a path param). Each unwrap()s the */
/* POST so a non-2xx (403 non-owner / 404 unknown id) lands in the mutation's error state,   */
/* and invalidates ONLY its own read key on success — the flipped company_status lives on    */
/* the subscribers row; the block/unblock roster is a client derivation of the users read.   */
/* ---------------------------------------------------------------------------------------- */

/** POST /admin/subscribers/{id}/suspend — id = the SUBSCRIPTION id; flips companies.status. */
export function useSuspendSubscriber(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.POST("/admin/subscribers/{id}/suspend", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_SUBSCRIBERS_KEY }),
  });
}

/** POST /admin/subscribers/{id}/resume — id = the SUBSCRIPTION id; flips companies.status. */
export function useResumeSubscriber(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.POST("/admin/subscribers/{id}/resume", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_SUBSCRIBERS_KEY }),
  });
}

/** POST /admin/users/{id}/block — id = the USER id; sets users.status='blocked'. */
export function useBlockUser(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.POST("/admin/users/{id}/block", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_USERS_KEY }),
  });
}

/** POST /admin/users/{id}/unblock — id = the USER id; sets users.status='active'. */
export function useUnblockUser(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.POST("/admin/users/{id}/unblock", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_USERS_KEY }),
  });
}
