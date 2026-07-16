// Function-level authorization (B-082 F1 — the CRITICAL finding).
//
// The stored 11×5 `role.perms` matrix (packages/db platform.ts) is the tenant's
// RBAC contract, but before this module NO route read it to gate a CRUD action:
// any authenticated member could POST /users, POST /roles or PUT /roles/:id and
// rewrite their own role's perms + approval_level, then self-approve unlimited
// PR/PO/WO (in-tenant privilege escalation → financial-authz bypass).
//
// This module enforces the EXISTING perms model (it invents no new policy):
//   - user/role administration lives under the `master` module (master.jsx
//     UsersPermissions), so its create/edit rights gate /users + /roles;
//   - a caller may never elevate its OWN effective authority (raise its
//     approval_level or grant itself a perm it does not already hold).
//
// The caller's role is resolved the same way GET /me and the approval ladder do
// (authUser.email → tenant `user` row → `role`), so it is tenant-scoped
// throughout. Resolution is fail-closed: an unattributable caller (no session /
// no dictionary row / no role) has no perms and is denied.
import type { FastifyRequest } from "fastify";
import type { RolePerms, RolePermFlags } from "@juneflow/db/schema";
import { loadRole, loadUserByEmail } from "./profile-data.js";

/** The 5 rights of the perms matrix (master.jsx PERMS order). */
export const PERM_RIGHTS = [
  "view",
  "create",
  "edit",
  "approve",
  "cancel",
] as const;
export type PermRight = keyof RolePermFlags;

/**
 * The permission module that governs user/role administration. In the perms
 * matrix (packages/db seed MODULE_IDS) `master` is the system/master-data
 * module; the UsersPermissions screen lives under it, so its create/edit rights
 * are the admin capability that gates /users and /roles.
 */
export const MANAGEMENT_MODULE = "master";

/** The caller's resolved authorization context (dictionary user + role). */
export interface CallerAuthz {
  /** Dictionary `user` id (NOT the better-auth auth_user id). */
  userId: string;
  /** The caller's role id, or null when the user has no role. */
  roleId: string | null;
  /** The caller's approval tier (0..4); 0 when the user has no role. */
  approvalLevel: number;
  /** The caller's stored perms matrix (empty when the user has no role). */
  perms: RolePerms;
}

/**
 * Resolve the caller's dictionary user + role (tenant-scoped). Returns null when
 * the caller cannot be attributed — no session user, no dictionary row, so the
 * guards below fail closed (no perms → denied).
 */
export async function loadCaller(
  request: FastifyRequest,
): Promise<CallerAuthz | null> {
  const db = request.db;
  const authUser = request.authUser;
  if (!db || !authUser) return null;
  const user = await loadUserByEmail(db, authUser.email);
  if (!user) return null;
  const role = await loadRole(db, user.roleId);
  return {
    userId: user.id,
    roleId: user.roleId,
    approvalLevel: role?.approvalLevel ?? 0,
    perms: role?.perms ?? {},
  };
}

/** Does the (possibly absent) perms matrix carry perms[module][right]? Fail-closed false. */
export function permAllowed(
  perms: RolePerms | undefined,
  module: string,
  right: PermRight,
): boolean {
  return perms?.[module]?.[right] === true;
}

/**
 * Would applying `next` grant a right that `current` does not already hold? Used
 * to stop a caller editing its OWN role from handing itself a perm it lacks (the
 * self-elevation half of F1). Any module/right that flips off→on is a grant.
 */
export function grantsBeyond(current: RolePerms, next: RolePerms): boolean {
  for (const module of Object.keys(next)) {
    const nextFlags = next[module];
    const currentFlags = current[module];
    for (const right of PERM_RIGHTS) {
      if (nextFlags?.[right] && !currentFlags?.[right]) return true;
    }
  }
  return false;
}
