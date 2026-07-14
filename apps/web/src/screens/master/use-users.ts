/*
 * Data hooks for UsersPermissions (P1-WEB-14) — the tenant's roles + users.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 * The prototype held roles/users in local state (master.jsx ROLE_PRESETS + the mock
 * add forms); here the server is the system of record (apps/api/src/routes/roles.ts +
 * users.ts, B-051):
 *   GET  /roles       -> the permission/approval roles + 11×5 matrix (B-014 envelope `.data`).
 *   POST /roles       -> create a role (name + approval limit + level + matrix).
 *   PUT  /roles/{id}  -> save a role's permission matrix ("Save" on the main screen).
 *   GET  /users       -> the tenant users (member counts derive from this, C10).
 *   POST /users       -> invite a user (server derives username + forces status invited).
 * Every mutation invalidates its own query so the list/counts re-render in the
 * server's canonical order. Bodies/responses are the opaque Entity (additionalProperties).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

type Entity = components["schemas"]["Entity"];
/** Opaque list-row shape (the contract types /roles and /users rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache keys — list reads + mutation invalidation. */
const ROLES_KEY = ["roles"] as const;
const USERS_KEY = ["users"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /roles — the tenant roles with their permission matrix. B-014 paginated
 * envelope `{ data, ... }`; the screen consumes the page rows (`data`).
 */
export function useRoleList() {
  return useQuery<Row[]>({
    queryKey: ROLES_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/roles"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * POST /roles — create a role. The caller composes the opaque body
 * ({ name, approval_limit, currency_code, approval_level, perms }); invalidates the
 * role list so the new role appears in the left panel.
 */
export function useCreateRole(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/roles", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ROLES_KEY }),
  });
}

/**
 * PUT /roles/{id} — save a role's permission matrix. The caller composes the opaque
 * body (the role's fields + serialised perms); invalidates the role list on success.
 */
export function useUpdateRole(): UseMutationResult<
  Entity,
  unknown,
  { id: string; body: Entity }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Entity }) =>
      unwrap(apiClient.PUT("/roles/{id}", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ROLES_KEY }),
  });
}

/**
 * GET /users — the tenant users. Consumed only for the per-role member count on the
 * UsersPermissions screen (countMembersByRole, C10). B-014 envelope `.data`.
 */
export function useUserList() {
  return useQuery<Row[]>({
    queryKey: USERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/users"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/**
 * POST /users — invite a user. The caller composes the opaque body
 * ({ name, email, dept, role_id, status }); the server derives username from email
 * and forces status "invited". Invalidates the user list so the role counts update.
 */
export function useCreateUser(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/users", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  });
}
