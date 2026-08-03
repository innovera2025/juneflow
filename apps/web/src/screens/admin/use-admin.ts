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
 * server state (companies.status / users.status) and invalidates its own read key. The package
 * create/edit writes (POST /admin/packages, PUT /admin/packages/{id}) are likewise real (W1b,
 * B-197) — money = SERVER (price_y is DERIVED server-side; the client sends price_m only) and
 * both invalidate ADMIN_PACKAGES_KEY. The CompanyControl "Save settings" write is real too
 * (W1c, PUT /admin/subscribers/{id}/package) — it writes package_id + a seat override onto the
 * subscription row (money = SERVER) and invalidates ADMIN_SUBSCRIBERS_KEY. The remaining
 * prototype writes (reset-pw, invite, remind, export) have NO merged handler and stay honest
 * toasts / honest-disabled.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";
import { num } from "./admin-rows";

type Entity = components["schemas"]["Entity"];
/** Opaque list-row shape (the contract types these rows as Entity). */
type Row = Record<string, unknown>;

const ADMIN_PACKAGES_KEY = ["admin-packages"] as const;
const ADMIN_SUBSCRIBERS_KEY = ["admin-subscribers"] as const;
const ADMIN_SUBSCRIBERS_TOTALS_KEY = ["admin-subscribers-totals"] as const;
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
 * GET /admin/subscribers — the SERVER-computed revenue totals off the SAME envelope. The
 * admin.ts handler (computeMrrArr) attaches `mrr`/`arr` as siblings of `data`; useAdminSubscribers
 * drops them (its `.data` narrowing), so admin.overview reads the raw envelope here. money =
 * SERVER: the KPIs DISPLAY these authoritative totals — they are NOT re-derived client-side (the
 * client deriveMrr is deprecated for the KPI, per admin.ts). The typed 200 is the opaque
 * EntityList, so mrr/arr are runtime siblings read defensively through num() (0 when absent).
 */
export function useAdminOverviewTotals() {
  return useQuery<{ mrr: number; arr: number }>({
    queryKey: ADMIN_SUBSCRIBERS_TOTALS_KEY,
    queryFn: async () => {
      const env = (await unwrap(apiClient.GET("/admin/subscribers"))) as unknown as Record<string, unknown>;
      return { mrr: num(env.mrr), arr: num(env.arr) };
    },
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

/* ---------------------------------------------------------------------------------------- */
/* Package CRUD (W1b, B-197) — owner-gated create/edit; NO delete (B-196). The caller        */
/* composes the opaque body (buildPackageBody); money = SERVER, so it sends price_m only     */
/* (never price_y/yearly — the door derives it). Both invalidate the packages read.          */
/* ---------------------------------------------------------------------------------------- */

/** POST /admin/packages — create a plan; the door strips any client `id`. Body is opaque Entity. */
export function useCreatePackage(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/admin/packages", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_PACKAGES_KEY }),
  });
}

/** PUT /admin/packages/{id} — edit a plan; the id is the PATH param, never in the body. */
export function useUpdatePackage(id: string): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.PUT("/admin/packages/{id}", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_PACKAGES_KEY }),
  });
}

/* ---------------------------------------------------------------------------------------- */
/* Subscriber package change (W1c) — the owner-gated CompanyControl "Save settings" write.    */
/* PUT /admin/subscribers/{id}/package writes package_id + a seat override directly onto the  */
/* SUBSCRIPTION row (the id is that subscription id, in the PATH). Body = the opaque           */
/* {package_id, seats}; money = SERVER (no client price). Invalidates the subscribers read     */
/* ONLY — the package catalogue is untouched.                                                 */
/* ---------------------------------------------------------------------------------------- */

/** PUT /admin/subscribers/{id}/package — id = the SUBSCRIPTION id (PATH); body = {package_id, seats}. */
export function useSetSubscriberPackage(id: string): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.PUT("/admin/subscribers/{id}/package", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_SUBSCRIBERS_KEY }),
  });
}
