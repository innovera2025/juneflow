// GET /me — current user + role + approval_limits + package (P1-BE-01).
//
// Contract (openapi.yaml /me → Me): "user + role + approval_limits +
// package{menus,limits,ai_used}". Auth = bearer (B-028(ก)); the tenant-scope
// hook has already resolved the session (request.authUser) and attached the
// company-scoped request.db, so every read here is tenant-scoped by
// construction. The session links to the dictionary user row via email within
// company_id (unique per user_company_email_uq — see packages/db schema/auth.ts).
import type { FastifyInstance } from "fastify";
import {
  loadPackageUsage,
  loadRole,
  loadUserByEmail,
  serializeRole,
  serializeUser,
} from "./profile-data.js";

/** Register GET /me on the given (already /api/v1-prefixed) scope. */
export function registerMeRoute(app: FastifyInstance): void {
  app.get("/me", async (request, reply) => {
    const db = request.db;
    const authUser = request.authUser;
    // tenant-scope fails closed before this handler; guard anyway.
    if (!db || !authUser) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    const userRow = await loadUserByEmail(db, authUser.email);
    // A session whose user has no dictionary row in this tenant cannot be
    // served a profile — fail closed rather than inventing one.
    if (!userRow) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "No user record for this session in the tenant",
      });
    }

    const [role, pkg] = await Promise.all([
      loadRole(db, userRow.roleId),
      loadPackageUsage(db),
    ]);

    return reply.code(200).send({
      user: serializeUser(userRow),
      role: role ? serializeRole(role) : null,
      approval_limits: role?.approvalLimits ?? {},
      package: pkg,
    });
  });
}
