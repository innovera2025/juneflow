// Audit log plugin (STUB - not registered yet).
//
// Hard architectural rule (PLAN.md section 5, apps/api/CLAUDE.md):
//   EVERY mutation writes an AuditLog row via middleware - never hand-written
//   per endpoint. AuditLog shape per docs/handoff/data-dictionary.html:
//   { user, action, entity, before/after, ip, at } for every
//   create / update / approve / void.
//
// TODO(P0-BE-13): implement -
//   - hook mutating requests (POST / PUT / PATCH / DELETE)
//   - capture entity before/after snapshots, acting user, ip, UTC timestamp
//   - persist through @juneflow/db AuditLog table (P0-BE-06..09 schema)
//   - wrap with fastify-plugin so hooks apply across encapsulation contexts
//   - gate G3: unit tests prove every mutation produces an AuditLog row

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function auditLogPlugin(app: FastifyInstance): Promise<void> {
  app.addHook(
    "onResponse",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!MUTATING_METHODS.has(request.method)) return;
      // TODO(P0-BE-13): write AuditLog {user, action, entity, before/after, ip, at}.
      void reply;
      request.log.warn("NOT_IMPLEMENTED: audit-log middleware (P0-BE-13)");
    },
  );
}
